const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const request = require("supertest");
const { createDatabase } = require("../../src/config/database");
const { initializeModels } = require("../../src/models");
const { fixture, testEnvironment, validUser } = require("../helpers/fixture");
const { importReference } = require("../../scripts/import-reference-profile");
let db, models, app, services, token, otherToken, especieId, plantaId, device, zone;
const prefix = `irrigacao-${randomUUID()}`;
const api = (method, path, body, auth = token) => {
  const call = request(app)[method](`/api/v1${path}`).auth(auth, { type: "bearer" });
  return body === undefined ? call : call.send(body);
};
const input = (extra = {}) => ({ nome: "Perfil experimental (teste)", especieId, fase: "MUDA", umidadeMinima: 30, umidadeAlvo: 50, duracaoMaximaSegundos: 5, intervaloMinimoSegundos: 60, fonte: "Dados fictícios, exclusivos dos testes", ...extra });
const createProfile = async extra => (await api("post", "/perfis-irrigacao", input(extra)).expect(201)).body.data.perfil;
const validateProfile = async id => (await api("patch", `/perfis-irrigacao/${id}`, { statusValidacao: "VALIDADO" }).expect(200)).body.data.perfil;
const event = (extra = {}) => ({ versao: 1, mensagemId: randomUUID(), dispositivoId: device.id, zonaId: zone.id, medidoEm: new Date().toISOString(), simulado: true, tipo: "IRRIGACAO_INICIADA", irrigacaoId: randomUUID(), ...extra });
const ingest = data => services.mqttService.ingest(`${prefix}/${device.id}/eventos`, Buffer.from(JSON.stringify(data)));

before(async () => {
  assert.equal(process.env.HORTA_EPHEMERAL_POSTGRES, "true", "Use npm run test:postgres");
  const env = testEnvironment({ DATABASE_URL: process.env.DATABASE_URL, MQTT_PREFIX: prefix });
  db = createDatabase(env); models = initializeModels(db);
  ({ app, services } = await fixture({ env, models, database: db }));
  for (const other of [false, true]) {
    const email = `${randomUUID()}@example.com`;
    await request(app).post("/api/v1/auth/register").send({ ...validUser, email }).expect(201);
    const login = await request(app).post("/api/v1/auth/login").send({ email, senha: validUser.senha }).expect(200);
    if (other) otherToken = login.body.data.accessToken; else token = login.body.data.accessToken;
  }
  especieId = (await api("post", "/especies", { nomeCientifico: `Teste ${randomUUID()}` }).expect(201)).body.data.especie.id;
  plantaId = (await api("post", "/plantas", { nome: "Vaso irrigação", faseAtual: "MUDA", especieId }).expect(201)).body.data.planta.id;
  device = (await api("post", "/dispositivos", { nome: "Simulador", simulado: true }).expect(201)).body.data;
  zone = (await api("post", `/dispositivos/${device.id}/zonas`, { nome: "Zona", plantaId }).expect(201)).body.data;
});
after(async () => { if (db) await db.close(); });

test("perfis exigem autenticação, são privados e não permitem publicação global pela API", async () => {
  await request(app).get("/api/v1/perfis-irrigacao").expect(401);
  const p = await createProfile();
  assert.equal(p.tipo, "PESSOAL"); assert.equal(p.statusValidacao, "RASCUNHO");
  for (const method of ["get", "patch", "delete"]) await api(method, `/perfis-irrigacao/${p.id}`, method === "patch" ? { nome: "Invadido" } : undefined, otherToken).expect(404);
  await api("post", `/perfis-irrigacao/${p.id}/copia`, {}, otherToken).expect(404);
  await api("post", "/perfis-irrigacao", input({ tipo: "REFERENCIA" })).expect(422);
  await api("post", "/perfis-irrigacao", input({ especieId: randomUUID() })).expect(404);
  const other = await api("get", `/perfis-irrigacao?especieId=${especieId}`, undefined, otherToken).expect(200);
  assert.equal(other.body.meta.total, 0);
});

