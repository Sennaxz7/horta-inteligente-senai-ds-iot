const { z } = require("zod");
const { fases, gruposIrrigacao } = require("./plantaValidators");
const escalasUmidade = ["GRAVIMETRICA_BANDEJA", "CAPACIDADE_RETENCAO", "VOLUMETRICA"];
const uuid = z.string().uuid();
const page = {
  pagina: z.coerce.number().int().min(1).max(1000000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
};
const booleanQuery = z.enum(["true", "false"]).transform(v => v === "true");
const fields = {
  nome: z.string().trim().min(1).max(120), especieId: uuid, fase: z.enum(fases),
  escalaUmidade: z.enum(escalasUmidade).nullable().optional(),
  umidadeMinima: z.number().min(0).max(100), umidadeAlvo: z.number().min(0).max(100),
  duracaoMaximaSegundos: z.number().int().positive().max(86400),
  intervaloMinimoSegundos: z.number().int().positive().max(2147483647),
  fonte: z.string().trim().min(1).max(4000), observacao: z.string().trim().max(4000).nullable().optional(),
};
const create = z.object(fields).strict().refine(v => v.umidadeMinima < v.umidadeAlvo, "Umidade mínima deve ser menor que a alvo.");
module.exports = {
  create,
  profileFields: Object.keys(fields),
  escalasUmidade,
  patch: z.object({ ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
    statusValidacao: z.enum(["RASCUNHO", "VALIDADO"]).optional(),
  }).strict().refine(v => Object.keys(v).length > 0, "Informe um campo para alterar."),
  params: z.object({ id: uuid }).strict(),
  list: z.object({ ...page, especieId: uuid.optional(), fase: z.enum(fases).optional(),
    plantaId: uuid.optional(), tipo: z.enum(["PESSOAL", "REFERENCIA"]).optional(),
    grupoIrrigacao: z.enum(gruposIrrigacao).optional(),
    statusValidacao: z.enum(["RASCUNHO", "VALIDADO"]).optional(),
    arquivados: booleanQuery.default(false),
  }).strict(),
  bind: z.object({ perfilIrrigacaoId: uuid.nullable() }).strict(),
  copy: z.object({ especieId: uuid.optional() }).strict(),
  history: z.object({ ...page, resultado: z.enum(["EM_ANDAMENTO", "CONCLUIDA", "FALHA"]).optional(),
    simulado: booleanQuery.optional(), de: z.iso.datetime({ offset: true }).optional(),
    ate: z.iso.datetime({ offset: true }).optional(),
  }).strict().refine(v => !v.de || !v.ate || Date.parse(v.de) <= Date.parse(v.ate), "Período invertido."),
};
