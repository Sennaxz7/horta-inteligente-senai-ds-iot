const { randomUUID } = require("node:crypto");
const s = require("../../src/validators/irrigacaoValidators");
const mqtt = require("../../src/validators/mqttValidators");

test("perfil rejeita propriedade, publicação global, valores incoerentes e parâmetros PID", () => {
  const valid = { nome: "Ensaio", especieId: randomUUID(), fase: "MUDA", umidadeMinima: 30, umidadeAlvo: 50, duracaoMaximaSegundos: 5, intervaloMinimoSegundos: 60, fonte: "Ensaio fictício de teste" };
  expect(s.create.safeParse(valid).success).toBe(true);
  for (const extra of [{ usuarioId: randomUUID() }, { tipo: "REFERENCIA" }, { statusValidacao: "VALIDADO" }, { Kp: 1 }, { umidadeMinima: 50 }, { umidadeAlvo: 101 }, { duracaoMaximaSegundos: 0 }, { fonte: " " }]) {
    expect(s.create.safeParse({ ...valid, ...extra }).success).toBe(false);
  }
  expect(s.patch.safeParse({}).success).toBe(false);
});

test("filtros de irrigação preservam false e validam intervalo e paginação", () => {
  expect(s.history.parse({ simulado: "false" }).simulado).toBe(false);
  expect(s.list.parse({}).arquivados).toBe(false);
  for (const query of [{ pagina: 0 }, { limite: 101 }, { simulado: "yes" }, { de: "2026-11-02T00:00:00Z", ate: "2026-11-01T00:00:00Z" }]) expect(s.history.safeParse(query).success).toBe(false);
});

test("eventos correlacionados validam resultado e preservam compatibilidade com eventos antigos", () => {
  const base = { versao: 1, mensagemId: randomUUID(), dispositivoId: randomUUID(), zonaId: randomUUID(), medidoEm: new Date().toISOString(), simulado: true, tipo: "IRRIGACAO_FINALIZADA" };
  expect(mqtt.eventos.safeParse(base).success).toBe(true);
  expect(mqtt.eventos.safeParse({ ...base, irrigacaoId: randomUUID(), resultado: "FALHA", motivoFalha: "Reservatório vazio" }).success).toBe(true);
  for (const extra of [{ resultado: "FALHA" }, { irrigacaoId: randomUUID(), motivoFalha: "Falhou" }, { irrigacaoId: randomUUID(), tipo: "FALHA_SENSOR" }, { irrigacaoId: randomUUID(), tipo: "IRRIGACAO_INICIADA", resultado: "CONCLUIDA" }]) expect(mqtt.eventos.safeParse({ ...base, ...extra }).success).toBe(false);
});
