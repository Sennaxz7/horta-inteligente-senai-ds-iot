"use strict";

module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      const options = { transaction };
      const timestamps = () => ({
        created_at: { type: S.DATE, allowNull: false },
        updated_at: { type: S.DATE, allowNull: false },
      });
      const reference = (model, key = "id", nullable = false) => ({
        type: key === "codigo" ? S.STRING(20) : S.UUID,
        allowNull: nullable,
        references: { model, key },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      });
      await q.createTable(
        "fases_crescimento",
        {
          codigo: { type: S.STRING(20), primaryKey: true },
          nome: { type: S.STRING(60), allowNull: false },
          ordem: { type: S.INTEGER, allowNull: false, unique: true },
        },
        options,
      );
      await q.bulkInsert(
        "fases_crescimento",
        [
          { codigo: "SEMENTE", nome: "Semente", ordem: 1 },
          { codigo: "GERMINACAO", nome: "Germinação", ordem: 2 },
          { codigo: "MUDA", nome: "Muda", ordem: 3 },
          { codigo: "VEGETATIVA", nome: "Vegetativa", ordem: 4 },
          { codigo: "ADULTA", nome: "Adulta", ordem: 5 },
        ],
        options,
      );
      await q.createTable(
        "especies",
        {
          id: { type: S.UUID, primaryKey: true, allowNull: false },
          nome_cientifico: { type: S.STRING(255), allowNull: false },
          nome_cientifico_normalizado: {
            type: S.STRING(255),
            allowNull: false,
          },
          nome_comum: { type: S.STRING(160), allowNull: true },
          plant_net_id: { type: S.STRING(100), allowNull: true },
          ...timestamps(),
        },
        options,
      );
      await q.addIndex("especies", ["nome_cientifico_normalizado"], {
        ...options,
        name: "especies_nome_normalizado_unique",
        unique: true,
      });
      await q.sequelize.query(
        `ALTER TABLE especies ADD CONSTRAINT especies_nome_normalizado
        CHECK (nome_cientifico_normalizado = lower(nome_cientifico) AND nome_cientifico = btrim(nome_cientifico))`,
        options,
      );
      await q.createTable(
        "plantas",
        {
          id: { type: S.UUID, primaryKey: true, allowNull: false },
          usuario_id: reference("usuarios"),
          especie_id: reference("especies", "id", true),
          nome: { type: S.STRING(120), allowNull: false },
          apelido: { type: S.STRING(120), allowNull: true },
          data_plantio: { type: S.DATEONLY, allowNull: true },
          fase_atual: reference("fases_crescimento", "codigo"),
          status_identificacao: {
            type: S.STRING(30),
            allowNull: false,
            defaultValue: "NAO_IDENTIFICADA",
          },
          origem_identificacao: { type: S.STRING(20), allowNull: true },
          confianca_identificacao: { type: S.DOUBLE, allowNull: true },
          arquivada_em: { type: S.DATE, allowNull: true },
          ...timestamps(),
        },
        options,
      );
      await q.addIndex(
        "plantas",
        ["usuario_id", "arquivada_em", "created_at"],
        options,
      );
      await q.sequelize.query(
        `ALTER TABLE plantas ADD CONSTRAINT plantas_identificacao_coerente CHECK (
        (especie_id IS NULL AND status_identificacao IN ('NAO_IDENTIFICADA', 'IDENTIFICACAO_PENDENTE')
          AND origem_identificacao IS NULL AND confianca_identificacao IS NULL)
        OR (especie_id IS NOT NULL AND status_identificacao = 'IDENTIFICADA'
          AND origem_identificacao IS NOT NULL AND (
            (origem_identificacao = 'MANUAL' AND confianca_identificacao IS NULL)
            OR (origem_identificacao = 'API' AND confianca_identificacao IS NOT NULL
              AND confianca_identificacao BETWEEN 0 AND 1))))`,
        options,
      );
      await q.createTable(
        "historicos_crescimento",
        {
          id: { type: S.UUID, primaryKey: true, allowNull: false },
          planta_id: reference("plantas"),
          fase: reference("fases_crescimento", "codigo"),
          altura_cm: { type: S.DOUBLE, allowNull: true },
          observacao: { type: S.TEXT, allowNull: true },
          registrado_em: { type: S.DATE, allowNull: false },
          ...timestamps(),
        },
        options,
      );
      await q.addIndex(
        "historicos_crescimento",
        ["planta_id", "registrado_em", "created_at", "id"],
        options,
      );
      await q.sequelize.query(
        `ALTER TABLE historicos_crescimento ADD CONSTRAINT crescimento_altura_valida
        CHECK (altura_cm IS NULL OR (altura_cm >= 0 AND altura_cm <= 10000))`,
        options,
      );
    });
  },
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      for (const table of [
        "historicos_crescimento",
        "plantas",
        "especies",
        "fases_crescimento",
      ]) {
        await q.dropTable(table, { transaction });
      }
    });
  },
};
