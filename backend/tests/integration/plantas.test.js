const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const sharp = require('sharp');
const request = require('supertest');
const { createDatabase } = require('../../src/config/database');
const { initializeModels } = require('../../src/models');
const { fixture, testEnvironment, validUser } = require('../helpers/fixture');

let database;
let models;
let env;
let app;
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

function api(method, path, body, token = ownerToken) {
  const call = request(app)[method](`/api/v1${path}`).auth(token, { type: 'bearer' });
  return body === undefined ? call : call.send(body);
}
async function plant(input = {}) {
  const response = await api('post', '/plantas', { nome: 'Planta de teste', faseAtual: 'SEMENTE', ...input }).expect(201);
  return response.body.data.planta;
}
async function photo(plantaId, token = ownerToken) {
  const response = await request(app).post(`/api/v1/plantas/${plantaId}/fotos`).auth(token, { type: 'bearer' })
    .field('tipo', 'IDENTIFICACAO').attach('foto', image, { filename: 'foto.png', contentType: 'image/png' }).expect(201);
  return response.body.data.foto;
}

before(async () => {
  if (process.env.HORTA_EPHEMERAL_POSTGRES !== 'true') throw new Error('Use npm run test:postgres.');
  env = testEnvironment({
    DATABASE_URL: process.env.DATABASE_URL, UPLOAD_DIR: process.env.UPLOAD_DIR,
    PLANTNET_API_KEY: 'chave-privada-de-teste', AUTH_RATE_LIMIT_MAX: '1000',
  });
  database = createDatabase(env);
  models = initializeModels(database);
  ({ app } = await fixture({ env, database, models, fetchImpl: fakeFetch }));
  for (const [email, isOwner] of [['dona-plantas@example.com', true], ['outro-plantas@example.com', false]]) {
    const register = await request(app).post('/api/v1/auth/register').send({ ...validUser, email }).expect(201);
    const login = await request(app).post('/api/v1/auth/login').send({ email, senha: validUser.senha }).expect(200);
    if (isOwner) { ownerToken = login.body.data.accessToken; ownerId = register.body.data.usuario.id; }
    else otherToken = login.body.data.accessToken;
  }
  image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#57963a' } }).png().toBuffer();
});
after(async () => { if (database) await database.close(); });

test('catálogos exigem autenticação e as cinco fases vêm da migration', async () => {
  await request(app).get('/api/v1/fases-crescimento').expect(401);
  await request(app).get('/api/v1/especies').expect(401);
  await request(app).get('/api/v1/plantas').expect(401);
  const phases = await api('get', '/fases-crescimento').expect(200);
  assert.deepEqual(phases.body.data.map((item) => item.codigo), ['SEMENTE', 'GERMINACAO', 'MUDA', 'VEGETATIVA', 'ADULTA']);
});

test('espécies possuem busca, paginação e unicidade independente de caixa/espaços', async () => {
  const response = await api('post', '/especies', { nomeCientifico: ' Ocimum   basilicum ', nomeComum: 'Manjericão' }).expect(201);
  speciesId = response.body.data.especie.id;
  assert.equal(response.body.data.especie.nomeCientifico, 'Ocimum basilicum');
  assert.equal(response.body.data.especie.nomeCientificoNormalizado, undefined);
  await api('post', '/especies', { nomeCientifico: 'ocimum basilicum' }).expect(409);
  await api('get', `/especies/${speciesId}`).expect(200);
  const list = await api('get', '/especies?busca=manjeric%C3%A3o&limite=1').expect(200);
  assert.equal(list.body.meta.total, 1);
  assert.equal(list.body.data[0].id, speciesId);
  await api('get', '/especies?limite=101').expect(422);
});

test('cadastro sem espécie gera histórico inicial e status não identificada', async () => {
  const p = await plant();
  assert.equal(p.usuarioId, ownerId);
  assert.equal(p.especieId, null);
  assert.equal(p.statusIdentificacao, 'NAO_IDENTIFICADA');
  assert.equal(p.especie, null);
  const history = await api('get', `/plantas/${p.id}/crescimento`).expect(200);
  assert.equal(history.body.meta.total, 1);
  assert.equal(history.body.data[0].fase, 'SEMENTE');
});

