# Perfis e histórico de irrigação

Esta etapa oferece perfis pessoais e um catálogo compartilhado de referência, associação explícita à planta e histórico de execuções reportadas por MQTT. Não implementa firmware, controle PI/PID, cálculo Ziegler–Nichols ou acionamento da bomba. `automacaoHabilitada` continua aceitando somente `false`.

## Preparação

Na pasta `backend`, execute `npm.cmd run db:migrate` e reinicie a API. A migration `20261103000100-create-irrigacao.js` acrescenta três tabelas sem converter ou excluir mensagens antigas: `perfis_irrigacao`, `plantas_perfis_irrigacao` e `registros_irrigacao`.

O catálogo de referência começa vazio. Não foram inseridos parâmetros agronômicos sem fonte. Os exemplos numéricos abaixo são fictícios para demonstrar o contrato; não são recomendações para cultivo ou hardware.

## Rotas HTTP

Prefixo `/api/v1`, JWT Bearer obrigatório. Entradas desconhecidas são rejeitadas. Identificadores são UUIDs.

| Método | Caminho | Sucesso | Resultado |
| --- | --- | --- | --- |
| POST | `/perfis-irrigacao` | 201 | `data.perfil`, sempre pessoal e rascunho |
| GET | `/perfis-irrigacao` | 200 | Listagem paginada dos próprios perfis e referências validadas |
| GET | `/perfis-irrigacao/:id` | 200 | `data.perfil` |
| PATCH | `/perfis-irrigacao/:id` | 200 | `data.perfil` atualizado |
| DELETE | `/perfis-irrigacao/:id` | 204 | Arquivamento idempotente do perfil pessoal |
| POST | `/perfis-irrigacao/:id/copia` | 201 | Cópia pessoal em rascunho; enviar `{}` |
| GET | `/plantas/:id/perfil-irrigacao` | 200 | Perfil, vínculo, snapshot e necessidade de revisão |
| PUT | `/plantas/:id/perfil-irrigacao` | 200 | Associa perfil ou remove vínculo |
| GET | `/plantas/:id/irrigacoes` | 200 | Histórico paginado de execuções |

As respostas paginadas seguem `{data: [], meta: {pagina, limite, total, totalPaginas}}`. Não há POST HTTP, edição ou exclusão de registros de irrigação.

## Criação e validação de perfis pessoais

Exemplo de corpo de cadastro (valores apenas de demonstração):

```json
{
  "nome": "Perfil de ensaio",
  "especieId": "UUID_REAL_DO_CATALOGO",
  "fase": "MUDA",
  "umidadeMinima": 30,
  "umidadeAlvo": 50,
  "duracaoMaximaSegundos": 5,
  "intervaloMinimoSegundos": 60,
  "fonte": "Referência e identificação do ensaio que fundamenta os valores",
  "observacao": "Condições de substrato, sensor e calibração do ensaio"
}
```

Campos obrigatórios: todos acima exceto `observacao`, que aceita null. Nome: 1–120 caracteres; fonte: 1–4000; observação: até 4000. Umidades finitas entre 0 e 100, com mínima menor que alvo. Duração: inteiro entre 1 e 86400 segundos; intervalo: inteiro entre 1 e 2147483647 segundos. Esses tetos são limites técnicos de entrada, não limites operacionais recomendados. Espécie e fase devem existir.

O proprietário vem do JWT. `usuarioId`, `tipo`, `versao`, `validadoEm`, status de validação no cadastro e ganhos PI/PID não são aceitos no POST. O resultado inicial tem `tipo: PESSOAL`, `statusValidacao: RASCUNHO` e `versao: 1`.

Depois de conferir fonte, parâmetros e calibração, o usuário pode registrar sua confirmação:

```http
PATCH /api/v1/perfis-irrigacao/UUID_DO_PERFIL
```

```json
{"statusValidacao":"VALIDADO"}
```

Isso registra a confirmação do usuário e sua data; não é certificação agronômica automática. A API verifica somente estrutura, limites e consistência. `RASCUNHO` remove a confirmação. Qualquer alteração efetiva dos dados editáveis incrementa `versao`, volta a rascunho e limpa `validadoEm`. É necessário salvar a alteração e validar em outra requisição; edição e validação simultâneas retornam 409. Alterações parciais são conferidas contra os demais valores existentes (ex.: mudar apenas a mínima não pode superar a alvo atual).

