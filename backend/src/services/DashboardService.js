const { QueryTypes } = require("sequelize");

// Totais e listas refletem o mesmo snapshot do PostgreSQL.
const overview = `
  WITH plantas_usuario AS (
    SELECT id, nome, fase_atual, especie_id, arquivada_em
    FROM plantas WHERE usuario_id = $usuarioId
  ), ativas AS (
    SELECT * FROM plantas_usuario WHERE arquivada_em IS NULL
  ), dispositivos_ativos AS (
    SELECT id, nome, simulado, ultima_mensagem_em AS "ultimaMensagemEm",
      COALESCE(ultimo_status->>'estado', 'SEM_STATUS') AS estado,
      ultimo_status->>'medidoEm' AS "statusMedidoEm",
      ultimo_status->>'recebidoEm' AS "statusRecebidoEm"
    FROM mqtt_dispositivos WHERE usuario_id = $usuarioId AND arquivado_em IS NULL
  ), leituras AS (
    SELECT leitura.id, planta.id AS "plantaId", planta.nome AS "plantaNome",
      leitura.dispositivo_id AS "dispositivoId", leitura.zona_id AS "zonaId",
      leitura.medido_em AS "medidoEm", leitura.dados->'simulado' AS simulado,
      leitura.dados->'umidadeSoloPercentual' AS "umidadeSoloPercentual",
      leitura.dados->'escalaUmidade' AS "escalaUmidade",
      leitura.dados->'distanciaAguaCm' AS "distanciaAguaCm",
      leitura.dados->'nivelAguaPercentual' AS "nivelAguaPercentual",
      leitura.dados->'nivelAguaValido' AS "nivelAguaValido"
    FROM ativas AS planta
    JOIN LATERAL (
      SELECT id, dispositivo_id, zona_id, medido_em, dados
      FROM mqtt_mensagens
      WHERE planta_id = planta.id AND tipo = 'sensores'
      ORDER BY medido_em DESC, id DESC LIMIT 1
    ) AS leitura ON true
    ORDER BY "medidoEm" DESC, id DESC LIMIT $limite
  ), irrigacoes AS (
    SELECT r.id, r.irrigacao_id AS "irrigacaoId", planta.id AS "plantaId",
      planta.nome AS "plantaNome", r.dispositivo_id AS "dispositivoId",
      r.zona_id AS "zonaId", r.resultado, r.simulado,
      r.configuracao_id AS "configuracaoId",
      r.configuracao_snapshot #> '{irrigacao,perfilIrrigacaoId}' AS "perfilIrrigacaoId",
      r.configuracao_snapshot #> '{irrigacao,perfilNome}' AS "perfilNome",
      r.configuracao_snapshot #> '{irrigacao,perfilVersao}' AS "perfilVersao",
      COALESCE(r.iniciada_em, r.finalizada_em) AS data,
      r.iniciada_em AS "iniciadaEm", r.finalizada_em AS "finalizadaEm",
      r.duracao_segundos AS "duracaoSegundos"
    FROM registros_irrigacao AS r JOIN ativas AS planta ON planta.id = r.planta_id
    ORDER BY data DESC, id DESC LIMIT $limite
  ), dispositivos_recentes AS (
    SELECT * FROM dispositivos_ativos
    ORDER BY "ultimaMensagemEm" DESC NULLS LAST, id DESC LIMIT $limite
  )
  SELECT jsonb_build_object(
    'plantas', (
      SELECT jsonb_build_object(
        'total', count(*),
        'ativas', count(*) FILTER (WHERE arquivada_em IS NULL),
        'arquivadas', count(*) FILTER (WHERE arquivada_em IS NOT NULL),
        'ativasIdentificadas', count(*) FILTER (WHERE arquivada_em IS NULL AND especie_id IS NOT NULL),
        'ativasPorFase', COALESCE((
          SELECT jsonb_object_agg(fase_atual, total)
          FROM (SELECT fase_atual, count(*) AS total FROM ativas GROUP BY fase_atual) AS fases
        ), '{}'::jsonb)
      ) FROM plantas_usuario
    ),
    'dispositivos', (
      SELECT jsonb_build_object(
        'total', count(*),
        'online', count(*) FILTER (WHERE estado = 'ONLINE'),
        'offline', count(*) FILTER (WHERE estado = 'OFFLINE'),
        'semStatus', count(*) FILTER (WHERE estado = 'SEM_STATUS'),
        'itens', COALESCE((
          SELECT jsonb_agg(to_jsonb(d) ORDER BY "ultimaMensagemEm" DESC NULLS LAST, id DESC)
          FROM dispositivos_recentes AS d
        ), '[]'::jsonb)
      ) FROM dispositivos_ativos
    ),
    'ultimasLeituras', COALESCE((
      SELECT jsonb_agg(to_jsonb(l) ORDER BY "medidoEm" DESC, id DESC) FROM leituras AS l
    ), '[]'::jsonb),
    'irrigacoesRecentes', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY data DESC, id DESC) FROM irrigacoes AS i
    ), '[]'::jsonb)
  ) AS data
`;

class DashboardService {
  constructor({ database }) {
    this.database = database;
  }

  async get(usuarioId, { limite }) {
    const [summary] = await this.database.query(overview, {
      type: QueryTypes.SELECT,
      bind: { usuarioId, limite },
    });
    return summary;
  }
}

module.exports = DashboardService;
