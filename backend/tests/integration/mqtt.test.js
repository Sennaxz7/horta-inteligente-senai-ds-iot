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
test("PUT de zona pela planta preserva calibração, é idempotente e impede vínculos conflitantes", async () => {
  const plant = async name => (await api("post", "/plantas", { nome: name, faseAtual: "MUDA" }).expect(201)).body.data.planta;
  const first = await plant("Planta para vínculo");
  const second = await plant("Outra planta");
  const archived = await plant("Planta arquivada");
  await api("delete", `/plantas/${archived.id}`).expect(204);
  const calibration = { distanciaVazioCm: 25, distanciaCheioCm: 5 };
  const createZone = async () => (await api("post", `/dispositivos/${device.id}/zonas`, { nome: "Zona livre", calibracao: calibration }).expect(201)).body.data;
  const target = await createZone();
  const alternative = await createZone();
  const body = { dispositivoId: device.id, zonaId: target.id };
  const route = `/plantas/${first.id}/zona`;
  await request(app).put(`/api/v1${route}`).send(body).expect(401);
  await api("put", route, { ...body, zonaId: "invalido" }).expect(422);
  await api("put", route, body, otherToken).expect(404);
  await api("put", `/plantas/${archived.id}/zona`, body).expect(404);
  const saved = (await api("put", route, body).expect(200)).body.data;
  assert.equal(saved.plantaId, first.id);
  assert.equal(saved.nome, target.nome);
  assert.deepEqual(saved.calibracao, calibration);
  assert.deepEqual((await api("put", route, body).expect(200)).body.data, saved);
  await api("put", `/plantas/${second.id}/zona`, body).expect(409);
  await api("put", route, { ...body, zonaId: alternative.id }).expect(409);
  assert.equal((await models.ZonaIrrigacao.findByPk(target.id)).plantaId, first.id);
  assert.equal((await models.ZonaIrrigacao.findByPk(alternative.id)).plantaId, null);
});
test("DELETE de zona libera o vínculo sem apagar leituras ou irrigações", async () => {
  const plant = async nome => (await api("post", "/plantas", { nome, faseAtual: "MUDA" }).expect(201)).body.data.planta;
  const original = await plant("Planta a desvincular");
  const next = await plant("Próxima planta");
  const calibration = { distanciaVazioCm: 28, distanciaCheioCm: 6 };
  const target = (await api("post", `/dispositivos/${device.id}/zonas`, { nome: "Zona para liberar", plantaId: original.id, calibracao: calibration }).expect(201)).body.data;
  const reading = message({ zonaId: target.id });
  const event = { versao: 1, mensagemId: randomUUID(), dispositivoId: device.id, zonaId: target.id, medidoEm: reading.medidoEm, simulado: true, tipo: "IRRIGACAO_INICIADA", irrigacaoId: randomUUID() };
  assert.equal(await service.ingest(`${prefix}/${device.id}/sensores`, Buffer.from(JSON.stringify(reading))), true);
  assert.equal(await service.ingest(`${prefix}/${device.id}/eventos`, Buffer.from(JSON.stringify(event))), true);
  const path = `/plantas/${original.id}/zona`;
  await request(app).delete(`/api/v1${path}`).expect(401);
  await api("delete", path, null, otherToken).expect(404);
  assert.equal((await models.ZonaIrrigacao.findByPk(target.id)).plantaId, original.id);
  const removed = await api("delete", path).expect(204);
  assert.equal(removed.text, "");
  await api("delete", path).expect(204);
  const freed = await models.ZonaIrrigacao.findByPk(target.id);
  assert.equal(freed.plantaId, null);
  assert.equal(freed.nome, target.nome);
  assert.deepEqual(freed.calibracao, calibration);
  await api("put", `/plantas/${next.id}/zona`, { dispositivoId: device.id, zonaId: target.id }).expect(200);
  const readings = (await api("get", `/plantas/${original.id}/leituras`).expect(200)).body.data;
  assert.equal(readings[0].mensagemId, reading.mensagemId);
  const irrigations = (await api("get", `/plantas/${original.id}/irrigacoes`).expect(200)).body.data;
  assert.equal(irrigations[0].irrigacaoId, event.irrigacaoId);
  assert.equal((await api("get", `/plantas/${next.id}/irrigacoes`).expect(200)).body.meta.total, 0);
});
test("PATCH de zona preserva campos omitidos, aceita null e valida acesso e vínculo", async () => {
  const createPlant = async nome => (await api("post", "/plantas", { nome, faseAtual: "MUDA" }).expect(201)).body.data.planta;
  const plant = await createPlant("Planta para edição");
  const assigned = await createPlant("Planta em outra zona");
  const calibration = { distanciaVazioCm: 28, distanciaCheioCm: 6 };
  const zones = `/dispositivos/${device.id}/zonas`;
  const target = (await api("post", zones, { nome: "Zona para edição", plantaId: plant.id, calibracao: calibration }).expect(201)).body.data;
  await api("post", zones, { nome: "Outra zona", plantaId: assigned.id }).expect(201);
  const path = `${zones}/${target.id}`;
  await api("patch", path, { nome: "Sem acesso" }, otherToken).expect(404);
  for (const body of [{}, { dispositivoId: device.id }, { calibracao: { distanciaCheioCm: 4 } }]) {
    await api("patch", path, body).expect(422);
  }
  await api("patch", path, { plantaId: assigned.id }).expect(409);
  const renamed = (await api("patch", path, { nome: "Vaso da varanda" }).expect(200)).body.data;
  assert.equal(renamed.nome, "Vaso da varanda");
  assert.equal(renamed.plantaId, plant.id);
  assert.deepEqual(renamed.calibracao, calibration);
  const unbound = (await api("patch", path, { plantaId: null }).expect(200)).body.data;
  assert.equal(unbound.plantaId, null);
  assert.deepEqual(unbound.calibracao, calibration);
  const cleared = (await api("patch", path, { calibracao: null }).expect(200)).body.data;
  assert.equal(cleared.calibracao, null);
  assert.equal(cleared.nome, renamed.nome);
});
test("histórico unificado pagina os quatro tipos por data e preserva a origem após desvínculo", async () => {
  const plant = (await api("post", "/plantas", { nome: "Vaso com histórico", faseAtual: "MUDA" }).expect(201)).body.data.planta;
  const target = (await api("post", `/dispositivos/${device.id}/zonas`, { nome: "Zona da linha do tempo", plantaId: plant.id }).expect(201)).body.data;
  const date = hour => `2025-01-01T${hour}:00:00Z`;
  const growth = await models.HistoricoCrescimento.create({ plantaId: plant.id, fase: "MUDA", registradoEm: date("08"), alturaCm: 8.5 });
  const foto = await models.FotoPlanta.create({
    plantaId: plant.id, chaveArquivo: `${randomUUID()}.jpg`, mimeType: "image/jpeg",
    tamanhoBytes: 1, capturadaEm: date("09"), tipo: "IDENTIFICACAO",
  });
  const identification = await models.IdentificacaoPlanta.create({ plantaId: plant.id, fotoId: foto.id, status: "PENDENTE", createdAt: date("09") });
  const ingest = (type, data) => service.ingest(`${prefix}/${device.id}/${type}`, Buffer.from(JSON.stringify(data)));
  const reading = message({ zonaId: target.id, medidoEm: date("10") });
  assert.equal(await ingest("sensores", reading), true);
  const execution = randomUUID();
  assert.equal(await ingest("eventos", {
    versao: 1, mensagemId: randomUUID(), dispositivoId: device.id, zonaId: target.id,
    medidoEm: date("10"), simulado: true, tipo: "IRRIGACAO_FINALIZADA",
    irrigacaoId: execution, duracaoSegundos: 2,
  }), true);
  await api("delete", `/plantas/${plant.id}/zona`).expect(204);
  await api("delete", `/plantas/${plant.id}`).expect(204);

  const path = `/plantas/${plant.id}/historico`;
  const range = `de=${date("08")}&ate=${date("10")}`;
  const first = (await api("get", `${path}?${range}&limite=2`).expect(200)).body;
  assert.deepEqual(first.meta, { pagina: 1, limite: 2, total: 4, totalPaginas: 2 });
  assert.deepEqual(first.data.map(item => item.tipo), ["IRRIGACAO", "LEITURA"]);
  assert.equal(first.data[0].dados.irrigacaoId, execution);
  assert.equal(first.data[0].dados.iniciadaEm, null);
  assert.equal(Date.parse(first.data[0].data), Date.parse(date("10")));
  assert.equal(first.data[1].dados.umidadeSoloPercentual, 45);
  const second = (await api("get", `${path}?${range}&limite=2&pagina=2`).expect(200)).body;
  assert.deepEqual(second.data.map(item => item.id), [identification.id, growth.id]);
  assert.equal(second.data[0].dados.fotoId, foto.id);
  assert.equal(second.data[0].dados.chaveArquivo, undefined);
  const filtered = (await api("get", `${path}?${range}&tipo=CRESCIMENTO`).expect(200)).body;
  assert.equal(filtered.meta.total, 1);
  assert.equal(filtered.data[0].dados.alturaCm, 8.5);
  const empty = (await api("get", `${path}?${range}&limite=2&pagina=3`).expect(200)).body;
  assert.deepEqual(empty.data, []);
  assert.equal(empty.meta.total, 4);

  await request(app).get(`/api/v1${path}`).expect(401);
  await api("get", path, null, otherToken).expect(403);
  await api("get", `/plantas/${randomUUID()}/historico`).expect(404);
  for (const query of ["tipo=OUTRO", "limite=101", `de=${date("10")}&ate=${date("08")}`]) {
    await api("get", `${path}?${query}`).expect(422);
  }
});
test("dashboard resume somente a horta autenticada e limita as listas sem reduzir os totais", async () => {
  await request(app).get("/api/v1/dashboard").expect(401);
  await api("get", "/dashboard?limite=101").expect(422);
  await api("get", `/dashboard?usuarioId=${device.usuarioId}`).expect(422);
  const other = (method, path, body) => api(method, path, body, otherToken);
  const empty = (await other("get", "/dashboard").expect(200)).body.data;
  assert.deepEqual(empty.plantas, { total: 0, ativas: 0, arquivadas: 0, ativasIdentificadas: 0, ativasPorFase: {} });
  assert.deepEqual(empty.dispositivos.itens, []);
  assert.deepEqual(empty.ultimasLeituras, []);
  assert.deepEqual(empty.irrigacoesRecentes, []);

  const species = (await other("post", "/especies", { nomeCientifico: `Teste ${randomUUID()}` }).expect(201)).body.data.especie;
  const createPlant = async (nome, faseAtual, especieId) => (await other("post", "/plantas", { nome, faseAtual, especieId }).expect(201)).body.data.planta;
  const first = await createPlant("Planta monitorada", "MUDA", species.id);
  const second = await createPlant("Outra planta ativa", "SEMENTE");
  const archived = await createPlant("Planta arquivada", "MUDA");
  const createDevice = async nome => (await other("post", "/dispositivos", { nome, simulado: true }).expect(201)).body.data;
  const online = await createDevice("Dispositivo com status");
  const idle = await createDevice("Dispositivo sem status");
  const archivedDevice = await createDevice("Dispositivo arquivado");
  await other("delete", `/dispositivos/${archivedDevice.id}`).expect(204);
  const createZone = async planta => (await other("post", `/dispositivos/${online.id}/zonas`, { nome: planta.nome, plantaId: planta.id }).expect(201)).body.data;
  const [a, b, c] = [await createZone(first), await createZone(second), await createZone(archived)];
  const at = minute => `2025-01-01T10:${minute}:00Z`;
  const send = async (type, medidoEm, extra) => {
    const payload = { versao: 1, mensagemId: randomUUID(), dispositivoId: online.id, medidoEm, simulado: true, ...extra };
    assert.equal(await service.ingest(`${prefix}/${online.id}/${type}`, Buffer.from(JSON.stringify(payload))), true);
  };
  await send("status", at("00"), { estado: "ONLINE" });
  for (const [zoneId, minute, umidadeSoloPercentual] of [[a.id, "02", 60], [a.id, "00", 20], [b.id, "01", 40], [c.id, "05", 90]]) {
    await send("sensores", at(minute), { zonaId: zoneId, umidadeSoloPercentual, distanciaAguaCm: null });
  }
  const irrigacaoId = randomUUID();
  for (const [zoneId, minute, execution] of [[a.id, "03", irrigacaoId], [b.id, "02", randomUUID()], [c.id, "06", randomUUID()]]) {
    await send("eventos", at(minute), { zonaId: zoneId, tipo: "IRRIGACAO_FINALIZADA", irrigacaoId: execution, duracaoSegundos: 2 });
  }
  await other("delete", `/plantas/${archived.id}`).expect(204);
  const dashboard = (await other("get", "/dashboard").expect(200)).body.data;
  assert.deepEqual(dashboard.plantas, { total: 3, ativas: 2, arquivadas: 1, ativasIdentificadas: 1, ativasPorFase: { MUDA: 1, SEMENTE: 1 } });
  assert.deepEqual(dashboard.ultimasLeituras.map(l => [l.plantaId, l.umidadeSoloPercentual]), [[first.id, 60], [second.id, 40]]);
  assert.deepEqual(dashboard.irrigacoesRecentes.map(i => i.plantaId), [first.id, second.id]);
  assert.equal(dashboard.irrigacoesRecentes[0].irrigacaoId, irrigacaoId);
  assert.equal(dashboard.irrigacoesRecentes[0].simulado, true);
  assert.deepEqual(dashboard.dispositivos.itens.map(d => [d.id, d.estado]), [[online.id, "ONLINE"], [idle.id, "SEM_STATUS"]]);
  const limited = (await other("get", "/dashboard?limite=1").expect(200)).body.data;
  assert.equal(limited.dispositivos.total, 2);
  assert.equal(limited.dispositivos.online, 1);
  assert.equal(limited.dispositivos.offline, 0);
  assert.equal(limited.dispositivos.semStatus, 1);
  assert.equal(limited.dispositivos.itens.length, 1);
  assert.equal(limited.ultimasLeituras.length, 1);
  assert.equal(limited.irrigacoesRecentes.length, 1);
  const owner = (await api("get", "/dashboard").expect(200)).body.data;
  assert.ok(!owner.dispositivos.itens.some(d => d.id === online.id));
  assert.ok(!owner.irrigacoesRecentes.some(i => i.irrigacaoId === irrigacaoId));
  assert.ok(!owner.ultimasLeituras.some(l => l.plantaId === first.id));
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
