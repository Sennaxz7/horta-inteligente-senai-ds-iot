const mqtt = require("mqtt");
const { randomUUID } = require("node:crypto");
const { Op } = require("sequelize");
const schemas = require("../validators/mqttValidators");
const AppError = require("../utils/AppError");
const { pageOptions, paginated } = require("../utils/pagination");

class MqttService {
  constructor({ models, database, env, logger = console, connect = mqtt.connect }) {
    Object.assign(this, { models, database, env, logger, connect });
    this.connected = false;
    this.pending = new Set();
  }

  start() {
    if (!this.env.MQTT_ENABLED || this.client) return;
    this.client = this.connect(this.env.MQTT_URL, {
      clientId: this.env.MQTT_CLIENT_ID || `horta-api-${randomUUID()}`,
      username: this.env.MQTT_USERNAME || undefined, password: this.env.MQTT_PASSWORD || undefined,
      clean: true, reconnectPeriod: 5000, connectTimeout: 10000, queueQoSZero: false,
      resubscribe: false,
    });
    this.client.on("connect", () => {
      const topics = ["sensores", "status", "eventos", "config/ack"].map(s => `${this.env.MQTT_PREFIX}/+/${s}`);
      this.client.subscribe(topics, { qos: 1 }, (error, grants) => {
        this.connected = !error && grants?.length === topics.length && grants.every(g => g.qos < 128);
        this.logger.info(this.connected ? "MQTT: assinaturas ativas." : "MQTT: assinatura recusada.");
      });
    });
    for (const event of ["close", "offline", "reconnect"]) this.client.on(event, () => { this.connected = false; });
    this.client.on("error", () => this.logger.error("MQTT: falha de conexão ou processamento."));
    // MQTT.js chama handleMessage antes de confirmar o pacote QoS 1.
    // Só confirmamos após persistir; erros de banco forçam nova conexão.
    this.client.handleMessage = (packet, callback) => {
      const task = this.ingest(packet.topic, packet.payload, packet).then(() => callback(), error => {
        this.client.stream?.destroy();
        callback(error);
      });
      this.pending.add(task);
      task.finally(() => this.pending.delete(task));
    };
  }

  async stop() {
    this.connected = false;
    if (this.client) await new Promise(resolve => this.client.end(true, {}, resolve));
    await Promise.allSettled([...this.pending]);
    this.client = null;
  }

  async owned(id, usuarioId) {
    const device = await this.models.Dispositivo.findOne({ where: { id, usuarioId, arquivadoEm: null } });
    if (!device) throw new AppError(404, "DEVICE_NOT_FOUND", "Dispositivo não encontrado.");
    return device;
  }

  async zone(deviceId, zonaId) {
    const zone = await this.models.ZonaIrrigacao.findOne({ where: { id: zonaId, dispositivoId: deviceId } });
    if (!zone) throw new AppError(404, "ZONE_NOT_FOUND", "Zona não encontrada.");
    return zone;
  }

  async ingest(topic, payload, packet = {}) {
    const prefix = `${this.env.MQTT_PREFIX}/`;
    if (!topic.startsWith(prefix) || payload.length > 16384) return false;
    const [deviceId, ...parts] = topic.slice(prefix.length).split("/");
    const type = parts.join("/");
    const schema = { sensores: schemas.sensores, status: schemas.status, eventos: schemas.eventos, "config/ack": schemas.ack }[type];
    if (!schema || (packet.retain && type !== "status")) return false;
    let parsed;
    try { parsed = schema.safeParse(JSON.parse(payload.toString("utf8"))); } catch { return false; }
    if (!parsed.success || parsed.data.dispositivoId !== deviceId) return false;
    const data = parsed.data;
    if (this.env.MQTT_TEST_MODE && !data.simulado) return false;
    return this.database.transaction(async transaction => {
      const device = await this.models.Dispositivo.findOne({ where: { id: deviceId, arquivadoEm: null }, transaction, lock: transaction.LOCK.UPDATE });
      if (!device || device.simulado !== data.simulado) return false;
      const existing = await this.models.MensagemMqtt.findOne({ where: { dispositivoId: deviceId, mensagemId: data.mensagemId }, transaction });
      if (existing) return false;
      const zone = data.zonaId ? await this.models.ZonaIrrigacao.findOne({ where: { id: data.zonaId, dispositivoId: deviceId }, transaction, lock: transaction.LOCK.UPDATE }) : null;
      if (data.zonaId && !zone) return false;
      let config;
      if (type === "config/ack") {
        config = await this.models.ConfiguracaoMqtt.findOne({ where: { id: data.configuracaoId, dispositivoId: deviceId, zonaId: data.zonaId }, transaction, lock: transaction.LOCK.UPDATE });
        if (!config) return false;
      }
      const values = { ...data };
      if (type === "sensores") {
        values.nivelAguaPercentual = null;
        values.nivelAguaValido = false;
        if (zone.calibracao && data.distanciaAguaCm !== null) {
          const { distanciaVazioCm: empty, distanciaCheioCm: full } = zone.calibracao;
          if (data.distanciaAguaCm >= full && data.distanciaAguaCm <= empty) {
            values.nivelAguaPercentual = Math.round((empty - data.distanciaAguaCm) / (empty - full) * 10000) / 100;
            values.nivelAguaValido = true;
          }
        }
      }
      await this.models.MensagemMqtt.create({ dispositivoId: deviceId, mensagemId: data.mensagemId, zonaId: zone?.id || null, plantaId: zone?.plantaId || null, tipo: type, dados: values, medidoEm: data.medidoEm, recebidoEm: new Date() }, { transaction });
      const changes = {};
      if (!device.ultimaMensagemEm || new Date(data.medidoEm) > new Date(device.ultimaMensagemEm)) changes.ultimaMensagemEm = data.medidoEm;
      if (type === "status" && (!packet.retain || !device.ultimoStatus || Date.parse(data.medidoEm) > Date.parse(device.ultimoStatus.medidoEm))) changes.ultimoStatus = { ...data, recebidoEm: new Date().toISOString() };
      await device.update(changes, { transaction });
      if (config && config.status !== "CONFIRMADA") await config.update({ status: data.aplicada ? "CONFIRMADA" : "ERRO", confirmadaEm: data.aplicada ? new Date() : null }, { transaction });
      return true;
    });
  }

