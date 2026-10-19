const { randomUUID } = require('node:crypto');
const { UniqueConstraintError } = require('sequelize');
const { readEnvironment } = require('../../src/config/env');
const AuthService = require('../../src/services/AuthService');
const { createApp } = require('../../src/app');
const { createServices } = require('../../src/services');

function testEnvironment(overrides = {}) {
  return readEnvironment({
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1/horta_inteligente_test',
    JWT_SECRET: 'test-only-secret-with-at-least-32-characters', BCRYPT_ROUNDS: '10',
    AUTH_RATE_LIMIT_MAX: '100', ...overrides,
  });
}

async function fixture({ env = testEnvironment(), Usuario, database, models, fetchImpl } = {}) {
  const users = new Map();
  const model = Usuario || models?.Usuario || {
    async create(values) {
      if ([...users.values()].some((user) => user.email === values.email)) {
        throw new UniqueConstraintError({ errors: [] });
      }
      const user = { id: randomUUID(), ...values, createdAt: new Date(), updatedAt: new Date() };
      users.set(user.id, user);
      return user;
    },
    scope() {
      return { findOne: async ({ where }) => [...users.values()].find((user) => user.email === where.email) || null };
    },
    async findByPk(id) { return users.get(id) || null; },
  };
  const authService = new AuthService({ Usuario: model, env });
  await authService.initialize();
  const errors = [];
  const services = models ? createServices({ env, models, database, fetchImpl }) : undefined;
  const app = createApp({
    env, authService, database: database || { authenticate: async () => {} },
    services,
    logger: { error: (...args) => errors.push(args) },
  });
  return { app, env, users, model, errors, services };
}

const validUser = { nome: 'Ana Silva', email: 'ana@example.com', senha: 'MinhaSenhaSegura123!' };

module.exports = { fixture, testEnvironment, validUser };
