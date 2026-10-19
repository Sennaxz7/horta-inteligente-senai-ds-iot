const { DataTypes, Model } = require("sequelize");

function defineUsuario(sequelize) {
  class Usuario extends Model {
    toJSON() {
      const values = { ...this.get() };
      delete values.senhaHash;
      return values;
    }
  }

  Usuario.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      nome: { type: DataTypes.STRING(120), allowNull: false },
      email: {
        type: DataTypes.STRING(254),
        allowNull: false,
        unique: "usuarios_email_unique",
      },
      senhaHash: { type: DataTypes.STRING(60), allowNull: false },
    },
    {
      sequelize,
      modelName: "Usuario",
      tableName: "usuarios",
      underscored: true,
      defaultScope: { attributes: { exclude: ["senhaHash"] } },
      scopes: {
        comSenha: {
          attributes: [
            "id",
            "nome",
            "email",
            "senhaHash",
            "createdAt",
            "updatedAt",
          ],
        },
      },
    },
  );

  return Usuario;
}

module.exports = defineUsuario;
