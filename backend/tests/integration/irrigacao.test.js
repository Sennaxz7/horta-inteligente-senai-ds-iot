const { createHttpClient } = require("../helpers/http");
const { randomUUID } = require("node:crypto");
const { createDatabase } = require("../../src/config/database");
const { initializeModels } = require("../../src/models");
const { fixture, testEnvironment, validUser } = require("../helpers/fixture");
const { importReference } = require("../../scripts/import-reference-profile");
let db, models, client, services, token, otherToken, especieId, plantaId, device, zone;
const prefix = `irrigacao-${randomUUID()}`;
function api(method, path, status, body, auth = token) {
  return check(method.toUpperCase(), `/api/v1${path}`, status, { token: auth, json: body ?? undefined });
}
const input = (extra = {}) => ({ nome: "Perfil experimental (teste)", especieId, fase: "MUDA", umidadeMinima: 30, umidadeAlvo: 50, duracaoMaximaSegundos: 5, intervaloMinimoSegundos: 60, fonte: "Dados fictícios, exclusivos dos testes", ...extra });
const createProfile = async extra => (await api("post", "/perfis-irrigacao", 201, input(extra))).body.data.perfil;
const validateProfile = async id => (await api("patch", `/perfis-irrigacao/${id}`, 200, { statusValidacao: "VALIDADO" })).body.data.perfil;
const event = (extra = {}) => ({ versao: 1, mensagemId: randomUUID(), dispositivoId: device.id, zonaId: zone.id, medidoEm: new Date().toISOString(), simulado: true, tipo: "IRRIGACAO_INICIADA", irrigacaoId: randomUUID(), ...extra });
const ingest = data => services.mqttService.ingest(`${prefix}/${device.id}/eventos`, Buffer.from(JSON.stringify(data)));

async function check(method, url, status, options, http = client) {
  const response = await http.request(method, url, options);
  if (status !== undefined) expect(response.status).toBe(status);
  return response;
}

beforeAll(async () => {
  expect(process.env.HORTA_EPHEMERAL_POSTGRES).toBe("true");
  const env = testEnvironment({ DATABASE_URL: process.env.DATABASE_URL, MQTT_PREFIX: prefix });
  db = createDatabase(env); models = initializeModels(db);
  const context = await fixture({ env, models, database: db });
  client = await createHttpClient(context.app);
  services = context.services;
  for (const other of [false, true]) {
    const email = `${randomUUID()}@example.com`;
    await check("POST", "/api/v1/auth/register", 201, { json: { ...validUser, email } });
    const login = await check("POST", "/api/v1/auth/login", 200, { json: { email, senha: validUser.senha } });
    if (other) otherToken = login.body.data.accessToken; else token = login.body.data.accessToken;
  }
  especieId = (await api("post", "/especies", 201, { nomeCientifico: `Teste ${randomUUID()}` })).body.data.especie.id;
  plantaId = (await api("post", "/plantas", 201, { nome: "Vaso irrigação", faseAtual: "MUDA", especieId })).body.data.planta.id;
  device = (await api("post", "/dispositivos", 201, { nome: "Simulador", simulado: true })).body.data;
  zone = (await api("post", `/dispositivos/${device.id}/zonas`, 201, { nome: "Zona", plantaId })).body.data;
});
afterAll(async () => { await client?.close(); if (db) await db.close(); });

test("perfis exigem autenticação, são privados e não permitem publicação global pela API", async () => {
  await check("GET", "/api/v1/perfis-irrigacao", 401);
  const p = await createProfile();
  expect(p.tipo).toBe("PESSOAL"); expect(p.statusValidacao).toBe("RASCUNHO");
  for (const method of ["get", "patch", "delete"]) await api(method, `/perfis-irrigacao/${p.id}`, 404, method === "patch" ? { nome: "Invadido" } : undefined, otherToken);
  await api("post", `/perfis-irrigacao/${p.id}/copia`, 404, {}, otherToken);
  await api("post", "/perfis-irrigacao", 422, input({ tipo: "REFERENCIA" }));
  await api("post", "/perfis-irrigacao", 404, input({ especieId: randomUUID() }));
  const other = await api("get", `/perfis-irrigacao?especieId=${especieId}`, 200, undefined, otherToken);
  expect(other.body.meta.total).toBe(0);
});