test("referências importadas são compartilhadas, copiáveis e somente leitura", async () => {
  await assert.rejects(() => importReference(db, models, input({ umidadeAlvo: 10 })));
  const ref = await importReference(db, models, input({ nome: "Referência revisada (teste)" }));
  assert.equal(ref.tipo, "REFERENCIA"); assert.equal(ref.usuarioId, null);
  await api("get", `/perfis-irrigacao/${ref.id}`, undefined, otherToken).expect(200);
  await api("patch", `/perfis-irrigacao/${ref.id}`, { nome: "Alterado" }).expect(403);
  await api("delete", `/perfis-irrigacao/${ref.id}`).expect(403);
  const copy = (await api("post", `/perfis-irrigacao/${ref.id}/copia`, {}).expect(201)).body.data.perfil;
  assert.equal(copy.tipo, "PESSOAL"); assert.equal(copy.statusValidacao, "RASCUNHO"); assert.notEqual(copy.id, ref.id);
  await api("patch", `/perfis-irrigacao/${copy.id}`, { umidadeAlvo: 55 }).expect(200);
  assert.equal((await ref.reload()).umidadeAlvo, 50);
  const listed = await api("get", `/perfis-irrigacao?plantaId=${plantaId}&tipo=REFERENCIA`).expect(200);
  assert.ok(listed.body.data.some(p => p.id === ref.id));
});

test("associação exige validação, propriedade e compatibilidade; edição pede revisão com snapshot", async () => {
  const p = await createProfile();
  const path = `/plantas/${plantaId}/perfil-irrigacao`;
  await api("put", path, { perfilIrrigacaoId: p.id }).expect(409);
  await validateProfile(p.id);
  await api("put", path, { perfilIrrigacaoId: p.id }, otherToken).expect(403);
  const bound = await api("put", path, { perfilIrrigacaoId: p.id }).expect(200);
  assert.equal(bound.body.data.necessitaRevisao, false);
  await api("patch", `/perfis-irrigacao/${p.id}`, { umidadeMinima: 60 }).expect(422);
  await api("patch", `/perfis-irrigacao/${p.id}`, { umidadeAlvo: 55, statusValidacao: "VALIDADO" }).expect(409);
  const changed = (await api("patch", `/perfis-irrigacao/${p.id}`, { umidadeAlvo: 55 }).expect(200)).body.data.perfil;
  assert.equal(changed.versao, 2); assert.equal(changed.statusValidacao, "RASCUNHO");
  const review = (await api("get", path).expect(200)).body.data;
  assert.ok(review.motivos.includes("VERSAO_ALTERADA")); assert.equal(review.vinculo.snapshot.umidadeAlvo, 50);
  await validateProfile(p.id);
  const rebound = (await api("put", path, { perfilIrrigacaoId: p.id }).expect(200)).body.data;
  assert.equal(rebound.necessitaRevisao, false); assert.equal(rebound.vinculo.versao, 2);
  await api("post", `/plantas/${plantaId}/crescimento`, { fase: "VEGETATIVA" }).expect(201);
  assert.ok((await api("get", path).expect(200)).body.data.motivos.includes("FASE_ALTERADA"));
  await api("put", path, { perfilIrrigacaoId: p.id }).expect(409);
  await api("put", path, { perfilIrrigacaoId: null }).expect(200);
  assert.equal((await api("get", path).expect(200)).body.data.perfil, null);
});

test("sugestões exigem espécie, filtros coerentes e não expõem plantas de terceiros", async () => {
  const plant = (await api("post", "/plantas", { nome: "Sem identificação", faseAtual: "MUDA" }).expect(201)).body.data.planta;
  await api("get", `/perfis-irrigacao?plantaId=${plant.id}`).expect(409);
  await api("get", `/perfis-irrigacao?plantaId=${plantaId}&fase=ADULTA`).expect(422);
  await api("get", `/perfis-irrigacao?plantaId=${plantaId}`, undefined, otherToken).expect(403);
  await api("get", "/perfis-irrigacao?limite=101").expect(422);
  const p = await createProfile({ fase: "ADULTA" }); await validateProfile(p.id);
  await api("put", `/plantas/${plantaId}/perfil-irrigacao`, { perfilIrrigacaoId: p.id }).expect(409);
});

