const { readEnvironment } = require('../../src/config/env');
const { testEnvironment } = require('../helpers/fixture');
const { registerSchema } = require('../../src/validators/authValidators');
const { databaseOptions } = require('../../src/config/database');

test('configuração falha sem segredo e não exibe valores sensíveis', () => {
  expect(() => readEnvironment({ DATABASE_URL: 'postgresql://user:secret@localhost/db' }))
    .toThrow(/^(?![\s\S]*user:secret)[\s\S]*JWT_SECRET/);
});

test('configuração rejeita banco de outro dialeto e booleanos ambíguos', () => {
  expect(() => testEnvironment({ DATABASE_URL: 'sqlite://localhost/db' })).toThrow();
  expect(() => testEnvironment({ DATABASE_SSL: 'yes' })).toThrow();
  expect(() => testEnvironment({ JWT_EXPIRES_IN_SECONDS: '0' })).toThrow();
  expect(() => testEnvironment({ BCRYPT_ROUNDS: '4' })).toThrow();
});

test('TLS exige validação de certificado quando habilitado', () => {
  const options = databaseOptions(testEnvironment({ DATABASE_SSL: 'true' }));
  expect(options.dialectOptions.ssl.rejectUnauthorized).toBe(true);
  expect(databaseOptions(testEnvironment()).dialectOptions.ssl).toBeUndefined();
});

test('CORS aceita apenas origens explícitas HTTP(S)', () => {
  expect(testEnvironment({ CORS_ORIGINS: 'http://localhost:5173, https://horta.example' }).CORS_ORIGINS)
    .toStrictEqual(['http://localhost:5173', 'https://horta.example']);
  expect(() => testEnvironment({ CORS_ORIGINS: '*' })).toThrow();
  expect(() => testEnvironment({ CORS_ORIGINS: 'https://example.com/path' })).toThrow();
});

test('senhas respeitam o limite de 72 bytes UTF-8 do bcrypt', () => {
  const user = { nome: 'Ana', email: 'ana@example.com' };
  expect(registerSchema.safeParse({ ...user, senha: 'á'.repeat(36) }).success).toBe(true);
  expect(registerSchema.safeParse({ ...user, senha: 'á'.repeat(37) }).success).toBe(false);
  expect(registerSchema.safeParse({ ...user, senha: '12345678901' }).success).toBe(false);
  expect(registerSchema.safeParse({ ...user, senha: '123456789012\0' }).success).toBe(false);
});
