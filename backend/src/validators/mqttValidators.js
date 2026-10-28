const { z } = require("zod");
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
      nome: z.string().trim().min(1).max(120),
      plantaId: uuid.nullable().default(null),
      calibracao: calibracao.nullable().default(null),
    })
    .strict(),
  config,
  sensores: z
    .object({
      ...base,
      zonaId: uuid,
      umidadeSoloPercentual: percent.nullable(),
      distanciaAguaCm: z.number().positive().max(10000).nullable(),
    })
    .strict(),
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
    })
    .strict(),
  ack: z
    .object({
      ...base,
      zonaId: uuid,
      configuracaoId: uuid,
      aplicada: z.boolean(),
    })
    .strict(),
  params: z.object({ id: uuid, zonaId: uuid.optional() }),
  pagination: z
    .object({
      pagina: z.coerce.number().int().min(1).max(100000).default(1),
      limite: z.coerce.number().int().min(1).max(100).default(20),
    })
    .strict(),
};
