const { z } = require("zod");
const { fases, gruposIrrigacao } = require("./plantaValidators");
const { escalasUmidade } = require("./irrigacaoValidators");
const uuid = z.string().uuid();
const percent = z.number().min(0).max(100);
const time = z.iso
  .datetime({ offset: true })
  .refine((v) => Date.parse(v) <= Date.now() + 30000, "Data futura.");
const base = {
  versao: z.literal(1),
  mensagemId: uuid,
  dispositivoId: uuid,
  medidoEm: time,
  simulado: z.boolean(),
};
const calibracao = z
  .object({
    distanciaVazioCm: z.number().positive().max(10000),
    distanciaCheioCm: z.number().positive().max(10000),
  })
  .strict()
  .refine((v) => v.distanciaVazioCm > v.distanciaCheioCm);
const config = z
  .object({
    intervaloLeituraSegundos: z.number().int().min(2).max(86400),
    automacaoHabilitada: z.literal(false),
    calibracaoReservatorio: calibracao.nullable(),
  })
  .strict();
const irrigationSnapshot = z.object({
  plantaId: uuid, perfilIrrigacaoId: uuid, perfilVersao: z.number().int().positive(),
  especieId: uuid.nullable(), fase: z.enum(fases),
  perfilNome: z.string().min(1).max(120).optional(),
  origem: z.enum(["ASSOCIADO", "PADRAO_GRUPO"]).optional(),
  grupoIrrigacao: z.enum(gruposIrrigacao).optional(),
  escalaUmidade: z.enum(escalasUmidade).optional(),
  umidadeMinima: percent, umidadeAlvo: percent,
  duracaoMaximaSegundos: z.number().int().min(1).max(86400),
  intervaloMinimoSegundos: z.number().int().min(1).max(2147483647),
}).strict().refine(v => v.umidadeMinima < v.umidadeAlvo &&
  (v.origem === "PADRAO_GRUPO" ? Boolean(v.grupoIrrigacao && v.escalaUmidade) : Boolean(v.especieId)));
const configMessage = config.extend({
  versao: z.literal(1), configuracaoId: uuid, dispositivoId: uuid, zonaId: uuid,
  modo: z.enum(["MONITORAMENTO", "SIMULACAO_IRRIGACAO"]).optional(),
  irrigacao: irrigationSnapshot.optional(),
}).superRefine((value, ctx) => {
  if (value.modo === "SIMULACAO_IRRIGACAO" ? !value.irrigacao || !value.calibracaoReservatorio : value.irrigacao) {
    ctx.addIssue({ code: "custom", message: "Modo incompatível com os parâmetros de irrigação." });
  }
});
const zonaFields = {
  nome: z.string().trim().min(1).max(120),
  plantaId: uuid.nullable(),
  calibracao: calibracao.nullable(),
};
module.exports = {
  dispositivo: z
    .object({
      nome: z.string().trim().min(1).max(120),
      simulado: z.boolean().default(true),
    })
    .strict(),
  dispositivoPatch: z
    .object({ nome: z.string().trim().min(1).max(120) })
    .strict(),
  zona: z
    .object({
      ...zonaFields,
      plantaId: zonaFields.plantaId.default(null),
      calibracao: zonaFields.calibracao.default(null),
    })
    .strict(),
  zonaPatch: z.object(zonaFields).strict().partial()
    .refine(data => Object.keys(data).length > 0, "Informe ao menos um campo."),
  config,
  syncConfig: config.extend({ modo: z.enum(["MONITORAMENTO", "SIMULACAO_IRRIGACAO"]).optional() }),
  configMessage,
  irrigationSnapshot,
  sensores: z
    .object({
      ...base,
      zonaId: uuid,
      umidadeSoloPercentual: percent.nullable(),
      distanciaAguaCm: z.number().positive().max(10000).nullable(),
      configuracaoId: uuid.optional(),
    })
    .strict()
    .refine(v => v.simulado || !v.configuracaoId),
  status: z.object({ ...base, estado: z.enum(["ONLINE", "OFFLINE"]) }).strict(),
  eventos: z
    .object({
      ...base,
      zonaId: uuid,
      tipo: z.enum([
        "IRRIGACAO_INICIADA",
        "IRRIGACAO_FINALIZADA",
        "FALHA_SENSOR",
        "RESERVATORIO_BAIXO",
      ]),
      duracaoSegundos: z.number().min(0).max(86400).optional(),
      irrigacaoId: uuid.optional(),
      configuracaoId: uuid.optional(),
      resultado: z.enum(["CONCLUIDA", "FALHA"]).optional(),
      motivoFalha: z.string().trim().min(1).max(2000).optional(),
    })
    .strict()
    .superRefine((v, ctx) => {
      const irrigation = ["IRRIGACAO_INICIADA", "IRRIGACAO_FINALIZADA"].includes(v.tipo);
      const end = v.tipo === "IRRIGACAO_FINALIZADA";
      const invalid = (!irrigation && (v.irrigacaoId || v.configuracaoId)) ||
        (!end && (v.resultado || v.motivoFalha)) ||
        ((v.resultado || v.motivoFalha || v.configuracaoId) && !v.irrigacaoId) ||
        (v.motivoFalha && v.resultado !== "FALHA");
      if (invalid) ctx.addIssue({ code: "custom", message: "Campos de execução incompatíveis com o evento." });
    }),
  ack: z
    .object({
      ...base,
      zonaId: uuid,
      configuracaoId: uuid,
      aplicada: z.boolean(),
    })
    .strict(),
  params: z.object({ id: uuid, zonaId: uuid.optional() }),
  vinculoZona: z.object({ dispositivoId: uuid, zonaId: uuid }).strict(),
  pagination: z
    .object({
      pagina: z.coerce.number().int().min(1).max(100000).default(1),
      limite: z.coerce.number().int().min(1).max(100).default(20),
    })
    .strict(),
};
