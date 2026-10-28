const path = require("node:path");
const dotenv = require("dotenv");
const { z } = require("zod");

function readEnvironment(source = process.env) {
  const schema = z.object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => {
        try {
          return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }, "Informe uma URL PostgreSQL."),
    DATABASE_SSL: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86400)
      .default(3600),
    JWT_ISSUER: z.string().min(1).default("horta-inteligente-api"),
    JWT_AUDIENCE: z.string().min(1).default("horta-inteligente-web"),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
    CORS_ORIGINS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .refine(
        (origins) =>
          origins.every((origin) => {
            try {
              const url = new URL(origin);
              return (
                ["http:", "https:"].includes(url.protocol) &&
                url.origin === origin
              );
            } catch {
              return false;
            }
          }),
        "Use origens HTTP(S) sem caminho nem barra final.",
      ),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(86400000)
      .default(900000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(20),
    UPLOAD_DIR: z.string().min(1).default("storage/uploads"),
    MQTT_ENABLED: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
    MQTT_TEST_MODE: z.enum(["true", "false"]).default("true").transform(v => v === "true"),
    MQTT_URL: z.string().url().refine(v => {
      const url = new URL(v);
      return ["mqtt:", "mqtts:"].includes(url.protocol) && !url.username && !url.password;
    }).default("mqtt://test.mosquitto.org:1883"),
    MQTT_PREFIX: z.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/).max(150).default("senai/mateu-horta-7c91"),
    MQTT_USERNAME: z.string().default(""),
    MQTT_PASSWORD: z.string().default(""),
    MQTT_CLIENT_ID: z.string().regex(/^[a-zA-Z0-9_-]*$/).max(100).default(""),
    PLANTNET_API_KEY: z.string().trim().default(""),
    PLANTNET_PROJECT: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .default("all"),
    PLANTNET_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(20000),
  });

  const parsed = schema.superRefine((env, ctx) => {
    if (env.MQTT_ENABLED && !env.MQTT_TEST_MODE && (!env.MQTT_URL.startsWith("mqtts://") || !env.MQTT_USERNAME || !env.MQTT_PASSWORD || new URL(env.MQTT_URL).hostname === "test.mosquitto.org")) {
      ctx.addIssue({ code: "custom", path: ["MQTT_URL"], message: "Modo real exige broker privado com TLS e credenciais." });
    }
  }).safeParse(source);
  if (!parsed.success) {
    // Não inclua valores das variáveis: podem conter credenciais.
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new Error(
      `Configuração inválida: ${fields.join(", ")}. Consulte .env.example.`,
    );
  }
  return Object.freeze(parsed.data);
}

function loadEnvironment() {
  dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
  return readEnvironment();
}

module.exports = { readEnvironment, loadEnvironment };
