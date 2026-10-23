const mqtt = require("mqtt");

const client = mqtt.connect("mqtt://test.mosquitto.org:1883");
const topico = "senai/horta-inteligente/esp32-test/sensores";

const leitura = [];

client.on("connect", () => {
    console.log("Conectado ao broker!");

    client.subscribe(topico, (erro) => {
        if(erro) {
            console.log("Não foi possivel assinar o topico!");
            return;
        }

        console.log("Aguardando....");
    });
});

client.on("message", (topicoRecebido, mensagem) => {
    let dados;

    try{
        dados = JSON.parse(mensagem.toString());
    }catch {
        console.log("Mensagem invalida!");
        return;
    }

    const umidade = dados?.umidadeSoloPercentual;

    if(
        dados?.simulado !== true ||
        typeof umidade !== "number" ||
        !Number.isFinite(umidade) ||
        umidade < 0 ||
        umidade > 100
    ) {
        console.log("Mensagem ignorada: leitura simulada inválida.");
        return;
    }
    leitura.push(umidade);

    if (leitura.length > 100) {
        leitura.shift();
    }

    const soma = leitura.reduce((total, valor) => total + valor, 0);
    const media = soma / leitura.length;

    console.log("\nTópico:", topicoRecebido);
    console.log("Umidade recebida:", umidade + "%");
    console.log("Leituras na amostra:", leitura.length);
    console.log("Média da amostra:", media.toFixed(2) + "%");

});

client.on("error", () => {
    console.log("Erro na conexão");
})
process.once("SIGINT", () => {
    client.end();
})