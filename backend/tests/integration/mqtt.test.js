const { createHttpClient } = require("../helpers/http");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const fs = require("node:fs");
const mqtt = require("mqtt");
const { createDatabase } = require("../../src/config/database");
const { initializeModels } = require("../../src/models");
const { fixture, testEnvironment, validUser } = require("../helpers/fixture");
let db, models, service, client, token, otherToken, device, zone;
const prefix = `test-${randomUUID()}`;
function api(method, route, status, body, auth = token) {
  return check(method.toUpperCase(), `/api/v1${route}`, status, { token: auth, json: body ?? undefined });
}
const message = (extra = {}) => ({ versao: 1, mensagemId: randomUUID(), dispositivoId: device.id, zonaId: zone.id, medidoEm: new Date().toISOString(), simulado: true, umidadeSoloPercentual: 45, distanciaAguaCm: 15, ...extra });
async function check(method, url, status, options, http = client) {
  const response = await http.request(method, url, options);
  if (status !== undefined) expect(response.status).toBe(status);
  return response;
}

beforeAll(async () => {
  expect(process.env.HORTA_EPHEMERAL_POSTGRES).toBe("true");
  const env = testEnvironment({ DATABASE_URL: process.env.DATABASE_URL, MQTT_PREFIX: prefix });
  db = createDatabase(env); models = initializeModels(db);
  const f = await fixture({ env, models, database: db });
  client = await createHttpClient(f.app);
  service = f.services.mqttService;
  for (const other of [false, true]) {
    const email = `mqtt-${randomUUID()}@example.com`;
    await check("POST", "/api/v1/auth/register", 201, { json: { ...validUser, email } });
    const login = await check("POST", "/api/v1/auth/login", 200, { json: { email, senha: validUser.senha } });
    if (other) otherToken = login.body.data.accessToken; else token = login.body.data.accessToken;
  }
  device = (await api("post", "/dispositivos", 201, { nome: "Simulador", simulado: true })).body.data;
  zone = (await api("post", `/dispositivos/${device.id}/zonas`, 201, { nome: "Vaso", calibracao: { distanciaVazioCm: 30, distanciaCheioCm: 5 } })).body.data;
});
afterAll(async () => { await client?.close(); if (service) await service.stop(); if (db) await db.close(); });
test("persiste leitura, calcula nível, rejeita inválidas e deduplica em concorrência", async () => {
  const data = message(); const topic = `${prefix}/${device.id}/sensores`;
  const results = await Promise.all([service.ingest(topic, Buffer.from(JSON.stringify(data))), service.ingest(topic, Buffer.from(JSON.stringify(data)))]);
  expect(results.filter(Boolean).length).toBe(1);
  const saved = await models.MensagemMqtt.findOne({ where: { mensagemId: data.mensagemId } });
  expect(saved.dados.nivelAguaPercentual).toBe(60);
  for (const extra of [{ umidadeSoloPercentual: 101 }, { simulado: false }, { dispositivoId: randomUUID() }, { zonaId: randomUUID() }]) expect(await service.ingest(topic, Buffer.from(JSON.stringify(message(extra))))).toBe(false);
  expect(await service.ingest(topic, Buffer.from(JSON.stringify(message())), { retain: true })).toBe(false);
  const invalidDistance = message({ distanciaAguaCm: 35 });
  await service.ingest(topic, Buffer.from(JSON.stringify(invalidDistance)));
  expect((await models.MensagemMqtt.findOne({ where: { mensagemId: invalidDistance.mensagemId } })).dados.nivelAguaPercentual).toBe(null);
});
test("API exige autenticação e isola dispositivos entre usuários", async () => {
  await check("GET", "/api/v1/dispositivos", 401);
  await api("get", `/dispositivos/${device.id}/leituras`, 404, null, otherToken);
  const history = await api("get", `/dispositivos/${device.id}/leituras`, 200);
  expect(history.body.meta.total >= 2).toBeTruthy();
  await api("post", `/dispositivos/${device.id}/zonas/${zone.id}/sincronizacao`, 422, { intervaloLeituraSegundos: 5, automacaoHabilitada: true, calibracaoReservatorio: zone.calibracao });
});
test("ACK só confirma configuração do dispositivo e zona corretos", async () => {
  const config = await models.ConfiguracaoMqtt.create({ dispositivoId: device.id, zonaId: zone.id, dados: {}, status: "ENVIADA" });
  const ack = { versao: 1, mensagemId: randomUUID(), dispositivoId: device.id, zonaId: zone.id, medidoEm: new Date().toISOString(), simulado: true, configuracaoId: config.id, aplicada: true };
  expect(await service.ingest(`${prefix}/${device.id}/config/ack`, Buffer.from(JSON.stringify(ack)))).toBe(true);
  expect((await config.reload()).status).toBe("CONFIRMADA");
});
test("vínculo de planta preserva histórico e bloqueia associação de terceiros", async () => {
  const plantResponse = await api("post", "/plantas", 201, { nome: "Vaso MQTT", faseAtual: "SEMENTE" });
  const plantaId = plantResponse.body.data.planta.id;
  await api("put", `/dispositivos/${device.id}/zonas/${zone.id}`, 200, { nome: "Vaso", plantaId, calibracao: zone.calibracao });
  const data = message(); await service.ingest(`${prefix}/${device.id}/sensores`, Buffer.from(JSON.stringify(data)));
  await api("put", `/dispositivos/${device.id}/zonas/${zone.id}`, 200, { nome: "Vaso", plantaId: null, calibracao: zone.calibracao });
  const history = await api("get", `/plantas/${plantaId}/leituras`, 200);
  expect(history.body.data[0].mensagemId).toBe(data.mensagemId);
  await api("get", `/plantas/${plantaId}/leituras`, 404, null, otherToken);
  await api("patch", `/dispositivos/${device.id}`, 422, { nome: "Renomeado", simulado: false });
});
test("PUT de zona pela planta preserva calibração, é idempotente e impede vínculos conflitantes", async () => {
  const plant = async name => (await api("post", "/plantas", 201, { nome: name, faseAtual: "MUDA" })).body.data.planta;
  const first = await plant("Planta para vínculo");
  const second = await plant("Outra planta");
  const archived = await plant("Planta arquivada");
  await api("delete", `/plantas/${archived.id}`, 204);
  const calibration = { distanciaVazioCm: 25, distanciaCheioCm: 5 };
  const createZone = async () => (await api("post", `/dispositivos/${device.id}/zonas`, 201, { nome: "Zona livre", calibracao: calibration })).body.data;
  const target = await createZone();
  const alternative = await createZone();
  const body = { dispositivoId: device.id, zonaId: target.id };
  const route = `/plantas/${first.id}/zona`;
  await check("PUT", `/api/v1${route}`, 401, { json: body });
  await api("put", route, 422, { ...body, zonaId: "invalido" });
  await api("put", route, 404, body, otherToken);
  await api("put", `/plantas/${archived.id}/zona`, 404, body);
  const saved = (await api("put", route, 200, body)).body.data;
  expect(saved.plantaId).toBe(first.id);
  expect(saved.nome).toBe(target.nome);
  expect(saved.calibracao).toStrictEqual(calibration);
  expect((await api("put", route, 200, body)).body.data).toStrictEqual(saved);
  await api("put", `/plantas/${second.id}/zona`, 409, body);
  await api("put", route, 409, { ...body, zonaId: alternative.id });
  expect((await models.ZonaIrrigacao.findByPk(target.id)).plantaId).toBe(first.id);
  expect((await models.ZonaIrrigacao.findByPk(alternative.id)).plantaId).toBe(null);
});
test("DELETE de zona libera o vínculo sem apagar leituras ou irrigações", async () => {
  const plant = async nome => (await api("post", "/plantas", 201, { nome, faseAtual: "MUDA" })).body.data.planta;
  const original = await plant("Planta a desvincular");
  const next = await plant("Próxima planta");
  const calibration = { distanciaVazioCm: 28, distanciaCheioCm: 6 };
  const target = (await api("post", `/dispositivos/${device.id}/zonas`, 201, { nome: "Zona para liberar", plantaId: original.id, calibracao: calibration })).body.data;
  const reading = message({ zonaId: target.id });
  const event = { versao: 1, mensagemId: randomUUID(), dispositivoId: device.id, zonaId: target.id, medidoEm: reading.medidoEm, simulado: true, tipo: "IRRIGACAO_INICIADA", irrigacaoId: randomUUID() };
  expect(await service.ingest(`${prefix}/${device.id}/sensores`, Buffer.from(JSON.stringify(reading)))).toBe(true);
  expect(await service.ingest(`${prefix}/${device.id}/eventos`, Buffer.from(JSON.stringify(event)))).toBe(true);
  const path = `/plantas/${original.id}/zona`;
  await check("DELETE", `/api/v1${path}`, 401);
  await api("delete", path, 404, null, otherToken);
  expect((await models.ZonaIrrigacao.findByPk(target.id)).plantaId).toBe(original.id);
  const removed = await api("delete", path, 204);
  expect(removed.text).toBe("");
  await api("delete", path, 204);
  const freed = await models.ZonaIrrigacao.findByPk(target.id);
  expect(freed.plantaId).toBe(null);
  expect(freed.nome).toBe(target.nome);
  expect(freed.calibracao).toStrictEqual(calibration);
  await api("put", `/plantas/${next.id}/zona`, 200, { dispositivoId: device.id, zonaId: target.id });
  const readings = (await api("get", `/plantas/${original.id}/leituras`, 200)).body.data;
  expect(readings[0].mensagemId).toBe(reading.mensagemId);
  const irrigations = (await api("get", `/plantas/${original.id}/irrigacoes`, 200)).body.data;
  expect(irrigations[0].irrigacaoId).toBe(event.irrigacaoId);
  expect((await api("get", `/plantas/${next.id}/irrigacoes`, 200)).body.meta.total).toBe(0);
});
test("PATCH de zona preserva campos omitidos, aceita null e valida acesso e vínculo", async () => {
  const createPlant = async nome => (await api("post", "/plantas", 201, { nome, faseAtual: "MUDA" })).body.data.planta;
  const plant = await createPlant("Planta para edição");
  const assigned = await createPlant("Planta em outra zona");
  const calibration = { distanciaVazioCm: 28, distanciaCheioCm: 6 };
  const zones = `/dispositivos/${device.id}/zonas`;
  const target = (await api("post", zones, 201, { nome: "Zona para edição", plantaId: plant.id, calibracao: calibration })).body.data;
  await api("post", zones, 201, { nome: "Outra zona", plantaId: assigned.id });
  const path = `${zones}/${target.id}`;
  await api("patch", path, 404, { nome: "Sem acesso" }, otherToken);
  for (const body of [{}, { dispositivoId: device.id }, { calibracao: { distanciaCheioCm: 4 } }]) {
    await api("patch", path, 422, body);
  }
  await api("patch", path, 409, { plantaId: assigned.id });
  const renamed = (await api("patch", path, 200, { nome: "Vaso da varanda" })).body.data;
  expect(renamed.nome).toBe("Vaso da varanda");
  expect(renamed.plantaId).toBe(plant.id);
  expect(renamed.calibracao).toStrictEqual(calibration);
  const unbound = (await api("patch", path, 200, { plantaId: null })).body.data;
  expect(unbound.plantaId).toBe(null);
  expect(unbound.calibracao).toStrictEqual(calibration);
  const cleared = (await api("patch", path, 200, { calibracao: null })).body.data;
  expect(cleared.calibracao).toBe(null);
  expect(cleared.nome).toBe(renamed.nome);
});
test("histórico unificado pagina os quatro tipos por data e preserva a origem após desvínculo", async () => {
  const plant = (await api("post", "/plantas", 201, { nome: "Vaso com histórico", faseAtual: "MUDA" })).body.data.planta;
  const target = (await api("post", `/dispositivos/${device.id}/zonas`, 201, { nome: "Zona da linha do tempo", plantaId: plant.id })).body.data;
  const date = hour => `2025-01-01T${hour}:00:00Z`;
  const growth = await models.HistoricoCrescimento.create({ plantaId: plant.id, fase: "MUDA", registradoEm: date("08"), alturaCm: 8.5 });
  const foto = await models.FotoPlanta.create({
    plantaId: plant.id, chaveArquivo: `${randomUUID()}.jpg`, mimeType: "image/jpeg",
    tamanhoBytes: 1, capturadaEm: date("09"), tipo: "IDENTIFICACAO",
  });
  const identification = await models.IdentificacaoPlanta.create({ plantaId: plant.id, fotoId: foto.id, status: "PENDENTE", createdAt: date("09") });
  const ingest = (type, data) => service.ingest(`${prefix}/${device.id}/${type}`, Buffer.from(JSON.stringify(data)));
  const reading = message({ zonaId: target.id, medidoEm: date("10") });
  expect(await ingest("sensores", reading)).toBe(true);
  const execution = randomUUID();
  expect(await ingest("eventos", {
    versao: 1, mensagemId: randomUUID(), dispositivoId: device.id, zonaId: target.id,
    medidoEm: date("10"), simulado: true, tipo: "IRRIGACAO_FINALIZADA",
    irrigacaoId: execution, duracaoSegundos: 2,
  })).toBe(true);
  await api("delete", `/plantas/${plant.id}/zona`, 204);
  await api("delete", `/plantas/${plant.id}`, 204);

  const path = `/plantas/${plant.id}/historico`;
  const range = `de=${date("08")}&ate=${date("10")}`;
  const first = (await api("get", `${path}?${range}&limite=2`, 200)).body;
  expect(first.meta).toStrictEqual({ pagina: 1, limite: 2, total: 4, totalPaginas: 2 });
  expect(first.data.map(item => item.tipo)).toStrictEqual(["IRRIGACAO", "LEITURA"]);
  expect(first.data[0].dados.irrigacaoId).toBe(execution);
  expect(first.data[0].dados.iniciadaEm).toBe(null);
  expect(Date.parse(first.data[0].data)).toBe(Date.parse(date("10")));
  expect(first.data[1].dados.umidadeSoloPercentual).toBe(45);
  const second = (await api("get", `${path}?${range}&limite=2&pagina=2`, 200)).body;
  expect(second.data.map(item => item.id)).toStrictEqual([identification.id, growth.id]);
  expect(second.data[0].dados.fotoId).toBe(foto.id);
  expect(second.data[0].dados.chaveArquivo).toBeUndefined();
  const filtered = (await api("get", `${path}?${range}&tipo=CRESCIMENTO`, 200)).body;
  expect(filtered.meta.total).toBe(1);
  expect(filtered.data[0].dados.alturaCm).toBe(8.5);
  const empty = (await api("get", `${path}?${range}&limite=2&pagina=3`, 200)).body;
  expect(empty.data).toStrictEqual([]);
  expect(empty.meta.total).toBe(4);

  await check("GET", `/api/v1${path}`, 401);
  await api("get", path, 403, null, otherToken);
  await api("get", `/plantas/${randomUUID()}/historico`, 404);
  for (const query of ["tipo=OUTRO", "limite=101", `de=${date("10")}&ate=${date("08")}`]) {
    await api("get", `${path}?${query}`, 422);
  }
});
test("dashboard resume somente a horta autenticada e limita as listas sem reduzir os totais", async () => {
  await check("GET", "/api/v1/dashboard", 401);
  await api("get", "/dashboard?limite=101", 422);
  await api("get", `/dashboard?usuarioId=${device.usuarioId}`, 422);
  const other = (method, path, status, body) => api(method, path, status, body, otherToken);
  const empty = (await other("get", "/dashboard", 200)).body.data;
  expect(empty.plantas).toStrictEqual({ total: 0, ativas: 0, arquivadas: 0, ativasIdentificadas: 0, ativasPorFase: {} });
  expect(empty.dispositivos.itens).toStrictEqual([]);
  expect(empty.ultimasLeituras).toStrictEqual([]);
  expect(empty.irrigacoesRecentes).toStrictEqual([]);

  const species = (await other("post", "/especies", 201, { nomeCientifico: `Teste ${randomUUID()}` })).body.data.especie;
  const createPlant = async (nome, faseAtual, especieId) => (await other("post", "/plantas", 201, { nome, faseAtual, especieId })).body.data.planta;
  const first = await createPlant("Planta monitorada", "MUDA", species.id);
  const second = await createPlant("Outra planta ativa", "SEMENTE");
  const archived = await createPlant("Planta arquivada", "MUDA");
  const createDevice = async nome => (await other("post", "/dispositivos", 201, { nome, simulado: true })).body.data;
  const online = await createDevice("Dispositivo com status");
  const idle = await createDevice("Dispositivo sem status");
  const archivedDevice = await createDevice("Dispositivo arquivado");
  await other("delete", `/dispositivos/${archivedDevice.id}`, 204);
  const createZone = async planta => (await other("post", `/dispositivos/${online.id}/zonas`, 201, { nome: planta.nome, plantaId: planta.id })).body.data;
  const [a, b, c] = [await createZone(first), await createZone(second), await createZone(archived)];
  const at = minute => `2025-01-01T10:${minute}:00Z`;
  const send = async (type, medidoEm, extra) => {
    const payload = { versao: 1, mensagemId: randomUUID(), dispositivoId: online.id, medidoEm, simulado: true, ...extra };
    expect(await service.ingest(`${prefix}/${online.id}/${type}`, Buffer.from(JSON.stringify(payload)))).toBe(true);
  };
  await send("status", at("00"), { estado: "ONLINE" });
  for (const [zoneId, minute, umidadeSoloPercentual] of [[a.id, "02", 60], [a.id, "00", 20], [b.id, "01", 40], [c.id, "05", 90]]) {
    await send("sensores", at(minute), { zonaId: zoneId, umidadeSoloPercentual, distanciaAguaCm: null });
  }
  const irrigacaoId = randomUUID();
  for (const [zoneId, minute, execution] of [[a.id, "03", irrigacaoId], [b.id, "02", randomUUID()], [c.id, "06", randomUUID()]]) {
    await send("eventos", at(minute), { zonaId: zoneId, tipo: "IRRIGACAO_FINALIZADA", irrigacaoId: execution, duracaoSegundos: 2 });
  }
  await other("delete", `/plantas/${archived.id}`, 204);
  const dashboard = (await other("get", "/dashboard", 200)).body.data;
  expect(dashboard.plantas).toStrictEqual({ total: 3, ativas: 2, arquivadas: 1, ativasIdentificadas: 1, ativasPorFase: { MUDA: 1, SEMENTE: 1 } });
  expect(dashboard.ultimasLeituras.map(l => [l.plantaId, l.umidadeSoloPercentual])).toStrictEqual([[first.id, 60], [second.id, 40]]);
  expect(dashboard.irrigacoesRecentes.map(i => i.plantaId)).toStrictEqual([first.id, second.id]);
  expect(dashboard.irrigacoesRecentes[0].irrigacaoId).toBe(irrigacaoId);
  expect(dashboard.irrigacoesRecentes[0].simulado).toBe(true);
  expect(dashboard.dispositivos.itens.map(d => [d.id, d.estado])).toStrictEqual([[online.id, "ONLINE"], [idle.id, "SEM_STATUS"]]);
  const limited = (await other("get", "/dashboard?limite=1", 200)).body.data;
  expect(limited.dispositivos.total).toBe(2);
  expect(limited.dispositivos.online).toBe(1);
  expect(limited.dispositivos.offline).toBe(0);
  expect(limited.dispositivos.semStatus).toBe(1);
  expect(limited.dispositivos.itens.length).toBe(1);
  expect(limited.ultimasLeituras.length).toBe(1);
  expect(limited.irrigacoesRecentes.length).toBe(1);
  const owner = (await api("get", "/dashboard", 200)).body.data;
  expect(!owner.dispositivos.itens.some(d => d.id === online.id)).toBeTruthy();
  expect(!owner.irrigacoesRecentes.some(i => i.irrigacaoId === irrigacaoId)).toBeTruthy();
  expect(!owner.ultimasLeituras.some(l => l.plantaId === first.id)).toBeTruthy();
});
const binary = process.platform === "win32" ? "C:/Program Files/mosquitto/mosquitto.exe" : "/usr/sbin/mosquitto";
const mqttNetworkTest = fs.existsSync(binary) ? test : test.skip;
mqttNetworkTest("MQTT TCP real: perfil versionado recebe ACK e chega ao histórico e dashboard", async () => {
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
    simulator = spawn(process.execPath, ["scripts/simulate-mqtt.js"], { windowsHide: true, stdio: "ignore", env: { ...process.env, MQTT_URL: service.env.MQTT_URL, MQTT_PREFIX: prefix, MQTT_SIM_DEVICE_ID: device.id, MQTT_SIM_ZONE_ID: zone.id, MQTT_SIM_USERNAME: "", MQTT_SIM_PASSWORD: "", MQTT_SIM_IRRIGACOES: "true" } });
    await until(async () => (await models.Dispositivo.findByPk(device.id)).ultimoStatus?.estado === "ONLINE");
    const data = message(); publisher.publish(`${prefix}/${device.id}/sensores`, JSON.stringify(data), { qos: 1 });
    await until(() => models.MensagemMqtt.findOne({ where: { mensagemId: data.mensagemId } }));
    const sync = `/dispositivos/${device.id}/zonas/${zone.id}/sincronizacao`;
    const input = { intervaloLeituraSegundos: 2, automacaoHabilitada: false, calibracaoReservatorio: zone.calibracao, modo: "SIMULACAO_IRRIGACAO" };
    const fallback = (await api("post", sync, 202, input)).body.data;
    expect(fallback.dados.modo).toBe("MONITORAMENTO");
    expect(fallback.dados.motivoMonitoramento).toBe("SEM_PLANTA_ATIVA");
    await until(async () => (await models.ConfiguracaoMqtt.findByPk(fallback.id)).status === "CONFIRMADA");

    const especieId = (await api("post", "/especies", 201, { nomeCientifico: `Teste MQTT ${randomUUID()}` })).body.data.especie.id;
    const plant = (await api("post", "/plantas", 201, { nome: "Vaso do simulador", faseAtual: "MUDA", especieId })).body.data.planta;
    const profile = (await api("post", "/perfis-irrigacao", 201, {
      nome: "Parâmetros fictícios", especieId, fase: "MUDA", umidadeMinima: 50, umidadeAlvo: 65,
      duracaoMaximaSegundos: 1, intervaloMinimoSegundos: 60, fonte: "Somente teste automatizado",
    })).body.data.perfil;
    await api("patch", `/perfis-irrigacao/${profile.id}`, 200, { statusValidacao: "VALIDADO" });
    await api("put", `/plantas/${plant.id}/perfil-irrigacao`, 200, { perfilIrrigacaoId: profile.id });
    await api("put", `/plantas/${plant.id}/zona`, 200, { dispositivoId: device.id, zonaId: zone.id });
    const config = (await api("post", sync, 202, input)).body.data;
    expect(config.dados.automacaoHabilitada).toBe(false);
    expect(config.dados.irrigacao.perfilVersao).toBe(1);
    expect(config.dados.irrigacao.plantaId).toBe(plant.id);
    await until(async () => (await models.ConfiguracaoMqtt.findByPk(config.id)).status === "CONFIRMADA");
    await until(() => models.RegistroIrrigacao.findOne({ where: { configuracaoId: config.id, resultado: "CONCLUIDA" } }));
    await api("patch", `/perfis-irrigacao/${profile.id}`, 200, { umidadeAlvo: 66 });
    const revised = (await api("post", sync, 202, input)).body.data;
    expect(revised.dados.modo).toBe("MONITORAMENTO");
    expect(revised.dados.motivoMonitoramento).toBe("PERFIL_REQUER_REVISAO");
    await until(async () => (await models.ConfiguracaoMqtt.findByPk(revised.id)).status === "CONFIRMADA");
    const history = (await api("get", `/plantas/${plant.id}/irrigacoes`, 200)).body.data;
    expect(history[0].configuracaoId).toBe(config.id);
    expect(history[0].configuracaoSnapshot.irrigacao.umidadeAlvo).toBe(65);
    expect(history[0].duracaoSegundos).toBe(1);
    const dashboard = (await api("get", "/dashboard", 200)).body.data;
    const execution = dashboard.irrigacoesRecentes.find(i => i.configuracaoId === config.id);
    expect(execution.perfilIrrigacaoId).toBe(profile.id);
    expect(execution.perfilVersao).toBe(1);
    await api("patch", `/plantas/${plant.id}`, 200, { grupoIrrigacao: "HORTALICAS" });
    await api("post", `/plantas/${plant.id}/crescimento`, 201, { fase: "VEGETATIVA" });
    const standard = (await api("post", sync, 202, input)).body.data;
    expect(standard.dados.irrigacao).toMatchObject({
      origem: "PADRAO_GRUPO", perfilNome: "Hortaliças · Vegetativa", escalaUmidade: "VOLUMETRICA",
      umidadeMinima: 20.51, umidadeAlvo: 23.41,
    });
    await until(async () => (await models.ConfiguracaoMqtt.findByPk(standard.id)).status === "CONFIRMADA");
    await until(async () => {
      const result = (await api("get", "/dashboard", 200)).body.data;
      return result.ultimasLeituras.some(reading => reading.plantaId === plant.id &&
        reading.escalaUmidade === "VOLUMETRICA" && reading.umidadeSoloPercentual === 20);
    });
    const real = (await api("post", "/dispositivos", 201, { nome: "Dispositivo físico", simulado: false })).body.data;
    const realZone = (await api("post", `/dispositivos/${real.id}/zonas`, 201, { nome: "Zona física" })).body.data;
    await api("post", `/dispositivos/${real.id}/zonas/${realZone.id}/sincronizacao`, 409, { ...input, calibracaoReservatorio: null });
  } finally {
    if (simulator) simulator.kill();
    if (publisher) await new Promise(r => publisher.end(true, {}, r));
    await service.stop(); broker.kill();
  }
}, 30000);

