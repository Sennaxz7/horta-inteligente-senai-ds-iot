"use strict";

module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      const opts = { transaction };
      const ref = (model, allowNull = false, key = "id") => ({
        type: key === "codigo" ? S.STRING(20) : S.UUID,
        allowNull, references: { model, key }, onDelete: "RESTRICT", onUpdate: "CASCADE",
      });
      const id = { type: S.UUID, primaryKey: true, allowNull: false };
      const timestamps = () => ({ created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false } });
      await q.createTable("perfis_irrigacao", {
        id, usuario_id: ref("usuarios", true), tipo: { type: S.STRING(20), allowNull: false },
        nome: { type: S.STRING(120), allowNull: false }, especie_id: ref("especies"),
        fase: ref("fases_crescimento", false, "codigo"),
        umidade_minima: { type: S.DOUBLE, allowNull: false }, umidade_alvo: { type: S.DOUBLE, allowNull: false },
        duracao_maxima_segundos: { type: S.INTEGER, allowNull: false }, intervalo_minimo_segundos: { type: S.INTEGER, allowNull: false },
        fonte: { type: S.TEXT, allowNull: false }, observacao: S.TEXT,
        status_validacao: { type: S.STRING(20), allowNull: false, defaultValue: "RASCUNHO" },
        versao: { type: S.INTEGER, allowNull: false, defaultValue: 1 }, validado_em: S.DATE,
        arquivado_em: S.DATE, ...timestamps(),
      }, opts);
      await q.sequelize.query(`ALTER TABLE perfis_irrigacao
        ADD CONSTRAINT perfil_proprietario CHECK ((tipo = 'PESSOAL' AND usuario_id IS NOT NULL) OR (tipo = 'REFERENCIA' AND usuario_id IS NULL)),
        ADD CONSTRAINT perfil_parametros CHECK (umidade_minima >= 0 AND umidade_minima < umidade_alvo AND umidade_alvo <= 100 AND duracao_maxima_segundos > 0 AND intervalo_minimo_segundos > 0 AND versao > 0 AND length(btrim(fonte)) > 0),
        ADD CONSTRAINT perfil_validacao CHECK ((status_validacao = 'RASCUNHO' AND validado_em IS NULL) OR (status_validacao = 'VALIDADO' AND validado_em IS NOT NULL))`, opts);
      await q.addIndex("perfis_irrigacao", ["especie_id", "fase", "arquivado_em"], opts);
      await q.addIndex("perfis_irrigacao", ["usuario_id"], opts);
      await q.createTable("plantas_perfis_irrigacao", {
        planta_id: { ...ref("plantas"), primaryKey: true }, perfil_irrigacao_id: ref("perfis_irrigacao"),
        versao: { type: S.INTEGER, allowNull: false }, snapshot: { type: S.JSONB, allowNull: false }, ...timestamps(),
      }, opts);
      await q.createTable("registros_irrigacao", {
        id, dispositivo_id: ref("mqtt_dispositivos"), zona_id: ref("mqtt_zonas"), planta_id: ref("plantas", true),
        irrigacao_id: { type: S.UUID, allowNull: false }, simulado: { type: S.BOOLEAN, allowNull: false },
        iniciada_em: S.DATE, finalizada_em: S.DATE,
        inicio_recebido_em: S.DATE, fim_recebido_em: S.DATE,
        duracao_segundos: S.DOUBLE, motivo_falha: S.TEXT,
        resultado: { type: S.STRING(20), allowNull: false },
        configuracao_id: ref("mqtt_configuracoes", true), configuracao_snapshot: S.JSONB,
        ...timestamps(),
      }, opts);
      await q.addIndex("registros_irrigacao", ["dispositivo_id", "irrigacao_id"], { ...opts, unique: true });
      await q.addIndex("registros_irrigacao", ["planta_id", "created_at", "id"], opts);
      await q.sequelize.query(`ALTER TABLE registros_irrigacao
        ADD CONSTRAINT irrigacao_datas CHECK (iniciada_em IS NOT NULL OR finalizada_em IS NOT NULL),
        ADD CONSTRAINT irrigacao_ordem CHECK (iniciada_em IS NULL OR finalizada_em IS NULL OR finalizada_em >= iniciada_em),
        ADD CONSTRAINT irrigacao_duracao CHECK (duracao_segundos IS NULL OR (duracao_segundos >= 0 AND duracao_segundos <= 86400)),
        ADD CONSTRAINT irrigacao_estado CHECK ((resultado = 'EM_ANDAMENTO' AND iniciada_em IS NOT NULL AND finalizada_em IS NULL) OR (resultado IN ('CONCLUIDA','FALHA') AND finalizada_em IS NOT NULL))`, opts);
    });
  },
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      for (const table of ["registros_irrigacao", "plantas_perfis_irrigacao", "perfis_irrigacao"]) {
        await q.dropTable(table, { transaction });
      }
    });
  },
};
