const { Op } = require("sequelize");
const { pageOptions, paginated } = require("../utils/pagination");

class IrrigacaoService {
  constructor({ models, plantaService }) { Object.assign(this, { models, plantaService }); }

  async list(plantaId, usuarioId, query) {
    await this.plantaService.owned(plantaId, usuarioId);
    const where = { plantaId };
    if (query.resultado) where.resultado = query.resultado;
    if (query.simulado !== undefined) where.simulado = query.simulado;
    // No término sem início, a data conhecida do término é a referência do período.
    if (query.de || query.ate) {
      const { fn, col, where: sqlWhere } = require("sequelize");
      where[Op.and] = sqlWhere(fn("COALESCE", col("iniciada_em"), col("finalizada_em")), {
        ...(query.de ? { [Op.gte]: new Date(query.de) } : {}),
        ...(query.ate ? { [Op.lte]: new Date(query.ate) } : {}),
      });
    }
    const result = await this.models.RegistroIrrigacao.findAndCountAll({
      where, ...pageOptions(query), order: [["createdAt", "DESC"], ["id", "DESC"]],
    });
    result.rows = result.rows.map(row => ({ ...row.toJSON(), inicioAusente: !row.iniciadaEm }));
    return paginated(result, query);
  }

  // Executado dentro da transação MQTT, após o bloqueio do dispositivo e da zona.
  // false significa evento conflitante; nenhum efeito parcial será persistido.
  async record(data, zone, transaction) {
    if (!data.irrigacaoId || !["IRRIGACAO_INICIADA", "IRRIGACAO_FINALIZADA"].includes(data.tipo)) return true;
    const row = await this.models.RegistroIrrigacao.findOne({
      where: { dispositivoId: data.dispositivoId, irrigacaoId: data.irrigacaoId }, transaction,
    });
    const start = data.tipo === "IRRIGACAO_INICIADA";
    const date = new Date(data.medidoEm);
    if (row) {
      if (row.zonaId !== zone.id || (start ? row.iniciadaEm : row.finalizadaEm)) return false;
      if ((start && row.finalizadaEm && date > row.finalizadaEm) || (!start && row.iniciadaEm && date < row.iniciadaEm)) return false;
      if (data.configuracaoId && row.configuracaoId && data.configuracaoId !== row.configuracaoId) return false;
    }
    let config;
    if (data.configuracaoId) {
      config = await this.models.ConfiguracaoMqtt.findOne({
        where: { id: data.configuracaoId, dispositivoId: data.dispositivoId, zonaId: zone.id }, transaction,
      });
      if (!config) return false;
    }
    const changes = start
      ? { iniciadaEm: date, inicioRecebidoEm: new Date() }
      : { finalizadaEm: date, fimRecebidoEm: new Date(), resultado: data.resultado || "CONCLUIDA",
        duracaoSegundos: data.duracaoSegundos ?? null, motivoFalha: data.motivoFalha ?? null };
    if (config && !row?.configuracaoId) {
      changes.configuracaoId = config.id;
      changes.configuracaoSnapshot = config.dados;
    }
    if (row) await row.update(changes, { transaction });
    else await this.models.RegistroIrrigacao.create({
      dispositivoId: data.dispositivoId, zonaId: zone.id, plantaId: zone.plantaId || null,
      irrigacaoId: data.irrigacaoId, simulado: data.simulado, resultado: "EM_ANDAMENTO", ...changes,
    }, { transaction });
    return true;
  }
}

module.exports = IrrigacaoService;
