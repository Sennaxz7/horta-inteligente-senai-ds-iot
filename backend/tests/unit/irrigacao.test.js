const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const s = require("../../src/validators/irrigacaoValidators");
const mqtt = require("../../src/validators/mqttValidators");

test("perfil rejeita propriedade, publicação global, valores incoerentes e parâmetros PID", () => {
  const valid = { nome: "Ensaio", especieId: randomUUID(), fase: "MUDA", umidadeMinima: 30, umidadeAlvo: 50, duracaoMaximaSegundos: 5, intervaloMinimoSegundos: 60, fonte: "Ensaio fictício de teste" };
  assert.equal(s.create.safeParse(valid).success, true);
  for (const extra of [{ usuarioId: randomUUID() }, { tipo: "REFERENCIA" }, { statusValidacao: "VALIDADO" }, { Kp: 1 }, { umidadeMinima: 50 }, { umidadeAlvo: 101 }, { duracaoMaximaSegundos: 0 }, { fonte: " " }]) {
    assert.equal(s.create.safeParse({ ...valid, ...extra }).success, false);
  }
  assert.equal(s.patch.safeParse({}).success, false);
});

test("filtros de irrigação preservam false e validam intervalo e paginação", () => {
  assert.equal(s.history.parse({ simulado: "false" }).simulado, false);
  assert.equal(s.list.parse({}).arquivados, false);
  for (const query of [{ pagina: 0 }, { limite: 101 }, { simulado: "yes" }, { de: "2026-11-02T00:00:00Z", ate: "2026-11-01T00:00:00Z" }]) assert.equal(s.history.safeParse(query).success, false);
});

test("eventos correlacionados validam resultado e preservam compatibilidade com eventos antigos", () => {
  const base = { versao: 1, mensagemId: randomUUID(), dispositivoId: randomUUID(), zonaId: randomUUID(), medidoEm: new Date().toISOString(), simulado: true, tipo: "IRRIGACAO_FINALIZADA" };
  assert.equal(mqtt.eventos.safeParse(base).success, true);
  assert.equal(mqtt.eventos.safeParse({ ...base, irrigacaoId: randomUUID(), resultado: "FALHA", motivoFalha: "Reservatório vazio" }).success, true);
  for (const extra of [{ resultado: "FALHA" }, { irrigacaoId: randomUUID(), motivoFalha: "Falhou" }, { irrigacaoId: randomUUID(), tipo: "FALHA_SENSOR" }, { irrigacaoId: randomUUID(), tipo: "IRRIGACAO_INICIADA", resultado: "CONCLUIDA" }]) assert.equal(mqtt.eventos.safeParse({ ...base, ...extra }).success, false);
});
