const { createHttpClient } = require("../helpers/http");
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const sharp = require('sharp');
const { createDatabase } = require('../../src/config/database');
const { initializeModels } = require('../../src/models');
const { fixture, testEnvironment, validUser } = require('../helpers/fixture');

let database;
let models;
let env;
let client;
let ownerToken;
let otherToken;
let ownerId;
let speciesId;
let image;
let fetchCount = 0;
const result = { results: [{ score: 0.94, species: {
  scientificNameWithoutAuthor: 'Ocimum basilicum', commonNames: ['Manjericão'],
} }] };
let fetchHandler = async () => Response.json(result);
const fakeFetch = async (...args) => { fetchCount++; return fetchHandler(...args); };

function api(method, path, status, body, token = ownerToken) {
  return check(method.toUpperCase(), `/api/v1${path}`, status, { token: token, json: body ?? undefined });
}
async function plant(input = {}) {
  const response = await api('post', '/plantas', 201, { nome: 'Planta de teste', faseAtual: 'SEMENTE', ...input });
  return response.body.data.planta;
}
function photoForm(bytes, filename, contentType, fields = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('foto', new Blob([bytes], { type: contentType }), filename);
  return form;
}

async function photo(plantaId, token = ownerToken) {
  const response = await check("POST", `/api/v1/plantas/${plantaId}/fotos`, 201, { token: token, body: photoForm(image, 'foto.png', 'image/png', { 'tipo': 'IDENTIFICACAO' }) });
  return response.body.data.foto;
}

async function check(method, url, status, options, http = client) {
  const response = await http.request(method, url, options);
  if (status !== undefined) expect(response.status).toBe(status);
  return response;
}

beforeAll(async () => {
  if (process.env.HORTA_EPHEMERAL_POSTGRES !== 'true') throw new Error('Use npm run test:postgres.');
  env = testEnvironment({
    DATABASE_URL: process.env.DATABASE_URL, UPLOAD_DIR: process.env.UPLOAD_DIR,
    PLANTNET_API_KEY: 'chave-privada-de-teste', AUTH_RATE_LIMIT_MAX: '1000',
  });
  database = createDatabase(env);
  models = initializeModels(database);
  const context = await fixture({ env, database, models, fetchImpl: fakeFetch });
  client = await createHttpClient(context.app);
  for (const [email, isOwner] of [['dona-plantas@example.com', true], ['outro-plantas@example.com', false]]) {
    const register = await check("POST", '/api/v1/auth/register', 201, { json: { ...validUser, email } });
    const login = await check("POST", '/api/v1/auth/login', 200, { json: { email, senha: validUser.senha } });
    if (isOwner) { ownerToken = login.body.data.accessToken; ownerId = register.body.data.usuario.id; }
    else otherToken = login.body.data.accessToken;
  }
  image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#57963a' } }).png().toBuffer();
});
afterAll(async () => { await client?.close(); if (database) await database.close(); });

test('catálogos exigem autenticação e as cinco fases vêm da migration', async () => {
  await check("GET", '/api/v1/fases-crescimento', 401);
  await check("GET", '/api/v1/especies', 401);
  await check("GET", '/api/v1/plantas', 401);
  const phases = await api('get', '/fases-crescimento', 200);
  expect(phases.body.data.map((item) => item.codigo)).toStrictEqual(['SEMENTE', 'GERMINACAO', 'MUDA', 'VEGETATIVA', 'ADULTA']);
});

test('espécies possuem busca, paginação e unicidade independente de caixa/espaços', async () => {
  const response = await api('post', '/especies', 201, { nomeCientifico: ' Ocimum   basilicum ', nomeComum: 'Manjericão' });
  speciesId = response.body.data.especie.id;
  expect(response.body.data.especie.nomeCientifico).toBe('Ocimum basilicum');
  expect(response.body.data.especie.nomeCientificoNormalizado).toBeUndefined();
  await api('post', '/especies', 409, { nomeCientifico: 'ocimum basilicum' });
  await api('get', `/especies/${speciesId}`, 200);
  const list = await api('get', '/especies?busca=manjeric%C3%A3o&limite=1', 200);
  expect(list.body.meta.total).toBe(1);
  expect(list.body.data[0].id).toBe(speciesId);
  await api('get', '/especies?limite=101', 422);
});

