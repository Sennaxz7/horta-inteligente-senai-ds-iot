const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "FotoPlanta",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      plantaId: { type: DataTypes.UUID, allowNull: false },
      chaveArquivo: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      mimeType: { type: DataTypes.STRING(40), allowNull: false },
      tamanhoBytes: { type: DataTypes.INTEGER, allowNull: false },
      capturadaEm: { type: DataTypes.DATE, allowNull: false },
      tipo: { type: DataTypes.STRING(20), allowNull: false },
    },
    { tableName: "fotos_plantas", underscored: true },
  );