Referências são somente leitura pela API. Para personalizar, envie `{}` ao POST `/perfis-irrigacao/:id/copia`. A cópia mantém os parâmetros e a fonte, recebe outro UUID, pertence ao usuário e começa na versão 1 em rascunho. Editar a cópia não altera a referência. Perfis pessoais de terceiros retornam 404. Tentativa de editar/arquivar referência retorna 403.

## Publicação administrativa de referências

Não existe papel de administrador na autenticação atual. Portanto, a publicação global é feita exclusivamente por um comando local, com acesso administrativo ao ambiente do backend. Não foi criada uma rota que permita a um usuário comum publicar perfis para todos.

Prepare um JSON com o mesmo corpo de criação, dados reais e fonte revisada. Execute na pasta `backend`:

```powershell
npm.cmd run perfis:importar -- "C:\caminho\perfil-revisado.json" --validado
```

`--validado` é a confirmação explícita do operador de que revisou os dados. O comando utiliza a conexão configurada, valida campos e catálogos, cria um perfil `REFERENCIA` sem dono, com status `VALIDADO` e data de validação. Cada execução cria um perfil novo; não é um upsert e não deve ser repetido para o mesmo cadastro por engano. Não há parâmetros padrão nem importação automática. Revisão/arquivamento de referências existentes permanece uma operação administrativa no banco; a API comum só permite leitura e cópia.

## Busca por planta e associação

```http
GET /api/v1/perfis-irrigacao?plantaId=UUID_DA_PLANTA
```

Busca referências validadas e perfis pessoais que correspondam à espécie confirmada e à fase atual da planta. Rascunhos pessoais podem aparecer para edição, mas não podem ser associados. Planta sem espécie retorna 409 `PLANT_SPECIES_REQUIRED`. A seleção é manual; a PlantNet não define os parâmetros e a API não escolhe automaticamente um perfil.

Filtros: `pagina` (padrão 1), `limite` (padrão 20, máximo 100), `especieId`, `fase`, `plantaId`, `tipo=PESSOAL|REFERENCIA`, `statusValidacao=RASCUNHO|VALIDADO` e `arquivados=true|false` (padrão false). `true` lista somente arquivados. Combinar planta com espécie/fase diferentes retorna 422.

Associação:

```http
PUT /api/v1/plantas/UUID_DA_PLANTA/perfil-irrigacao
```

```json
{"perfilIrrigacaoId":"UUID_DO_PERFIL"}
```

Somente perfis ativos, validados, visíveis ao usuário e compatíveis com a espécie/fase podem ser associados. A planta deve estar ativa. O vínculo guarda versão e snapshot do perfil escolhido. Consultas retornam:

```json
{
  "data": {
    "perfil": {},
    "vinculo": {},
    "necessitaRevisao": true,
    "motivos": ["VERSAO_ALTERADA"]
  }
}
```

Os objetos vazios acima representam os dados completos do perfil e vínculo. Motivos possíveis: `PERFIL_ARQUIVADO`, `PERFIL_NAO_VALIDADO`, `VERSAO_ALTERADA`, `ESPECIE_ALTERADA`, `FASE_ALTERADA`. A revisão é calculada comparando o estado atual com a versão selecionada; se espécie/fase voltarem aos valores originais e não houver outra divergência, esses motivos deixam de aparecer. Nenhuma seleção é reenviada automaticamente ao MQTT. Reassociar explicitamente um perfil compatível e validado atualiza o snapshot. Enviar `{"perfilIrrigacaoId":null}` remove o vínculo. Sem vínculo, perfil e vínculo são null e a lista de motivos fica vazia. Plantas arquivadas permanecem consultáveis, mas não podem alterar associação.

## Eventos MQTT e registros de execução

Mantém-se o tópico `{prefixo}/{dispositivoId}/eventos` e o envelope versão 1. Novos emissores devem gerar `irrigacaoId` para cada execução e repeti-lo no início/fim; cada mensagem tem seu próprio `mensagemId`, preservado nos reenvios.

Início (substitua os marcadores por UUIDs e datas reais):

```json
{
  "versao": 1,
  "mensagemId": "UUID_DA_MENSAGEM_INICIAL",
  "dispositivoId": "UUID_DO_DISPOSITIVO",
  "zonaId": "UUID_DA_ZONA",
  "medidoEm": "2026-11-03T12:00:00Z",
  "simulado": true,
  "tipo": "IRRIGACAO_INICIADA",
  "irrigacaoId": "UUID_DA_EXECUCAO"
}
```

Término:

```json
{
  "versao": 1,
  "mensagemId": "UUID_DA_MENSAGEM_FINAL",
  "dispositivoId": "UUID_DO_DISPOSITIVO",
  "zonaId": "UUID_DA_ZONA",
  "medidoEm": "2026-11-03T12:00:05Z",
  "simulado": true,
  "tipo": "IRRIGACAO_FINALIZADA",
  "irrigacaoId": "UUID_DA_EXECUCAO",
  "resultado": "CONCLUIDA",
  "duracaoSegundos": 5
}
```

No término, `resultado` pode ser `CONCLUIDA` (padrão quando omitido) ou `FALHA`; `motivoFalha` é opcional, até 2000 caracteres, somente com `resultado: FALHA`. `duracaoSegundos` é a duração reportada, opcional, entre 0 e 86400. Sem duração, fica null: não é calculada a partir de horários nem implica volume aplicado. Resultado/motivo são aceitos somente na finalização e exigem `irrigacaoId`.

`configuracaoId` é opcional e exige `irrigacaoId`; quando informado precisa existir no mesmo dispositivo/zona. Guarda-se o ID e snapshot dos dados daquela configuração. Não se escolhe a última configuração por aproximação. Os dois eventos não podem informar configurações diferentes. Configuração aceita na API atual é de monitoramento; um ACK não comprova irrigação. O perfil selecionado na planta não é apresentado como perfil executado, pois ainda não foi enviado como configuração de irrigação ao dispositivo. Ganhos PI/PID e sua sintonia pertencem à montagem física e continuam fora desta entrega.

Regras de persistência:

- Chave de execução: dispositivo + `irrigacaoId`; há índice único no banco.
- Registro e mensagem original são gravados na mesma transação. Reenvios do mesmo `mensagemId` não duplicam dados.
- Novo início para execução que já tem início e novo término para execução encerrada são descartados, mesmo que usem outro ID de mensagem. Não sobrescrevem fatos já persistidos.
- Término recebido primeiro cria um registro finalizado com início null e `inicioAusente: true`. Se o início chegar depois com data coerente, completa o registro preservando o resultado final.
- Término anterior ao início, troca de zona para a mesma execução e configuração conflitante são descartados.
- Sem término, permanece `EM_ANDAMENTO`; não existe conclusão ou falha automática por timeout.
- Planta é a vinculada à zona no recebimento do primeiro evento aceito da execução. Esse vínculo nunca é transferido ao trocar a ocupante da zona. Não é possível reconstruir uma ocupação antiga a partir de um evento que só chegou depois da troca.
- Mensagens antigas sem `irrigacaoId` continuam salvas no histórico geral de eventos, sem conversão ou pareamento aproximado. Nenhum backfill é executado.
- Eventos relatam o dispositivo/simulador. Não comprovam fisicamente acionamento ou volume de água. Dispositivo arquivado não aceita novas mensagens, conforme o contrato MQTT existente; seus registros já persistidos permanecem consultáveis pela planta.

## Consulta do histórico

```http
GET /api/v1/plantas/UUID_DA_PLANTA/irrigacoes?resultado=CONCLUIDA&simulado=true&pagina=1&limite=20
```

Além de paginação, aceita `resultado=EM_ANDAMENTO|CONCLUIDA|FALHA`, `simulado=true|false` e `de`/`ate` ISO 8601 com fuso. Período inclusivo: usa início quando conhecido, senão término. Ordenação por criação do registro decrescente, com desempate por UUID; um início atrasado pode modificar a inclusão no filtro por período. Datas do dispositivo e de recebimento são expostas separadamente. Apenas o dono da planta consulta, inclusive se ela ou o dispositivo estiverem arquivados. Registros de zonas sem planta não aparecem em nenhuma planta; os eventos originais continuam no histórico do dispositivo.

## Demonstração e testes

No terminal do simulador:

```powershell
$env:MQTT_SIM_IRRIGACOES = 'true'
npm.cmd run mqtt:simulate
```

A cada seis leituras, o simulador publica início e finalização após dois segundos, sempre com `simulado: true`, sem saídas físicas. Sem a variável, o comportamento anterior de apenas leituras/status é mantido.

`npm.cmd test` verifica validações, isolamento de campos e protocolo. `npm.cmd run test:postgres` usa banco temporário e verifica importação administrativa, referências/cópias, acesso privado, compatibilidade, snapshots, versões, arquivamento, MQTT concorrente, mensagens fora de ordem, integridade transacional e migrations/rollback. Não publica referências no banco de desenvolvimento.
