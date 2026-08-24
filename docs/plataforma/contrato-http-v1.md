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
| `409` | `conflito` | conflito **dentro da própria org** (ex.: reivindicar 2× o mesmo domínio na MESMA org). Nunca cross-tenant — ver §4.3 |

> `404` vs `403`: cross-tenant é **sempre** `404` (não enumerar). `403` só quando o recurso é
> comprovadamente da própria org do principal e o que falta é **papel** (member tentando ação de admin).

---

## 4. Rotas

Prefixo: `/api/v1`. Toda rota (exceto as de sessão) exige sessão viva (senão `401`). Toda decisão
passa por `autorizar`/`autorizar_acao_admin` (invariante 5). Escopo vem da sessão (invariante 6).

### 4.1 Sessão — `#1469`/`platform-web`
| Método | Rota | Muta? | Sucesso | Erros | Notas |
|---|---|---|---|---|---|
| `POST` | `/session` | sim | `204` + `Set-Cookie` | `401` | login: shape depende do MODELO DE AUTH — **decisão pendente** (§2). `emitir_sessao` (id fresco = rotação). |
| `DELETE` | `/session` | sim | `204` + `Set-Cookie` expurgo | — | logout **idempotente e NÃO-autenticado**: sempre `204`+expurgo, com ou sem sessão. *Exigir sessão vazaria a validade do cookie (Altair).* Se havia sessão, `invalidar` no servidor. |

### 4.2 Conta própria (`/me`) — `#1473`/`platform-conta` (shapes do @Castor, medidas no FE)
| Método | Rota | Muta? | Sucesso (shape) | Erros |
|---|---|---|---|---|
| `GET` | `/me` | não | `200` `{ nome, email, idioma? }` | `401` |
| `PATCH` | `/me` | sim | `200` Perfil `{ nome, email, idioma? }` | `401`,`400` |
| `GET` | `/me/assinatura` | não | `200` `{ plano, status: "ativa"\|"inadimplente"\|"cancelada"\|"nenhuma", consumo?: { usado, limite\|null, unidade } }` | `401` |
| `GET` | `/me/dispositivos` | não | `200` `[{ id, nome, ultimoAcesso: ISO-8601, sessaoAtual: bool }]` | `401` |
| `DELETE` | `/me/dispositivos/{id}` | sim | `204` | `401`,`404` (dispositivo de outro ⇒ `404`, inv. 1) |

`/me` **não** aceita id de usuário na URL — o "eu" é a sessão (inv. 6). `/usuarios/{id}` não existe
de propósito (seria enumeração).

### 4.3 Admin da org — `#1475`/`platform-org-admin` (mapeia `AcaoAdminOrg`)
Sob `/orgs/{org}`; `{org}` é conferido contra a sessão via `autorizar_acao_admin` (org alheia ⇒
`404`; própria org sem papel `org_admin` ⇒ `403`).

| Método | Rota | Muta? | `AcaoAdminOrg` | Sucesso |
|---|---|---|---|---|
| `GET` | `/orgs/{org}/membros` | não | `ListarMembros` | `200` `[{ uid, nome, email, papel }]` |
| `POST` | `/orgs/{org}/membros` | sim | `ConvidarMembro` | `201` |
| `DELETE` | `/orgs/{org}/membros/{uid}` | sim | `RemoverMembro` | `204` |
| `PATCH` | `/orgs/{org}/membros/{uid}` | sim | `MudarPapelMembro` | `200` |
| `POST` | `/orgs/{org}/dominios` | sim | `ReivindicarDominio` | `201` pendente |
| `POST` | `/orgs/{org}/dominios/{dom}/verificacao` | sim | `VerificarDominio` | `200` \| `422` (DNS não confere) |
| `PATCH` | `/orgs/{org}/settings` | sim | `EditarSettings` | `200` |
| `PUT` | `/orgs/{org}/assinatura` | sim | `GerirAssinatura` | `200` |

> **⚠️ Reivindicar domínio NÃO devolve `409` cross-tenant (fix do @Altair — era um ORÁCULO):** se a
> org A pede `acme.com` e leva `409` porque a org B reivindicou, A **descobre que a Acme é cliente** —
> exatamente o que o invariante 1 proíbe. Então **reivindicar é livre e fica PENDENTE** (`201`), e a
> guarda real é a **verificação** (quem não controla o DNS nunca passa; dois pendentes, um só verifica).
> `409` só existe **dentro da própria org** (reivindicar o mesmo domínio 2×) — aí não vaza nada alheio.

### 4.4 Config do app — `#1471` (fix @Castor: é **user-scoped**, não org)
O #1471 é "prefs **owner-scoped**" e o FE já usa `/me/config` **data-driven** (a allowlist é do BE; a
UI só renderiza o que vier). Corrigido de `/orgs/{org}/config` para:

| Método | Rota | Muta? | Sucesso (shape) | Erros |
|---|---|---|---|---|
| `GET` | `/me/config` | não | `200` `[{ chave, valor: bool\|string, tipo: "bool"\|"texto"\|"opcao", opcoes?: string[], rotulo?: {"pt-BR","en"} }]` | `401` |
| `PATCH` | `/me/config` | sim | `200` mesmo shape | `401`, `400` (chave fora da allowlist ⇒ recusa) |

> Crate de config ainda não landou; a rota entra agora (desbloqueia FE) e a borda a liga quando o
> crate expuser a operação.

### 4.5 Back-office (staff) — `#1474` (`Operacao::ProvisionarOrg`, staff-only)
Toda rota aqui é **auditada** (invariante 4): registra `staff_id` + ação + alvo. **Provisionar e
suspender são rotas SEPARADAS (fix do @Altair):** colapsá-las tornaria a auditoria dependente de
payload, e **suspender é a operação mais destrutiva do produto** — merece a sua própria linha e log.
| Método | Rota | Muta? | Sucesso | Notas |
|---|---|---|---|---|
| `GET` | `/admin/orgs` | não | `200` | só staff; não-staff ⇒ `404` (não revela o back-office) |
| `POST` | `/admin/orgs/{org}/provisionamento` | sim | `202` | provisiona; auditado |
| `POST` | `/admin/orgs/{org}/suspensao` | sim | `202` | **suspende (destrutivo); auditado à parte** |

> Não-staff recebe **`404`** em todo `/admin/*` (invariante 1: back-office não se anuncia a cliente).

> **Escopo dos testes de `contrato.rs` (nota do @Altair — não sobrevender):** os testes amarram
> estruturalmente só os invariantes **3** (GET nunca muta) e **4** (staff auditado), que são
> propriedades da TABELA. Os invariantes **1, 2, 5, 6** são comportamentais — vivem na borda (#1505)
> e são provados **lá**, não aqui. Não leia "6 testes" como "6 invariantes guardados".

---

## 5. Versionamento

`v1` é este documento + `platform-web/src/contrato.rs`. Mudança incompatível ⇒ `/api/v2` + nova
tabela; o FE fixa a versão. Adição compatível (rota nova) ⇒ append, sem bump.

**Aberto (fora deste card, sinalizado):** o **auth M365-web** (OAuth que resolve o principal no
`POST /session`) não tem card — a rota de login está especificada, mas o servidor (#1505) precisa
desse upstream pra preencher o principal.