test('cadastro sem espécie gera histórico inicial e status não identificada', async () => {
  const p = await plant();
  expect(p.usuarioId).toBe(ownerId);
  expect(p.especieId).toBe(null);
  expect(p.statusIdentificacao).toBe('NAO_IDENTIFICADA');
  expect(p.especie).toBe(null);
  const history = await api('get', `/plantas/${p.id}/crescimento`, 200);
  expect(history.body.meta.total).toBe(1);
  expect(history.body.data[0].fase).toBe('SEMENTE');
});

test('cadastro manual associa espécie e não inventa confiança', async () => {
  const p = await plant({ especieId: speciesId, faseAtual: 'MUDA', dataPlantio: '2026-10-01' });
  expect(p.especie.nomeCientifico).toBe('Ocimum basilicum');
  expect(p.statusIdentificacao).toBe('IDENTIFICADA');
  expect(p.origemIdentificacao).toBe('MANUAL');
  expect(p.confiancaIdentificacao).toBe(null);
  await api('post', '/plantas', 404, { nome: 'inválida', faseAtual: 'SEMENTE', especieId: randomUUID() });
  await api('post', '/plantas', 422, { nome: 'inválida', faseAtual: 'SEMENTE', usuarioId: ownerId });
});

test('falha ao gravar histórico inicial desfaz a criação da planta', async () => {
  const original = models.HistoricoCrescimento.create;
  models.HistoricoCrescimento.create = async () => { throw new Error('falha de teste'); };
  try {
    await api('post', '/plantas', 500, { nome: 'Rollback cadastro', faseAtual: 'SEMENTE' });
  } finally { models.HistoricoCrescimento.create = original; }
  expect(await models.Planta.count({ where: { nome: 'Rollback cadastro' } })).toBe(0);
});

test('listagem isola usuários, filtra fase e trata %/_ como texto literal', async () => {
  const p = await plant({ nome: 'Bandeja 100%_A', faseAtual: 'VEGETATIVA' });
  const filtered = await api('get', '/plantas?busca=100%25_A&fase=VEGETATIVA&limite=1', 200);
  expect(filtered.body.meta.total).toBe(1);
  expect(filtered.body.data[0].id).toBe(p.id);
  const other = await api('get', '/plantas', 200, undefined, otherToken);
  expect(other.body.meta.total).toBe(0);
  await api('get', '/plantas?pagina=0', 422);
  await api('get', '/plantas/invalido', 422);
  await api('get', `/plantas/${randomUUID()}`, 404);
});

test('outra pessoa não lê, edita, arquiva, identifica ou envia fotos para a planta', async () => {
  const p = await plant();
  for (const [method, path, body] of [
    ['get', `/plantas/${p.id}`], ['patch', `/plantas/${p.id}`, { nome: 'roubada' }],
    ['delete', `/plantas/${p.id}`], ['put', `/plantas/${p.id}/especie`, { especieId: speciesId }],
    ['get', `/plantas/${p.id}/crescimento`], ['post', `/plantas/${p.id}/crescimento`, { fase: 'MUDA' }],
    ['get', `/plantas/${p.id}/fotos`], ['get', `/plantas/${p.id}/identificacoes`],
    ['post', `/plantas/${p.id}/identificacoes`, { fotoId: randomUUID() }],
  ]) await api(method, path, 403, body, otherToken);
  await check("POST", `/api/v1/plantas/${p.id}/fotos`, 403, { token: otherToken, body: photoForm(image, 'foto.png', 'image/png') });
});

test('PATCH altera dados básicos e espécie é alterada somente pela rota própria', async () => {
  const p = await plant();
  const updated = await api('patch', `/plantas/${p.id}`, 200, { nome: 'Novo nome', apelido: 'Vaso 1' });
  expect(updated.body.data.planta.nome).toBe('Novo nome');
  await api('patch', `/plantas/${p.id}`, 422, { faseAtual: 'ADULTA' });
  await api('patch', `/plantas/${p.id}`, 422, { especieId: speciesId });
  const manual = await api('put', `/plantas/${p.id}/especie`, 200, { especieId: speciesId });
  expect(manual.body.data.planta.origemIdentificacao).toBe('MANUAL');
  const cleared = await api('put', `/plantas/${p.id}/especie`, 200, { especieId: null });
  expect(cleared.body.data.planta.statusIdentificacao).toBe('NAO_IDENTIFICADA');
});

