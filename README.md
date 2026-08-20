# GALAXIE

Aplicativo desktop (workspace de produtividade Microsoft 365) que dá aos
usuários de um cliente acesso simples aos arquivos da empresa no SharePoint **e**
um conjunto de ferramentas integradas de e-mail, agenda, contatos, navegação,
arquivos locais e acesso remoto. O dado vem de **três caminhos**: Microsoft
Graph delegado (`/me`, sem IMAP) nas contas M365, Google (Drive/appData) nas
contas pessoais, e o **filesystem local** (Explorer de Arquivos).

A pessoa entra com o e-mail corporativo, o app descobre o tenant, ela faz login
na página oficial da Microsoft e cai no workspace. Feito pela
[Galaxie Works](https://galaxie.works) para atender múltiplos clientes a partir
do mesmo binário. Auto-atualiza (installer assinado publicado no repo de
distribuição; o app se atualiza sozinho).

---

## O que faz hoje

**Base (acesso a arquivos)**

| Recurso | Descrição |
|---|---|
| **Login por e-mail** | Detecta o tenant pelo domínio (OIDC público) e abre o login oficial da Microsoft já preenchido |
| **Sessão persistente** | Reabre logado (refresh token cifrado com DPAPI) |
| **Bibliotecas SharePoint** | Lista os sites que o usuário enxerga; **Conectar/Desconectar** cria/remove o atalho no OneDrive; **Abrir no Explorer**; liga `LongPathsEnabled` via UAC |

**Módulos (Galaxie Apps)**

| Módulo | Descrição |
|---|---|
| **Bridge** | Cliente de e-mail (4 painéis) + **Agenda** (eventos, recorrência) + **People** (contatos M365, categorias, organizações) — tudo via Graph delegado |
| **Navigator** | Navegador embutido (WebView2) com abas, sleeping tabs, command palette, favoritos, histórico/privacidade |
| **Explorer** (Files) | Gerenciador de arquivos locais (épico #675): árvore This PC/Cloud/Network, copy/move com engine paralela e progresso na central, undo (journal), previews. Backend Rust `fs_explorer.rs` |
| **Remote** | Acesso remoto (épico #682): captura de tela, input, transporte WebRTC/str0m, agente SYSTEM. Crates em `services/` (feature `remote`); infra de relay em `infra/remote/` |
| **Previews** | Preview de anexos (PDF/TXT/docx/xlsx/pptx) dentro do app, com sandbox de segurança |
| **Telemetria** | Diagnóstico/observabilidade privacy-first (TelemetryPolicy em Rust → OpenObserve self-host; consent por categoria, PII-scrubbed) |

Contas: além do M365 (Graph), o app também loga em **conta Microsoft pessoal** e
**Google** (provider `google`, épico #692 — nuvem via Drive/appData). Recursos
que dependem de org (SharePoint/`/sites`) ficam gateados por provider.

## Como funciona a autenticação

Fluxo **Authorization Code + PKCE** com redirect de loopback. O app **nunca vê a
senha**: quem coleta credenciais e MFA é a página da Microsoft, no navegador
padrão. O que volta para o app é um authorization code, trocado por tokens.

O **refresh token** é gravado em `%LOCALAPPDATA%\GALAXIE\sessao.bin`,
cifrado com **DPAPI** — a mesma abordagem do MSAL no Windows. A chave deriva da
credencial do usuário do Windows: outro usuário da máquina não decifra, e o
arquivo copiado para outro computador é inútil.

> **Por que não o Cofre de Credenciais:** ele limita o blob a 2560 bytes e o
> Windows guarda em UTF-16 (2 bytes/char). O refresh token da Microsoft passa de
> 1500 caracteres → ~3150 bytes → estoura o limite. Pior: a API respondia
> "gravado com sucesso" e descartava em silêncio.

O `CLIENT_ID` em `src-tauri/src/config.rs` é público por natureza — aplicações
*public client* não têm secret, e o PKCE é o que protege o fluxo.

## Permissões Microsoft Graph

O app é **delegado (`/me`)** e **Graph-only** (sem IMAP/EWS/EAS, ainda que esses
escopos estejam disponíveis no registro). Há duas listas que não se confundem:

- **Concedidas (*granted*)** — escopos delegados com *admin consent* do tenant,
  disponíveis **sem novo consent**. A lista completa e atual (**101 escopos**, com a
  implicação por feature) está em **[`docs/reference/graph-scopes.md`](docs/reference/graph-scopes.md)** —
  fonte única de verdade. Inclui caixa compartilhada, Teams/Chat, Online Meetings,
  OneNote, Org settings, entre outros.
- **Requisitadas (*requested*)** — o subconjunto **mínimo** que o app pede no token,
  em `src-tauri/src/config.rs`, em **duas** consts: `SCOPES_BASE` (user-consentable)
  e `SCOPES_ORG` (admin consent, só na org contratada). Conferir no arquivo — a
  lista não é duplicada aqui de propósito, porque a cópia antiga driftou:

  Lista completa e atualizada em
  [`docs/reference/graph-scopes.md`](docs/reference/graph-scopes.md#requisitados-hoje).

Adicionar um escopo **já concedido** à lista requisitada **não** dispara re-consent
— o admin já consentiu; basta o usuário relogar para obter um token novo. A lista
completa de concedidas e as implicações por feature estão no **AGENTS.md** (§1.1).

## Stack

- **[Tauri 2](https://tauri.app)** — binário nativo pequeno, WebView2 no Windows
- **Rust** — auth, Microsoft Graph e integrações com o Windows (registro, Explorer)
- **React + TypeScript + Vite**
- **Tailwind CSS v4 + shadcn/ui** — tema neutro, claro e escuro

## Rodando localmente

Pré-requisitos: [Node](https://nodejs.org) + [pnpm](https://pnpm.io),
[Rust](https://rustup.rs) e as
[dependências do Tauri](https://tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm tauri dev
```

Build de produção:

```bash
pnpm tauri build
```

Antes do primeiro login é preciso registrar o app no Entra ID — o passo a passo
está em **[REGISTRO-APP.md](REGISTRO-APP.md)**.

## Estrutura

```
src/                    interface (React)
  components/           ui (shadcn/reui), agenda, people, bridge, animate-ui…
  screens/              login, control-room (Bridge), navegador, configuracoes…
  lib/api.ts            ponte para o backend (mock fora do Tauri)
  lib/                  tema, strings (i18n pt/en), telemetria, store zustand…
src-tauri/src/          backend (Rust/Tauri) — comandos em lib.rs
  auth.rs               PKCE, tenant, sessão (DPAPI), foto do perfil
  dpapi.rs              wrapper único do DPAPI (cifra a sessão em disco)
  graph.rs              Microsoft Graph: mail, agenda, people, tarefas, sites (pool graph_enviar/429)
  gdrive.rs             backend de nuvem do Google (config em Drive/appData, conta pessoal)
  fs_explorer.rs        Explorer de arquivos local: listar, copy/move (engine paralela), undo/journal, watcher
  browser.rs            Navigator: abas, sessão, histórico (WebView2)
  bookmarks.rs          importação de favoritos do Chrome/Edge
  favicon.rs            busca de favicon dos sites das abas
  remote.rs             fronteira congelada FE↔Remote (feature `remote`)
  remote_stub.rs        stub do Remote quando a feature está OFF
  remote_identity.rs    custódia da identidade Ed25519 do device (signaling /v2/ws)
  domain_claim.rs       prova de posse de domínio (absorção de tenant)
  lock_screen.rs        PIN local da tela de bloqueio
  salvar_pdf.rs         "Salvar como…" → PDF do corpo do e-mail
  telemetry.rs          TelemetryPolicy (consent/scrub/sampling) + transporte OTLP
  system.rs             registro do Windows e Explorer
  estado.rs             registro local dos atalhos criados
  config.rs             CLIENT_ID, endpoints e SCOPES_BASE/SCOPES_ORG
services/               crates do Remote (captura, input, transporte, signaling, agente SYSTEM)
infra/                  stacks de infra: relay do Remote (coturn), OpenObserve, traefik
```

Docs em [`docs/`](docs/), **escopados por área** (ver o índice [`docs/README.md`](docs/README.md)):
módulos em `bridge/`, `navigator/`, `explorer/`, `remote/`, `astro/` (Galaxie AI);
cross-cutting em `reference/`; histórico em `arquivo/` (produtos removidos) e
`historia/`; processo em `equipe/`, release notes em `releases/`, runbooks em
`runbooks/`. A **lei do processo** é o [`TEAM-CANON.md`](TEAM-CANON.md) na raiz
(o antigo `WORKFLOW.md` é só um redirect pra ele); instruções operacionais em
[`AGENTS.md`](AGENTS.md) + [`Rules.md`](Rules.md).

## Limitações conhecidas

**O Graph não lista atalhos do OneDrive.** Verificado em cinco consultas
(`/drive/root/children` delegado e app-only, `/drive/root/delta` em ambos e
`/drive/sharedWithMe`): todas retornam zero itens com `remoteItem`, mesmo com o
atalho visível no OneDrive web. Como contorno, o app guarda o `id` devolvido na
criação (`estado.rs`) — é o que permite saber o que está conectado e remover
depois. **Consequência:** atalhos criados fora do app não são reconhecidos.

**O OneDrive ignora o nome enviado na criação** e deriva `"{site} - {biblioteca}"`
(vira "Comercial - Comercial"). O app renomeia logo em seguida, num PATCH — além
de feio, o nome longo consome o limite de 400 caracteres de caminho do SharePoint.

**Registro single-tenant.** Para atender clientes de outros tenants, o registro
precisa virar *multitenant* e o admin de cada cliente dar consent uma vez.

## Próximos passos

Em andamento: telemetria live no build shipado; **Astro** (Galaxie AI — créditos de IA + meeting-assistant, ver
`docs/astro/galaxie-ai-discovery.md`). O roadmap vive no board (GitHub Projects) — ver
`AGENTS.md` §2.