test("referências importadas são compartilhadas, copiáveis e somente leitura", async () => {
  await expect(importReference(db, models, input({ umidadeAlvo: 10 }))).rejects.toThrow();
  const ref = await importReference(db, models, input({ nome: "Referência revisada (teste)" }));
  expect(ref.tipo).toBe("REFERENCIA"); expect(ref.usuarioId).toBe(null);
  await api("get", `/perfis-irrigacao/${ref.id}`, 200, undefined, otherToken);
  await api("patch", `/perfis-irrigacao/${ref.id}`, 403, { nome: "Alterado" });
  await api("delete", `/perfis-irrigacao/${ref.id}`, 403);
  const copy = (await api("post", `/perfis-irrigacao/${ref.id}/copia`, 201, {})).body.data.perfil;
  expect(copy.tipo).toBe("PESSOAL"); expect(copy.statusValidacao).toBe("RASCUNHO"); expect(copy.id).not.toBe(ref.id);
  await api("patch", `/perfis-irrigacao/${copy.id}`, 200, { umidadeAlvo: 55 });
  expect((await ref.reload()).umidadeAlvo).toBe(50);
  const listed = await api("get", `/perfis-irrigacao?plantaId=${plantaId}&tipo=REFERENCIA`, 200);
  expect(listed.body.data.some(p => p.id === ref.id)).toBeTruthy();
});

test("associação exige validação, propriedade e compatibilidade; edição pede revisão com snapshot", async () => {
  const p = await createProfile();
  const path = `/plantas/${plantaId}/perfil-irrigacao`;
  await api("put", path, 409, { perfilIrrigacaoId: p.id });
  await validateProfile(p.id);
  await api("put", path, 403, { perfilIrrigacaoId: p.id }, otherToken);
  const bound = await api("put", path, 200, { perfilIrrigacaoId: p.id });
  expect(bound.body.data.necessitaRevisao).toBe(false);
  await api("patch", `/perfis-irrigacao/${p.id}`, 422, { umidadeMinima: 60 });
  await api("patch", `/perfis-irrigacao/${p.id}`, 409, { umidadeAlvo: 55, statusValidacao: "VALIDADO" });
  const changed = (await api("patch", `/perfis-irrigacao/${p.id}`, 200, { umidadeAlvo: 55 })).body.data.perfil;
  expect(changed.versao).toBe(2); expect(changed.statusValidacao).toBe("RASCUNHO");
  const review = (await api("get", path, 200)).body.data;
  expect(review.motivos.includes("VERSAO_ALTERADA")).toBeTruthy(); expect(review.vinculo.snapshot.umidadeAlvo).toBe(50);
  await validateProfile(p.id);
  const rebound = (await api("put", path, 200, { perfilIrrigacaoId: p.id })).body.data;
  expect(rebound.necessitaRevisao).toBe(false); expect(rebound.vinculo.versao).toBe(2);
  await api("post", `/plantas/${plantaId}/crescimento`, 201, { fase: "VEGETATIVA" });
  expect((await api("get", path, 200)).body.data.motivos.includes("FASE_ALTERADA")).toBeTruthy();
  await api("put", path, 409, { perfilIrrigacaoId: p.id });
  await api("put", path, 200, { perfilIrrigacaoId: null });
  expect((await api("get", path, 200)).body.data.perfil).toBe(null);
});

test("sugestões exigem espécie, filtros coerentes e não expõem plantas de terceiros", async () => {
  const plant = (await api("post", "/plantas", 201, { nome: "Sem identificação", faseAtual: "MUDA" })).body.data.planta;
  await api("get", `/perfis-irrigacao?plantaId=${plant.id}`, 409);
  await api("get", `/perfis-irrigacao?plantaId=${plantaId}&fase=ADULTA`, 422);
  await api("get", `/perfis-irrigacao?plantaId=${plantaId}`, 403, undefined, otherToken);
  await api("get", "/perfis-irrigacao?limite=101", 422);
  const p = await createProfile({ fase: "ADULTA" }); await validateProfile(p.id);
  await api("put", `/plantas/${plantaId}/perfil-irrigacao`, 409, { perfilIrrigacaoId: p.id });
});