test('cadastro manual associa espécie e não inventa confiança', async () => {
  const p = await plant({ especieId: speciesId, faseAtual: 'MUDA', dataPlantio: '2026-10-01' });
  assert.equal(p.especie.nomeCientifico, 'Ocimum basilicum');
  assert.equal(p.statusIdentificacao, 'IDENTIFICADA');
  assert.equal(p.origemIdentificacao, 'MANUAL');
  assert.equal(p.confiancaIdentificacao, null);
  await api('post', '/plantas', { nome: 'inválida', faseAtual: 'SEMENTE', especieId: randomUUID() }).expect(404);
  await api('post', '/plantas', { nome: 'inválida', faseAtual: 'SEMENTE', usuarioId: ownerId }).expect(422);
});

test('falha ao gravar histórico inicial desfaz a criação da planta', async () => {
  const original = models.HistoricoCrescimento.create;
  models.HistoricoCrescimento.create = async () => { throw new Error('falha de teste'); };
  try {
    await api('post', '/plantas', { nome: 'Rollback cadastro', faseAtual: 'SEMENTE' }).expect(500);
  } finally { models.HistoricoCrescimento.create = original; }
  assert.equal(await models.Planta.count({ where: { nome: 'Rollback cadastro' } }), 0);
});

test('listagem isola usuários, filtra fase e trata %/_ como texto literal', async () => {
  const p = await plant({ nome: 'Bandeja 100%_A', faseAtual: 'VEGETATIVA' });
  const filtered = await api('get', '/plantas?busca=100%25_A&fase=VEGETATIVA&limite=1').expect(200);
  assert.equal(filtered.body.meta.total, 1);
  assert.equal(filtered.body.data[0].id, p.id);
  const other = await api('get', '/plantas', undefined, otherToken).expect(200);
  assert.equal(other.body.meta.total, 0);
  await api('get', '/plantas?pagina=0').expect(422);
  await api('get', '/plantas/invalido').expect(422);
  await api('get', `/plantas/${randomUUID()}`).expect(404);
});

test('outra pessoa não lê, edita, arquiva, identifica ou envia fotos para a planta', async () => {
  const p = await plant();
  for (const [method, path, body] of [
    ['get', `/plantas/${p.id}`], ['patch', `/plantas/${p.id}`, { nome: 'roubada' }],
    ['delete', `/plantas/${p.id}`], ['put', `/plantas/${p.id}/especie`, { especieId: speciesId }],
    ['get', `/plantas/${p.id}/crescimento`], ['post', `/plantas/${p.id}/crescimento`, { fase: 'MUDA' }],
    ['get', `/plantas/${p.id}/fotos`], ['get', `/plantas/${p.id}/identificacoes`],
    ['post', `/plantas/${p.id}/identificacoes`, { fotoId: randomUUID() }],
  ]) await api(method, path, body, otherToken).expect(403);
  await request(app).post(`/api/v1/plantas/${p.id}/fotos`).auth(otherToken, { type: 'bearer' })
    .attach('foto', image, 'foto.png').expect(403);
});

test('PATCH altera dados básicos e espécie é alterada somente pela rota própria', async () => {
  const p = await plant();
  const updated = await api('patch', `/plantas/${p.id}`, { nome: 'Novo nome', apelido: 'Vaso 1' }).expect(200);
  assert.equal(updated.body.data.planta.nome, 'Novo nome');
  await api('patch', `/plantas/${p.id}`, { faseAtual: 'ADULTA' }).expect(422);
  await api('patch', `/plantas/${p.id}`, { especieId: speciesId }).expect(422);
  const manual = await api('put', `/plantas/${p.id}/especie`, { especieId: speciesId }).expect(200);
  assert.equal(manual.body.data.planta.origemIdentificacao, 'MANUAL');
  const cleared = await api('put', `/plantas/${p.id}/especie`, { especieId: null }).expect(200);
  assert.equal(cleared.body.data.planta.statusIdentificacao, 'NAO_IDENTIFICADA');
});

