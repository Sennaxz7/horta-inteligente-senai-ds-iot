const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "IdentificacaoPlanta",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      plantaId: { type: DataTypes.UUID, allowNull: false },
      fotoId: { type: DataTypes.UUID, allowNull: false },
      status: { type: DataTypes.STRING(20), allowNull: false },
      candidatos: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      codigoErro: { type: DataTypes.STRING(60), allowNull: true },
      especieConfirmadaId: { type: DataTypes.UUID, allowNull: true },
      confirmadaEm: { type: DataTypes.DATE, allowNull: true },
      finalizadaEm: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: "identificacoes_plantas", underscored: true },
  );
