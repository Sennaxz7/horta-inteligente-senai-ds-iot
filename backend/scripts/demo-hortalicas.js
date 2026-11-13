const { fork } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const path = require("node:path");

const demonstration = [
  { nome: "Alface da bandeja", nomeComum: "Alface", nomeCientifico: "Lactuca sativa", faseAtual: "SEMENTE" },
  { nome: "Alface do vaso", nomeComum: "Alface", nomeCientifico: "Lactuca sativa", faseAtual: "VEGETATIVA", simular: true },
  { nome: "Rúcula do vaso", nomeComum: "Rúcula", nomeCientifico: "Eruca vesicaria", faseAtual: "VEGETATIVA" },
  { nome: "Couve do vaso", nomeComum: "Couve", nomeCientifico: "Brassica oleracea", faseAtual: "ADULTA", simular: true },
  { nome: "Repolho do vaso", nomeComum: "Repolho", nomeCientifico: "Brassica oleracea", faseAtual: "VEGETATIVA", simular: true },
];
const calibracao = { distanciaVazioCm: 30, distanciaCheioCm: 5 };
const api = (process.env.HORTA_DEMO_API_URL || "http://127.0.0.1:3000/api/v1").replace(/\/$/, "");

async function request(route, { method = "GET", body, token } = {}) {
  const response = await fetch(api + route, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(12000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${method} ${route}: ${result.error?.message || response.status}`);
  return result;
}

async function findByName(get, route, name, match = () => true) {
  for (let page = 1; ; page++) {
    const { data, meta } = await get(`${route}${route.includes("?") ? "&" : "?"}limite=100&pagina=${page}`);
    const item = data.find(candidate => candidate.nome === name && match(candidate));
    if (item || page >= meta.totalPaginas) return item;
  }
}

async function preparePlants(get, post) {
  const species = new Map();
  const simulations = [];
  for (const item of demonstration) {
    const { nome, nomeCientifico, nomeComum, faseAtual, simular } = item;
    if (!species.has(nomeCientifico)) {
      const { data } = await get("/especies?limite=100&busca=" + encodeURIComponent(nomeCientifico));
      const match = data.find(candidate => candidate.nomeCientifico.toLowerCase() === nomeCientifico.toLowerCase());
      const found = match || (await post("/especies", { nomeCientifico, nomeComum })).data.especie;
      species.set(nomeCientifico, found.id);
    }
    const especieId = species.get(nomeCientifico);
    const existing = await findByName(get, "/plantas?busca=" + encodeURIComponent(nome), nome,
      candidate => candidate.especieId === especieId && candidate.grupoIrrigacao === "HORTALICAS");
    const plant = existing || (await post("/plantas", { nome, faseAtual, especieId, grupoIrrigacao: "HORTALICAS" })).data.planta;
    if (simular) simulations.push(plant);
  }
  return simulations;
}

async function prepareSimulator(get, post, plant) {
  const name = "Simulador · " + plant.nome;
  const device = await findByName(get, "/dispositivos", name, item => item.simulado)
    || (await post("/dispositivos", { nome: name, simulado: true })).data;
  const zonesPath = `/dispositivos/${device.id}/zonas`;
  const zone = await findByName(get, zonesPath, plant.nome, item => item.plantaId === plant.id)
    || (await post(zonesPath, { nome: plant.nome, plantaId: plant.id, calibracao })).data;
  return { device, zone };
}

async function waitForConfiguration(get, path, id) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const { data } = await get(path + "/configuracao");
    if (data?.id === id && data.status === "CONFIRMADA") return;
    if (data?.id === id && data.status === "ERRO") break;
    await delay(1000);
  }
  throw new Error("O simulador não confirmou a configuração. Confira se a API e o simulador usam o mesmo broker e prefixo.");
}

async function main() {
  const credentials = JSON.parse(Buffer.from(readFileSync(0, "utf8").trim(), "base64").toString("utf8"));
  const { data: { accessToken: token } } = await request("/auth/login", { method: "POST", body: credentials });
  const get = route => request(route, { token });
  const post = (route, body) => request(route, { method: "POST", body, token });
  const { mqtt } = await get("/dispositivos?limite=1");
  if (!mqtt.conectado) throw new Error("MQTT da API desconectado. Confira a URL do broker e inicie a API antes da demonstração.");
  const { data: profiles } = await get("/perfis-irrigacao?tipo=REFERENCIA&grupoIrrigacao=HORTALICAS&limite=5");
  if (profiles.length !== 5) throw new Error("Catálogo de Hortaliças incompleto. Execute npm.cmd run db:migrate.");

  const children = [];
  let stopping = false;
  const stop = () => {
    stopping = true;
    for (const child of children) if (child.connected) child.send("encerrar", () => {});
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  if (process.send) {
    process.once("disconnect", stop);
    process.on("message", message => { if (message === "encerrar") stop(); });
  }
  try {
    const plants = await preparePlants(get, post);
    for (const plant of plants) {
      if (stopping) break;
      const { device, zone } = await prepareSimulator(get, post, plant);
      const child = fork(path.join(__dirname, "simulate-mqtt.js"), {
        env: {
          ...process.env, MQTT_SIM_DEVICE_ID: device.id, MQTT_SIM_ZONE_ID: zone.id,
          MQTT_SIM_IRRIGACOES: "true",
        },
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      });
      children.push(child);
      const ready = new AbortController();
      let message;
      try {
        message = await Promise.race([
          once(child, "message", { signal: AbortSignal.any([ready.signal, AbortSignal.timeout(15000)]) }),
          once(child, "exit", { signal: ready.signal }).then(() => []),
        ]);
      } finally {
        ready.abort();
      }
      if (stopping) break;
      if (message[0] !== "mqtt-pronto") throw new Error(`Simulador encerrou antes de conectar: ${plant.nome}.`);
      const zonePath = `/dispositivos/${device.id}/zonas/${zone.id}`;
      const { data: config } = await post(zonePath + "/sincronizacao", {
        modo: "SIMULACAO_IRRIGACAO", automacaoHabilitada: false, intervaloLeituraSegundos: 5,
        calibracaoReservatorio: zone.calibracao,
      });
      if (!config.dados.irrigacao) throw new Error(`A configuração ficou em monitoramento: ${config.dados.motivoMonitoramento}.`);
      await waitForConfiguration(get, zonePath, config.id);
      console.info(`${plant.nome}: ${config.dados.irrigacao.perfilNome} confirmado.`);
    }
    if (!stopping) {
      console.info("Abra o Dashboard ou o Histórico da alface do vaso, da couve ou do repolho. Pressione Ctrl+C para encerrar.");
      await Promise.race(children.map(child => child.exitCode === null ? once(child, "exit") : Promise.resolve()));
      if (!stopping) throw new Error("Um dos simuladores encerrou durante a demonstração.");
    }
  } finally {
    stop();
    const unfinished = children.filter(child => child.pid && child.exitCode === null && child.signalCode === null);
    const timeout = setTimeout(() => unfinished.forEach(child => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }), 5000);
    try {
      await Promise.allSettled(unfinished.map(child => once(child, "exit")));
    } finally {
      clearTimeout(timeout);
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      if (process.connected) process.disconnect();
    }
  }
}

main().catch(error => {
  console.error("Demonstração:", error.message);
  process.exitCode = 1;
});