test('crescimento atualiza fase e registros antigos não substituem a fase mais recente', async () => {
  const p = await plant();
  const current = await api('post', `/plantas/${p.id}/crescimento`, 201, { fase: 'MUDA', alturaCm: 8.5 });
  expect(current.body.data.faseAtual).toBe('MUDA');
  const old = await api('post', `/plantas/${p.id}/crescimento`, 201, {
    fase: 'GERMINACAO', registradoEm: '2020-01-01T12:00:00Z', observacao: 'Registro antigo.',
  });
  expect(old.body.data.faseAtual).toBe('MUDA');
  const detail = await api('get', `/plantas/${p.id}`, 200);
  expect(detail.body.data.planta.faseAtual).toBe('MUDA');
  const period = await api('get', `/plantas/${p.id}/crescimento?de=2019-01-01T00:00:00Z&ate=2021-01-01T00:00:00Z`, 200);
  expect(period.body.meta.total).toBe(1);
});

test('crescimento e atualização da fase têm rollback conjunto', async () => {
  const p = await plant();
  models.Planta.addHook('beforeUpdate', 'falhaCrescimento', () => { throw new Error('falha controlada'); });
  try { await api('post', `/plantas/${p.id}/crescimento`, 500, { fase: 'ADULTA' }); }
  finally { models.Planta.removeHook('beforeUpdate', 'falhaCrescimento'); }
  expect(await models.HistoricoCrescimento.count({ where: { plantaId: p.id } })).toBe(1);
  expect((await models.Planta.findByPk(p.id)).faseAtual).toBe('SEMENTE');
});

test('foto é reencodada como JPEG, persistida e entregue apenas ao proprietário', async () => {
  const p = await plant();
  const f = await photo(p.id);
  expect(f.mimeType).toBe('image/jpeg');
  expect(f.chaveArquivo).toBeUndefined();
  const response = await api('get', `/plantas/${p.id}/fotos/${f.id}/arquivo`, 200);
  expect(response.headers['content-type']).toBe('image/jpeg');
  const metadata = await sharp(response.body).metadata();
  expect(metadata.format).toBe('jpeg');
  expect(metadata.exif).toBeUndefined();
  await check("GET", f.arquivoUrl, 401);
  await api('get', `/plantas/${p.id}/fotos/${f.id}/arquivo`, 403, undefined, otherToken);
  const list = await api('get', `/plantas/${p.id}/fotos`, 200);
  expect(list.body.meta.total).toBe(1);
  const record = await api('post', `/plantas/${p.id}/crescimento`, 201, { fase: 'MUDA', fotoId: f.id });
  expect(record.body.data.registro.fotoId).toBe(f.id);
});

test('upload rejeita conteúdo falso, ausência de arquivo, tipo inadequado e tamanho excessivo', async () => {
  const p = await plant();
  await check("POST", `/api/v1/plantas/${p.id}/fotos`, 422, { token: ownerToken, body: photoForm(Buffer.from('não sou imagem'), 'falsa.jpg', 'image/jpeg') });
  await api('post', `/plantas/${p.id}/fotos`, 422, {});
  await check("POST", `/api/v1/plantas/${p.id}/fotos`, 415, { token: ownerToken, body: photoForm(Buffer.from('<svg/>'), 'imagem.svg', 'image/svg+xml') });
  await check("POST", `/api/v1/plantas/${p.id}/fotos`, 413, { token: ownerToken, body: photoForm(Buffer.alloc(5 * 1024 * 1024 + 1), 'grande.jpg', 'image/jpeg') });
  expect(await models.FotoPlanta.count({ where: { plantaId: p.id } })).toBe(0);
});

