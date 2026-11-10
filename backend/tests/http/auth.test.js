const { createHttpClient } = require('../helpers/http');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const { fixture, testEnvironment, validUser } = require('../helpers/fixture');

const base = '/api/v1';
let client;

async function setup(options) {
  const context = await fixture(options);
  client = await createHttpClient(context.app);
  return context;
}

afterEach(async () => {
  try {
    await client?.close();
  } finally {
    client = undefined;
  }
});

async function check(method, path, status, options) {
  const response = await client.request(method, path, options);
  expect(response.status).toBe(status);
  return response;
}

test('cadastro, login e /me usam o mesmo usuário sem expor senha/hash', async () => {
  const { users, env } = await setup();
  const registered = await check('POST', `${base}/auth/register`, 201, { json: {
    ...validUser, nome: '  Ana Silva  ', email: '  ANA@EXAMPLE.COM  ',
  } });
  const user = registered.body.data.usuario;
  expect(user.email).toBe(validUser.email);
  expect(user.nome).toBe(validUser.nome);
  expect(user.senhaHash).toBeUndefined();
  expect(user.senha).toBeUndefined();
  const stored = users.get(user.id);
  expect(stored.senhaHash).not.toBe(validUser.senha);
  expect(await bcrypt.compare(validUser.senha, stored.senhaHash)).toBe(true);

  const login = await check('POST', `${base}/auth/login`, 200, { json: { email: validUser.email, senha: validUser.senha } });
  const { accessToken, expiresIn } = login.body.data;
  const payload = jwt.verify(accessToken, env.JWT_SECRET);
  expect(payload.sub).toBe(user.id);
  expect(payload.iss).toBe(env.JWT_ISSUER);
  expect(payload.aud).toBe(env.JWT_AUDIENCE);
  expect(payload.exp - payload.iat).toBe(expiresIn);
  expect(payload.senhaHash).toBeUndefined();

  const me = await check('GET', `${base}/auth/me`, 200, { token: accessToken });
  expect(me.body.data.usuario).toStrictEqual(user);
  expect(me.headers['cache-control']).toBe('no-store');
  expect(me.headers['x-request-id']).toBeTruthy();
  expect(me.headers['x-powered-by']).toBeUndefined();
});

test('cadastro rejeita e-mail duplicado normalizado', async () => {
  await setup();
  await check('POST', `${base}/auth/register`, 201, { json: validUser });
  const response = await check('POST', `${base}/auth/register`, 409, { json: { ...validUser, email: 'ANA@EXAMPLE.COM' } });
  expect(response.body.error.code).toBe('EMAIL_IN_USE');
});

test('validação rejeita campos extras e senha multibyte longa antes de persistir', async () => {
  const { users } = await setup();
  await check('POST', `${base}/auth/register`, 422, { json: { ...validUser, usuarioId: randomUUID() } });
  await check('POST', `${base}/auth/register`, 422, { json: { ...validUser, senha: 'á'.repeat(37) } });
  await check('POST', `${base}/auth/register`, 422, { json: { ...validUser, email: 'inválido' } });
  await check('POST', `${base}/auth/register`, 422);
  expect(users.size).toBe(0);
});

test('login não distingue e-mail inexistente de senha incorreta', async () => {
  await setup();
  await check('POST', `${base}/auth/register`, 201, { json: validUser });
  const wrong = await check('POST', `${base}/auth/login`, 401, { json: { email: validUser.email, senha: 'incorreta' } });
  const absent = await check('POST', `${base}/auth/login`, 401, { json: { email: 'ausente@example.com', senha: 'incorreta' } });
  expect(wrong.body.error.code).toBe(absent.body.error.code);
  expect(wrong.body.error.message).toBe(absent.body.error.message);
});

test('rota protegida rejeita token ausente, inválido e usuário removido', async () => {
  const { env } = await setup();
  await check('GET', `${base}/auth/me`, 401);
  await check('GET', `${base}/auth/me`, 401, { headers: { 'Authorization': 'Basic abc' } });
  await check('GET', `${base}/auth/me`, 401, { token: 'invalido' });
  const token = jwt.sign({}, env.JWT_SECRET, {
    subject: randomUUID(), expiresIn: 3600, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE,
  });
  await check('GET', `${base}/auth/me`, 401, { token: token });
});

test('JWT rejeita assinatura, expiração, audiência, emissor, algoritmo e claims incorretos', async () => {
  const { env } = await setup();
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
  for (const token of tokens) await check('GET', `${base}/auth/me`, 401, { token: token });
});

test('/me deriva a identidade do token mesmo com outro id na query', async () => {
  await setup();
  await check('POST', `${base}/auth/register`, 201, { json: validUser });
  const other = await check('POST', `${base}/auth/register`, 201, { json: { ...validUser, email: 'bia@example.com' } });
  const login = await check('POST', `${base}/auth/login`, 200, { json: { email: validUser.email, senha: validUser.senha } });
  const me = await check('GET', `${base}/auth/me`, 200, { query: { usuarioId: other.body.data.usuario.id }, token: login.body.data.accessToken });
  expect(me.body.data.usuario.email).toBe(validUser.email);
});

test('limite de tentativas inclui cadastro e login', async () => {
  await setup({ env: testEnvironment({ AUTH_RATE_LIMIT_MAX: '2' }) });
  await check('POST', `${base}/auth/register`, 422, { json: {} });
  await check('POST', `${base}/auth/login`, 422, { json: {} });
  const response = await check('POST', `${base}/auth/login`, 429, { json: {} });
  expect(response.body.error.code).toBe('RATE_LIMITED');
  expect(response.headers['retry-after']).toBeTruthy();
});

test('erros de JSON, tamanho e rota possuem respostas controladas', async () => {
  await setup();
  const invalid = await check('POST', `${base}/auth/login`, 400, { headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  expect(invalid.body.error.code).toBe('INVALID_JSON');
  const large = await check('POST', `${base}/auth/register`, 413, { json: { nome: 'a'.repeat(17000) } });
  expect(large.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  await check('GET', '/inexistente', 404);
});

test('falhas internas não expõem detalhes e readiness reflete o banco', async () => {
  const brokenDatabase = { authenticate: async () => { throw new Error('password=segredo'); } };
  const { model, errors } = await setup({ database: brokenDatabase });
  await check('GET', `${base}/health/live`, 200);
  await check('GET', `${base}/health/ready`, 503);
  model.create = async () => { throw new Error('SQL password=segredo'); };
  const response = await check('POST', `${base}/auth/register`, 500, { json: validUser });
  expect(response.body.error.code).toBe('INTERNAL_ERROR');
  expect(JSON.stringify(response.body).includes('segredo')).toBe(false);
  expect(JSON.stringify(errors).includes('segredo')).toBe(false);
});

test('CORS permite apenas as origens configuradas', async () => {
  await setup({ env: testEnvironment({ CORS_ORIGINS: 'http://localhost:5173' }) });
  const allowed = await check('GET', `${base}/health/live`, 200, { headers: { 'Origin': 'http://localhost:5173' } });
  expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  const denied = await check('GET', `${base}/health/live`, 200, { headers: { 'Origin': 'https://outro.example' } });
  expect(denied.headers['access-control-allow-origin']).toBeUndefined();
});
