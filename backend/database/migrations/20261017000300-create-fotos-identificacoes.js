"use strict";

module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      const options = { transaction };
      const reference = (model, nullable = false) => ({
        type: S.UUID,
        allowNull: nullable,
        references: { model, key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      });
      const timestamps = () => ({
        created_at: { type: S.DATE, allowNull: false },
        updated_at: { type: S.DATE, allowNull: false },
      });
      await q.createTable(
        "fotos_plantas",
        {
          id: { type: S.UUID, primaryKey: true, allowNull: false },
          planta_id: reference("plantas"),
          chave_arquivo: {
            type: S.STRING(100),
            allowNull: false,
            unique: true,
          },
          mime_type: { type: S.STRING(40), allowNull: false },
          tamanho_bytes: { type: S.INTEGER, allowNull: false },
          capturada_em: { type: S.DATE, allowNull: false },
          tipo: { type: S.STRING(20), allowNull: false },
          ...timestamps(),
        },
        options,
      );
      await q.addIndex("fotos_plantas", ["planta_id", "capturada_em"], options);
      await q.addIndex("fotos_plantas", ["id", "planta_id"], {
        ...options,
        name: "fotos_planta_composta_unique",
        unique: true,
      });
      await q.sequelize.query(
        `ALTER TABLE fotos_plantas ADD CONSTRAINT fotos_metadados_validos
        CHECK (mime_type = 'image/jpeg' AND tamanho_bytes > 0 AND tipo IN ('GERAL', 'CRESCIMENTO', 'IDENTIFICACAO'))`,
        options,
      );
      await q.addColumn(
        "historicos_crescimento",
        "foto_id",
        reference("fotos_plantas", true),
        options,
      );
      await q.createTable(
        "identificacoes_plantas",
        {
          id: { type: S.UUID, primaryKey: true, allowNull: false },
          planta_id: reference("plantas"),
          foto_id: reference("fotos_plantas"),
          status: { type: S.STRING(20), allowNull: false },
          candidatos: { type: S.JSONB, allowNull: false, defaultValue: [] },
          codigo_erro: { type: S.STRING(60), allowNull: true },
          especie_confirmada_id: reference("especies", true),
          confirmada_em: { type: S.DATE, allowNull: true },
          finalizada_em: { type: S.DATE, allowNull: true },
          ...timestamps(),
        },
        options,
      );
      await q.addIndex(
        "identificacoes_plantas",
        ["planta_id", "created_at"],
        options,
      );
      await q.sequelize.query(
        `ALTER TABLE historicos_crescimento ADD CONSTRAINT crescimento_foto_da_planta
        FOREIGN KEY (foto_id, planta_id) REFERENCES fotos_plantas (id, planta_id)`,
        options,
      );
      await q.sequelize.query(
        `ALTER TABLE identificacoes_plantas ADD CONSTRAINT identificacao_foto_da_planta
        FOREIGN KEY (foto_id, planta_id) REFERENCES fotos_plantas (id, planta_id)`,
        options,
      );
      await q.addIndex("identificacoes_plantas", ["planta_id"], {
        ...options,
        name: "identificacao_pendente_por_planta",
        unique: true,
        where: { status: "PENDENTE" },
      });
      await q.sequelize.query(
        `ALTER TABLE identificacoes_plantas ADD CONSTRAINT identificacao_estado_valido CHECK (
        (status IN ('PENDENTE', 'CONCLUIDA', 'ERRO') AND especie_confirmada_id IS NULL AND confirmada_em IS NULL)
        OR (status = 'CONFIRMADA' AND especie_confirmada_id IS NOT NULL AND confirmada_em IS NOT NULL))`,
        options,
      );
    });
  },
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      await q.dropTable("identificacoes_plantas", { transaction });
      await q.removeColumn("historicos_crescimento", "foto_id", {
        transaction,
      });
      await q.dropTable("fotos_plantas", { transaction });
    });
  },
};
