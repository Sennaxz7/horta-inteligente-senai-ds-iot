// Simula o protocolo do ESP32; nunca aciona saídas físicas.
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const mqtt = require("mqtt");
const { z } = require("zod");
const { configMessage } = require("../src/validators/mqttValidators");
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
let irrigation;
let irrigationTimer;
let appliedConfig;
let lastIrrigationEndedAt;
let nextProfileReading = "ACIMA_MINIMA";
let stopping = false;
const send = (suffix, data, retain = false) =>
  client.publish(`${base}/${suffix}`, JSON.stringify(data), { qos: 1, retain });
function finishIrrigation(result) {
  const { execution, duration } = irrigation;
  send("eventos", {
    ...envelope(), ...execution, tipo: "IRRIGACAO_FINALIZADA", resultado: result,
    ...(result === "CONCLUIDA" ? { duracaoSegundos: duration } : { motivoFalha: "Simulação interrompida." }),
  });
  irrigation = null;
  lastIrrigationEndedAt = Date.now();
  if (result === "CONCLUIDA" && execution.configuracaoId && appliedConfig?.configuracaoId === execution.configuracaoId) {
    nextProfileReading = "ALVO";
  }
}

function readings() {
  if (!client.connected) return;
  const profile = appliedConfig?.irrigacao;
  let umidadeSoloPercentual = [45, 43, 41, 39, 37][tick % 5];
  if (profile) {
    const { umidadeMinima, umidadeAlvo, escalaUmidade } = profile;
    if (nextProfileReading === "ACIMA_MINIMA") {
      umidadeSoloPercentual = escalaUmidade === "VOLUMETRICA"
        ? Math.ceil(umidadeAlvo)
        : Number(((umidadeMinima + umidadeAlvo) / 2).toFixed(2));
    } else if (nextProfileReading === "ALVO") {
      umidadeSoloPercentual = umidadeAlvo;
    } else {
      umidadeSoloPercentual = Math.max(0, Math.ceil(umidadeMinima) - 1);
    }
    nextProfileReading = "ABAIXO_MINIMA";
  }
  send("sensores", {
    ...envelope(),
    zonaId: zoneId,
    umidadeSoloPercentual,
    distanciaAguaCm: [15, 17, 20, 25, 29][tick % 5],
    ...(profile ? { configuracaoId: appliedConfig.configuracaoId } : {}),
  });
  tick++;
  // Demonstração opcional: publica eventos, sem controlar bomba ou inferir consumo.
  const shouldSimulate = profile
    ? umidadeSoloPercentual < profile.umidadeMinima &&
      (lastIrrigationEndedAt === undefined ||
       Date.now() - lastIrrigationEndedAt >= profile.intervaloMinimoSegundos * 1000)
    : !appliedConfig?.modo && tick % 6 === 0;
  if (process.env.MQTT_SIM_IRRIGACOES === "true" && !irrigation && shouldSimulate) {
    const execution = { zonaId: zoneId, irrigacaoId: randomUUID(),
      ...(profile ? { configuracaoId: appliedConfig.configuracaoId } : {}) };
    const duration = profile ? Math.min(2, profile.duracaoMaximaSegundos) : 2;
    irrigation = { execution, duration };
    send("eventos", { ...envelope(), ...execution, tipo: "IRRIGACAO_INICIADA" });
    irrigationTimer = setTimeout(() => finishIrrigation("CONCLUIDA"), duration * 1000);
  }
  console.log(`Leitura simulada ${tick}: ${umidadeSoloPercentual}% de umidade.`);
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
    process.send?.("mqtt-pronto");
    console.log("Simulador conectado. Automação física desabilitada.");
  });
});
client.on("message", (topic, payload, packet) => {
  if (topic !== `${base}/config` || packet.retain || payload.length > 16384) return;
  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    return;
  }
  const parsed = configMessage.safeParse(data);
  if (!parsed.success || parsed.data.dispositivoId !== deviceId || parsed.data.zonaId !== zoneId) return;
  const repeated = appliedConfig?.configuracaoId === parsed.data.configuracaoId;
  appliedConfig = parsed.data;
  send("config/ack", {
    ...envelope(),
    zonaId: zoneId,
    configuracaoId: data.configuracaoId,
    aplicada: true,
  });
  if (repeated) return;
  nextProfileReading = "ACIMA_MINIMA";
  intervalMs = data.intervaloLeituraSegundos * 1000;
  if (appliedConfig.irrigacao) readings();
  schedule();
  console.log("Configuração simulada aplicada:", data.configuracaoId);
});
client.on("error", () => console.error("Simulador: falha de conexão MQTT."));
function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  clearTimeout(irrigationTimer);
  if (client.connected) {
    if (irrigation) finishIrrigation("FALHA");
    send("status", { ...envelope(), estado: "OFFLINE" }, true);
  }
  client.end(!client.connected, () => { if (process.connected) process.disconnect(); });
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
if (process.send) {
  process.once("disconnect", stop);
  process.on("message", message => { if (message === "encerrar") stop(); });
}