test('falha no banco após gravar arquivo compensa a criação do arquivo', async () => {
  const p = await plant();
  const original = models.FotoPlanta.create;
  const beforeFiles = (await fs.readdir(env.UPLOAD_DIR)).sort();
  models.FotoPlanta.create = async () => { throw new Error('falha ao persistir foto'); };
  try {
    await check("POST", `/api/v1/plantas/${p.id}/fotos`, 500, { token: ownerToken, body: photoForm(image, 'foto.png', 'image/png') });
  } finally { models.FotoPlanta.create = original; }
  expect((await fs.readdir(env.UPLOAD_DIR)).sort()).toStrictEqual(beforeFiles);
});

test('foto de outra planta é rejeitada no crescimento, identificação e download', async () => {
  const a = await plant();
  const b = await plant();
  const f = await photo(a.id);
  await api('post', `/plantas/${b.id}/crescimento`, 404, { fase: 'MUDA', fotoId: f.id });
  await api('post', `/plantas/${b.id}/identificacoes`, 404, { fotoId: f.id });
  await api('get', `/plantas/${b.id}/fotos/${f.id}/arquivo`, 404);
  await expect(models.HistoricoCrescimento.create({
    plantaId: b.id, fotoId: f.id, fase: 'MUDA', registradoEm: new Date(),
  })).rejects.toMatchObject({ original: { code: '23503' } });
});

test('PlantNet gera sugestões sem alterar espécie e confirmação usa o candidato persistido', async () => {
  const p = await plant();
  const f = await photo(p.id);
  const identified = await api('post', `/plantas/${p.id}/identificacoes`, 201, { fotoId: f.id, orgao: 'leaf' });
  const identification = identified.body.data.identificacao;
  expect(identification.status).toBe('CONCLUIDA');
  const pending = await api('get', `/plantas/${p.id}`, 200);
  expect(pending.body.data.planta.especieId).toBe(null);
  expect(pending.body.data.planta.statusIdentificacao).toBe('IDENTIFICACAO_PENDENTE');
  await api('post', `/plantas/${p.id}/identificacoes/${identification.id}/confirmacao`, 422, { candidatoIndice: 4 });
  await api('post', `/plantas/${p.id}/identificacoes/${identification.id}/confirmacao`, 403, { candidatoIndice: 0 }, otherToken);
  const confirmed = await api('post', `/plantas/${p.id}/identificacoes/${identification.id}/confirmacao`, 200, { candidatoIndice: 0 });
  expect(confirmed.body.data.planta.especieId).toBe(speciesId);
  expect(confirmed.body.data.planta.confiancaIdentificacao).toBe(0.94);
  expect(confirmed.body.data.planta.origemIdentificacao).toBe('API');
  expect(confirmed.body.data.identificacao.status).toBe('CONFIRMADA');
  await api('post', `/plantas/${p.id}/identificacoes/${identification.id}/confirmacao`, 409, { candidatoIndice: 0 });
  const history = await api('get', `/plantas/${p.id}/identificacoes`, 200);
  expect(history.body.meta.total).toBe(1);
});

test('falha externa encerra identificação pendente e registra apenas código seguro', async () => {
  const p = await plant();
  const f = await photo(p.id);
  fetchHandler = async () => { throw new Error(`api-key=${env.PLANTNET_API_KEY}`); };
  try {
    const response = await api('post', `/plantas/${p.id}/identificacoes`, 502, { fotoId: f.id });
    expect(JSON.stringify(response.body).includes(env.PLANTNET_API_KEY)).toBe(false);
  } finally { fetchHandler = async () => Response.json(result); }
  const stored = await models.IdentificacaoPlanta.findOne({ where: { plantaId: p.id } });
  expect(stored.status).toBe('ERRO');
  expect(stored.codigoErro).toBe('PLANTNET_UNAVAILABLE');
  expect((await models.Planta.findByPk(p.id)).statusIdentificacao).toBe('NAO_IDENTIFICADA');
});

test('resposta vazia da PlantNet mantém planta sem identificação e não pode ser confirmada', async () => {
  const p = await plant();
  const f = await photo(p.id);
  fetchHandler = async () => Response.json({ results: [] });
  try {
    const response = await api('post', `/plantas/${p.id}/identificacoes`, 201, { fotoId: f.id });
    expect(response.body.data.identificacao.candidatos).toStrictEqual([]);
    await api('post', `/plantas/${p.id}/identificacoes/${response.body.data.identificacao.id}/confirmacao`, 422, { candidatoIndice: 0 });
  } finally { fetchHandler = async () => Response.json(result); }
  expect((await models.Planta.findByPk(p.id)).statusIdentificacao).toBe('NAO_IDENTIFICADA');
});

