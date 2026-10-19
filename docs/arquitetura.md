# Arquitetura aprovada

Este documento registra a estrutura validada antes da implementação. Infraestrutura, autenticação, catálogos, plantas, crescimento, fotos e identificação estão implementados. Perfis, dispositivos, zonas, MQTT, sensores, irrigações e dashboard permanecem planejados.

## Responsabilidades

Frontend → Express → controllers → services → Sequelize → PostgreSQL.

Identificação: backend → PlantNet → candidatos → confirmação do usuário. A chave fica no ambiente do servidor. A PlantNet não decide irrigação.

Automação: backend seleciona configuração validada → MQTT → ESP32 confirma versão → ESP32 decide e executa localmente → MQTT envia leituras/eventos → backend registra.

Não incluir previsão meteorológica nem criar valores agronômicos sem fonte e calibração.

## Modelo relacional planejado

| Entidade | Relações principais |
| --- | --- |
| Usuario | Possui plantas, dispositivos e perfis privados |
| Especie | Referenciada por plantas e perfis |
| FaseCrescimento | Catálogo referenciado por plantas, históricos e perfis |
| Planta | Pertence ao usuário; espécie e zona opcionais; possui fotos, identificações, crescimento, configurações e históricos |
| FotoPlanta | Pertence à planta; referenciada por identificações e registros de crescimento |
| IdentificacaoPlanta | Registra sugestões e confirmação da espécie |
| HistoricoCrescimento | Fase, altura, observação, foto e data |
| PerfilIrrigacao | Pertence ao usuário; espécie, fase, fonte, validação, versão e parâmetros |
| Dispositivo | Pertence ao usuário; possui zonas e eventos |
| ZonaIrrigacao | Pertence ao dispositivo; representa sensor/saída física e calibração |
| ConfiguracaoIrrigacao | Versão dos parâmetros efetivos para zona, planta e perfil; acompanha envio e confirmação |
| LeituraSensor | Dispositivo, zona, planta, valores e datas de medição/recebimento |
| RegistroIrrigacao | Dispositivo, zona, planta, configuração, duração e resultado |
| EventoDispositivo | Identificador único, tipo, dados e datas |

Cada zona possui uma planta ativa na primeira versão. A planta pode ser cadastrada sem zona. Leituras e irrigações preservam sua associação histórica mesmo após uma mudança de zona. Plantas e dispositivos serão arquivados para preservar o histórico.

Identificadores UUID, timestamps com fuso, tabelas e colunas em `snake_case`. Alterações de fase e seu histórico serão transacionais. Operações validarão a propriedade de todos os recursos relacionados.

## Estados

- Identificação: `NAO_IDENTIFICADA`, `IDENTIFICACAO_PENDENTE`, `IDENTIFICADA`.
- Fases: `SEMENTE`, `GERMINACAO`, `MUDA`, `VEGETATIVA`, `ADULTA`.
- Sincronização da configuração: `PENDENTE`, `ENVIADA`, `CONFIRMADA`, `ERRO`.

## Segurança do controle local

ESP32 mantém a última configuração válida. Tempo máximo, intervalo mínimo, exclusão de acionamentos simultâneos e validação das leituras são locais. A bomba inicia desligada após reinicialização. Ausência de perfil validado ou de calibração mantém monitoramento sem automação. Mudanças de espécie/fase exigem revisar a configuração aplicável.

Uma leitura percentual depende da calibração do sensor e substrato. Não equivale automaticamente a teor volumétrico de água. `umidadeMinima < umidadeAlvo`; ambos ficam entre 0 e 100; duração e intervalo são positivos. Nenhum valor agronômico padrão será preenchido nesta etapa.

## MQTT planejado

```text
horta/{deviceId}/sensores
horta/{deviceId}/status
horta/{deviceId}/config
horta/{deviceId}/config/ack
horta/{deviceId}/eventos
```

Broker autentica dispositivos e aplica ACL por tópico. Mensagens incluem zona, versão do protocolo, identificador único e data. IDs únicos por dispositivo impedem duplicação ao retransmitir mensagens. Publicar uma configuração não equivale a receber confirmação de aplicação.

## Endpoints aprovados

Todos usam `/api/v1` e exigem JWT e verificação de propriedade quando pertinente.

| Área | Endpoints planejados |
| --- | --- |
| Catálogos | `GET/POST /especies`, `GET /especies/:id`, `GET /fases-crescimento` |
| Plantas | `GET/POST /plantas`, `GET/PATCH/DELETE /plantas/:id` |
| Fotos | `GET/POST /plantas/:id/fotos`, `GET /plantas/:id/fotos/:fotoId/arquivo` |
| Identificação | `GET/POST /plantas/:id/identificacoes`, `POST /plantas/:id/identificacoes/:identificacaoId/confirmacao`, `PUT /plantas/:id/especie` |
| Crescimento | `GET/POST /plantas/:id/crescimento` |
| Perfis | `GET/POST /perfis-irrigacao`, `GET/PATCH/DELETE /perfis-irrigacao/:id`, `GET/PUT /plantas/:id/perfil-irrigacao` |
| Dispositivos | `GET/POST /dispositivos`, `GET/PATCH/DELETE /dispositivos/:id` |
| Zonas | `GET/POST /dispositivos/:id/zonas`, `PATCH /dispositivos/:id/zonas/:zonaId`, `PUT/DELETE /plantas/:id/zona` |
| Configuração | `GET /dispositivos/:id/zonas/:zonaId/configuracao`, `POST /dispositivos/:id/zonas/:zonaId/sincronizacao` |
| Históricos | `GET /plantas/:id/leituras`, `GET /plantas/:id/irrigacoes`, `GET /plantas/:id/historico`, `GET /dispositivos/:id/eventos` |
| Dashboard | `GET /dashboard` |

Listagens terão paginação e filtros apropriados. Downloads de fotos serão autenticados; uploads não serão servidos como uma pasta pública.

## Sequência de trabalho

1. Infraestrutura PostgreSQL/Sequelize e autenticação JWT — concluída.
2. Catálogos e CRUD de plantas — concluída.
3. Fotos, crescimento e identificação PlantNet — concluída; testes externos simulados, chamada real depende de chave válida.
4. Perfis, dispositivos, zonas e MQTT.
5. Leituras, irrigações, dashboard e validação integrada.
