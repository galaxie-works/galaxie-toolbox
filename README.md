# The GALAXIE

**Assim como a galáxia, The GALAXIE oferece um horizonte infinito de soluções
para pequenas e grandes corporações.** É a **suite desktop** de produtividade
Microsoft 365 da [Galaxie Works](https://galaxie.works): um único binário que
reúne navegador, e-mail, agenda, contatos, arquivos (locais e na nuvem), acesso
remoto e — a caminho — uma IA que orbita o seu trabalho. Cada capacidade é um
**membro** da suite; o conjunto é a galáxia.

A pessoa entra com o e-mail corporativo, o app descobre o tenant, ela faz login
na página oficial da Microsoft e cai no workspace. Um mesmo binário atende
múltiplos clientes. Auto-atualiza: os updates são assinados com a chave do
atualizador (Tauri updater/minisign) e verificados antes de aplicar. Assinatura
de código do instalador (Authenticode, via SignPath Foundation) está em adoção,
ainda não operacional.

O dado vem de **três caminhos**: Microsoft Graph delegado (`/me`, sem IMAP) nas
contas M365, Google (Drive/appData) nas contas pessoais, e o **filesystem
local** (Explorer de Arquivos).

---

## Os membros da suite

### Prontos hoje

| Membro | O que é |
|---|---|
| **Navigator** | O navegador embutido e a nave-mãe da suite: WebView2 nativo por aba (não iframe — abre Outlook/Teams/SharePoint que barram frame), sleeping tabs, command palette, favoritos, importação de bookmarks, histórico, modo privado, restauro de sessão. `browser.rs` |
| **Bridge** | O PIM completo via Graph delegado: **e-mail** (4 painéis, CRUD, caixas compartilhadas, salvar `.eml`/PDF), **Agenda** (eventos, recorrência, RSVP, calendários compartilhados) e **People** (contatos M365, categorias, grupos, organizações, enriquecimento). `screens/control-room.tsx` |
| **Files** (Explorer) | Gerenciador de arquivos local: árvore This PC / Cloud / Network, copy/move com engine paralela e progresso, undo por journal, previews, watcher. Backend Rust `fs_explorer.rs` |
| **OneDrive / Sites** | Mapeia as bibliotecas e pastas compartilhadas do SharePoint: **Conectar/Desconectar** liga/desliga um atalho no OneDrive do usuário (`/me/drive/root/children`), que o cliente nativo do OneDrive sincroniza para a máquina; **Abrir no Explorer**; liga `LongPathsEnabled` via UAC. `screens/sites.tsx`, `graph.rs` |
| **Remote** | Acesso remoto assistido: captura de tela, input, transporte WebRTC/str0m, vídeo H.264, agente SYSTEM, identidade de device Ed25519. Feature `remote` — **shipada nos releases oficiais**. Crates em `services/remote-*`; relay em `infra/remote/` |
| **Previews** | Preview de anexos (PDF/TXT/docx/xlsx/pptx) dentro do app, com sandbox de segurança |
| **Telemetria** | Diagnóstico/observabilidade privacy-first (TelemetryPolicy em Rust → OpenObserve self-host; consent por categoria, PII-scrubbed) |

Contas: além do M365 (Graph), o app também loga em **conta Microsoft pessoal** e
**Google** (provider `google`, épico #692 — nuvem via Drive/appData). Recursos
que dependem de org (SharePoint/`/sites`) ficam gateados por provider.

### A caminho

| Membro | Estado |
|---|---|
| **Astro** — a IA da suite | Em construção. A visão é uma IA que automatiza o trabalho, com destaque para **assistir reuniões do Teams**. Hoje é uma tela reservada (placeholder oculto por flag); não há código de IA no app ainda. Discovery em `docs/astro/` |
| **The GALAXIE Platform** — gestão corporativa do M365 | Backend de autorização em construção (`platform.thegalaxie.cloud`, épico #1265): onboarding corporativo, concessões, admin de org, back-office. Crates em `services/platform-*`; SPA web em `web/` (em fatias). Em paralelo, o app já traz um painel fino de org-admin (settings/branding/subscription do tenant) |

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

> O membro **Remote** só entra no binário com a feature Cargo `remote`
> (`pnpm tauri build --features remote`) — é o que os releases oficiais usam. Um
> build local padrão traz o Remote como stub e a UI degrada com gentileza.

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
                        e do backend platform.thegalaxie.cloud (platform-*)
infra/                  stacks de infra: relay do Remote (coturn), OpenObserve, traefik
web/                    SPA do platform.thegalaxie.cloud (em construção, épico #1265)
```

Docs em [`docs/`](docs/), **escopados por área** (ver o índice [`docs/README.md`](docs/README.md)):
membros em `bridge/`, `navigator/`, `explorer/`, `remote/`, `astro/` (Galaxie AI);
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

O roadmap vive no board (GitHub Projects) — ver `AGENTS.md` §2. As frentes
maiores em aberto: **Astro** (a IA da suite — créditos de IA + meeting-assistant
de Teams, discovery em `docs/astro/`) e **The GALAXIE Platform** (gestão
corporativa do M365 em `platform.thegalaxie.cloud`, épico #1265).
