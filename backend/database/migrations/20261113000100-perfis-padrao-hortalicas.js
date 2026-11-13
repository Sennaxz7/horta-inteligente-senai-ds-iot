"use strict";

const { randomUUID } = require("node:crypto");

const profiles = [
  ["SEMENTE", "Semente", 60, 70, "GRAVIMETRICA_BANDEJA"],
  ["GERMINACAO", "Germinação", 60, 70, "GRAVIMETRICA_BANDEJA"],
  ["MUDA", "Muda", 70, 80, "CAPACIDADE_RETENCAO"],
  ["VEGETATIVA", "Vegetativa", 20.51, 23.41, "VOLUMETRICA"],
  ["ADULTA", "Adulta", 20.51, 23.41, "VOLUMETRICA"],
];
const fonteBandeja = "https://doi.org/10.3390/horticulturae12080906";
const fonteVaso = "https://doi.org/10.1590/S0102-05362011000200018 · https://www.scielo.br/j/eagri/a/NFGdypYMJKtZDsnjZdQz3tn/?lang=pt";

module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      const options = { transaction };
      await q.addColumn("plantas", "grupo_irrigacao", S.STRING(20), options);
      await q.addColumn("perfis_irrigacao", "grupo_irrigacao", S.STRING(20), options);
      await q.addColumn("perfis_irrigacao", "escala_umidade", S.STRING(30), options);
      await q.sequelize.query(`
        ALTER TABLE plantas ADD CONSTRAINT plantas_grupo_irrigacao
          CHECK (grupo_irrigacao IS NULL OR grupo_irrigacao = 'HORTALICAS');
        ALTER TABLE perfis_irrigacao ALTER COLUMN especie_id DROP NOT NULL;
        ALTER TABLE perfis_irrigacao ADD CONSTRAINT perfis_escopo_irrigacao CHECK (
          (grupo_irrigacao IS NULL AND especie_id IS NOT NULL) OR
          (grupo_irrigacao IS NOT NULL AND grupo_irrigacao = 'HORTALICAS' AND especie_id IS NULL
            AND tipo = 'REFERENCIA' AND escala_umidade IS NOT NULL)
        );
        ALTER TABLE perfis_irrigacao ADD CONSTRAINT perfis_escala_umidade CHECK (
          escala_umidade IS NULL OR escala_umidade IN ('GRAVIMETRICA_BANDEJA', 'CAPACIDADE_RETENCAO', 'VOLUMETRICA')
        );
        CREATE UNIQUE INDEX perfis_padrao_grupo_fase ON perfis_irrigacao (grupo_irrigacao, fase)
          WHERE grupo_irrigacao IS NOT NULL AND arquivado_em IS NULL;
      `, options);
      const now = new Date();
      await q.bulkInsert("perfis_irrigacao", profiles.map(([fase, nome, minima, alvo, escala]) => ({
        id: randomUUID(), tipo: "REFERENCIA", nome: `Hortaliças · ${nome}`,
        grupo_irrigacao: "HORTALICAS", fase, escala_umidade: escala,
        umidade_minima: minima, umidade_alvo: alvo,
        duracao_maxima_segundos: 2, intervalo_minimo_segundos: 15,
        fonte: escala === "VOLUMETRICA" ? fonteVaso : fonteBandeja,
        observacao: "Perfil de demonstração. Alface como referência. Limiares adaptados dos ensaios para o simulador MQTT.",
        status_validacao: "VALIDADO", validado_em: now, created_at: now, updated_at: now,
      })), options);
    });
  },

  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      const options = { transaction };
      await q.bulkDelete("perfis_irrigacao", { grupo_irrigacao: "HORTALICAS" }, options);
      await q.sequelize.query(`
        DROP INDEX perfis_padrao_grupo_fase;
        ALTER TABLE perfis_irrigacao DROP CONSTRAINT perfis_escopo_irrigacao;
        ALTER TABLE perfis_irrigacao DROP CONSTRAINT perfis_escala_umidade;
        ALTER TABLE perfis_irrigacao ALTER COLUMN especie_id SET NOT NULL;
        ALTER TABLE plantas DROP CONSTRAINT plantas_grupo_irrigacao;
      `, options);
      await q.removeColumn("perfis_irrigacao", "escala_umidade", options);
      await q.removeColumn("perfis_irrigacao", "grupo_irrigacao", options);
      await q.removeColumn("plantas", "grupo_irrigacao", options);
    });
  },
};