test("padrões de Hortaliças são escolhidos por fase e cedem lugar a um perfil pessoal válido", async () => {
  const { body: { data: catalog } } = await api("get", "/perfis-irrigacao?grupoIrrigacao=HORTALICAS", 200);
  const byPhase = Object.fromEntries(catalog.map(profile => [profile.fase, profile]));
  expect(Object.keys(byPhase).sort()).toEqual(["ADULTA", "GERMINACAO", "MUDA", "SEMENTE", "VEGETATIVA"]);
  expect(byPhase.VEGETATIVA).toMatchObject({
    umidadeMinima: 20.51, umidadeAlvo: 23.41, escalaUmidade: "VOLUMETRICA",
    duracaoMaximaSegundos: 2, intervaloMinimoSegundos: 15,
  });

  const plant = (await api("post", "/plantas", 201, {
    nome: "Hortaliça de teste", grupoIrrigacao: "HORTALICAS", faseAtual: "SEMENTE",
  })).body.data.planta;
  const path = `/plantas/${plant.id}/perfil-irrigacao`;
  const current = async () => (await api("get", path, 200)).body.data;
  expect(await current()).toMatchObject({
    origem: "PADRAO_GRUPO", vinculo: null, perfilAplicado: { id: byPhase.SEMENTE.id },
  });

  await api("post", `/plantas/${plant.id}/crescimento`, 201, { fase: "GERMINACAO" });
  expect((await current()).perfilAplicado.id).toBe(byPhase.GERMINACAO.id);
  await api("put", `/plantas/${plant.id}/especie`, 200, { especieId });

  await api("post", `/perfis-irrigacao/${byPhase.GERMINACAO.id}/copia`, 422, {});
  const { body: { data: { perfil: personal } } } = await api("post", `/perfis-irrigacao/${byPhase.GERMINACAO.id}/copia`, 201, { especieId });
  expect(personal).toMatchObject({ especieId, grupoIrrigacao: null, escalaUmidade: "GRAVIMETRICA_BANDEJA" });
  await validateProfile(personal.id);
  await api("put", path, 200, { perfilIrrigacaoId: personal.id });
  expect(await current()).toMatchObject({ origem: "ASSOCIADO", perfilAplicado: { id: personal.id } });

  await api("post", `/plantas/${plant.id}/crescimento`, 201, { fase: "MUDA" });
  expect(await current()).toMatchObject({
    origem: "PADRAO_GRUPO", necessitaRevisao: true, motivos: ["FASE_ALTERADA"],
    perfilAplicado: { id: byPhase.MUDA.id, escalaUmidade: "CAPACIDADE_RETENCAO" },
  });
  await api("patch", `/plantas/${plant.id}`, 200, { grupoIrrigacao: null });
  expect((await current()).perfilAplicado).toBeNull();
});

test("arquivamento é idempotente, preserva vínculo e impede alterações e cópias", async () => {
  const p = await createProfile({ fase: "VEGETATIVA" }); await validateProfile(p.id);
  await api("put", `/plantas/${plantaId}/perfil-irrigacao`, 200, { perfilIrrigacaoId: p.id });
  await api("delete", `/perfis-irrigacao/${p.id}`, 204);
  await api("delete", `/perfis-irrigacao/${p.id}`, 204);
  await api("get", `/perfis-irrigacao/${p.id}`, 200);
  await api("patch", `/perfis-irrigacao/${p.id}`, 409, { nome: "Arquivado" });
  await api("post", `/perfis-irrigacao/${p.id}/copia`, 409, {});
  expect((await api("get", `/plantas/${plantaId}/perfil-irrigacao`, 200)).body.data.motivos.includes("PERFIL_ARQUIVADO")).toBeTruthy();
  const list = await api("get", "/perfis-irrigacao?arquivados=true", 200);
  expect(list.body.data.some(x => x.id === p.id)).toBeTruthy();
});

