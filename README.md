# Horta Inteligente — API

Backend do projeto acadêmico SENAI para identificação de plantas, acompanhamento do crescimento e irrigação local com ESP32.

O código da API está em `backend/`. A pasta `frontend/` está reservada para as telas. Execute todos os comandos npm deste documento dentro de `backend/`:

```powershell
cd "C:\Users\mateu\OneDrive\Documentos\ChatGPT\Projeto Senai\backend"
```

**Implementado:** infraestrutura, autenticação JWT, catálogos, plantas, crescimento, fotos e integração PlantNet; comunicação MQTT com dispositivos/zonas, leituras de solo e reservatório, histórico persistente, status, eventos, configurações de monitoramento e confirmação; perfis de irrigação pessoais/de referência, associação versionada à planta e histórico de execuções reportadas. Consulte o [guia MQTT](docs/mqtt.md) e o [guia de perfis e irrigações](docs/irrigacao.md). O [dashboard da API](docs/api.md#dashboard) reúne o resumo da horta. Acionamento físico, controle PI/PID e firmware permanecem para as próximas etapas. A automação continua desabilitada.

## Requisitos

- Node.js 22 ou superior e npm.
- PostgreSQL acessível com um banco exclusivo para a aplicação.
- Para `test:postgres`: binários locais do PostgreSQL (`initdb`, `pg_ctl`, `createdb`). No Windows, o script procura em `C:\Program Files\PostgreSQL`; também aceita `PG_BIN_DIR`.

## Instalação e configuração

Na pasta `backend`:

```powershell
npm.cmd ci
npm.cmd run setup:env
```

O segundo comando cria `backend/.env` com uma chave JWT aleatória e não sobrescreve um arquivo existente. Edite `DATABASE_URL` com suas credenciais reais. O `.env` está ignorado pelo Git; nunca publique esse arquivo.

Se precisar criar um banco, conecte ao PostgreSQL pelo pgAdmin ou psql como administrador e execute, com uma senha escolhida por você:

```sql
CREATE ROLE horta WITH LOGIN PASSWORD 'SUBSTITUA_POR_UMA_SENHA_FORTE';
CREATE DATABASE horta_inteligente OWNER horta;
```

Exemplo de formato da conexão, sem credenciais reais:

```dotenv
DATABASE_URL=postgresql://horta:SUA_SENHA@127.0.0.1:5432/horta_inteligente
```

Codifique caracteres especiais da senha ao compor a URL. Por exemplo, `@` vira `%40`. Se o servidor exigir TLS, configure `DATABASE_SSL=true`; a validação de certificados permanece habilitada.

Configure `CORS_ORIGINS` com a origem do frontend, se ele usar outra origem, por exemplo `http://localhost:5173`. Sem essa variável, respostas não autorizam acesso por CORS entre origens. CORS não substitui autenticação.

## Migrations e execução

```powershell
npm.cmd run db:migrate
npm.cmd run db:migrate:status
npm.cmd run dev
```

Para execução sem recarga automática, use `npm.cmd start`. Por padrão a API escuta em `http://127.0.0.1:3000/api/v1`. Para disponibilizá-la em uma interface de rede, configure `HOST` adequadamente.

A aplicação valida as variáveis, a conexão e a presença das tabelas na inicialização. Não cria tabelas automaticamente. `npm.cmd run db:migrate:undo` reverte a última migration e pode remover tabelas e seus dados: use somente quando essa exclusão for desejada.

## Teste manual com PowerShell

Com a API em execução:

```powershell
$apiHorta = 'http://127.0.0.1:3000/api/v1'

$cadastroHorta = @{
  nome = 'Ana Silva'
  email = 'ana@example.com'
  senha = 'MinhaSenhaSegura123!'
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "$apiHorta/auth/register" `
  -ContentType 'application/json; charset=utf-8' -Body $cadastroHorta

$credenciaisHorta = @{
  email = 'ana@example.com'
  senha = 'MinhaSenhaSegura123!'
} | ConvertTo-Json

$sessaoHorta = Invoke-RestMethod -Method Post -Uri "$apiHorta/auth/login" `
  -ContentType 'application/json; charset=utf-8' -Body $credenciaisHorta

Invoke-RestMethod -Uri "$apiHorta/auth/me" -Headers @{
  Authorization = "Bearer $($sessaoHorta.data.accessToken)"
}
```

## Testes automatizados

Na pasta `backend`, instale as dependências com `npm.cmd ci` se ainda não estiverem instaladas. As duas suítes usam Jest; os testes HTTP enviam requisições com o `fetch` nativo do Node.js.

```powershell
npm.cmd test
npm.cmd run test:postgres
```

`npm.cmd test` executa os testes unitários e HTTP. Verifica configuração, validações, autenticação, limites de requisição, tratamento de falhas e o contrato da PlantNet. A autenticação usa um repositório em memória; não é preciso iniciar o PostgreSQL, o Mosquitto ou a API.

`npm.cmd run test:postgres` precisa dos executáveis locais do PostgreSQL. O script cria um cluster temporário com senha em uma porta livre de `127.0.0.1`, aplica as migrations, roda a integração no Jest e verifica a reversão e a reaplicação das migrations. As fotos de teste ficam na pasta temporária, e o cluster é encerrado e removido ao final. O banco de desenvolvimento fica fora do teste.

O Mosquitto é necessário apenas para o cenário que testa MQTT por TCP. A suíte inicia o broker local quando encontra o executável no caminho esperado. Sem o executável, o Jest indica esse cenário como ignorado e roda os demais. Veja a [verificação MQTT](docs/mqtt.md#verificação).

Os testes não enviam fotos à PlantNet nem consomem sua quota: o serviço externo é simulado. A chamada real requer uma chave válida e acesso à internet.

Em outra instalação do PostgreSQL, informe o caminho dos binários:

```powershell
$env:PG_BIN_DIR = 'C:\Program Files\PostgreSQL\18\bin'
npm.cmd run test:postgres
```

## Organização

```text
backend/
  src/
    config/        Ambiente e conexão Sequelize
    controllers/   Entrada e saída HTTP
    middlewares/   JWT, validação e tratamento de erros
    models/        Usuários, catálogos, plantas, crescimento, fotos e identificações
    routes/        Autenticação e recursos protegidos
    services/      Regras de negócio, armazenamento de fotos e integração PlantNet
    utils/         Erros da aplicação
    validators/    Schemas de entrada
    app.js         Composição do Express sem abrir porta
    server.js      Inicialização e encerramento do servidor
  database/
    migrations/    Evolução versionada do banco
    seeders/       Reservado; as cinco fases são inseridas pela migration
  scripts/         Preparação do ambiente e PostgreSQL de teste
  tests/           Testes unitários, HTTP e integração PostgreSQL
  storage/uploads/ Fotos privadas, ignoradas pelo Git
frontend/          Reservado para as telas
docs/              Documentação existente, mantida no local original
```

## Plantas, fotos e identificação

Após atualizar um projeto existente, execute `npm.cmd ci` e `npm.cmd run db:migrate`. A migration insere as cinco fases de crescimento. O catálogo de espécies começa vazio: pode ser preenchido manualmente ou pela confirmação dos candidatos da PlantNet. Nenhum parâmetro de irrigação é criado.

Todas as rotas de catálogos e plantas exigem `Authorization: Bearer TOKEN`. O dono vem do JWT; o cliente não pode enviar `usuarioId`. Acesso à planta de outro usuário retorna 403.

Fluxo inicial:

1. Consulte `GET /api/v1/fases-crescimento`.
2. Cadastre em `POST /api/v1/plantas` com `nome` e `faseAtual`. Se a espécie já estiver no catálogo, também pode informar `especieId`.
3. Registre mudanças de fase em `POST /api/v1/plantas/:id/crescimento`. Esse endpoint grava o histórico e atualiza a fase na mesma transação. `PATCH /plantas/:id` altera somente nome, apelido e data de plantio.
4. Envie uma foto por `POST /api/v1/plantas/:id/fotos`, usando multipart e o campo `foto`.
5. Solicite identificação com o `fotoId` retornado.
6. Confira os candidatos e confirme um deles pela posição `candidatoIndice`, começando em zero.

Fotos aceitas: JPEG/JFIF, PNG e WebP estáticos, até 5 MiB e 25 milhões de pixels. O servidor verifica e reencoda o conteúdo como JPEG, aplica a orientação EXIF, reduz para caber em 2400×2400 sem ampliar e remove metadados. O nome original do arquivo não é utilizado no armazenamento. A listagem retorna uma URL relativa cujo download também exige Bearer JWT. No frontend, use uma requisição autenticada e transforme a resposta em Blob para exibição.

Para habilitar a identificação real, acrescente ao `.env` existente:

```dotenv
PLANTNET_API_KEY=SUA_CHAVE_PRIVADA
```

O backend funciona sem essa chave; apenas a solicitação de identificação retorna 503. `PLANTNET_PROJECT` usa `all` e `PLANTNET_TIMEOUT_MS` usa 20000 por padrão. O servidor envia à PlantNet somente a foto selecionada e o órgão indicado. Fotos enviadas para identificação são compartilhadas com esse serviço externo.

Exemplo dos corpos JSON:

```json
{"nome":"Meu manjericão","faseAtual":"MUDA","dataPlantio":"2026-10-01"}
```

```json
{"fotoId":"UUID_DA_FOTO","orgao":"leaf"}
```

```json
{"candidatoIndice":0}
```

Identificar gera sugestões; confirmar altera a espécie. Os scores são armazenados entre 0 e 1. Identificação manual usa confiança nula. Falhas da integração são registradas com códigos seguros, sem guardar a resposta bruta que poderia conter a chave. Não há execução automática de jobs pendentes após reiniciar: uma identificação abandonada permite nova tentativa depois do timeout configurado mais 60 segundos.

`DELETE /plantas/:id` arquiva a planta, preserva fotos/históricos e impede novas alterações. As listagens mostram ativas por padrão; `arquivadas=true` lista as arquivadas. O proprietário continua podendo consultar seus registros. Perfis e histórico de irrigações estão disponíveis conforme o [guia de irrigação](docs/irrigacao.md); irrigação automática permanece desabilitada.

Detalhes de filtros, formatos e erros: [contrato HTTP](docs/api.md). Contrato externo consultado: [identificação da PlantNet](https://my.plantnet.org/doc/api/identify).

## Decisões de autenticação e operação

- Senhas com pelo menos 12 caracteres e no máximo 72 bytes UTF-8; bcrypt com custo 12 por padrão. Senhas não são truncadas nem normalizadas.
- E-mails são normalizados com trim e minúsculas; índice UNIQUE impede duplicação mesmo em requisições concorrentes.
- `senhaHash` não é retornado pela API, pela serialização do model nem pelas consultas padrão.
- JWT HS256 com assinatura, expiração, emissor, audiência e identificador UUID verificados. `/me` também verifica se o usuário ainda existe.
- Login inválido retorna a mesma mensagem para e-mail inexistente e senha incorreta.
- Cadastro e login compartilham um limite por IP, com armazenamento em memória. Várias instâncias exigirão um armazenamento compartilhado para o limite.
- A API não confia em cabeçalhos de proxy por padrão. Se houver proxy reverso, configure a cadeia de proxies confiáveis antes de publicar.
- Tokens expiram em uma hora por padrão. Refresh tokens, revogação individual, recuperação de senha e verificação de e-mail não fazem parte desta etapa. Sem revogação, logout do cliente remove seu token e ele permanece válido até expirar.
- Em implantação, use HTTPS e uma conta PostgreSQL dedicada. Não envie credenciais administrativas no `.env` da aplicação.
- O `package.json` fixa um override de `uuid` para a linha 11 corrigida dentro do Sequelize 6. Isso elimina o [aviso GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) sem alterar a versão principal do ORM. Os testes com banco real verificam a geração dos UUIDs e as migrations com essa resolução.

Detalhes: [contrato HTTP](docs/api.md) e [arquitetura aprovada](docs/arquitetura.md).

Referências técnicas: [tratamento de erros do Express 5](https://expressjs.com/en/guide/error-handling.html), [migrations do Sequelize 6](https://sequelize.org/docs/v6/other-topics/migrations/) e [limite de entrada do bcrypt](https://www.npmjs.com/package/bcrypt).
