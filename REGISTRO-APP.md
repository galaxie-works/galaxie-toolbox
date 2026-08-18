# Registro do app no Entra ID — GALAXIE Toolbox

O Toolbox faz login **delegado**: cada pessoa entra com a própria conta, na
página oficial da Microsoft. Isso exige um registro do tipo
**public client / desktop** (sem secret — o PKCE é que protege o fluxo).

## Passo a passo no portal

1. Acesse **https://entra.microsoft.com** → **Identity** → **App registrations**
   → **New registration**.
2. **Name:** `GALAXIE Toolbox`
3. **Supported account types:**
   - Para atender **um único cliente**: *Accounts in this organizational directory only*.
   - Para atender **vários clientes** (o caso do Toolbox): **Accounts in any
     organizational directory (Any Microsoft Entra ID tenant — Multitenant)**.
4. **Redirect URI:** plataforma **Mobile and desktop applications**, e adicione
   exatamente:

   ```
   http://localhost
   ```

   > O app usa loopback com porta dinâmica (`http://localhost:PORTA`). Para
   > public clients, registrar `http://localhost` (sem porta) cobre qualquer porta.

5. **Register.**

## Permissões (API permissions)

**Add a permission → Microsoft Graph → Delegated permissions.**

⚠️ **Não use uma lista fixa aqui.** A tabela de 4 permissões que ficava neste
runbook cobria só o app antigo (atalho no OneDrive) e deixaria Bridge, Agenda,
People e Tarefas sem escopo. A fonte é o `src-tauri/src/config.rs`:

| Const | O que é | Consentimento |
|---|---|---|
| **`SCOPES_BASE`** (`config.rs:113`) | mínimo que **toda** conta pede — mail, agenda, tarefas, arquivos, pessoas, contatos | **user-consentable** (conta pessoal/Google também consegue) |
| **`SCOPES_ORG`** (`config.rs:120`) | caixas compartilhadas, diretório, sites, branding, OrgSettings | **exige admin consent**; só entra em conta **org contratada** |

`scopes_para(tenant)` (`config.rs:143`) compõe: **BASE** no caminho comum
(pessoal), **BASE + ORG** na org. A lista legível dos dois conjuntos está em
[`docs/reference/graph-scopes.md`](docs/reference/graph-scopes.md#requisitados-hoje).

Registre **todas** as do `SCOPES_BASE` + `SCOPES_ORG` e clique em **Grant admin
consent** (evita que cada usuário veja a tela de consentimento).

> ⚠️ **Escopo novo vai na const certa.** User-consentable → `SCOPES_BASE`;
> exige admin → `SCOPES_ORG`. Pôr um escopo ORG no BASE **quebra o login de conta
> pessoal**, que não consegue consentir aquilo.

> `User.Read` já cobre a foto do próprio usuário (`/me/photo`). Só precisaria de
> `User.ReadBasic.All` para ler a foto **de outras pessoas** — não é o caso.

## Segundo provider — Google (Drive/Gmail)

O app é multi-provider (#696/#697). Além do registro Microsoft acima, a conta
Google tem **registro próprio**, no Google Cloud Console:

1. **APIs & Services → Credentials → Create credentials → OAuth client ID.**
2. Tipo **Desktop app** (o app usa loopback + PKCE, igual ao MS).
3. Habilite as APIs que os escopos exigem (Drive, Gmail, Calendar, People).
4. Os escopos pedidos estão em **`GOOGLE_SCOPES`** (`src-tauri/src/config.rs:58`)
   — conferir lá, mesma regra de não duplicar lista em doc.
5. **Client secret:** o fluxo Desktop do Google emite um secret, mas ele **não é
   segredo** num app instalado — é público por construção. O app segue sendo
   public client + PKCE; não tratar esse valor como credencial protegida.

> O `client_id` de cada provider é config de build, não de tenant do cliente —
> o onboarding de cliente novo (abaixo) não repete este passo.

## Configuração adicional

- Em **Authentication**, confirme **Allow public client flows** = **Yes**
  (necessário para PKCE/loopback sem secret).
- **Não** crie client secret nem certificado — public client não usa.

## Plugando no app

Da tela **Overview**, copie o **Application (client) ID** e coloque em
`src-tauri/src/config.rs`:

```rust
pub const CLIENT_ID: &str = "<application-client-id>";
```

Para testar sem recompilar, dá para sobrescrever por variável de ambiente.
O nome primário é `GALAXIE_CLIENT_ID`; `VOAZ_CLIENT_ID` continua aceito como
**alias legado** (`src-tauri/src/config.rs:160-161`):

```powershell
$env:GALAXIE_CLIENT_ID = "<application-client-id>"
pnpm tauri dev
```

**O tenant não é configurado.** O app descobre sozinho, pelo domínio do e-mail
que a pessoa digita, consultando o documento OIDC público
(`.well-known/openid-configuration`). É isso que permite atender vários clientes
com o mesmo binário.

## Onboarding de um cliente novo

1. O registro precisa estar como **multitenant** (passo 3).
2. Um administrador do cliente faz o primeiro login — ou acessa o link de consent
   — e aprova as permissões **uma vez** para a organização.
3. A partir daí qualquer usuário daquele tenant entra normalmente.

## Segurança

- Public client **não guarda segredo**; o `CLIENT_ID` é público por natureza.
- O app **nunca vê a senha nem o MFA** — quem coleta é a página da Microsoft.
- O refresh token fica cifrado com **DPAPI** em
  `%LOCALAPPDATA%\GALAXIE\sessao.bin` (chave derivada do usuário do
  Windows). **Sair** apaga o arquivo.