test('crescimento atualiza fase e registros antigos não substituem a fase mais recente', async () => {
  const p = await plant();
  const current = await api('post', `/plantas/${p.id}/crescimento`, { fase: 'MUDA', alturaCm: 8.5 }).expect(201);
  assert.equal(current.body.data.faseAtual, 'MUDA');
  const old = await api('post', `/plantas/${p.id}/crescimento`, {
    fase: 'GERMINACAO', registradoEm: '2020-01-01T12:00:00Z', observacao: 'Registro antigo.',
  }).expect(201);
  assert.equal(old.body.data.faseAtual, 'MUDA');
  const detail = await api('get', `/plantas/${p.id}`).expect(200);
  assert.equal(detail.body.data.planta.faseAtual, 'MUDA');
  const period = await api('get', `/plantas/${p.id}/crescimento?de=2019-01-01T00:00:00Z&ate=2021-01-01T00:00:00Z`).expect(200);
  assert.equal(period.body.meta.total, 1);
});

test('crescimento e atualização da fase têm rollback conjunto', async () => {
  const p = await plant();
  models.Planta.addHook('beforeUpdate', 'falhaCrescimento', () => { throw new Error('falha controlada'); });
  try { await api('post', `/plantas/${p.id}/crescimento`, { fase: 'ADULTA' }).expect(500); }
  finally { models.Planta.removeHook('beforeUpdate', 'falhaCrescimento'); }
  assert.equal(await models.HistoricoCrescimento.count({ where: { plantaId: p.id } }), 1);
  assert.equal((await models.Planta.findByPk(p.id)).faseAtual, 'SEMENTE');
});

test('foto é reencodada como JPEG, persistida e entregue apenas ao proprietário', async () => {
  const p = await plant();
  const f = await photo(p.id);
  assert.equal(f.mimeType, 'image/jpeg');
  assert.equal(f.chaveArquivo, undefined);
  const response = await api('get', `/plantas/${p.id}/fotos/${f.id}/arquivo`).expect(200);
  assert.equal(response.headers['content-type'], 'image/jpeg');
  const metadata = await sharp(response.body).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.exif, undefined);
  await request(app).get(f.arquivoUrl).expect(401);
  await api('get', `/plantas/${p.id}/fotos/${f.id}/arquivo`, undefined, otherToken).expect(403);
  const list = await api('get', `/plantas/${p.id}/fotos`).expect(200);
  assert.equal(list.body.meta.total, 1);
  const record = await api('post', `/plantas/${p.id}/crescimento`, { fase: 'MUDA', fotoId: f.id }).expect(201);
  assert.equal(record.body.data.registro.fotoId, f.id);
});

test('upload rejeita conteúdo falso, ausência de arquivo, tipo inadequado e tamanho excessivo', async () => {
  const p = await plant();
  await request(app).post(`/api/v1/plantas/${p.id}/fotos`).auth(ownerToken, { type: 'bearer' })
    .attach('foto', Buffer.from('não sou imagem'), { filename: 'falsa.jpg', contentType: 'image/jpeg' }).expect(422);
  await api('post', `/plantas/${p.id}/fotos`, {}).expect(422);
  await request(app).post(`/api/v1/plantas/${p.id}/fotos`).auth(ownerToken, { type: 'bearer' })
    .attach('foto', Buffer.from('<svg/>'), { filename: 'imagem.svg', contentType: 'image/svg+xml' }).expect(415);
  await request(app).post(`/api/v1/plantas/${p.id}/fotos`).auth(ownerToken, { type: 'bearer' })
    .attach('foto', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'grande.jpg', contentType: 'image/jpeg' }).expect(413);
  assert.equal(await models.FotoPlanta.count({ where: { plantaId: p.id } }), 0);
});

