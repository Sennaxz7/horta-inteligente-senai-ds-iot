const { randomUUID } = require("node:crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const recursoRoutes = require("./routes/recursoRoutes");
const errorMiddleware = require("./middlewares/errorMiddleware");
const AppError = require("./utils/AppError");

function createApp({ env, authService, database, services, logger = console }) {
  const app = express();
  app.disable("x-powered-by");
  // Não confiar em X-Forwarded-For sem configurar a infraestrutura de proxy.
  app.set("trust proxy", false);
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set("X-Request-Id", req.requestId);
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false }));
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/v1/health/live", (req, res) =>
    res.json({ data: { status: "ok" } }),
  );
  app.get("/api/v1/health/ready", async (req, res) => {
    try {
      await database.authenticate();
      res.json({ data: { status: "ready" } });
    } catch {
      throw new AppError(
        503,
        "DATABASE_UNAVAILABLE",
        "Banco de dados indisponível.",
      );
    }
  });
  app.use("/api/v1/auth", authRoutes({ env, authService }));
  if (services?.mqttService) app.use("/api/v1", require("./routes/mqttRoutes")({ env, authService, services }));
  if (services)
    app.use("/api/v1", recursoRoutes({ env, authService, services }));
  app.use((req, res, next) =>
    next(new AppError(404, "NOT_FOUND", "Rota não encontrada.")),
  );
  app.use(errorMiddleware(logger));
  return app;
}

module.exports = { createApp };
