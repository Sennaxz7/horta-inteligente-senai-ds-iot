# Perfis e histórico de irrigação

Esta etapa oferece perfis pessoais e um catálogo compartilhado de referência, associação explícita à planta e histórico de execuções reportadas por MQTT. Não implementa firmware, controle PI/PID, cálculo Ziegler–Nichols ou acionamento da bomba. `automacaoHabilitada` continua aceitando somente `false`.

## Preparação

Na pasta `backend`, execute `npm.cmd run db:migrate` e reinicie a API. A migration `20261103000100-create-irrigacao.js` acrescenta três tabelas sem converter ou excluir mensagens antigas: `perfis_irrigacao`, `plantas_perfis_irrigacao` e `registros_irrigacao`.

A migration de Hortaliças cadastra cinco referências de demonstração, uma por fase. Os perfis vêm com 2 segundos de duração máxima e 15 segundos de espera após o fim da rega.

| Fase | Mínima | Alvo | Escala |
| --- | ---: | ---: | --- |
| Semente | 60% | 70% | Escala gravimétrica da bandeja |
| Germinação | 60% | 70% | Escala gravimétrica da bandeja |
| Muda | 70% | 80% | Percentual da capacidade de retenção do substrato |
| Vegetativa | 20,51% | 23,41% | Umidade volumétrica |
| Adulta | 20,51% | 23,41% | Umidade volumétrica |

