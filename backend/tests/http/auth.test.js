const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const { fixture, testEnvironment, validUser } = require('../helpers/fixture');

const base = '/api/v1';

test('cadastro, login e /me usam o mesmo usuário sem expor senha/hash', async () => {
  const { app, users, env } = await fixture();
  const registered = await request(app).post(`${base}/auth/register`).send({
    ...validUser, nome: '  Ana Silva  ', email: '  ANA@EXAMPLE.COM  ',
  }).expect(201);
  const user = registered.body.data.usuario;
  assert.equal(user.email, validUser.email);
  assert.equal(user.nome, validUser.nome);
  assert.equal(user.senhaHash, undefined);
  assert.equal(user.senha, undefined);
  const stored = users.get(user.id);
  assert.notEqual(stored.senhaHash, validUser.senha);
  assert.equal(await bcrypt.compare(validUser.senha, stored.senhaHash), true);

  const login = await request(app).post(`${base}/auth/login`).send({ email: validUser.email, senha: validUser.senha }).expect(200);
  const { accessToken, expiresIn } = login.body.data;
  const payload = jwt.verify(accessToken, env.JWT_SECRET);
  assert.equal(payload.sub, user.id);
  assert.equal(payload.iss, env.JWT_ISSUER);
  assert.equal(payload.aud, env.JWT_AUDIENCE);
  assert.equal(payload.exp - payload.iat, expiresIn);
  assert.equal(payload.senhaHash, undefined);

  const me = await request(app).get(`${base}/auth/me`).auth(accessToken, { type: 'bearer' }).expect(200);
  assert.deepEqual(me.body.data.usuario, user);
  assert.equal(me.headers['cache-control'], 'no-store');
  assert.ok(me.headers['x-request-id']);
  assert.equal(me.headers['x-powered-by'], undefined);
});

test('cadastro rejeita e-mail duplicado normalizado', async () => {
  const { app } = await fixture();
  await request(app).post(`${base}/auth/register`).send(validUser).expect(201);
  const response = await request(app).post(`${base}/auth/register`).send({ ...validUser, email: 'ANA@EXAMPLE.COM' }).expect(409);
  assert.equal(response.body.error.code, 'EMAIL_IN_USE');
});

test('validação rejeita campos extras e senha multibyte longa antes de persistir', async () => {
  const { app, users } = await fixture();
  await request(app).post(`${base}/auth/register`).send({ ...validUser, usuarioId: randomUUID() }).expect(422);
  await request(app).post(`${base}/auth/register`).send({ ...validUser, senha: 'á'.repeat(37) }).expect(422);
  await request(app).post(`${base}/auth/register`).send({ ...validUser, email: 'inválido' }).expect(422);
  await request(app).post(`${base}/auth/register`).expect(422);
  assert.equal(users.size, 0);
});

test('login não distingue e-mail inexistente de senha incorreta', async () => {
  const { app } = await fixture();
  await request(app).post(`${base}/auth/register`).send(validUser).expect(201);
  const wrong = await request(app).post(`${base}/auth/login`).send({ email: validUser.email, senha: 'incorreta' }).expect(401);
  const absent = await request(app).post(`${base}/auth/login`).send({ email: 'ausente@example.com', senha: 'incorreta' }).expect(401);
  assert.equal(wrong.body.error.code, absent.body.error.code);
  assert.equal(wrong.body.error.message, absent.body.error.message);
});

test('rota protegida rejeita token ausente, inválido e usuário removido', async () => {
  const { app, env } = await fixture();
  await request(app).get(`${base}/auth/me`).expect(401);
  await request(app).get(`${base}/auth/me`).set('Authorization', 'Basic abc').expect(401);
  await request(app).get(`${base}/auth/me`).auth('invalido', { type: 'bearer' }).expect(401);
  const token = jwt.sign({}, env.JWT_SECRET, {
    subject: randomUUID(), expiresIn: 3600, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE,
  });
  await request(app).get(`${base}/auth/me`).auth(token, { type: 'bearer' }).expect(401);
});

