const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "HistoricoCrescimento",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      plantaId: { type: DataTypes.UUID, allowNull: false },
      fase: { type: DataTypes.STRING(20), allowNull: false },
      fotoId: { type: DataTypes.UUID, allowNull: true },
      alturaCm: { type: DataTypes.DOUBLE, allowNull: true },
      observacao: { type: DataTypes.TEXT, allowNull: true },
      registradoEm: { type: DataTypes.DATE, allowNull: false },
    },
    { tableName: "historicos_crescimento", underscored: true },
  );
