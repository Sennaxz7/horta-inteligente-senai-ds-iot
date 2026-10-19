const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "Especie",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      nomeCientifico: { type: DataTypes.STRING(255), allowNull: false },
      nomeCientificoNormalizado: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      nomeComum: { type: DataTypes.STRING(160), allowNull: true },
      plantNetId: { type: DataTypes.STRING(100), allowNull: true },
    },
    { tableName: "especies", underscored: true },
  );
