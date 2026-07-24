# GALAXIE Toolbox

Aplicativo desktop que dá aos usuários de um cliente acesso simples aos arquivos
da empresa no SharePoint — e serve de base para ferramentas de auto-ajuda do
Microsoft 365.

A pessoa entra com o e-mail corporativo, o app descobre o tenant, ela faz login
na página oficial da Microsoft e vê as bibliotecas a que tem acesso. Um clique
em **Conectar** cria o atalho no OneDrive dela; a partir daí os arquivos
aparecem no Explorer, sem ocupar espaço até serem abertos.

Feito pela [Galaxie Works](https://galaxie.works) para atender múltiplos
clientes a partir do mesmo binário.

---

## O que faz hoje

| Recurso | Descrição |
|---|---|
| **Login por e-mail** | Detecta o tenant pelo domínio (documento OIDC público) e abre o login oficial da Microsoft já preenchido |
| **Sessão persistente** | Reabre logado, sem passar pelo navegador |
| **Lista de bibliotecas** | Mostra os sites do SharePoint que aquele usuário enxerga |
| **Conectar / Desconectar** | Cria e remove o atalho no OneDrive do usuário |
| **Abrir no Explorer** | Abre a pasta local certa, mesmo com vários OneDrive na máquina |
| **Caminhos longos** | Liga `LongPathsEnabled` (>260 caracteres) via UAC |

## Como funciona a autenticação

Fluxo **Authorization Code + PKCE** com redirect de loopback. O app **nunca vê a
senha**: quem coleta credenciais e MFA é a página da Microsoft, no navegador
padrão. O que volta para o app é um authorization code, trocado por tokens.

O **refresh token** é gravado em `%LOCALAPPDATA%\GALAXIE Toolbox\sessao.bin`,
cifrado com **DPAPI** — a mesma abordagem do MSAL no Windows. A chave deriva da
credencial do usuário do Windows: outro usuário da máquina não decifra, e o
arquivo copiado para outro computador é inútil.

> **Por que não o Cofre de Credenciais:** ele limita o blob a 2560 bytes e o
> Windows guarda em UTF-16 (2 bytes/char). O refresh token da Microsoft passa de
> 1500 caracteres → ~3150 bytes → estoura o limite. Pior: a API respondia
> "gravado com sucesso" e descartava em silêncio.

O `CLIENT_ID` em `src-tauri/src/config.rs` é público por natureza — aplicações
*public client* não têm secret, e o PKCE é o que protege o fluxo.

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
  components/ui/        componentes shadcn
  screens/              login e lista de bibliotecas
  lib/api.ts            ponte para o backend (mock fora do Tauri)
src-tauri/src/
  auth.rs               PKCE, tenant, sessão (DPAPI), foto do perfil
  graph.rs              Microsoft Graph: sites e atalhos
  system.rs             registro do Windows e Explorer
  estado.rs             registro local dos atalhos criados
  config.rs             CLIENT_ID e endpoints
```

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

Ferramentas de diagnóstico e auto-ajuda do OneDrive: reset e reinício do
cliente, limpeza de cache, verificação de nomes e caminhos que travam a
sincronização, e leitura de quota.