test('falha no banco após gravar arquivo compensa a criação do arquivo', async () => {
  const p = await plant();
  const original = models.FotoPlanta.create;
  const beforeFiles = (await fs.readdir(env.UPLOAD_DIR)).sort();
  models.FotoPlanta.create = async () => { throw new Error('falha ao persistir foto'); };
  try {
    await request(app).post(`/api/v1/plantas/${p.id}/fotos`).auth(ownerToken, { type: 'bearer' })
      .attach('foto', image, { filename: 'foto.png', contentType: 'image/png' }).expect(500);
  } finally { models.FotoPlanta.create = original; }
  assert.deepEqual((await fs.readdir(env.UPLOAD_DIR)).sort(), beforeFiles);
});

test('foto de outra planta é rejeitada no crescimento, identificação e download', async () => {
  const a = await plant();
  const b = await plant();
  const f = await photo(a.id);
  await api('post', `/plantas/${b.id}/crescimento`, { fase: 'MUDA', fotoId: f.id }).expect(404);
  await api('post', `/plantas/${b.id}/identificacoes`, { fotoId: f.id }).expect(404);
  await api('get', `/plantas/${b.id}/fotos/${f.id}/arquivo`).expect(404);
  await assert.rejects(() => models.HistoricoCrescimento.create({
    plantaId: b.id, fotoId: f.id, fase: 'MUDA', registradoEm: new Date(),
  }), (error) => error.original.code === '23503');
});

test('PlantNet gera sugestões sem alterar espécie e confirmação usa o candidato persistido', async () => {
  const p = await plant();
  const f = await photo(p.id);
  const identified = await api('post', `/plantas/${p.id}/identificacoes`, { fotoId: f.id, orgao: 'leaf' }).expect(201);
  const identification = identified.body.data.identificacao;
  assert.equal(identification.status, 'CONCLUIDA');
  const pending = await api('get', `/plantas/${p.id}`).expect(200);
  assert.equal(pending.body.data.planta.especieId, null);
  assert.equal(pending.body.data.planta.statusIdentificacao, 'IDENTIFICACAO_PENDENTE');
  await api('post', `/plantas/${p.id}/identificacoes/${identification.id}/confirmacao`, { candidatoIndice: 4 }).expect(422);
  await api('post', `/plantas/${p.id}/identificacoes/${identification.id}/confirmacao`, { candidatoIndice: 0 }, otherToken).expect(403);
  const confirmed = await api('post', `/plantas/${p.id}/identificacoes/${identification.id}/confirmacao`, { candidatoIndice: 0 }).expect(200);
  assert.equal(confirmed.body.data.planta.especieId, speciesId);
  assert.equal(confirmed.body.data.planta.confiancaIdentificacao, 0.94);
  assert.equal(confirmed.body.data.planta.origemIdentificacao, 'API');
  assert.equal(confirmed.body.data.identificacao.status, 'CONFIRMADA');
  await api('post', `/plantas/${p.id}/identificacoes/${identification.id}/confirmacao`, { candidatoIndice: 0 }).expect(409);
  const history = await api('get', `/plantas/${p.id}/identificacoes`).expect(200);
  assert.equal(history.body.meta.total, 1);
});

test('falha externa encerra identificação pendente e registra apenas código seguro', async () => {
  const p = await plant();
  const f = await photo(p.id);
  fetchHandler = async () => { throw new Error(`api-key=${env.PLANTNET_API_KEY}`); };
  try {
    const response = await api('post', `/plantas/${p.id}/identificacoes`, { fotoId: f.id }).expect(502);
    assert.equal(JSON.stringify(response.body).includes(env.PLANTNET_API_KEY), false);
  } finally { fetchHandler = async () => Response.json(result); }
  const stored = await models.IdentificacaoPlanta.findOne({ where: { plantaId: p.id } });
  assert.equal(stored.status, 'ERRO');
  assert.equal(stored.codigoErro, 'PLANTNET_UNAVAILABLE');
  assert.equal((await models.Planta.findByPk(p.id)).statusIdentificacao, 'NAO_IDENTIFICADA');
});

