# Contrato HTTP — web ↔ `platform-*` (v1)

**Épico:** #1265 · **Card:** #1503 (costura vertical 1/3) · **Autor:** Alcor (BE) · **Invariantes + revisão:** Altair.

Este é **a verdade única** que FE e BE constroem em paralelo, antes de existir servidor. As
rotas derivam do que os crates da fundação **já expõem** (medido, não inventado):
`platform-identity` (Principal/Org/Papel/Sessao/`autorizar`/`resolver_org`), `platform-conta`
(`resolver_conta_propria`, #1473), `platform-org-admin` (`AcaoAdminOrg`/`autorizar_acao_admin`,
#1475), `platform-web` (sessão: cookie/CSPRNG). O servidor que serve isto é a fatia 3/3 (#1505).

A forma-canônica das rotas e dos códigos vive **também em código** — `platform-web/src/contrato.rs`
(`CONTRATO: &[Rota]`) —, com testes dos invariantes abaixo. Este doc e aquela tabela **não podem
divergir** (há um teste que amarra os invariantes; a borda #1505 implementa contra a mesma tabela).

---

## 1. Invariantes (as 6 condições do Altair — NORMATIVAS, valem em toda rota)

1. **404 idêntico no fio.** "Não existe" e "existe mas não é tua" devem ser **indistinguíveis**:
   mesmo status (`404`), mesmo corpo, mesmos headers, mesma latência. Nunca `403` para recurso de
   outro tenant — `403` já confirma a existência. *(fonte: `resolver_org`/`AdminErro::NaoEncontrada`.)*
2. **`dono_do_recurso` vem do recurso persistido / da sessão, NUNCA do request.** Nenhuma rota lê
   dono/org/escopo de corpo, query ou header. Um id na URL é **conferido contra a sessão**, não confiado.
   *Teste obrigatório na borda: dono forjado ⇒ 404.*
3. **Operação que muda estado nunca é `GET`.** Com `SameSite=Lax`, um `GET` mutante é CSRF-ável e o
   cookie não protege. Mutação = `POST`/`PUT`/`PATCH`/`DELETE`.
4. **Leitura privilegiada de staff é auditada.** Staff pode ver/gerir qualquer org (`resolver_org`
   deixa) — toda operação de staff é registrada com **quem** a executou (sink de auditoria, #1474).
5. **Todo caminho pós-autenticação passa por `autorizar`.** Sem atalho, sem rota que toque o armazém
   direto sem decisão de autorização.
6. **Escopo e principal vêm da SESSÃO** (cookie `__Host-gx_sess` → `validar` → `Sessao`), nunca do
   payload. A borda é o último lugar onde isto pode ser furado.

---

## 2. Sessão e autenticação

- A sessão é o cookie **`__Host-gx_sess`** (`HttpOnly; Secure; SameSite=Lax; Path=/`, sem `Domain`).
  O SPA **nunca** lê o valor. Ver `platform-identity::sessao` + `platform-web`.
- **Sem cookie / cookie inválido / sessão revogada ⇒ `401`** em qualquer rota autenticada.
- **Dois cookies `__Host-gx_sess` ⇒ `401`** (recusa por shadowing — `sessao_id_do_cookie` é exatamente-um).
- A resolução do **principal** no login (OAuth M365-web) é **upstream** e ainda não tem card — quando
  existir, alimenta `emitir_sessao`. As rotas de sessão abaixo assumem o principal já resolvido.

---

## 3. Formato de erro (uniforme, mas o 404 não vaza a razão)

Corpo de erro: `application/json`
```json
{ "erro": "<codigo>" }
```
`<codigo>` ∈ `{ "nao_autenticado", "nao_encontrado", "negado", "payload_invalido", "conflito" }`.

**Regra do 404 (invariante 1):** para `nao_encontrado`, corpo e headers são **byte-a-byte iguais**
quer o recurso não exista, quer exista e não seja do solicitante. A razão **nunca** aparece.

| Código HTTP | `erro` | Quando |
|---|---|---|
| `401` | `nao_autenticado` | sem sessão viva (invariante 6) |
| `404` | `nao_encontrado` | recurso inexistente **ou** de outro tenant (invariante 1) |
| `403` | `negado` | recurso **visível** (própria org), mas papel insuficiente (`AdminErro::Negado`) |
| `400` | `payload_invalido` | corpo malformado / campo faltando |
| `409` | `conflito` | ex.: domínio já reivindicado |

> `404` vs `403`: cross-tenant é **sempre** `404` (não enumerar). `403` só quando o recurso é
> comprovadamente da própria org do principal e o que falta é **papel** (member tentando ação de admin).

---

## 4. Rotas

Prefixo: `/api/v1`. Toda rota (exceto as de sessão) exige sessão viva (senão `401`). Toda decisão
passa por `autorizar`/`autorizar_acao_admin` (invariante 5). Escopo vem da sessão (invariante 6).

### 4.1 Sessão — `#1469`/`platform-web`
| Método | Rota | Muta? | Sucesso | Erros | Notas |
|---|---|---|---|---|---|
| `POST` | `/session` | sim | `204` + `Set-Cookie` | `401` | login: principal já resolvido (upstream) → `emitir_sessao` (id fresco = rotação) |
| `DELETE` | `/session` | sim | `204` + `Set-Cookie` expurgo | — | logout: `invalidar` no servidor (fato) + expurgo |

### 4.2 Conta própria (`/me`) — `#1473`/`platform-conta`
| Método | Rota | Muta? | Sucesso | Erros | Fonte |
|---|---|---|---|---|---|
| `GET` | `/me` | não | `200` perfil próprio | `401` | `resolver_conta_propria` (escopo = sessão, invariante 6) |
| `DELETE` | `/me/recursos/{id}` | sim | `204` | `401`,`404` | `pode_revogar_recurso_proprio`; recurso de outro ⇒ `404` (inv. 1) |

`/me` **não** aceita id de usuário na URL — o "eu" é a sessão. Pedir `/usuarios/{id}` não existe de
propósito (seria enumeração).

### 4.3 Admin da org — `#1475`/`platform-org-admin` (mapeia `AcaoAdminOrg`)
Todas sob `/orgs/{org}` e todas conferem `{org}` contra a sessão via `autorizar_acao_admin`
(org alheia ⇒ `404`; própria org sem papel `org_admin` ⇒ `403`).

| Método | Rota | Muta? | `AcaoAdminOrg` | Sucesso |
|---|---|---|---|---|
| `GET` | `/orgs/{org}/membros` | não | `ListarMembros` | `200` |
| `POST` | `/orgs/{org}/membros` | sim | `ConvidarMembro` | `201` |
| `DELETE` | `/orgs/{org}/membros/{uid}` | sim | `RemoverMembro` | `204` |
| `PATCH` | `/orgs/{org}/membros/{uid}` | sim | `MudarPapelMembro` | `200` |
| `POST` | `/orgs/{org}/dominios` | sim | `ReivindicarDominio` | `201` / `409` (já reivindicado) |
| `POST` | `/orgs/{org}/dominios/{dom}/verificacao` | sim | `VerificarDominio` | `200` |
| `PATCH` | `/orgs/{org}/settings` | sim | `EditarSettings` | `200` |
| `PUT` | `/orgs/{org}/assinatura` | sim | `GerirAssinatura` | `200` |

### 4.4 Config do app — `#1471` (member basta: `Operacao::ConfigurarAppDaOrg`)
| Método | Rota | Muta? | Sucesso | Notas |
|---|---|---|---|---|
| `GET` | `/orgs/{org}/config` | não | `200` | member OU admin da própria org |
| `PATCH` | `/orgs/{org}/config` | sim | `200` | idem |

> Crate de config (#1471) ainda não landou; a rota entra no contrato agora (desbloqueia FE) e a
> borda a liga quando o crate expuser a operação.

### 4.5 Back-office (staff) — `#1474` (`Operacao::ProvisionarOrg`, staff-only)
Toda rota aqui é **auditada** (invariante 4): registra `staff_id` + ação + alvo.
| Método | Rota | Muta? | Sucesso | Notas |
|---|---|---|---|---|
| `GET` | `/admin/orgs` | não | `200` | só staff; não-staff ⇒ `404` (não revela a existência do back-office) |
| `POST` | `/admin/orgs/{org}/provisionamento` | sim | `202` | provisiona/suspende; auditado |

> Não-staff recebe **`404`** em todo `/admin/*` (invariante 1: back-office não se anuncia a cliente).

---

## 5. Versionamento

`v1` é este documento + `platform-web/src/contrato.rs`. Mudança incompatível ⇒ `/api/v2` + nova
tabela; o FE fixa a versão. Adição compatível (rota nova) ⇒ append, sem bump.

**Aberto (fora deste card, sinalizado):** o **auth M365-web** (OAuth que resolve o principal no
`POST /session`) não tem card — a rota de login está especificada, mas o servidor (#1505) precisa
desse upstream pra preencher o principal.
