# Frontend da Horta Inteligente

Interface em React e JavaScript, com Vite para desenvolvimento e React Router para navegação. Requer Node.js 22.12 ou superior.

## Executar no Windows

No primeiro terminal, dentro de `backend`, com PostgreSQL e `.env` configurados:

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd start
```

No segundo terminal, dentro de `frontend`:

```powershell
npm.cmd ci
npm.cmd run dev
```

Abra [http://127.0.0.1:5173](http://127.0.0.1:5173). O Vite encaminha as chamadas de `/api/v1` para `http://127.0.0.1:3000`. Se o backend estiver em outro endereço, copie `.env.example` para `.env.local` e ajuste `API_PROXY_TARGET`. Reinicie o Vite após mudar o arquivo.

## Páginas

| Rota | Função |
| --- | --- |
| `/login`, `/cadastro` | Entrar e criar conta |
| `/dashboard` | Resumo da horta, leituras, irrigações e dispositivos |
| `/plantas`, `/plantas/:id` | Cadastro, edição, fotos, identificação, crescimento, perfil, zona e histórico |
| `/perfis-irrigacao` | Perfis pessoais, validação, referências e cópias |
| `/dispositivos`, `/dispositivos/:id` | Dispositivos, zonas, calibração, eventos e sincronização |
| Endereço desconhecido | Página 404 com volta ao login ou dashboard |

O token Bearer fica na sessão da aba. A API valida a sessão e a propriedade dos dados. A interface pede login novamente ao receber `401` em uma requisição autenticada.

## Demonstração com o simulador

Crie uma planta com espécie e fase, crie e valide um perfil compatível e cadastre um dispositivo simulado. No dispositivo, crie uma zona calibrada. Na aba **Irrigação** da planta, vincule a zona e o perfil. Inicie o [simulador MQTT](../docs/mqtt.md#demonstração-de-irrigação-com-perfil) com os IDs do dispositivo e da zona. Na aba **Configuração** do dispositivo, selecione **Irrigação simulada** e sincronize. A confirmação é consultada enquanto estiver pendente. Acompanhe a execução no histórico da planta e no dashboard. A automação física permanece desabilitada.

## Build

```powershell
npm.cmd run build
npm.cmd run preview
```

Para hospedagem fora do Vite, sirva os arquivos de `dist/`, configure o fallback das rotas do React para `index.html` e encaminhe `/api/v1` à API. Se preferir endereços diferentes, defina `VITE_API_BASE_URL` no build e configure a origem exata do frontend em `CORS_ORIGINS` no backend.