test('resposta vazia da PlantNet mantém planta sem identificação e não pode ser confirmada', async () => {
  const p = await plant();
  const f = await photo(p.id);
  fetchHandler = async () => Response.json({ results: [] });
  try {
    const response = await api('post', `/plantas/${p.id}/identificacoes`, { fotoId: f.id }).expect(201);
    assert.deepEqual(response.body.data.identificacao.candidatos, []);
    await api('post', `/plantas/${p.id}/identificacoes/${response.body.data.identificacao.id}/confirmacao`, { candidatoIndice: 0 }).expect(422);
  } finally { fetchHandler = async () => Response.json(result); }
  assert.equal((await models.Planta.findByPk(p.id)).statusIdentificacao, 'NAO_IDENTIFICADA');
});

test('sem chave PlantNet a API mantém cadastro e fotos e rejeita apenas a identificação', async () => {
  const p = await plant();
  const f = await photo(p.id);
  const isolated = await fixture({ env: { ...env, PLANTNET_API_KEY: '' }, database, models, fetchImpl: fakeFetch });
  const beforeCount = fetchCount;
  await request(isolated.app).post(`/api/v1/plantas/${p.id}/identificacoes`).auth(ownerToken, { type: 'bearer' }).send({ fotoId: f.id }).expect(503);
  assert.equal(fetchCount, beforeCount);
  assert.equal(await models.IdentificacaoPlanta.count({ where: { plantaId: p.id } }), 0);
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
  const pending = api('post', `/plantas/${p.id}/identificacoes`, { fotoId: f.id }).then((response) => response);
  try {
    await Promise.race([entered, pending.then((response) => { throw new Error(`Não chamou PlantNet: ${response.status}`); })]);
    await api('post', `/plantas/${p.id}/identificacoes`, { fotoId: f.id }).expect(409);
    await api('put', `/plantas/${p.id}/especie`, { especieId: speciesId }).expect(200);
    release();
    assert.equal((await pending).status, 201);
    const stored = await models.Planta.findByPk(p.id);
    assert.equal(stored.origemIdentificacao, 'MANUAL');
    assert.equal(stored.confiancaIdentificacao, null);
  } finally { if (release) release(); fetchHandler = async () => Response.json(result); }
});

test('identificação interrompida antiga permite nova tentativa', async () => {
  const p = await plant();
  const f = await photo(p.id);
  const stale = await models.IdentificacaoPlanta.create({
    plantaId: p.id, fotoId: f.id, status: 'PENDENTE', createdAt: new Date(Date.now() - 180000),
  });
  await api('post', `/plantas/${p.id}/identificacoes`, { fotoId: f.id }).expect(201);
  await stale.reload();
  assert.equal(stale.status, 'ERRO');
  assert.equal(stale.codigoErro, 'INTERRUPTED');
});

test('arquivamento é idempotente, preserva histórico/fotos e bloqueia novas alterações', async () => {
  const p = await plant();
  const f = await photo(p.id);
  await api('delete', `/plantas/${p.id}`).expect(204);
  await api('delete', `/plantas/${p.id}`).expect(204);
  await api('patch', `/plantas/${p.id}`, { nome: 'bloqueada' }).expect(409);
  await api('put', `/plantas/${p.id}/especie`, { especieId: speciesId }).expect(409);
  await api('post', `/plantas/${p.id}/crescimento`, { fase: 'MUDA' }).expect(409);
  await api('post', `/plantas/${p.id}/identificacoes`, { fotoId: f.id }).expect(409);
  await request(app).post(`/api/v1/plantas/${p.id}/fotos`).auth(ownerToken, { type: 'bearer' }).attach('foto', image, 'foto.png').expect(409);
  const archived = await api('get', '/plantas?arquivadas=true').expect(200);
  assert.ok(archived.body.data.some((item) => item.id === p.id));
  const active = await api('get', '/plantas?limite=100').expect(200);
  assert.equal(active.body.data.some((item) => item.id === p.id), false);
  await api('get', `/plantas/${p.id}/fotos/${f.id}/arquivo`).expect(200);
  assert.equal(await models.HistoricoCrescimento.count({ where: { plantaId: p.id } }), 1);
  assert.ok((await models.Planta.findByPk(p.id)).arquivadaEm);
});
