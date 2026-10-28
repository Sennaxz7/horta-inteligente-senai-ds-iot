"use strict";
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      const opts = { transaction };
      const id = { type: S.UUID, primaryKey: true, allowNull: false };
      const ref = (model, allowNull = false) => ({ type: S.UUID, allowNull, references: { model, key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" });
      const timestamps = { created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false } };
      await q.createTable("mqtt_dispositivos", {
        id, usuario_id: ref("usuarios"), nome: { type: S.STRING(120), allowNull: false },
        simulado: { type: S.BOOLEAN, allowNull: false, defaultValue: true },
        arquivado_em: S.DATE, ultima_mensagem_em: S.DATE, ultimo_status: S.JSONB, ...timestamps,
      }, opts);
      await q.createTable("mqtt_zonas", {
        id, dispositivo_id: ref("mqtt_dispositivos"), nome: { type: S.STRING(120), allowNull: false },
        planta_id: ref("plantas", true), calibracao: S.JSONB, ...timestamps,
      }, opts);
      await q.addIndex("mqtt_zonas", ["planta_id"], { ...opts, unique: true, where: { planta_id: { [S.Op.ne]: null } } });
      await q.createTable("mqtt_mensagens", {
        id, dispositivo_id: ref("mqtt_dispositivos"), mensagem_id: { type: S.UUID, allowNull: false },
        zona_id: ref("mqtt_zonas", true), planta_id: ref("plantas", true),
        tipo: { type: S.STRING(20), allowNull: false }, dados: { type: S.JSONB, allowNull: false },
        medido_em: { type: S.DATE, allowNull: false }, recebido_em: { type: S.DATE, allowNull: false }, ...timestamps,
      }, opts);
      await q.addIndex("mqtt_mensagens", ["dispositivo_id", "mensagem_id"], { ...opts, unique: true });
      await q.addIndex("mqtt_mensagens", ["dispositivo_id", "tipo", "medido_em"], opts);
      await q.addIndex("mqtt_mensagens", ["planta_id", "medido_em"], opts);
      await q.createTable("mqtt_configuracoes", {
        id, dispositivo_id: ref("mqtt_dispositivos"), zona_id: ref("mqtt_zonas"),
        dados: { type: S.JSONB, allowNull: false }, status: { type: S.STRING(20), allowNull: false },
        confirmada_em: S.DATE, ...timestamps,
      }, opts);
      await q.sequelize.query("ALTER TABLE mqtt_configuracoes ADD CONSTRAINT mqtt_config_status CHECK (status IN ('PENDENTE','ENVIADA','CONFIRMADA','ERRO'))", opts);
    });
  },
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      for (const table of ["mqtt_configuracoes", "mqtt_mensagens", "mqtt_zonas", "mqtt_dispositivos"]) await q.dropTable(table, { transaction });
    });
  },
};
