const { loadEnvironment } = require("./config/env");
const { createDatabase } = require("./config/database");
const { initializeModels } = require("./models");
const AuthService = require("./services/AuthService");
const { createApp } = require("./app");
const { createServices } = require("./services");

async function start() {
  const env = loadEnvironment();
  const database = createDatabase(env);
  try {
    const models = initializeModels(database);
    const { Usuario } = models;
    await database.authenticate();
    const tables = await database.getQueryInterface().showAllTables();
    const requiredTables = [
      "usuarios",
      "especies",
      "fases_crescimento",
      "plantas",
      "historicos_crescimento",
      "fotos_plantas",
      "identificacoes_plantas",
    ];
    if (requiredTables.some((table) => !tables.includes(table)))
      throw new Error("Migrations pendentes. Execute npm run db:migrate.");
    const authService = new AuthService({ Usuario, env });
    await authService.initialize();
    const services = createServices({ models, database, env });
    const app = createApp({ env, authService, database, services });
    const server = app.listen(env.PORT, env.HOST);
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    console.info(`API disponível em http://${env.HOST}:${env.PORT}/api/v1`);

    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      const timer = setTimeout(() => process.exit(1), 10000);
      timer.unref();
      server.close(async () => {
        try {
          await database.close();
        } catch {
          process.exitCode = 1;
        }
        clearTimeout(timer);
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return { server, database };
  } catch (error) {
    await database.close();
    throw error;
  }
}

if (require.main === module) {
  start().catch((error) => {
    // Apenas configuração produz mensagens próprias; erros de conexão podem conter segredos.
    const actionable =
      error.message.startsWith("Configuração inválida:") ||
      error.message.startsWith("Migrations pendentes.");
    console.error(
      actionable
        ? error.message
        : "Falha ao iniciar a API. Verifique PostgreSQL, credenciais e migrations.",
    );
    process.exitCode = 1;
  });
}

module.exports = { start };
