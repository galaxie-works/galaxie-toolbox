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

**Add a permission → Microsoft Graph → Delegated permissions**:

| Permissão         | Para quê                                                    |
|-------------------|-------------------------------------------------------------|
| `User.Read`       | nome, e-mail e **foto** do usuário logado                   |
| `Files.ReadWrite` | criar e remover o atalho no OneDrive do próprio usuário     |
| `Sites.Read.All`  | descobrir e ler os sites que o usuário acessa               |
| `offline_access`  | manter a sessão (refresh token)                             |

Depois clique em **Grant admin consent** (evita que cada usuário veja a tela de
consentimento).

> `User.Read` já cobre a foto do próprio usuário (`/me/photo`). Só precisaria de
> `User.ReadBasic.All` para ler a foto **de outras pessoas** — não é o caso.

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

Para testar sem recompilar, dá para sobrescrever por variável de ambiente:

```powershell
$env:VOAZ_CLIENT_ID = "<application-client-id>"
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
  `%LOCALAPPDATA%\GALAXIE Toolbox\sessao.bin` (chave derivada do usuário do
  Windows). **Sair** apaga o arquivo.
