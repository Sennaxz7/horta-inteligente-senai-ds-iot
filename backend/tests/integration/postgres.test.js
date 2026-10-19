const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcrypt');
const net = require('node:net');
const { start } = require('../../src/server');
const { createDatabase } = require('../../src/config/database');
const { initializeModels } = require('../../src/models');
const { fixture, testEnvironment, validUser } = require('../helpers/fixture');

let database;
let Usuario;
let app;

before(async () => {
  if (process.env.HORTA_EPHEMERAL_POSTGRES !== 'true') {
    throw new Error('Execute npm run test:postgres para usar um banco temporário isolado.');
  }
  const env = testEnvironment({ DATABASE_URL: process.env.DATABASE_URL });
  database = createDatabase(env);
  ({ Usuario } = initializeModels(database));
  ({ app } = await fixture({ env, Usuario, database }));
});

after(async () => { if (database) await database.close(); });

test('PostgreSQL: cadastro persiste hash bcrypt e oculta o hash no model e HTTP', async () => {
  const response = await request(app).post('/api/v1/auth/register').send(validUser).expect(201);
  const id = response.body.data.usuario.id;
  const user = await Usuario.findByPk(id);
  assert.equal(user.senhaHash, undefined);
  const withPassword = await Usuario.scope('comSenha').findByPk(id);
  assert.equal(await bcrypt.compare(validUser.senha, withPassword.senhaHash), true);
  assert.equal(withPassword.toJSON().senhaHash, undefined);
  assert.equal(response.body.data.usuario.senhaHash, undefined);
  assert.ok(user.createdAt instanceof Date);
});

test('PostgreSQL: login e consulta autenticada funcionam após persistência', async () => {
  const login = await request(app).post('/api/v1/auth/login')
    .send({ email: validUser.email, senha: validUser.senha }).expect(200);
  const me = await request(app).get('/api/v1/auth/me')
    .auth(login.body.data.accessToken, { type: 'bearer' }).expect(200);
  assert.equal(me.body.data.usuario.email, validUser.email);
  await request(app).get('/api/v1/health/ready').expect(200);
});

test('PostgreSQL: cadastros concorrentes possuem um sucesso e um conflito', async () => {
  const body = { ...validUser, email: 'concorrente@example.com' };
  const responses = await Promise.all([
    request(app).post('/api/v1/auth/register').send(body),
    request(app).post('/api/v1/auth/register').send(body),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await Usuario.count({ where: { email: body.email } }), 1);
});

test('PostgreSQL: banco rejeita e-mail sem normalização mesmo fora da API', async () => {
  await assert.rejects(() => Usuario.create({
    nome: 'Teste', email: 'Maiusculo@example.com', senhaHash: 'x'.repeat(60),
  }), (error) => error.original.code === '23514');
});

test('PostgreSQL: token deixa de acessar /me se o usuário for removido', async () => {
  const email = 'removido@example.com';
  const registered = await request(app).post('/api/v1/auth/register').send({ ...validUser, email }).expect(201);
  const login = await request(app).post('/api/v1/auth/login').send({ email, senha: validUser.senha }).expect(200);
  await Usuario.destroy({ where: { id: registered.body.data.usuario.id } });
  await request(app).get('/api/v1/auth/me').auth(login.body.data.accessToken, { type: 'bearer' }).expect(401);
});

test('servidor real inicializa com ambiente válido e atende HTTP', async () => {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const overrides = {
    ...testEnvironment({ DATABASE_URL: process.env.DATABASE_URL }),
    PORT: String(port), HOST: '127.0.0.1', CORS_ORIGINS: '', DATABASE_SSL: 'false',
  };
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    process.env[key] = String(value);
  }
  let runtime;
  try {
    runtime = await start();
    await request(runtime.server).get('/api/v1/health/ready').expect(200);
    await request(runtime.server).post('/api/v1/auth/login')
      .send({ email: validUser.email, senha: validUser.senha }).expect(200);
  } finally {
    if (runtime) {
      await new Promise((resolve) => runtime.server.close(resolve));
      await runtime.database.close();
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
