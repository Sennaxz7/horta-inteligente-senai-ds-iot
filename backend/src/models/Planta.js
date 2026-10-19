const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "Planta",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      usuarioId: { type: DataTypes.UUID, allowNull: false },
      especieId: { type: DataTypes.UUID, allowNull: true },
      nome: { type: DataTypes.STRING(120), allowNull: false },
      apelido: { type: DataTypes.STRING(120), allowNull: true },
      dataPlantio: { type: DataTypes.DATEONLY, allowNull: true },
      faseAtual: { type: DataTypes.STRING(20), allowNull: false },
      statusIdentificacao: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "NAO_IDENTIFICADA",
      },
      origemIdentificacao: { type: DataTypes.STRING(20), allowNull: true },
      confiancaIdentificacao: { type: DataTypes.DOUBLE, allowNull: true },
      arquivadaEm: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: "plantas", underscored: true },
  );