test("arquivamento é idempotente, preserva vínculo e impede alterações e cópias", async () => {
  const p = await createProfile({ fase: "VEGETATIVA" }); await validateProfile(p.id);
  await api("put", `/plantas/${plantaId}/perfil-irrigacao`, { perfilIrrigacaoId: p.id }).expect(200);
  await api("delete", `/perfis-irrigacao/${p.id}`).expect(204);
  await api("delete", `/perfis-irrigacao/${p.id}`).expect(204);
  await api("get", `/perfis-irrigacao/${p.id}`).expect(200);
  await api("patch", `/perfis-irrigacao/${p.id}`, { nome: "Arquivado" }).expect(409);
  await api("post", `/perfis-irrigacao/${p.id}/copia`, {}).expect(409);
  assert.ok((await api("get", `/plantas/${plantaId}/perfil-irrigacao`).expect(200)).body.data.motivos.includes("PERFIL_ARQUIVADO"));
  const list = await api("get", "/perfis-irrigacao?arquivados=true").expect(200);
  assert.ok(list.body.data.some(x => x.id === p.id));
});

test("MQTT correlaciona início e fim, deduplica e mantém configuração explicitamente informada", async () => {
  const config = await models.ConfiguracaoMqtt.create({ dispositivoId: device.id, zonaId: zone.id, dados: { automacaoHabilitada: false }, status: "CONFIRMADA" });
  const start = event({ configuracaoId: config.id, medidoEm: "2026-11-01T10:00:00Z" });
  const results = await Promise.all([ingest(start), ingest(start)]);
  assert.equal(results.filter(Boolean).length, 1);
  let row = await models.RegistroIrrigacao.findOne({ where: { irrigacaoId: start.irrigacaoId } });
  assert.equal(row.resultado, "EM_ANDAMENTO");
  const end = event({ irrigacaoId: start.irrigacaoId, tipo: "IRRIGACAO_FINALIZADA", medidoEm: "2026-11-01T10:00:05Z", resultado: "CONCLUIDA", duracaoSegundos: 5 });
  assert.equal(await ingest(end), true); assert.equal(await ingest(end), false);
  assert.equal(await ingest({ ...end, mensagemId: randomUUID(), duracaoSegundos: 99 }), false);
  row = await row.reload(); assert.equal(row.duracaoSegundos, 5); assert.equal(row.resultado, "CONCLUIDA");
  assert.equal(row.configuracaoId, config.id); assert.equal(row.configuracaoSnapshot.automacaoHabilitada, false);
  const list = await api("get", `/plantas/${plantaId}/irrigacoes?resultado=CONCLUIDA&simulado=true&de=2026-11-01T00:00:00Z&ate=2026-11-01T23:59:59Z`).expect(200);
  assert.ok(list.body.data.some(x => x.irrigacaoId === start.irrigacaoId));
  assert.equal((await api("get", `/plantas/${plantaId}/irrigacoes?simulado=false`).expect(200)).body.meta.total, 0);
});

test("fim antes do início é registrado sem inventar data; falhas e datas conflitantes", async () => {
  const end = event({ tipo: "IRRIGACAO_FINALIZADA", medidoEm: "2026-11-01T11:00:05Z", resultado: "FALHA", motivoFalha: "Ensaio interrompido" });
  assert.equal(await ingest(end), true);
  let row = await models.RegistroIrrigacao.findOne({ where: { irrigacaoId: end.irrigacaoId } });
  assert.equal(row.iniciadaEm, null); assert.equal(row.resultado, "FALHA"); assert.equal(row.duracaoSegundos, null);
  const query = await api("get", `/plantas/${plantaId}/irrigacoes?resultado=FALHA&de=2026-11-01T11:00:00Z`).expect(200);
  assert.equal(query.body.data.find(x => x.irrigacaoId === end.irrigacaoId).inicioAusente, true);
  assert.equal(await ingest(event({ irrigacaoId: end.irrigacaoId, medidoEm: "2026-11-01T11:00:06Z" })), false);
  assert.equal(await ingest(event({ irrigacaoId: end.irrigacaoId, medidoEm: "2026-11-01T11:00:00Z" })), true);
  row = await row.reload(); assert.ok(row.iniciadaEm); assert.equal(row.resultado, "FALHA");
  assert.equal(row.duracaoSegundos, null);
});

