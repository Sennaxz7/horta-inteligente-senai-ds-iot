const { QueryTypes } = require("sequelize");
const { pageOptions, paginated } = require("../utils/pagination");

// A união acontece antes da paginação: uma página pode misturar todos os tipos.
const timeline = `
  WITH eventos AS (
    SELECT id, 'CRESCIMENTO' AS tipo, registrado_em AS data,
      jsonb_build_object('fase', fase, 'alturaCm', altura_cm,
        'observacao', observacao, 'fotoId', foto_id) AS dados
    FROM historicos_crescimento WHERE planta_id = $plantaId
    UNION ALL
    SELECT id, 'IDENTIFICACAO', created_at,
      jsonb_build_object('status', status, 'fotoId', foto_id,
        'especieConfirmadaId', especie_confirmada_id, 'confirmadaEm', confirmada_em,
        'finalizadaEm', finalizada_em, 'codigoErro', codigo_erro)
    FROM identificacoes_plantas WHERE planta_id = $plantaId
    UNION ALL
    SELECT id, 'LEITURA', medido_em,
      jsonb_build_object('dispositivoId', dispositivo_id, 'zonaId', zona_id,
        'simulado', dados->'simulado', 'umidadeSoloPercentual', dados->'umidadeSoloPercentual',
        'escalaUmidade', dados->'escalaUmidade',
        'distanciaAguaCm', dados->'distanciaAguaCm', 'nivelAguaPercentual', dados->'nivelAguaPercentual',
        'nivelAguaValido', dados->'nivelAguaValido')
    FROM mqtt_mensagens WHERE planta_id = $plantaId AND tipo = 'sensores'
    UNION ALL
    SELECT id, 'IRRIGACAO', COALESCE(iniciada_em, finalizada_em),
      jsonb_build_object('irrigacaoId', irrigacao_id, 'resultado', resultado,
        'dispositivoId', dispositivo_id, 'zonaId', zona_id, 'simulado', simulado,
        'iniciadaEm', iniciada_em, 'finalizadaEm', finalizada_em,
        'duracaoSegundos', duracao_segundos, 'motivoFalha', motivo_falha,
        'configuracaoId', configuracao_id,
        'perfilIrrigacaoId', configuracao_snapshot #> '{irrigacao,perfilIrrigacaoId}',
        'perfilNome', configuracao_snapshot #> '{irrigacao,perfilNome}',
        'perfilFase', configuracao_snapshot #> '{irrigacao,fase}',
        'perfilVersao', configuracao_snapshot #> '{irrigacao,perfilVersao}')
    FROM registros_irrigacao WHERE planta_id = $plantaId
  ), filtrados AS (
    SELECT * FROM eventos
    WHERE ($tipo::text IS NULL OR tipo = $tipo)
      AND ($de::timestamptz IS NULL OR data >= $de)
      AND ($ate::timestamptz IS NULL OR data <= $ate)
  ), pagina AS (
    SELECT * FROM filtrados ORDER BY data DESC, tipo ASC, id DESC
    LIMIT $limit OFFSET $offset
  )
  SELECT (SELECT count(*) FROM filtrados) AS total,
    COALESCE(jsonb_agg(to_jsonb(pagina) ORDER BY data DESC, tipo ASC, id DESC), '[]'::jsonb) AS itens
  FROM pagina
`;

class HistoricoService {
  constructor({ database, plantaService }) {
    Object.assign(this, { database, plantaService });
  }

  async list(plantaId, usuarioId, query) {
    await this.plantaService.owned(plantaId, usuarioId);
    const [result] = await this.database.query(timeline, {
      type: QueryTypes.SELECT,
      bind: {
        plantaId,
        tipo: query.tipo ?? null,
        de: query.de ?? null,
        ate: query.ate ?? null,
        ...pageOptions(query),
      },
    });
    return paginated({ rows: result.itens, count: Number(result.total) }, query);
  }
}

module.exports = HistoricoService;