test("MQTT correlaciona início e fim, deduplica e mantém configuração explicitamente informada", async () => {
  const config = await models.ConfiguracaoMqtt.create({ dispositivoId: device.id, zonaId: zone.id, dados: { automacaoHabilitada: false }, status: "CONFIRMADA" });
  const start = event({ configuracaoId: config.id, medidoEm: "2026-11-01T10:00:00Z" });
  const results = await Promise.all([ingest(start), ingest(start)]);
  expect(results.filter(Boolean).length).toBe(1);
  let row = await models.RegistroIrrigacao.findOne({ where: { irrigacaoId: start.irrigacaoId } });
  expect(row.resultado).toBe("EM_ANDAMENTO");
  const end = event({ irrigacaoId: start.irrigacaoId, tipo: "IRRIGACAO_FINALIZADA", medidoEm: "2026-11-01T10:00:05Z", resultado: "CONCLUIDA", duracaoSegundos: 5 });
  expect(await ingest(end)).toBe(true); expect(await ingest(end)).toBe(false);
  expect(await ingest({ ...end, mensagemId: randomUUID(), duracaoSegundos: 99 })).toBe(false);
  row = await row.reload(); expect(row.duracaoSegundos).toBe(5); expect(row.resultado).toBe("CONCLUIDA");
  expect(row.configuracaoId).toBe(config.id); expect(row.configuracaoSnapshot.automacaoHabilitada).toBe(false);
  const list = await api("get", `/plantas/${plantaId}/irrigacoes?resultado=CONCLUIDA&simulado=true&de=2026-11-01T00:00:00Z&ate=2026-11-01T23:59:59Z`, 200);
  expect(list.body.data.some(x => x.irrigacaoId === start.irrigacaoId)).toBeTruthy();
  expect((await api("get", `/plantas/${plantaId}/irrigacoes?simulado=false`, 200)).body.meta.total).toBe(0);
});

test("fim antes do início é registrado sem inventar data; falhas e datas conflitantes", async () => {
  const end = event({ tipo: "IRRIGACAO_FINALIZADA", medidoEm: "2026-11-01T11:00:05Z", resultado: "FALHA", motivoFalha: "Ensaio interrompido" });
  expect(await ingest(end)).toBe(true);
  let row = await models.RegistroIrrigacao.findOne({ where: { irrigacaoId: end.irrigacaoId } });
  expect(row.iniciadaEm).toBe(null); expect(row.resultado).toBe("FALHA"); expect(row.duracaoSegundos).toBe(null);
  const query = await api("get", `/plantas/${plantaId}/irrigacoes?resultado=FALHA&de=2026-11-01T11:00:00Z`, 200);
  expect(query.body.data.find(x => x.irrigacaoId === end.irrigacaoId).inicioAusente).toBe(true);
  expect(await ingest(event({ irrigacaoId: end.irrigacaoId, medidoEm: "2026-11-01T11:00:06Z" }))).toBe(false);
  expect(await ingest(event({ irrigacaoId: end.irrigacaoId, medidoEm: "2026-11-01T11:00:00Z" }))).toBe(true);
  row = await row.reload(); expect(row.iniciadaEm).toBeTruthy(); expect(row.resultado).toBe("FALHA");
  expect(row.duracaoSegundos).toBe(null);
});

test("eventos legados não viram execuções e configurações de outra zona são recusadas", async () => {
  const legacy = event(); delete legacy.irrigacaoId;
  const beforeCount = await models.RegistroIrrigacao.count();
  expect(await ingest(legacy)).toBe(true);
  expect(await models.RegistroIrrigacao.count()).toBe(beforeCount);
  const zone2 = (await api("post", `/dispositivos/${device.id}/zonas`, 201, { nome: "Outra" })).body.data;
  const config = await models.ConfiguracaoMqtt.create({ dispositivoId: device.id, zonaId: zone2.id, dados: {}, status: "ENVIADA" });
  const invalid = event({ configuracaoId: config.id });
  expect(await ingest(invalid)).toBe(false);
  expect(await models.MensagemMqtt.count({ where: { mensagemId: invalid.mensagemId } })).toBe(0);
  expect(await models.RegistroIrrigacao.count({ where: { irrigacaoId: invalid.irrigacaoId } })).toBe(0);
});