mqttNetworkTest("roteiro de Hortaliças prepara a conta e rega alface do vaso, couve e repolho", async () => {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const broker = spawn(binary, ["-p", String(port)], { windowsHide: true, stdio: "ignore" });
  let demo, exit;
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("A demonstração não atingiu o estado esperado.");
  };
  try {
    const url = `mqtt://127.0.0.1:${port}`;
    service.env = { ...service.env, MQTT_ENABLED: true, MQTT_URL: url };
    service.start();
    await waitFor(() => service.connected);
    const email = `demo-${randomUUID()}@example.com`;
    const credentials = { email, senha: validUser.senha };
    await check("POST", "/api/v1/auth/register", 201, { json: { ...validUser, email } });
    const login = await check("POST", "/api/v1/auth/login", 200, { json: credentials });
    const demoToken = login.body.data.accessToken;
    demo = spawn(process.execPath, ["scripts/demo-hortalicas.js"], {
      env: { ...process.env, HORTA_DEMO_API_URL: client.baseUrl + "/api/v1",
        MQTT_URL: url, MQTT_PREFIX: prefix, MQTT_SIM_USERNAME: "", MQTT_SIM_PASSWORD: "" },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
    exit = once(demo, "exit");
    let logs = "";
    demo.stdout.on("data", chunk => { logs += chunk.toString(); });
    demo.stderr.on("data", chunk => { logs += chunk.toString(); });
    demo.stdin.end(Buffer.from(JSON.stringify(credentials), "utf8").toString("base64"));
    const simulatedPlants = [
      ["Alface do vaso", "Hortaliças · Vegetativa"],
      ["Couve do vaso", "Hortaliças · Adulta"],
      ["Repolho do vaso", "Hortaliças · Vegetativa"],
    ];
    await waitFor(async () => {
      if (demo.exitCode !== null) throw new Error(logs);
      const { body: { data } } = await api("get", "/dashboard", 200, undefined, demoToken);
      return simulatedPlants.every(([plantName, profileName]) =>
        data.irrigacoesRecentes.some(item => item.simulado && item.plantaNome === plantName &&
          item.perfilNome === profileName &&
          item.resultado === "CONCLUIDA" && item.duracaoSegundos === 2));
    });
    const { body: { data: plants } } = await api("get", "/plantas", 200, undefined, demoToken);
    expect(plants.map(plant => plant.nome).sort()).toEqual([
      "Alface da bandeja", "Alface do vaso", "Couve do vaso", "Repolho do vaso", "Rúcula do vaso",
    ]);
    for (const [name] of simulatedPlants) {
      const plant = plants.find(item => item.nome === name);
      await waitFor(async () => {
        const { body: { data } } = await api("get", `/plantas/${plant.id}/historico?tipo=LEITURA`, 200, undefined, demoToken);
        return data.some(item => item.dados.escalaUmidade === "VOLUMETRICA" && item.dados.umidadeSoloPercentual === 23.41);
      });
    }
    const { body: { data: devices } } = await api("get", "/dispositivos", 200, undefined, demoToken);
    expect(devices.map(item => item.nome).sort()).toEqual(simulatedPlants.map(([name]) => "Simulador · " + name).sort());
  } finally {
    if (demo?.exitCode === null) {
      demo.send("encerrar", () => {});
      const timeout = setTimeout(() => demo.kill(), 3000);
      try { await exit; } finally { clearTimeout(timeout); }
    }
    await service.stop();
    broker.kill();
  }
}, 45000);
