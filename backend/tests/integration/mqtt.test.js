const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const mqtt = require("mqtt");
const request = require("supertest");
const { createDatabase } = require("../../src/config/database");
const { initializeModels } = require("../../src/models");
const { fixture, testEnvironment, validUser } = require("../helpers/fixture");
let db, models, service, app, token, otherToken, device, zone;
const prefix = `test-${randomUUID()}`;
const api = (method, route, body, auth = token) => {
  const call = request(app)[method](`/api/v1${route}`).auth(auth, { type: "bearer" });
  return body ? call.send(body) : call;
};
const message = (extra = {}) => ({ versao: 1, mensagemId: randomUUID(), dispositivoId: device.id, zonaId: zone.id, medidoEm: new Date().toISOString(), simulado: true, umidadeSoloPercentual: 45, distanciaAguaCm: 15, ...extra });
before(async () => {
  assert.equal(process.env.HORTA_EPHEMERAL_POSTGRES, "true");
  const env = testEnvironment({ DATABASE_URL: process.env.DATABASE_URL, MQTT_PREFIX: prefix });
  db = createDatabase(env); models = initializeModels(db);
  const f = await fixture({ env, models, database: db }); app = f.app; service = f.services.mqttService;
  for (const other of [false, true]) {
    const email = `mqtt-${randomUUID()}@example.com`;
    await request(app).post("/api/v1/auth/register").send({ ...validUser, email }).expect(201);
    const login = await request(app).post("/api/v1/auth/login").send({ email, senha: validUser.senha }).expect(200);
    if (other) otherToken = login.body.data.accessToken; else token = login.body.data.accessToken;
  }
  device = (await api("post", "/dispositivos", { nome: "Simulador", simulado: true }).expect(201)).body.data;
  zone = (await api("post", `/dispositivos/${device.id}/zonas`, { nome: "Vaso", calibracao: { distanciaVazioCm: 30, distanciaCheioCm: 5 } }).expect(201)).body.data;
});
after(async () => { if (service) await service.stop(); if (db) await db.close(); });
test("persiste leitura, calcula nível, rejeita inválidas e deduplica em concorrência", async () => {
  const data = message(); const topic = `${prefix}/${device.id}/sensores`;
  const results = await Promise.all([service.ingest(topic, Buffer.from(JSON.stringify(data))), service.ingest(topic, Buffer.from(JSON.stringify(data)))]);
  assert.equal(results.filter(Boolean).length, 1);
  const saved = await models.MensagemMqtt.findOne({ where: { mensagemId: data.mensagemId } });
  assert.equal(saved.dados.nivelAguaPercentual, 60);
  for (const extra of [{ umidadeSoloPercentual: 101 }, { simulado: false }, { dispositivoId: randomUUID() }, { zonaId: randomUUID() }]) assert.equal(await service.ingest(topic, Buffer.from(JSON.stringify(message(extra)))), false);
  assert.equal(await service.ingest(topic, Buffer.from(JSON.stringify(message())), { retain: true }), false);
  const invalidDistance = message({ distanciaAguaCm: 35 });
  await service.ingest(topic, Buffer.from(JSON.stringify(invalidDistance)));
  assert.equal((await models.MensagemMqtt.findOne({ where: { mensagemId: invalidDistance.mensagemId } })).dados.nivelAguaPercentual, null);
});
test("API exige autenticação e isola dispositivos entre usuários", async () => {
  await request(app).get("/api/v1/dispositivos").expect(401);
  await api("get", `/dispositivos/${device.id}/leituras`, null, otherToken).expect(404);
  const history = await api("get", `/dispositivos/${device.id}/leituras`).expect(200);
  assert.ok(history.body.meta.total >= 2);
  await api("post", `/dispositivos/${device.id}/zonas/${zone.id}/sincronizacao`, { intervaloLeituraSegundos: 5, automacaoHabilitada: true, calibracaoReservatorio: zone.calibracao }).expect(422);
});
test("ACK só confirma configuração do dispositivo e zona corretos", async () => {
  const config = await models.ConfiguracaoMqtt.create({ dispositivoId: device.id, zonaId: zone.id, dados: {}, status: "ENVIADA" });
  const ack = { versao: 1, mensagemId: randomUUID(), dispositivoId: device.id, zonaId: zone.id, medidoEm: new Date().toISOString(), simulado: true, configuracaoId: config.id, aplicada: true };
  assert.equal(await service.ingest(`${prefix}/${device.id}/config/ack`, Buffer.from(JSON.stringify(ack))), true);
  assert.equal((await config.reload()).status, "CONFIRMADA");
});
test("vínculo de planta preserva histórico e bloqueia associação de terceiros", async () => {
  const plantResponse = await api("post", "/plantas", { nome: "Vaso MQTT", faseAtual: "SEMENTE" }).expect(201);
  const plantaId = plantResponse.body.data.planta.id;
  await api("put", `/dispositivos/${device.id}/zonas/${zone.id}`, { nome: "Vaso", plantaId, calibracao: zone.calibracao }).expect(200);
  const data = message(); await service.ingest(`${prefix}/${device.id}/sensores`, Buffer.from(JSON.stringify(data)));
  await api("put", `/dispositivos/${device.id}/zonas/${zone.id}`, { nome: "Vaso", plantaId: null, calibracao: zone.calibracao }).expect(200);
  const history = await api("get", `/plantas/${plantaId}/leituras`).expect(200);
  assert.equal(history.body.data[0].mensagemId, data.mensagemId);
  await api("get", `/plantas/${plantaId}/leituras`, null, otherToken).expect(404);
  await api("patch", `/dispositivos/${device.id}`, { nome: "Renomeado", simulado: false }).expect(422);
});
test("MQTT TCP real: broker local entrega leitura e configuração recebe ACK", { timeout: 20000 }, async t => {
  const binary = process.platform === "win32" ? "C:/Program Files/mosquitto/mosquitto.exe" : "/usr/sbin/mosquitto";
  if (!fs.existsSync(binary)) return t.skip("Mosquitto local não instalado");
  const socket = net.createServer(); await new Promise(r => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const broker = spawn(binary, ["-p", String(port)], { windowsHide: true, stdio: "ignore" });
  let publisher, simulator;
  const until = async fn => { for (let i = 0; i < 150; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error("Timeout aguardando MQTT"); };
  try {
    service.env = { ...service.env, MQTT_ENABLED: true, MQTT_URL: `mqtt://127.0.0.1:${port}` };
    service.start(); await until(() => service.connected);
    publisher = mqtt.connect(service.env.MQTT_URL);
    await new Promise((resolve, reject) => { publisher.once("connect", resolve); publisher.once("error", reject); });
    await new Promise((resolve, reject) => publisher.subscribe(`${prefix}/${device.id}/config`, { qos: 1 }, e => e ? reject(e) : resolve()));
    simulator = spawn(process.execPath, ["scripts/simulate-mqtt.js"], { windowsHide: true, stdio: "ignore", env: { ...process.env, MQTT_URL: service.env.MQTT_URL, MQTT_PREFIX: prefix, MQTT_SIM_DEVICE_ID: device.id, MQTT_SIM_ZONE_ID: zone.id, MQTT_SIM_USERNAME: "", MQTT_SIM_PASSWORD: "" } });
    await until(async () => (await models.Dispositivo.findByPk(device.id)).ultimoStatus?.estado === "ONLINE");
    const data = message(); publisher.publish(`${prefix}/${device.id}/sensores`, JSON.stringify(data), { qos: 1 });
    await until(() => models.MensagemMqtt.findOne({ where: { mensagemId: data.mensagemId } }));
    const response = await api("post", `/dispositivos/${device.id}/zonas/${zone.id}/sincronizacao`, { intervaloLeituraSegundos: 5, automacaoHabilitada: false, calibracaoReservatorio: zone.calibracao }).expect(202);
    await until(async () => (await models.ConfiguracaoMqtt.findByPk(response.body.data.id)).status === "CONFIRMADA");
  } finally {
    if (simulator) simulator.kill();
    if (publisher) await new Promise(r => publisher.end(true, {}, r));
    await service.stop(); broker.kill();
  }
});
