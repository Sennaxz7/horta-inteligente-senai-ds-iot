# MQTT da Horta Inteligente

O backend agora assina MQTT, valida e persiste leituras, status, eventos e confirmações no PostgreSQL. O simulador representa uma placa ESP32. Não há controle elétrico de bomba nem firmware dependente de modelo de sensor nesta entrega. Configurações aceitam apenas `automacaoHabilitada: false`; perfis agronômicos validados e firmware com proteções locais são necessários antes de permitir automação.

## Início rápido no Windows

Na pasta `backend`, com PostgreSQL e `.env` já configurados:

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run mqtt:setup
```

Acrescente ou ajuste no `backend/.env`:

```dotenv
MQTT_ENABLED=true
MQTT_TEST_MODE=true
MQTT_URL=mqtt://test.mosquitto.org:1883
MQTT_PREFIX=senai/mateu-horta-7c91
```

Inicie a API (`npm.cmd start`) e aguarde `MQTT: assinaturas ativas.`. Em outro PowerShell, na pasta backend:

```powershell
.\scripts\mqtt-demo.ps1
```

O roteiro pede login de um usuário já cadastrado, cria dispositivo/zona e mostra os comandos para iniciar o simulador em um terceiro terminal. Depois publica uma configuração, espera o ACK e mostra as últimas leituras. As referências 30/5 cm são fictícias, não parâmetros físicos aprovados. Não é necessário manter o broker local aberto ao usar o servidor público.

Cada dispositivo tem UUID criado pela API. O antigo nome `esp32-teste` e os JSONs reduzidos dos primeiros exercícios não atendem ao contrato completo abaixo. O simulador já envia todos os campos.

### Alternativa quando o broker público não responder

O código não depende do servidor público. Abra um terminal para o Mosquitto local:

```powershell
& "C:\Program Files\mosquitto\mosquitto.exe" -p 1884 -v
```

No terminal da API, antes de `npm.cmd start`, e no terminal do simulador, antes de `npm.cmd run mqtt:simulate`, execute:

```powershell
$env:MQTT_URL="mqtt://127.0.0.1:1884"
```

Use o mesmo prefixo nos dois processos. A variável do terminal tem prioridade sobre `.env`. Para voltar ao broker do arquivo `.env`, abra um novo terminal ou execute `Remove-Item Env:MQTT_URL`. A demonstração via API e a persistência no banco funcionam da mesma maneira.

## Contrato de comunicação — versão 1

Prefixo configurável, sem barra final. Padrão de teste: `senai/mateu-horta-7c91`; privado: pode ser `horta`.

| Sufixo do tópico `{prefixo}/{dispositivoId}/…` | Direção | Retain |
| --- | --- | --- |
| `sensores` | placa → backend | false |
| `status` | placa → backend | true |
| `eventos` | placa → backend | false |
| `config` | backend → placa | false |
| `config/ack` | placa → backend | false |

Publicar com QoS 1. O processamento de entrada aguarda a transação do banco antes do ACK MQTT. O banco impede duplicação por dispositivo + `mensagemId`; todo reenvio de uma mensagem precisa preservar esse identificador. Identificadores não devem ser reutilizados entre tipos de mensagem. QoS 1 permite duplicação, não garante entrega exatamente uma vez. A sessão é limpa: mensagens publicadas enquanto o backend estiver desconectado podem se perder; firmware deve manter fila local e reenviar ao voltar, conservando os IDs. Não há promessa de recuperação de dados não publicados/persistidos.

Envelope comum de entrada:

```json
{
  "versao": 1,
  "mensagemId": "UUID-gerado-para-cada-mensagem",
  "dispositivoId": "UUID-cadastrado-na-API",
  "medidoEm": "2026-10-28T15:00:00Z",
  "simulado": true
}
```

Os textos UUID acima são marcadores; envie UUIDs reais. Data ISO com fuso obrigatório, tolerância de 30 s no futuro. Dispositivo deve existir, estar ativo, coincidir com o tópico e com o campo `simulado` cadastrado. Campos extras são rejeitados. Limite de entrada: 16 KiB. Mensagens inválidas são descartadas sem derrubar a API. Erros de persistência são tratados como falha, não como leitura salva.

Campos específicos adicionados ao envelope:

* `sensores`: `zonaId` UUID, `umidadeSoloPercentual` número 0–100 ou null, `distanciaAguaCm` número positivo até 10000 ou null. Zona deve pertencer ao dispositivo. Null representa ausência de leitura; não use zero para falha de sensor.
* `status`: `estado` ONLINE ou OFFLINE; sem zona. Use Last Will OFFLINE. Timestamp do Last Will pode representar a criação da conexão, não o momento exato da queda; `recebidoEm` é o instante de observação pelo backend. Último status não garante conectividade atual: compare também idade da última leitura.
* `eventos`: `zonaId`, `tipo` IRRIGACAO_INICIADA, IRRIGACAO_FINALIZADA, FALHA_SENSOR ou RESERVATORIO_BAIXO; `duracaoSegundos` opcional, 0–86400. São registros informativos e não acionam equipamento.
* `config/ack`: `zonaId`, `configuracaoId` UUID e `aplicada` booleano. ACK de outro dispositivo/zona não é aceito.

### Reservatório

Cadastre `calibracao: {distanciaVazioCm, distanciaCheioCm}` na zona, com vazio > cheio > 0. O nível calculado é `(vazio - distância)/(vazio - cheio) × 100`. Sem calibração, com null ou distância fora do intervalo, `nivelAguaPercentual` é null e `nivelAguaValido` false. O percentual é da altura calibrada, não necessariamente do volume em litros. Não há limite automático de irrigação derivado desses exemplos.

### Configuração

POST de sincronização recebe:

```json
{
  "intervaloLeituraSegundos": 5,
  "automacaoHabilitada": false,
  "calibracaoReservatorio": {"distanciaVazioCm": 30, "distanciaCheioCm": 5}
}
```

A calibração deve coincidir com a da zona (ou ambas null). O backend acrescenta `versao`, `configuracaoId`, `dispositivoId` e `zonaId`. Estados: PENDENTE → ENVIADA → CONFIRMADA, ou ERRO. Confirmação de publicação pelo broker não equivale a confirmação da placa. Sem ACK, permanece ENVIADA; após reconexão/reinício da placa, consulte e sincronize novamente. Não há reenvio automático de configurações antigas nem comando de bomba retido. Ao aplicar, a placa deve validar o JSON, persistir a configuração válida e responder com o ID exato. Simulador aplica somente o intervalo, sem saídas físicas.

## API — JWT Bearer obrigatório

Todos os recursos são filtrados pelo proprietário autenticado; IDs de terceiros retornam 404. Paginação usa `pagina` e `limite` (até 100).

| Método e caminho após `/api/v1` | Função |
| --- | --- |
| POST `/dispositivos` | `{nome, simulado}`; retorna UUID |
| GET `/dispositivos` | lista paginada e estado da conexão MQTT do backend |
| GET `/dispositivos/:id` | dispositivo e último status observado |
| PATCH `/dispositivos/:id` | altera nome; modo simulado é imutável |
| DELETE `/dispositivos/:id` | arquiva, preservando histórico |
| POST `/dispositivos/:id/zonas` | `{nome, plantaId?, calibracao?}` |
| GET `/dispositivos/:id/zonas` | zonas paginadas |
| PUT `/dispositivos/:id/zonas/:zonaId` | substitui nome, vínculo e calibração; null desvincula |
| GET `/dispositivos/:id/leituras` | histórico paginado, incluindo nível calculado |
| GET `/plantas/:id/leituras` | histórico da planta, preservado após mudança de zona |
| GET `/dispositivos/:id/eventos` | eventos paginados |
| GET `/dispositivos/:id/status` | histórico de estados paginado |
| GET `/dispositivos/:id/zonas/:zonaId/configuracao` | última configuração e estado do ACK |
| POST `/dispositivos/:id/zonas/:zonaId/sincronizacao` | publica nova versão; retorna 202 |

Vínculo com planta é opcional; quando informado, deve pertencer ao mesmo usuário, estar ativa e não ter outra zona. Cada leitura conserva a planta vinculada no instante de recebimento, mesmo após mudar a zona. Os históricos MQTT não substituem os futuros perfis de irrigação e dashboard.

## Broker privado e hardware

O broker público permite que qualquer pessoa publique no tópico; UUID/prefixo não autenticam a origem. Use somente simulações nesse broker. O backend bloqueia modo real (`MQTT_TEST_MODE=false`) sem URL mqtts, usuário e senha, e recusa `test.mosquitto.org` nesse modo. TLS verifica certificados normalmente; não há opção para desativar a verificação.

Modelos em `backend/mqtt/` mostram listener TLS e ACL. O administrador precisa fornecer certificados válidos, criar `passwords` com `mosquitto_passwd`, ajustar os caminhos e aplicar a ACL no broker. Use usuário `horta-backend` no backend e o UUID do dispositivo como username da placa; cada placa ganha senha exclusiva. A ACL permite que a placa publique apenas seus tópicos e leia apenas sua configuração. Configure `MQTT_PREFIX=horta` em ambos. Não versionar senhas/chaves. O backend não cria contas no broker automaticamente.

O simulador usa `MQTT_SIM_USERNAME` / `MQTT_SIM_PASSWORD`, separados das credenciais do backend. Requer `MQTT_SIM_DEVICE_ID` e `MQTT_SIM_ZONE_ID`. Interrompa com Ctrl+C para publicar OFFLINE.

Firmware real deve implementar esse contrato, calibração de solo e reservatório, fila de reenvio, reconexão, Last Will, validação e confirmação de configurações, bomba desligada no boot e proteções locais. O modelo/pinos/tensão dos sensores ainda não foram definidos, portanto não há firmware físico validado nesta entrega.

Referências: [MQTT.js](https://github.com/mqttjs/MQTT.js), [Mosquitto configuração/ACL/TLS](https://mosquitto.org/man/mosquitto-conf-5.html), [broker público](https://test.mosquitto.org/).

## Verificação

`npm.cmd test`: validação e autenticação. `npm.cmd run test:postgres`: cluster PostgreSQL temporário isolado, migrations/rollback, persistência, deduplicação concorrente, isolamento de usuários e troca MQTT TCP real com Mosquitto local, quando instalado. O teste de rede local não exige acesso ao broker público nem altera o banco de desenvolvimento.
