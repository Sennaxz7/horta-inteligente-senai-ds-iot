const { createHttpClient } = require("../helpers/http");
const bcrypt = require('bcrypt');
const net = require('node:net');
const { start } = require('../../src/server');
const { createDatabase } = require('../../src/config/database');
const { initializeModels } = require('../../src/models');
const { fixture, testEnvironment, validUser } = require('../helpers/fixture');

let database;
let Usuario;
let client;

async function check(method, url, status, options, http = client) {
  const response = await http.request(method, url, options);
  if (status !== undefined) expect(response.status).toBe(status);
  return response;
}

beforeAll(async () => {
  if (process.env.HORTA_EPHEMERAL_POSTGRES !== 'true') {
    throw new Error('Execute npm run test:postgres para usar um banco temporário isolado.');
  }
  const env = testEnvironment({ DATABASE_URL: process.env.DATABASE_URL });
  database = createDatabase(env);
  ({ Usuario } = initializeModels(database));
  const context = await fixture({ env, Usuario, database });
  client = await createHttpClient(context.app);
});

afterAll(async () => { await client?.close(); if (database) await database.close(); });

test('PostgreSQL: cadastro persiste hash bcrypt e oculta o hash no model e HTTP', async () => {
  const response = await check("POST", '/api/v1/auth/register', 201, { json: validUser });
  const id = response.body.data.usuario.id;
  const user = await Usuario.findByPk(id);
  expect(user.senhaHash).toBeUndefined();
  const withPassword = await Usuario.scope('comSenha').findByPk(id);
  expect(await bcrypt.compare(validUser.senha, withPassword.senhaHash)).toBe(true);
  expect(withPassword.toJSON().senhaHash).toBeUndefined();
  expect(response.body.data.usuario.senhaHash).toBeUndefined();
  expect(user.createdAt instanceof Date).toBeTruthy();
});

test('PostgreSQL: login e consulta autenticada funcionam após persistência', async () => {
  const login = await check("POST", '/api/v1/auth/login', 200, { json: { email: validUser.email, senha: validUser.senha } });
  const me = await check("GET", '/api/v1/auth/me', 200, { token: login.body.data.accessToken });
  expect(me.body.data.usuario.email).toBe(validUser.email);
  await check("GET", '/api/v1/health/ready', 200);
});

test('PostgreSQL: cadastros concorrentes possuem um sucesso e um conflito', async () => {
  const body = { ...validUser, email: 'concorrente@example.com' };
  const responses = await Promise.all([
    check("POST", '/api/v1/auth/register', undefined, { json: body }),
    check("POST", '/api/v1/auth/register', undefined, { json: body }),
  ]);
  expect(responses.map((response) => response.status).sort()).toStrictEqual([201, 409]);
  expect(await Usuario.count({ where: { email: body.email } })).toBe(1);
});

test('PostgreSQL: banco rejeita e-mail sem normalização mesmo fora da API', async () => {
  await expect(Usuario.create({
    nome: 'Teste', email: 'Maiusculo@example.com', senhaHash: 'x'.repeat(60),
  })).rejects.toMatchObject({ original: { code: '23514' } });
});

test('PostgreSQL: token deixa de acessar /me se o usuário for removido', async () => {
  const email = 'removido@example.com';
  const registered = await check("POST", '/api/v1/auth/register', 201, { json: { ...validUser, email } });
  const login = await check("POST", '/api/v1/auth/login', 200, { json: { email, senha: validUser.senha } });
  await Usuario.destroy({ where: { id: registered.body.data.usuario.id } });
  await check("GET", '/api/v1/auth/me', 401, { token: login.body.data.accessToken });
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
    const runtimeClient = await createHttpClient(runtime.server);
    await check("GET", '/api/v1/health/ready', 200, undefined, runtimeClient);
    await check("POST", '/api/v1/auth/login', 200, { json: { email: validUser.email, senha: validUser.senha } }, runtimeClient);
  } finally {
    if (runtime) {
      await new Promise((resolve) => runtime.server.close(resolve));
      await runtime.mqttService?.stop();
      await runtime.database.close();
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