test("eventos legados não viram execuções e configurações de outra zona são recusadas", async () => {
  const legacy = event(); delete legacy.irrigacaoId;
  const beforeCount = await models.RegistroIrrigacao.count();
  assert.equal(await ingest(legacy), true);
  assert.equal(await models.RegistroIrrigacao.count(), beforeCount);
  const zone2 = (await api("post", `/dispositivos/${device.id}/zonas`, { nome: "Outra" }).expect(201)).body.data;
  const config = await models.ConfiguracaoMqtt.create({ dispositivoId: device.id, zonaId: zone2.id, dados: {}, status: "ENVIADA" });
  const invalid = event({ configuracaoId: config.id });
  assert.equal(await ingest(invalid), false);
  assert.equal(await models.MensagemMqtt.count({ where: { mensagemId: invalid.mensagemId } }), 0);
  assert.equal(await models.RegistroIrrigacao.count({ where: { irrigacaoId: invalid.irrigacaoId } }), 0);
});

test("falha ao persistir mensagem reverte início e término da execução na mesma transação", async () => {
  const start = event();
  const fail = () => { throw new Error("Falha intencional na persistência da mensagem"); };
  models.MensagemMqtt.addHook("beforeCreate", "irrigacaoRollback", fail);
  try { await assert.rejects(() => ingest(start)); }
  finally { models.MensagemMqtt.removeHook("beforeCreate", "irrigacaoRollback"); }
  assert.equal(await models.RegistroIrrigacao.count({ where: { irrigacaoId: start.irrigacaoId } }), 0);
  assert.equal(await ingest(start), true);
  const end = event({ tipo: "IRRIGACAO_FINALIZADA", irrigacaoId: start.irrigacaoId });
  models.MensagemMqtt.addHook("beforeCreate", "irrigacaoRollback", fail);
  try { await assert.rejects(() => ingest(end)); }
  finally { models.MensagemMqtt.removeHook("beforeCreate", "irrigacaoRollback"); }
  const row = await models.RegistroIrrigacao.findOne({ where: { irrigacaoId: start.irrigacaoId } });
  assert.equal(row.resultado, "EM_ANDAMENTO"); assert.equal(row.finalizadaEm, null);
  assert.equal(await ingest(end), true);
});

test("execução não muda de zona e permanece disponível em nova instância da aplicação", async () => {
  const start = event(); assert.equal(await ingest(start), true);
  const zone2 = (await api("post", `/dispositivos/${device.id}/zonas`, { nome: "Zona concorrente" }).expect(201)).body.data;
  const wrongEnd = event({ irrigacaoId: start.irrigacaoId, tipo: "IRRIGACAO_FINALIZADA", zonaId: zone2.id });
  assert.equal(await ingest(wrongEnd), false);
  assert.equal(await models.MensagemMqtt.count({ where: { mensagemId: wrongEnd.mensagemId } }), 0);
  const restarted = await fixture({ env: testEnvironment(), models, database: db });
  const response = await request(restarted.app).get(`/api/v1/plantas/${plantaId}/irrigacoes`).auth(token, { type: "bearer" }).expect(200);
  assert.equal(response.body.data.find(x => x.irrigacaoId === start.irrigacaoId).resultado, "EM_ANDAMENTO");
});

test("histórico mantém planta do primeiro evento após troca de zona e preserva registros arquivados", async () => {
  const start = event(); assert.equal(await ingest(start), true);
  const plant2 = (await api("post", "/plantas", { nome: "Nova ocupante", faseAtual: "MUDA" }).expect(201)).body.data.planta;
  await api("put", `/dispositivos/${device.id}/zonas/${zone.id}`, { nome: "Zona", plantaId: plant2.id }).expect(200);
  assert.equal(await ingest(event({ tipo: "IRRIGACAO_FINALIZADA", irrigacaoId: start.irrigacaoId })), true);
  const row = await models.RegistroIrrigacao.findOne({ where: { irrigacaoId: start.irrigacaoId } });
  assert.equal(row.plantaId, plantaId);
  assert.equal((await api("get", `/plantas/${plant2.id}/irrigacoes`).expect(200)).body.meta.total, 0);
  await api("delete", `/plantas/${plantaId}`).expect(204);
  await api("delete", `/dispositivos/${device.id}`).expect(204);
  await api("get", `/plantas/${plantaId}/irrigacoes`).expect(200);
  await api("get", `/plantas/${plantaId}/irrigacoes`, undefined, otherToken).expect(403);
  await request(app).get(`/api/v1/plantas/${plantaId}/irrigacoes`).expect(401);
  await api("post", `/plantas/${plantaId}/irrigacoes`, {}).expect(404);
  await api("get", `/plantas/${plantaId}/irrigacoes?pagina=0`).expect(422);
});
