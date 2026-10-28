// Simula o protocolo do ESP32; nunca aciona saídas físicas.
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const mqtt = require("mqtt");
const { z } = require("zod");
const { config: configSchema } = require("../src/validators/mqttValidators");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
  quiet: true,
});
const deviceId = process.env.MQTT_SIM_DEVICE_ID;
const zoneId = process.env.MQTT_SIM_ZONE_ID;
if (![deviceId, zoneId].every((v) => z.string().uuid().safeParse(v).success)) {
  console.error(
    "Defina MQTT_SIM_DEVICE_ID e MQTT_SIM_ZONE_ID com os UUIDs cadastrados pela API.",
  );
  process.exit(1);
}
const prefix = process.env.MQTT_PREFIX || "senai/mateu-horta-7c91";
const base = `${prefix}/${deviceId}`;
const envelope = () => ({
  versao: 1,
  mensagemId: randomUUID(),
  dispositivoId: deviceId,
  medidoEm: new Date().toISOString(),
  simulado: true,
});
const client = mqtt.connect(
  process.env.MQTT_URL || "mqtt://test.mosquitto.org:1883",
  {
    username: process.env.MQTT_SIM_USERNAME || undefined,
    password: process.env.MQTT_SIM_PASSWORD || undefined,
    clientId: `sim-${randomUUID()}`,
    reconnectPeriod: 5000,
    will: {
      topic: `${base}/status`,
      payload: JSON.stringify({ ...envelope(), estado: "OFFLINE" }),
      qos: 1,
      retain: true,
    },
  },
);
let intervalMs = 5000;
let timer;
let tick = 0;
const send = (suffix, data, retain = false) =>
  client.publish(`${base}/${suffix}`, JSON.stringify(data), { qos: 1, retain });
function readings() {
  if (!client.connected) return;
  // Distâncias e umidades fictícias para testar a cadeia de dados.
  send("sensores", {
    ...envelope(),
    zonaId: zoneId,
    umidadeSoloPercentual: [45, 43, 41, 39, 37][tick % 5],
    distanciaAguaCm: [15, 17, 20, 25, 29][tick % 5],
  });
  tick++;
  console.log(`Leitura simulada ${tick} publicada.`);
}
function schedule() {
  clearInterval(timer);
  timer = setInterval(readings, intervalMs);
}
client.on("connect", () => {
  client.subscribe(`${base}/config`, { qos: 1 }, (error, grants) => {
    if (error || grants?.[0]?.qos === 128)
      return console.error("Assinatura de configurações recusada.");
    send("status", { ...envelope(), estado: "ONLINE" }, true);
    readings();
    schedule();
    console.log("Simulador conectado. Automação física desabilitada.");
  });
});
client.on("message", (topic, payload, packet) => {
  if (packet.retain || payload.length > 16384) return;
  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    return;
  }
  const schema = z
    .object({
      versao: z.literal(1),
      configuracaoId: z.string().uuid(),
      dispositivoId: z.literal(deviceId),
      zonaId: z.literal(zoneId),
      ...configSchema.shape,
    })
    .strict();
  const parsed = schema.safeParse(data);
  if (!parsed.success) return;
  intervalMs = data.intervaloLeituraSegundos * 1000;
  schedule();
  send("config/ack", {
    ...envelope(),
    zonaId: zoneId,
    configuracaoId: data.configuracaoId,
    aplicada: true,
  });
  console.log("Configuração simulada aplicada:", data.configuracaoId);
});
client.on("error", () => console.error("Simulador: falha de conexão MQTT."));
process.once("SIGINT", () => {
  clearInterval(timer);
  if (!client.connected) return client.end(true);
  send("status", { ...envelope(), estado: "OFFLINE" }, true);
  client.end(false);
});
