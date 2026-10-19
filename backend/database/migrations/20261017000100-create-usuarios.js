"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "usuarios",
        {
          id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
          nome: { type: Sequelize.STRING(120), allowNull: false },
          email: { type: Sequelize.STRING(254), allowNull: false },
          senha_hash: { type: Sequelize.STRING(60), allowNull: false },
          created_at: { type: Sequelize.DATE, allowNull: false },
          updated_at: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction },
      );
      await queryInterface.addIndex("usuarios", ["email"], {
        name: "usuarios_email_unique",
        unique: true,
        transaction,
      });
      await queryInterface.sequelize.query(
        `ALTER TABLE usuarios ADD CONSTRAINT usuarios_email_normalizado
         CHECK (email = lower(btrim(email)))`,
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("usuarios");
  },
};
