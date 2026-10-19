const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "FaseCrescimento",
    {
      codigo: { type: DataTypes.STRING(20), primaryKey: true },
      nome: { type: DataTypes.STRING(60), allowNull: false },
      ordem: { type: DataTypes.INTEGER, allowNull: false },
    },
    { tableName: "fases_crescimento", timestamps: false },
  );