test('sem chave PlantNet a API mantém cadastro e fotos e rejeita apenas a identificação', async () => {
  const p = await plant();
  const f = await photo(p.id);
  const isolated = await fixture({ env: { ...env, PLANTNET_API_KEY: '' }, database, models, fetchImpl: fakeFetch });
  const beforeCount = fetchCount;
  const temporaryClient = await createHttpClient(isolated.app);
  try {
    await check("POST", `/api/v1/plantas/${p.id}/identificacoes`, 503, { token: ownerToken, json: { fotoId: f.id } }, temporaryClient);
  } finally {
    await temporaryClient.close();
  }
  expect(fetchCount).toBe(beforeCount);
  expect(await models.IdentificacaoPlanta.count({ where: { plantaId: p.id } })).toBe(0);
});

test('solicitações simultâneas não duplicam chamada externa nem sobrescrevem espécie manual', async () => {
  const p = await plant();
  const f = await photo(p.id);
  let release;
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  fetchHandler = async () => {
    started();
    return new Promise((resolve) => { release = () => resolve(Response.json(result)); });
  };
  const pending = api('post', `/plantas/${p.id}/identificacoes`, undefined, { fotoId: f.id });
  try {
    await Promise.race([entered, pending.then((response) => { throw new Error(`Não chamou PlantNet: ${response.status}`); })]);
    await api('post', `/plantas/${p.id}/identificacoes`, 409, { fotoId: f.id });
    await api('put', `/plantas/${p.id}/especie`, 200, { especieId: speciesId });
    release();
    expect((await pending).status).toBe(201);
    const stored = await models.Planta.findByPk(p.id);
    expect(stored.origemIdentificacao).toBe('MANUAL');
    expect(stored.confiancaIdentificacao).toBe(null);
  } finally { if (release) release(); fetchHandler = async () => Response.json(result); }
});

test('identificação interrompida antiga permite nova tentativa', async () => {
  const p = await plant();
  const f = await photo(p.id);
  const stale = await models.IdentificacaoPlanta.create({
    plantaId: p.id, fotoId: f.id, status: 'PENDENTE', createdAt: new Date(Date.now() - 180000),
  });
  await api('post', `/plantas/${p.id}/identificacoes`, 201, { fotoId: f.id });
  await stale.reload();
  expect(stale.status).toBe('ERRO');
  expect(stale.codigoErro).toBe('INTERRUPTED');
});

test('arquivamento é idempotente, preserva histórico/fotos e bloqueia novas alterações', async () => {
  const p = await plant();
  const f = await photo(p.id);
  await api('delete', `/plantas/${p.id}`, 204);
  await api('delete', `/plantas/${p.id}`, 204);
  await api('patch', `/plantas/${p.id}`, 409, { nome: 'bloqueada' });
  await api('put', `/plantas/${p.id}/especie`, 409, { especieId: speciesId });
  await api('post', `/plantas/${p.id}/crescimento`, 409, { fase: 'MUDA' });
  await api('post', `/plantas/${p.id}/identificacoes`, 409, { fotoId: f.id });
  await check("POST", `/api/v1/plantas/${p.id}/fotos`, 409, { token: ownerToken, body: photoForm(image, 'foto.png', 'image/png') });
  const archived = await api('get', '/plantas?arquivadas=true', 200);
  expect(archived.body.data.some((item) => item.id === p.id)).toBeTruthy();
  const active = await api('get', '/plantas?limite=100', 200);
  expect(active.body.data.some((item) => item.id === p.id)).toBe(false);
  await api('get', `/plantas/${p.id}/fotos/${f.id}/arquivo`, 200);
  expect(await models.HistoricoCrescimento.count({ where: { plantaId: p.id } })).toBe(1);
  expect((await models.Planta.findByPk(p.id)).arquivadaEm).toBeTruthy();
});
