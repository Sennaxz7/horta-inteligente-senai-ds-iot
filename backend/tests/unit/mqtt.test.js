const { test } = require("node:test");
const assert = require("node:assert/strict");
const s = require("../../src/validators/mqttValidators");
const { testEnvironment } = require("../helpers/fixture");
const MqttService = require("../../src/services/MqttService");
test("MQTT real exige TLS, credenciais e broker privado", () => {
  for (const overrides of [{}, { MQTT_URL: "mqtts://test.mosquitto.org:8883", MQTT_USERNAME: "x", MQTT_PASSWORD: "x" }]) assert.throws(() => testEnvironment({ MQTT_ENABLED: "true", MQTT_TEST_MODE: "false", ...overrides }));
  assert.equal(testEnvironment({ MQTT_ENABLED: "true", MQTT_TEST_MODE: "false", MQTT_URL: "mqtts://broker.example:8883", MQTT_USERNAME: "x", MQTT_PASSWORD: "x" }).MQTT_ENABLED, true);
  assert.throws(() => testEnvironment({ MQTT_PREFIX: "horta/#" }));
});
test("configuração rejeita automação e calibração invertida", () => {
  const config = { intervaloLeituraSegundos: 5, automacaoHabilitada: false, calibracaoReservatorio: null };
  assert.equal(s.config.safeParse(config).success, true);
  assert.equal(s.config.safeParse({ ...config, automacaoHabilitada: true }).success, false);
  assert.equal(s.config.safeParse({ ...config, calibracaoReservatorio: { distanciaVazioCm: 5, distanciaCheioCm: 30 } }).success, false);
});
test("JSON inválido, payload grande e tópicos estranhos não acessam banco", async () => {
  const service = new MqttService({ env: testEnvironment(), database: { transaction() { throw new Error("Não deveria acessar banco"); } } });
  for (const [topic, payload] of [["outro/id/sensores", "{}"], [`${service.env.MQTT_PREFIX}/id/sensores`, "{"], [`${service.env.MQTT_PREFIX}/id/sensores`, "x".repeat(16385)]]) assert.equal(await service.ingest(topic, Buffer.from(payload)), false);
});
