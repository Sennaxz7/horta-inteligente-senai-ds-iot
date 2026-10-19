const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readEnvironment } = require('../../src/config/env');
const { testEnvironment } = require('../helpers/fixture');
const { registerSchema } = require('../../src/validators/authValidators');
const { databaseOptions } = require('../../src/config/database');

test('configuração falha sem segredo e não exibe valores sensíveis', () => {
  assert.throws(() => readEnvironment({ DATABASE_URL: 'postgresql://user:secret@localhost/db' }),
    (error) => error.message.includes('JWT_SECRET') && !error.message.includes('user:secret'));
});

test('configuração rejeita banco de outro dialeto e booleanos ambíguos', () => {
  assert.throws(() => testEnvironment({ DATABASE_URL: 'sqlite://localhost/db' }));
  assert.throws(() => testEnvironment({ DATABASE_SSL: 'yes' }));
  assert.throws(() => testEnvironment({ JWT_EXPIRES_IN_SECONDS: '0' }));
  assert.throws(() => testEnvironment({ BCRYPT_ROUNDS: '4' }));
});

test('TLS exige validação de certificado quando habilitado', () => {
  const options = databaseOptions(testEnvironment({ DATABASE_SSL: 'true' }));
  assert.equal(options.dialectOptions.ssl.rejectUnauthorized, true);
  assert.equal(databaseOptions(testEnvironment()).dialectOptions.ssl, undefined);
});

test('CORS aceita apenas origens explícitas HTTP(S)', () => {
  assert.deepEqual(testEnvironment({ CORS_ORIGINS: 'http://localhost:5173, https://horta.example' }).CORS_ORIGINS,
    ['http://localhost:5173', 'https://horta.example']);
  assert.throws(() => testEnvironment({ CORS_ORIGINS: '*' }));
  assert.throws(() => testEnvironment({ CORS_ORIGINS: 'https://example.com/path' }));
});

test('senhas respeitam o limite de 72 bytes UTF-8 do bcrypt', () => {
  const user = { nome: 'Ana', email: 'ana@example.com' };
  assert.equal(registerSchema.safeParse({ ...user, senha: 'á'.repeat(36) }).success, true);
  assert.equal(registerSchema.safeParse({ ...user, senha: 'á'.repeat(37) }).success, false);
  assert.equal(registerSchema.safeParse({ ...user, senha: '12345678901' }).success, false);
  assert.equal(registerSchema.safeParse({ ...user, senha: '123456789012\0' }).success, false);
});
