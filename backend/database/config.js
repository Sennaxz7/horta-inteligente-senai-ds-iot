const path = require("node:path");
const dotenv = require("dotenv");
const { databaseOptions } = require("../src/config/database");

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

if (!process.env.DATABASE_URL)
  throw new Error("Configure DATABASE_URL antes de executar migrations.");
if (!["true", "false", undefined].includes(process.env.DATABASE_SSL)) {
  throw new Error("DATABASE_SSL deve ser true ou false.");
}

const options = {
  use_env_variable: "DATABASE_URL",
  ...databaseOptions({ DATABASE_SSL: process.env.DATABASE_SSL === "true" }),
};

module.exports = { development: options, test: options, production: options };
