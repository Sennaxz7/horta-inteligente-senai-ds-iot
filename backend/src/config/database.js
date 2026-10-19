const { Sequelize } = require("sequelize");

function databaseOptions(env) {
  return {
    dialect: "postgres",
    logging: false,
    define: { underscored: true, freezeTableName: true },
    pool: { max: 5, min: 0, acquire: 10000, idle: 10000 },
    dialectOptions: {
      connectionTimeoutMillis: 5000,
      ...(env.DATABASE_SSL
        ? { ssl: { require: true, rejectUnauthorized: true } }
        : {}),
    },
  };
}

function createDatabase(env) {
  return new Sequelize(env.DATABASE_URL, databaseOptions(env));
}

module.exports = { createDatabase, databaseOptions };