  async listDevices(usuarioId, query) {
    const result = await this.models.Dispositivo.findAndCountAll({ where: { usuarioId, arquivadoEm: null }, ...pageOptions(query), order: [["createdAt", "DESC"], ["id", "DESC"]] });
    return { ...paginated(result, query), mqtt: { habilitado: this.env.MQTT_ENABLED, conectado: this.connected } };
  }

  async saveZone(id, usuarioId, input, zonaId) {
    // Serializa vínculos por usuário para evitar atribuição simultânea da planta.
    return this.database.transaction(async transaction => {
      const owner = await this.models.Usuario.findByPk(usuarioId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!owner) throw new AppError(404, "USER_NOT_FOUND", "Usuário não encontrado.");
      await this.owned(id, usuarioId);
      if (input.plantaId) {
        const plant = await this.models.Planta.findOne({ where: { id: input.plantaId, usuarioId, arquivadaEm: null }, transaction });
        if (!plant) throw new AppError(404, "PLANT_NOT_FOUND", "Planta não encontrada.");
        const assigned = await this.models.ZonaIrrigacao.findOne({ where: { plantaId: input.plantaId }, transaction });
        if (assigned && assigned.id !== zonaId) throw new AppError(409, "PLANT_HAS_ZONE", "Planta já vinculada a uma zona.");
      }
      if (zonaId) {
        const zone = await this.zone(id, zonaId);
        return zone.update(input, { transaction });
      }
      return this.models.ZonaIrrigacao.create({ ...input, dispositivoId: id }, { transaction });
    });
  }

  async history(id, usuarioId, query, type) {
    await this.owned(id, usuarioId);
    return paginated(await this.models.MensagemMqtt.findAndCountAll({ where: { dispositivoId: id, tipo: type }, ...pageOptions(query), order: [["medidoEm", "DESC"], ["id", "DESC"]] }), query);
  }

  async synchronize(id, zonaId, usuarioId, input) {
    await this.owned(id, usuarioId);
    const zone = await this.zone(id, zonaId);
    if (JSON.stringify(input.calibracaoReservatorio) !== JSON.stringify(zone.calibracao)) {
      // Comparação por campos, pois JSONB não preserva a ordem das chaves.
      if (input.calibracaoReservatorio?.distanciaVazioCm !== zone.calibracao?.distanciaVazioCm || input.calibracaoReservatorio?.distanciaCheioCm !== zone.calibracao?.distanciaCheioCm) throw new AppError(409, "CALIBRATION_MISMATCH", "Use a calibração cadastrada na zona.");
    }
    if (!this.connected) throw new AppError(503, "MQTT_UNAVAILABLE", "Broker MQTT desconectado.");
    const config = await this.models.ConfiguracaoMqtt.create({ dispositivoId: id, zonaId, dados: input, status: "PENDENTE" });
    const message = { versao: 1, configuracaoId: config.id, dispositivoId: id, zonaId, ...input };
    await config.update({ status: "ENVIADA" });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout")), 10000);
        this.client.publish(`${this.env.MQTT_PREFIX}/${id}/config`, JSON.stringify(message), { qos: 1, retain: false }, error => { clearTimeout(timer); error ? reject(error) : resolve(); });
      });
    } catch {
      await this.models.ConfiguracaoMqtt.update({ status: "ERRO" }, { where: { id: config.id, status: { [Op.ne]: "CONFIRMADA" } } });
      throw new AppError(503, "MQTT_PUBLISH_FAILED", "Publicação não confirmada pelo broker. Consulte a configuração antes de repetir.");
    }
    return config.reload();
  }
}
module.exports = MqttService;
