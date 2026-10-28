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
    console.log("Mensagem recebida:", mensagem.toString());
    let dados;

    try{
        dados = JSON.parse(mensagem.toString());
    }catch {
        console.log("Mensagem invalida!");
        return;
    }

    const umidadeAr = dados?.umidadeArPercentual;
    const tempC = dados?.temperaturaC;
    const distancia = dados?.distanciaCm;

    
    leitura.push({
        umidadeAr,
        tempC,  
        distancia
    });

    if (leitura.length > 100) {
        leitura.shift();
    }
    const somaTemp = leitura.reduce((total, item) => total + item.tempC, 0);
    const mediaTemp = somaTemp / leitura.length;

    const somaUmidade = leitura.reduce((total, item) => total + item.umidadeAr, 0);
    const mediaUmidade = somaUmidade / leitura.length;

    const somaDist = leitura.reduce((total, item) => total + item.distancia, 0);
    const mediaDist = somaDist / leitura.length

    console.log("\nTópico:", topicoRecebido);
    console.log("Umidade recebida:", umidadeAr + "%");
    console.log("Temperatura: ", tempC + "C");
    console.log("Distacia: ", distancia + "cm")
    console.log("Leituras na amostra:", leitura.length);
    console.log("Média da umidade:", mediaUmidade.toFixed(2) + "%");
    console.log("Média da temperatura:", mediaTemp.toFixed(2) + "C");
    console.log("Média da distancia:", mediaDist.toFixed(2) + "cm");


});

client.on("error", () => {
    console.log("Erro na conexão");
})
process.once("SIGINT", () => {
    client.end();
})