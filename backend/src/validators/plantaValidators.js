const { z } = require("zod");

const fases = ["SEMENTE", "GERMINACAO", "MUDA", "VEGETATIVA", "ADULTA"];
const uuid = z.string().uuid("Informe um UUID válido.");
const pagination = {
  pagina: z.coerce.number().int().min(1).max(1000000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
};
const timestamp = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => Date.parse(value) <= Date.now() + 30000,
    "A data não pode estar no futuro.",
  );
const nome = z.string().trim().min(1).max(120);
const details = {
  nome,
  apelido: z.string().trim().min(1).max(120).nullable().optional(),
  dataPlantio: z.iso.date().nullable().optional(),
};

module.exports = {
  fases,
  idParams: z.object({ id: uuid }).strict(),
  fotoParams: z.object({ id: uuid, fotoId: uuid }).strict(),
  identificacaoParams: z.object({ id: uuid, identificacaoId: uuid }).strict(),
  paginationSchema: z.object(pagination).strict(),
  especieCreateSchema: z
    .object({
      nomeCientifico: z
        .string()
        .trim()
        .min(2)
        .max(255)
        .transform((value) => value.replace(/\s+/g, " ")),
      nomeComum: z.string().trim().min(1).max(160).nullable().optional(),
    })
    .strict(),
  especieQuerySchema: z
    .object({
      ...pagination,
      busca: z.string().trim().min(1).max(120).optional(),
    })
    .strict(),
  plantaCreateSchema: z
    .object({
      ...details,
      faseAtual: z.enum(fases),
      especieId: uuid.nullable().optional(),
    })
    .strict(),
  plantaPatchSchema: z
    .object(details)
    .partial()
    .strict()
    .refine(
      (value) => Object.keys(value).length > 0,
      "Informe pelo menos um campo para alterar.",
    ),
  plantaQuerySchema: z
    .object({
      ...pagination,
      busca: z.string().trim().min(1).max(120).optional(),
      fase: z.enum(fases).optional(),
      especieId: uuid.optional(),
      statusIdentificacao: z
        .enum(["NAO_IDENTIFICADA", "IDENTIFICACAO_PENDENTE", "IDENTIFICADA"])
        .optional(),
      arquivadas: z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),
    })
    .strict(),
  especieManualSchema: z.object({ especieId: uuid.nullable() }).strict(),
  crescimentoCreateSchema: z
    .object({
      fase: z.enum(fases),
      alturaCm: z.number().min(0).max(10000).nullable().optional(),
      observacao: z.string().trim().max(2000).nullable().optional(),
      registradoEm: timestamp.optional(),
      fotoId: uuid.nullable().optional(),
    })
    .strict(),
  crescimentoQuerySchema: z
    .object({
      ...pagination,
      de: z.iso.datetime({ offset: true }).optional(),
      ate: z.iso.datetime({ offset: true }).optional(),
    })
    .strict()
    .refine(
      (value) =>
        !value.de ||
        !value.ate ||
        Date.parse(value.de) <= Date.parse(value.ate),
      "A data inicial deve ser anterior à final.",
    ),
  fotoCreateSchema: z
    .object({
      tipo: z.enum(["GERAL", "CRESCIMENTO", "IDENTIFICACAO"]).default("GERAL"),
      capturadaEm: timestamp.optional(),
    })
    .strict(),
  identificacaoCreateSchema: z
    .object({
      fotoId: uuid,
      orgao: z
        .enum(["auto", "leaf", "flower", "fruit", "bark"])
        .default("auto"),
    })
    .strict(),
  confirmacaoSchema: z
    .object({ candidatoIndice: z.number().int().min(0).max(4) })
    .strict(),
};
