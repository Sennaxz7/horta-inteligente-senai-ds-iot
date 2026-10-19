# Contrato HTTP — etapas 1–3

Base: `/api/v1`. Corpos usam `Content-Type: application/json`, exceto o upload de foto, que usa multipart. Campos desconhecidos são rejeitados. O limite do corpo JSON é 16 KiB.

## Rotas implementadas

| Método | Caminho | Autenticação | Sucesso |
| --- | --- | --- | --- |
| POST | `/auth/register` | Pública | 201 |
| POST | `/auth/login` | Pública | 200 |
| GET | `/auth/me` | Bearer JWT | 200 |
| GET | `/health/live` | Pública | 200 |
| GET | `/health/ready` | Pública | 200, ou 503 sem conexão PostgreSQL |

### Cadastro

```json
{
  "nome": "Ana Silva",
  "email": "ana@example.com",
  "senha": "MinhaSenhaSegura123!"
}
```

Nome: 2–120 caracteres após trim. E-mail válido: até 254 caracteres após normalização. Senha: pelo menos 12 caracteres, até 72 bytes UTF-8 e sem byte nulo.

Resposta 201:

```json
{
  "data": {
    "usuario": {
      "id": "6385f6bf-3f1e-4b57-a057-a56864347ac0",
      "nome": "Ana Silva",
      "email": "ana@example.com",
      "createdAt": "2026-10-17T22:00:00.000Z",
      "updatedAt": "2026-10-17T22:00:00.000Z"
    }
  }
}
```

O cadastro não inicia sessão; faça login em seguida.

### Login

```json
{
  "email": "ana@example.com",
  "senha": "MinhaSenhaSegura123!"
}
```

Resposta 200 inclui `data.usuario`, `data.accessToken`, `data.tokenType` (`Bearer`) e `data.expiresIn` em segundos. O token só contém as claims necessárias à sessão, sem senha ou dados de perfil.

### Sessão atual

Envie `Authorization: Bearer TOKEN` em `GET /auth/me`. A resposta contém `data.usuario`, no mesmo formato do cadastro. A identidade vem do token verificado. IDs enviados no corpo ou na query não selecionam outro usuário.

### Health checks

`/health/live` retorna `{"data":{"status":"ok"}}` enquanto o processo atende HTTP. `/health/ready` verifica a conexão PostgreSQL e retorna `{"data":{"status":"ready"}}` se disponível. Não expõe credenciais nem informações da infraestrutura.