test("falha ao persistir mensagem reverte início e término da execução na mesma transação", async () => {
  const start = event();
  const fail = () => { throw new Error("Falha intencional na persistência da mensagem"); };
  models.MensagemMqtt.addHook("beforeCreate", "irrigacaoRollback", fail);
  try { await expect(ingest(start)).rejects.toThrow(); }
  finally { models.MensagemMqtt.removeHook("beforeCreate", "irrigacaoRollback"); }
  expect(await models.RegistroIrrigacao.count({ where: { irrigacaoId: start.irrigacaoId } })).toBe(0);
  expect(await ingest(start)).toBe(true);
  const end = event({ tipo: "IRRIGACAO_FINALIZADA", irrigacaoId: start.irrigacaoId });
  models.MensagemMqtt.addHook("beforeCreate", "irrigacaoRollback", fail);
  try { await expect(ingest(end)).rejects.toThrow(); }
  finally { models.MensagemMqtt.removeHook("beforeCreate", "irrigacaoRollback"); }
  const row = await models.RegistroIrrigacao.findOne({ where: { irrigacaoId: start.irrigacaoId } });
  expect(row.resultado).toBe("EM_ANDAMENTO"); expect(row.finalizadaEm).toBe(null);
  expect(await ingest(end)).toBe(true);
});

test("execução não muda de zona e permanece disponível em nova instância da aplicação", async () => {
  const start = event(); expect(await ingest(start)).toBe(true);
  const zone2 = (await api("post", `/dispositivos/${device.id}/zonas`, 201, { nome: "Zona concorrente" })).body.data;
  const wrongEnd = event({ irrigacaoId: start.irrigacaoId, tipo: "IRRIGACAO_FINALIZADA", zonaId: zone2.id });
  expect(await ingest(wrongEnd)).toBe(false);
  expect(await models.MensagemMqtt.count({ where: { mensagemId: wrongEnd.mensagemId } })).toBe(0);
  const restarted = await fixture({ env: testEnvironment(), models, database: db });
  const temporaryClient = await createHttpClient(restarted.app);
  try {
    const response = await check("GET", `/api/v1/plantas/${plantaId}/irrigacoes`, 200, { token: token }, temporaryClient);
    expect(response.body.data.find(x => x.irrigacaoId === start.irrigacaoId).resultado).toBe("EM_ANDAMENTO");
  } finally {
    await temporaryClient.close();
  }
});

test("histórico mantém planta do primeiro evento após troca de zona e preserva registros arquivados", async () => {
  const start = event(); expect(await ingest(start)).toBe(true);
  const plant2 = (await api("post", "/plantas", 201, { nome: "Nova ocupante", faseAtual: "MUDA" })).body.data.planta;
  await api("put", `/dispositivos/${device.id}/zonas/${zone.id}`, 200, { nome: "Zona", plantaId: plant2.id });
  expect(await ingest(event({ tipo: "IRRIGACAO_FINALIZADA", irrigacaoId: start.irrigacaoId }))).toBe(true);
  const row = await models.RegistroIrrigacao.findOne({ where: { irrigacaoId: start.irrigacaoId } });
  expect(row.plantaId).toBe(plantaId);
  expect((await api("get", `/plantas/${plant2.id}/irrigacoes`, 200)).body.meta.total).toBe(0);
  await api("delete", `/plantas/${plantaId}`, 204);
  await api("delete", `/dispositivos/${device.id}`, 204);
  await api("get", `/plantas/${plantaId}/irrigacoes`, 200);
  await api("get", `/plantas/${plantaId}/irrigacoes`, 403, undefined, otherToken);
  await check("GET", `/api/v1/plantas/${plantaId}/irrigacoes`, 401);
  await api("post", `/plantas/${plantaId}/irrigacoes`, 404, {});
  await api("get", `/plantas/${plantaId}/irrigacoes?pagina=0`, 422);
});