test('JWT rejeita assinatura, expiração, audiência, emissor, algoritmo e claims incorretos', async () => {
  const { app, env } = await fixture();
  const options = { subject: randomUUID(), expiresIn: 3600, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE };
  const tokens = [
    jwt.sign({}, 'outra-chave-secreta-com-mais-de-32-caracteres', options),
    jwt.sign({}, env.JWT_SECRET, { ...options, expiresIn: -1 }),
    jwt.sign({}, env.JWT_SECRET, { ...options, audience: 'outro-cliente' }),
    jwt.sign({}, env.JWT_SECRET, { ...options, issuer: 'outro-emissor' }),
    jwt.sign({}, env.JWT_SECRET, { ...options, algorithm: 'HS384' }),
    jwt.sign({}, env.JWT_SECRET, { ...options, subject: 'não-é-uuid' }),
    jwt.sign({}, env.JWT_SECRET, { subject: randomUUID(), issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE }),
    jwt.sign({}, '', { ...options, algorithm: 'none' }),
  ];
  for (const token of tokens) await request(app).get(`${base}/auth/me`).auth(token, { type: 'bearer' }).expect(401);
});

test('/me deriva a identidade do token mesmo com outro id na query', async () => {
  const { app } = await fixture();
  await request(app).post(`${base}/auth/register`).send(validUser).expect(201);
  const other = await request(app).post(`${base}/auth/register`).send({ ...validUser, email: 'bia@example.com' }).expect(201);
  const login = await request(app).post(`${base}/auth/login`).send({ email: validUser.email, senha: validUser.senha }).expect(200);
  const me = await request(app).get(`${base}/auth/me`).query({ usuarioId: other.body.data.usuario.id })
    .auth(login.body.data.accessToken, { type: 'bearer' }).expect(200);
  assert.equal(me.body.data.usuario.email, validUser.email);
});

test('limite de tentativas inclui cadastro e login', async () => {
  const { app } = await fixture({ env: testEnvironment({ AUTH_RATE_LIMIT_MAX: '2' }) });
  await request(app).post(`${base}/auth/register`).send({}).expect(422);
  await request(app).post(`${base}/auth/login`).send({}).expect(422);
  const response = await request(app).post(`${base}/auth/login`).send({}).expect(429);
  assert.equal(response.body.error.code, 'RATE_LIMITED');
  assert.ok(response.headers['retry-after']);
});

test('erros de JSON, tamanho e rota possuem respostas controladas', async () => {
  const { app } = await fixture();
  const invalid = await request(app).post(`${base}/auth/login`).set('Content-Type', 'application/json').send('{bad').expect(400);
  assert.equal(invalid.body.error.code, 'INVALID_JSON');
  const large = await request(app).post(`${base}/auth/register`).send({ nome: 'a'.repeat(17000) }).expect(413);
  assert.equal(large.body.error.code, 'PAYLOAD_TOO_LARGE');
  await request(app).get('/inexistente').expect(404);
});

test('falhas internas não expõem detalhes e readiness reflete o banco', async () => {
  const brokenDatabase = { authenticate: async () => { throw new Error('password=segredo'); } };
  const { app, model, errors } = await fixture({ database: brokenDatabase });
  await request(app).get(`${base}/health/live`).expect(200);
  await request(app).get(`${base}/health/ready`).expect(503);
  model.create = async () => { throw new Error('SQL password=segredo'); };
  const response = await request(app).post(`${base}/auth/register`).send(validUser).expect(500);
  assert.equal(response.body.error.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(response.body).includes('segredo'), false);
  assert.equal(JSON.stringify(errors).includes('segredo'), false);
});

test('CORS permite apenas as origens configuradas', async () => {
  const { app } = await fixture({ env: testEnvironment({ CORS_ORIGINS: 'http://localhost:5173' }) });
  const allowed = await request(app).get(`${base}/health/live`).set('Origin', 'http://localhost:5173').expect(200);
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');
  const denied = await request(app).get(`${base}/health/live`).set('Origin', 'https://outro.example').expect(200);
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});