## Erros

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Verifique os campos enviados.",
    "details": [{ "campo": "email", "mensagem": "Informe um e-mail válido." }],
    "requestId": "6385f6bf-3f1e-4b57-a057-a56864347ac0"
  }
}
```

`details` aparece em erros de validação. Respostas de erro incluem um identificador de requisição, também disponível em `X-Request-Id`; o limitador de tentativas usa uma mensagem fixa e o cabeçalho `X-Request-Id`.

| HTTP | Código | Motivo |
| --- | --- | --- |
| 400 | `INVALID_JSON` | Corpo JSON malformado |
| 401 | `AUTH_REQUIRED` | Token Bearer não informado corretamente |
| 401 | `INVALID_TOKEN` | Token inválido, expirado ou usuário removido |
| 401 | `INVALID_CREDENTIALS` | E-mail ou senha incorretos |
| 404 | `NOT_FOUND` | Rota inexistente |
| 409 | `EMAIL_IN_USE` | E-mail já cadastrado |
| 413 | `PAYLOAD_TOO_LARGE` | JSON maior que 16 KiB |
| 415 | `UNSUPPORTED_ENCODING` | Codificação de corpo não suportada |
| 422 | `VALIDATION_ERROR` | Campos ausentes, inválidos ou desconhecidos |
| 429 | `RATE_LIMITED` | Limite compartilhado de cadastro/login atingido |
| 500 | `INTERNAL_ERROR` | Falha interna sem detalhes sensíveis |
| 503 | `DATABASE_UNAVAILABLE` | Readiness sem conexão com o banco |

Limite padrão: 20 requisições de cadastro/login por IP a cada 15 minutos. A resposta 429 inclui `Retry-After`. Respostas usam `Cache-Control: no-store`.

## Catálogos e plantas

Todas as rotas abaixo exigem JWT. Espécies e fases formam um catálogo compartilhado. Plantas e seus registros são privados por usuário. Catálogos não incluem parâmetros agronômicos nem perfis de irrigação nesta etapa.

| Método | Caminho | Sucesso | Função |
| --- | --- | --- | --- |
| GET | `/fases-crescimento` | 200 | Array das cinco fases, ordenadas |
| GET | `/especies` | 200 | Listagem paginada; filtro `busca` |
| POST | `/especies` | 201 | Cadastro manual de espécie |
| GET | `/especies/:id` | 200 | `data.especie` |
| GET | `/plantas` | 200 | Listagem paginada das plantas do usuário |
| POST | `/plantas` | 201 | Cadastro e registro inicial de crescimento |
| GET | `/plantas/:id` | 200 | `data.planta`, incluindo espécie ou null |
| PATCH | `/plantas/:id` | 200 | Alteração de dados básicos |
| DELETE | `/plantas/:id` | 204 | Arquivamento idempotente, sem corpo |
| PUT | `/plantas/:id/especie` | 200 | Identificação manual ou remoção da espécie |
| GET | `/plantas/:id/crescimento` | 200 | Histórico paginado |
| POST | `/plantas/:id/crescimento` | 201 | Registro e atualização transacional da fase |

Todos os parâmetros `:id`, `:fotoId` e `:identificacaoId` são UUIDs; valores malformados retornam 422.

### Paginação e filtros

Listagens de espécies, plantas, crescimento, fotos e identificações aceitam `pagina` (padrão 1) e `limite` (padrão 20, máximo 100). Resposta:

```json
{
  "data": [],
  "meta": {"pagina": 1, "limite": 20, "total": 0, "totalPaginas": 0}
}
```

Filtros de plantas: `busca` em nome/apelido, `fase`, `especieId`, `statusIdentificacao` e `arquivadas=true|false`. Por padrão, retorna somente ativas; `true` retorna somente arquivadas. Busca de espécies consulta nome científico/comum. `%`, `_` e barra invertida na busca são tratados como texto literal.

O histórico de crescimento aceita `de` e `ate` em ISO 8601 com fuso, inclusivos. Campos desconhecidos na query retornam 422. Listagens têm desempate por UUID para ordenação determinística.

### Cadastro de espécie

```json
{"nomeCientifico":"Ocimum basilicum","nomeComum":"Manjericão"}
```

`nomeCientifico`: 2–255 caracteres, obrigatório, espaços normalizados; único sem distinguir maiúsculas/minúsculas. `nomeComum`: opcional/nulo, 1–160 caracteres. Resposta `data.especie`. Não há edição nem exclusão pública de espécies nesta etapa.

### Cadastro e atualização de planta

```json
{
  "nome":"Manjericão da bancada",
  "apelido":"Vaso 1",
  "faseAtual":"MUDA",
  "dataPlantio":"2026-10-01",
  "especieId":null
}
```

`nome`: obrigatório, 1–120 caracteres. `faseAtual`: obrigatória, uma das fases do catálogo. `apelido`: opcional/nulo, 1–120 caracteres. `dataPlantio`: opcional/nulo, data válida `YYYY-MM-DD`. `especieId`: opcional/nulo ou UUID de espécie existente. O dono é obtido do JWT. Status, origem e confiança são calculados pelo servidor.

`PATCH` aceita apenas `nome`, `apelido` e `dataPlantio`, com pelo menos um campo. Alterações de fase são feitas pela rota de crescimento; alterações de espécie, pela rota específica.

`PUT /plantas/:id/especie` recebe `{"especieId":"UUID"}` ou `{"especieId":null}`. A identificação manual tem origem `MANUAL` e confiança nula. Remover espécie retorna ao estado `NAO_IDENTIFICADA`.

### Crescimento

```json
{
  "fase":"VEGETATIVA",
  "alturaCm":18.5,
  "observacao":"Novas folhas.",
  "registradoEm":"2026-10-17T10:00:00-03:00",
  "fotoId":null
}
```

`fase` é obrigatória. Altura opcional/nula entre 0 e 10000 cm (limite de entrada, sem recomendação agronômica). Observação opcional/nula de até 2000 caracteres. `registradoEm` é opcional e usa a data atual por padrão; datas futuras além de 30 segundos de tolerância são rejeitadas. `fotoId` opcional/nulo deve pertencer à mesma planta.

Resposta: `data.registro` e `data.faseAtual`. A fase atual é a do registro mais recente por `registradoEm`, desempate por criação e UUID. Um registro retroativo é preservado sem substituir uma fase mais recente. O cadastro inicial também gera histórico. Transações e bloqueio da planta impedem divergência entre fase e histórico em escritas concorrentes.

## Fotos privadas

| Método | Caminho | Sucesso |
| --- | --- | --- |
| POST | `/plantas/:id/fotos` | 201, `data.foto` |
| GET | `/plantas/:id/fotos` | 200, listagem paginada |
| GET | `/plantas/:id/fotos/:fotoId/arquivo` | 200, bytes JPEG |

Upload multipart: um arquivo no campo `foto`; campos textuais opcionais `tipo` (`GERAL`, `CRESCIMENTO`, `IDENTIFICACAO`, padrão `GERAL`) e `capturadaEm` (timestamp ISO com fuso, padrão agora). Até 5 MiB por imagem. JPEG/JFIF, PNG e WebP estáticos, até 25 milhões de pixels; reencodados em JPEG sem metadados, com orientação aplicada e dimensões máximas de 2400×2400 sem ampliar.

A resposta inclui `id`, `plantaId`, `mimeType`, `tamanhoBytes`, `capturadaEm`, `tipo`, timestamps e `arquivoUrl`. Não inclui o caminho físico nem a chave interna. A autenticação e a propriedade da planta são verificadas antes de receber/processar o upload. Download e listagem também exigem autenticação. Não há pasta pública de uploads.

Limite de upload: 30 solicitações por usuário a cada 15 minutos. Se a gravação no banco falhar após gravar o arquivo, ele é removido como compensação. Banco e filesystem não possuem uma transação distribuída: uma interrupção abrupta entre essas operações pode deixar um arquivo órfão.

## Identificação por PlantNet

| Método | Caminho | Sucesso |
| --- | --- | --- |
| POST | `/plantas/:id/identificacoes` | 201, `data.identificacao` |
| GET | `/plantas/:id/identificacoes` | 200, listagem paginada |
| POST | `/plantas/:id/identificacoes/:identificacaoId/confirmacao` | 200, `data.identificacao` e `data.planta` |

Solicitação:

```json
{"fotoId":"UUID_DA_FOTO","orgao":"leaf"}
```

`orgao` é opcional: `auto` (padrão), `leaf`, `flower`, `fruit` ou `bark`. O backend envia a foto já armazenada e reencodada à PlantNet. A chamada é síncrona do ponto de vista do HTTP, com timeout configurado; nenhuma transação fica aberta durante a chamada externa. Limite: 10 solicitações por usuário a cada 15 minutos.

Cada identificação armazena `status`, `candidatos`, `codigoErro`, `especieConfirmadaId`, `confirmadaEm`, `finalizadaEm` e timestamps, além de planta e foto. Estados: `PENDENTE`, `CONCLUIDA`, `CONFIRMADA`, `ERRO`. `CONCLUIDA` pode conter uma lista vazia de candidatos.

Os candidatos contêm `nomeCientifico`, `nomeComum`, `confianca` (0–1) e `plantNetId` (nulo quando não fornecido). Não se atribui um ID de outra base taxonômica ao campo PlantNet. O servidor não persiste a resposta bruta do provedor.

Solicitar identificação não atribui a espécie. Para confirmar:

```json
{"candidatoIndice":0}
```

O índice começa em zero e precisa existir na lista persistida. O cliente não envia nome ou confiança na confirmação. A confirmação associa/cria a espécie no catálogo e atualiza planta e identificação na mesma transação, com origem `API`. Uma identificação já confirmada não pode ser confirmada novamente.

Só uma chamada externa por planta pode permanecer `PENDENTE`. Uma tentativa interrompida pelo encerramento do processo é marcada como erro ao solicitar nova identificação depois de `PLANTNET_TIMEOUT_MS + 60000` ms. Uma espécie definida manualmente durante uma chamada externa permanece intacta quando chegam as sugestões.

## Erros dos novos recursos

Além dos erros gerais já descritos:

| HTTP | Código | Motivo |
| --- | --- | --- |
| 403 | `FORBIDDEN` | Planta de outro usuário |
| 404 | `PLANT_NOT_FOUND`, `SPECIES_NOT_FOUND` | Recurso inexistente |
| 404 | `PHOTO_NOT_FOUND`, `IDENTIFICATION_NOT_FOUND` | Registro não encontrado na planta informada |
| 404 | `PHOTO_FILE_NOT_FOUND` | Metadados existem, mas arquivo não está disponível |
| 409 | `PLANT_ARCHIVED` | Tentativa de alterar planta arquivada |
| 409 | `SPECIES_ALREADY_EXISTS` | Espécie já cadastrada |
| 409 | `IDENTIFICATION_IN_PROGRESS` | Chamada externa ainda em andamento |
| 409 | `IDENTIFICATION_INTERRUPTED` | Tentativa foi substituída/interrompida |
| 409 | `IDENTIFICATION_NOT_CONFIRMABLE` | Identificação não está concluída e disponível para confirmação |
| 413 | `IMAGE_TOO_LARGE` | Upload ou imagem processada maior que 5 MiB |
| 415 | `UNSUPPORTED_IMAGE` | Tipo declarado não aceito |
| 422 | `INVALID_IMAGE`, `INVALID_UPLOAD`, `PHOTO_REQUIRED` | Conteúdo inválido ou multipart incorreto |
| 422 | `INVALID_CANDIDATE` | Índice não corresponde a um candidato persistido |
| 422 | `PLANTNET_NO_RESULT` | Provedor rejeitou a imagem sem identificação |
| 502 | `PLANTNET_AUTH_ERROR` | Credencial do provedor rejeitada |
| 502 | `PLANTNET_INVALID_RESPONSE`, `PLANTNET_UNAVAILABLE` | Resposta inválida ou indisponibilidade externa |
| 503 | `PLANTNET_NOT_CONFIGURED`, `PLANTNET_QUOTA_EXCEEDED` | Chave ausente ou quota do provedor atingida |
| 504 | `PLANTNET_TIMEOUT` | Tempo limite da integração |

Plantas arquivadas permanecem consultáveis pelo dono, incluindo crescimento, fotos e identificações. Novas alterações, uploads, identificações e confirmações são bloqueados.