Os pares foram adaptados para o simulador com alface como referência. Semente e Germinação usam a faixa descrita para a emergência. Muda usa dois tratamentos do ensaio em bandeja. Os valores volumétricos usam a curva do ensaio em vasos de Juazeiro, com 15 kPa como limiar de teste e 10 kPa como referência para o alvo. [Estudo em bandeja](https://doi.org/10.3390/horticulturae12080906) · [Curva do ensaio em vaso](https://doi.org/10.1590/S0102-05362011000200018) · [Referência de 15 kPa](https://www.scielo.br/j/eagri/a/NFGdypYMJKtZDsnjZdQz3tn/?lang=pt)

## Rotas HTTP

Prefixo `/api/v1`, JWT Bearer obrigatório. Entradas desconhecidas são rejeitadas. Identificadores são UUIDs.

| Método | Caminho | Sucesso | Resultado |
| --- | --- | --- | --- |
| POST | `/perfis-irrigacao` | 201 | `data.perfil`, sempre pessoal e rascunho |
| GET | `/perfis-irrigacao` | 200 | Listagem paginada dos próprios perfis e referências validadas |
| GET | `/perfis-irrigacao/:id` | 200 | `data.perfil` |
| PATCH | `/perfis-irrigacao/:id` | 200 | `data.perfil` atualizado |
| DELETE | `/perfis-irrigacao/:id` | 204 | Arquivamento idempotente do perfil pessoal |
| POST | `/perfis-irrigacao/:id/copia` | 201 | Cópia pessoal em rascunho. Envie `{}` para referência por espécie ou `{especieId}` para padrão de grupo. |
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

Referências são somente leitura pela API. Para personalizar uma referência por espécie, envie `{}` ao POST `/perfis-irrigacao/:id/copia`. Para copiar um padrão do grupo, informe a espécie da cópia. A cópia mantém os parâmetros e a fonte, recebe outro UUID, pertence ao usuário e começa na versão 1 em rascunho. Editar a cópia não altera a referência. Perfis pessoais de terceiros retornam 404. Tentativa de editar/arquivar referência retorna 403.

## Publicação administrativa de referências

Não existe papel de administrador na autenticação atual. Portanto, a publicação global é feita exclusivamente por um comando local, com acesso administrativo ao ambiente do backend. Não foi criada uma rota que permita a um usuário comum publicar perfis para todos.

Prepare um JSON com o mesmo corpo de criação, dados reais e fonte revisada. Execute na pasta `backend`:

```powershell
npm.cmd run perfis:importar -- "C:\caminho\perfil-revisado.json" --validado
```

`--validado` é a confirmação explícita do operador de que revisou os dados. O comando utiliza a conexão configurada, valida campos e catálogos, cria um perfil `REFERENCIA` por espécie, sem dono, com status `VALIDADO` e data de validação. Cada execução cria um perfil novo. Os padrões de Hortaliças são inseridos pela migration. Revisão e arquivamento de referências existentes são operações administrativas.

## Busca por planta e associação

```http
GET /api/v1/perfis-irrigacao?plantaId=UUID_DA_PLANTA
```

O filtro por planta lista as opções para associação manual, compatíveis com sua espécie confirmada e fase atual. Rascunhos pessoais podem aparecer para edição, mas não podem ser associados. Nesse filtro, planta sem espécie retorna 409 `PLANT_SPECIES_REQUIRED`. Para consultar o perfil automático, use a rota de vínculo da planta, inclusive quando a espécie ainda não foi identificada.

Filtros: `pagina` (padrão 1), `limite` (padrão 20, máximo 100), `especieId`, `fase`, `plantaId`, `grupoIrrigacao=HORTALICAS`, `tipo=PESSOAL|REFERENCIA`, `statusValidacao=RASCUNHO|VALIDADO` e `arquivados=true|false` (padrão false). `true` lista somente arquivados. Combinar planta com espécie/fase diferentes retorna 422.

Associação:

```http
PUT /api/v1/plantas/UUID_DA_PLANTA/perfil-irrigacao
```

```json
{"perfilIrrigacaoId":"UUID_DO_PERFIL"}
```

Somente perfis por espécie ativos, validados e compatíveis com a espécie/fase podem ser associados manualmente. A planta deve estar ativa. O vínculo guarda versão e snapshot do perfil escolhido. Para copiar um padrão do grupo como perfil pessoal, envie `{"especieId":"UUID_DA_ESPECIE"}` na rota de cópia.

A consulta retorna o vínculo manual e o `perfilAplicado`, com `origem` igual a `ASSOCIADO` ou `PADRAO_GRUPO`. Um vínculo válido tem prioridade. Sem vínculo válido, uma planta cadastrada com `grupoIrrigacao: "HORTALICAS"` usa o padrão da fase atual. A consulta e a sincronização MQTT usam a mesma regra. Consultas retornam:

```json
{
  "data": {
    "perfil": {},
    "vinculo": {},
    "necessitaRevisao": true,
    "motivos": ["VERSAO_ALTERADA"],
    "perfilAplicado": {},
    "origem": "PADRAO_GRUPO"
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

`configuracaoId` é opcional no protocolo legado e exige `irrigacaoId`; quando informado precisa existir no mesmo dispositivo/zona. Guarda-se o ID e snapshot dos dados daquela configuração. Na [demonstração com perfil](mqtt.md#demonstração-de-irrigação-com-perfil), o simulador repete o ID confirmado no início e no fim. O registro usa a planta do snapshot e preserva a versão do perfil usada, inclusive após mudanças na zona ou no perfil. Um ACK, por si só, não comprova uma execução. Ganhos PI/PID e sua sintonia continuam fora desta entrega.

Regras de persistência:

- Chave de execução: dispositivo + `irrigacaoId`; há índice único no banco.
- Registro e mensagem original são gravados na mesma transação. Reenvios do mesmo `mensagemId` não duplicam dados.
- Novo início para execução que já tem início e novo término para execução encerrada são descartados, mesmo que usem outro ID de mensagem. Não sobrescrevem fatos já persistidos.
- Término recebido primeiro cria um registro finalizado com início null e `inicioAusente: true`. Se o início chegar depois com data coerente, completa o registro preservando o resultado final.
- Término anterior ao início, troca de zona para a mesma execução e configuração conflitante são descartados.
- Sem término, permanece `EM_ANDAMENTO`; não existe conclusão ou falha automática por timeout.
- Para execuções com perfil simulado, a planta vem da configuração confirmada. Nos demais casos, usa-se a planta vinculada à zona no recebimento do primeiro evento aceito. Trocar a ocupante da zona não transfere execuções registradas.
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

Sem modo explícito, o simulador publica início e finalização após dois segundos a cada seis leituras, sempre com `simulado: true`, sem saídas físicas. Com `SIMULACAO_IRRIGACAO`, os eventos levam o ID da configuração e respeitam a umidade mínima, o intervalo e a duração máxima do perfil. Com `MONITORAMENTO` explícito, o simulador só publica leituras e status. Sem a variável, nenhum evento de irrigação é gerado.

Na pasta `backend`, `npm.cmd test` roda no Jest os testes unitários e HTTP sem PostgreSQL ou Mosquitto. `npm.cmd run test:postgres` executa a integração com Jest e `fetch` nativo, usando os executáveis locais do PostgreSQL para criar um banco temporário. Essa suíte verifica perfis, vínculos, versões, arquivamento, mensagens fora de ordem, transações e migrations, sem publicar referências no banco de desenvolvimento. O Mosquitto só é necessário para o [cenário MQTT por TCP](mqtt.md#verificação), que é ignorado quando o executável não é encontrado.
