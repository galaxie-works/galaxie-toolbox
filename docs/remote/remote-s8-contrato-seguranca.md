# Remote S8 — Contrato de segurança do não-supervisionado (DECISÃO)

> **Status:** **DECIDIDO** — @Altair (architect), 2026-08-15, a pedido do @Polaris.
> Incorpora ao `remote-net` os padrões que o spike do RASystem (#943/#944) mandou
> "roubar": **grants, capability-por-mensagem, consent-first, audit encadeado**.
> Destrava os passos S8-facing do S7 (#690) e o daemon do #691. **Doc-only** — a
> implementação é da raia do @Confucius; aqui está o contrato e o porquê.
> Frame do Wagner intacto: str0m + coturn, Windows-first, RASystem não adotado.

## 1. O que JÁ existe (não re-desenhar)

O `remote-net` v2 não é folha em branco — antes de pedir padrão novo, o que ele já faz:

| Propriedade | Onde | Estado |
|---|---|---|
| Token de sessão assinado, com capabilities | `ticket.rs:13-25` (`TicketClaims`) | **Ed25519 + domain separation** (`DOMAIN = "…/session-ticket\0"`) |
| TTL curto | `authority.rs:20` | **60 s** |
| Uso único (anti-replay) | `TicketVerifier::verify_and_consume` + `consumed_tickets` no snapshot | **pronto** |
| Autenticação do controlador | `opaque.rs` (OPAQUE) + `authority.rs:338-455` | **pronto** (senha permanente nunca trafega) |
| Identidade do device | `identity.rs` (Ed25519) + `windows_secret.rs` (DPAPI-NG) | **pronto** |
| Teto de capability por device | `DeviceRecord.capabilities` + `AuthorityError::Capabilities` | **pronto (no servidor)** |
| Revogação | `revoke_device` + `session.revoke` (`protocol.rs:45`) | **pronto** |
| Auditoria | `AuditRecord` (`authority.rs:62-71`), persistida no snapshot | **lista plana, sem encadeamento** |
| Consentimento | `session.accept/reject` existem no protocolo (`protocol.rs:41-43`) | **sem política do lado do device** |

**Conclusão que orienta tudo abaixo:** dos 4 padrões pedidos, **um já está resolvido
por equivalente** (grants ⊂ tickets assinados) e **três são lacunas reais**
(enforcement por mensagem, consentimento, audit à prova de adulteração).

## 2. C1 — PASETO: **não adotar o formato.** Adotar o conceito de *grant*.

**Decisão: nada de `rusty_paseto`.** O nosso ticket já é, na prática, um PASETO
v4.public artesanal: **mesma primitiva** (Ed25519), **domain separation** explícita
(o que o PASETO chama de implicit assertion), payload tipado com
`deny_unknown_fields`, TTL e uso único. Trocar o formato custaria uma dependência
de cripto nova e uma migração de wire **por zero ganho de segurança** — e contraria
frontalmente o D1/D1-bis do S7, que acabou de cortar a superfície do binário SYSTEM.

**O que o RASystem tem e nós NÃO temos é o *grant*, não o PASETO:** hoje **toda**
sessão exige um round-trip OPAQUE completo (senha permanente do controlador). Não
existe autorização *permanente e revogável* de um controlador para um device — que é
exatamente o que o #691 promete ("senha permanente + address book") e o que um
operador espera ao reconectar 20 vezes por dia.

**Contrato do grant** (segundo token Ed25519 no mesmo `ticket.rs`, **domínio
diferente** — nunca reusar o domínio do ticket):

```rust
// DOMAIN: b"Galaxie.Remote.Net.v2/access-grant\0"
pub struct GrantClaims {
    pub jti: String,              // revogável por id
    pub device_id: String,
    pub controller_id: String,
    pub owner_id: String,
    pub org_id: String,
    pub capabilities: Capabilities, // ⊆ política do device
    pub issued_at: u64,
    pub expires_at: u64,          // horas/dias, não 60 s
    pub consent_mode: ConsentMode, // ver C3
}
```

Regras duras:
- **Grant não abre sessão.** Ele só autoriza **emitir um ticket** de 60 s/uso único.
  A cadeia é `grant (longo, revogável) → ticket (60 s, uso único) → sessão`. Assim o
  vazamento de um grant não dá acesso imediato: ainda passa pelo servidor, que checa
  revogação, política e consentimento.
- **Capabilities do grant são um teto**, cortado pelo teto do device
  (`DeviceRecord.capabilities`) — o mínimo dos dois vence, sempre.
- **Revogação por `jti`** (mesma mecânica do `consumed_tickets`), com propagação em
  **≤ 30 s** no device conectado (o heartbeat é de 30 s, `worker.rs:19`) e
  `session.revoke` matando sessão em curso.
- Métodos novos **aditivos**: `grant.issue`, `grant.list`, `grant.revoke`.

## 3. C2 — Capability-por-mensagem: **sim, e no plano de dados** (não é token por mensagem)

Hoje a checagem de capability acontece **no início da sessão**. O plano de controle
(DataChannel) já carrega input, e vai carregar clipboard/file-transfer (#688) e áudio
(#689). O `remote.rs` só checa `capabilities.input` no caminho de input
(`remote.rs:797-810`) — o resto do `handle_control` (`:783-795`) é permissivo por
construção: `ControlFrame::Control(_) | ControlFrame::Chunk { .. } => {}` **ignora em
silêncio**. Quando esses frames ganharem semântica, eles entram **sem porteiro**.

**Decisão — "capability-por-mensagem" pra nós significa: um único choke point com
default-deny no decodificador de controle**, não um token assinado por mensagem
(que custaria uma verificação Ed25519 por evento de mouse — inaceitável no hot-path).

```rust
fn autorizar(&self, frame: &ControlFrame) -> Result<(), RemoteError>  // fail-closed
```
- Toda variante **nova** de frame precisa declarar qual capability exige; variante
  não mapeada = **recusa** (não `=> {}`).
- A fonte da verdade é o conjunto **derivado do ticket** (§4.3 do doc do S7), nunca
  o que o owner pediu no `session.start`.
- Recusa é **evento de auditoria** (C4), não só um `Err` silencioso — negação
  repetida é sinal de controlador comprometido.

## 4. C3 — Consent-first: política **local do device**, não só do servidor

Hoje o device aceita qualquer sessão cujo ticket verifique. Isso é frágil por um
motivo estrutural: **o servidor é o único guardião**, e um servidor comprometido (ou
com bug de autorização) vira acesso total à máquina do cliente.

**Decisão: o device carrega uma política de consentimento, provisionada junto com a
identidade (§8 do doc do #691), e ela é o teto final.**

```rust
pub enum ConsentMode { AlwaysAsk, AskWhenLoggedIn, NeverAsk }

pub struct UnattendedPolicy {
    pub allow_unattended: bool,
    pub consent: ConsentMode,        // default: AskWhenLoggedIn
    pub consent_timeout_secs: u16,   // default 30 — sem resposta = NEGA
    pub capability_ceiling: Capabilities,
    pub allowed_controllers: Option<Vec<String>>, // None = qualquer um do grant
}
```

- **`AskWhenLoggedIn` é o default** e resolve o caso que assusta o usuário final:
  ninguém entra na máquina enquanto ele está trabalhando **sem ele ver e aceitar**;
  com a máquina no logon screen (ninguém logado), o grant + ticket bastam — que é o
  ponto do não-supervisionado.
- **Timeout nega** (fail-closed), nunca aceita por inércia.
- O prompt de consentimento é do **daemon/worker** (SYSTEM), não do app do usuário:
  no secure desktop o app do usuário pode nem existir.
- **`capability_ceiling` local** corta o que veio do servidor. Defesa em profundidade:
  servidor errado/comprometido não amplia poder além do que a máquina aceita.

## 5. C4 — Auditoria encadeada: **sim, e nas duas pontas** (`sha2` já é dep)

Hoje o `AuditRecord` é lista plana no snapshot (`authority.rs:64-71`, `:124`). Quem
editar o snapshot reescreve a história sem deixar rastro.

**Decisão:**
1. **Encadear** — cada registro ganha `prev_hash` e `hash = SHA-256(serialização
   canônica ‖ prev_hash)`; a verificação do snapshot recomputa a cadeia e **falha
   fechado**. **Zero dep nova:** `sha2` já está no `Cargo.toml` do `remote-net`.
2. **Auditoria local no device**, espelhando as ações que o device observa
   (`SessionStart`/`SessionEnd`/consent aceito-negado/capability negada). Um log que
   só existe no servidor não responde a pergunta que o cliente faz — *"quem entrou na
   minha máquina?"* — e é inútil se o servidor for justamente o problema.
3. **Ações novas** no enum (`authority.rs:51-60`): `GrantIssue`, `GrantRevoke`,
   `ConsentPrompt`, `ConsentDenied`, `CapabilityDenied`.
4. Retenção: teto por device com descarte do mais antigo, **mantendo o
   encadeamento** (guarda o hash do registro descartado como âncora).

## 6. Versionamento — o servidor atualiza sozinho, o device instalado não

O `PROTOCOL_VERSION` é 2 e há **allowlist de métodos** (`protocol.rs:194-203`)
verificada nas duas pontas. O S0 roda numa VPS e atualiza quando quisermos; o device
é um app **instalado no cliente**, que atualiza quando o cliente deixar.

**Decisão: métodos `grant.*` entram como ADITIVOS mantendo `v = 2`.**
- O servidor **precisa continuar funcionando com device que nunca fala `grant.*`**
  (fluxo OPAQUE por sessão continua válido — é o caminho attended de hoje).
- O device descobre o que o servidor suporta pela resposta de `device.register`
  (campo aditivo `serverFeatures: []`), lido **tolerante a campos desconhecidos** —
  mesma disciplina do §5 do doc do S7.
- Bump pra `v = 3` só quando houver **quebra real** de formato. Versão é caro:
  gate de compatibilidade, não enfeite.

## 7. O que NÃO entra (decidido, pra não voltar à mesa)

- **PASETO como formato** (C1) — custo de dep e migração por zero ganho.
- **Token assinado por mensagem** — verificação assimétrica no hot-path de input.
- **iroh** — spike separado (#945), fora deste contrato.
- **mTLS device↔S0** — o pin de certificado (`transport.rs`) + registro assinado
  Ed25519 já cobrem; certificado por device é custo de PKI sem ganho aqui.

## 8. Ordem de implementação (pro @Confucius, quando chegar no S8-facing)

1. **`GrantClaims` + emissão/verificação** em `ticket.rs` (domínio próprio) e
   `grant.issue/list/revoke` no `authority.rs` — **núcleo leve**, cabe no `default`
   do feature-gate (D1-bis): só `ed25519-dalek`/`base64`/`serde`.
2. **Audit encadeado** (`prev_hash`/`hash` + verificação do snapshot + ações novas).
3. **`UnattendedPolicy` + prompt de consentimento** no daemon/worker (#691), com o
   `capability_ceiling` local cortando o do servidor.
4. **`autorizar(&ControlFrame)` fail-closed** no pump (S7 passo 3) — antes de
   #688/#689 chegarem, senão nascem sem porteiro.
5. `serverFeatures` aditivo no `device.register`.

**Dependência de ordem:** o item 4 é o único que precisa entrar **antes** de
clipboard/file-transfer/áudio; os outros podem vir junto do daemon do #691.

## 9. O que fica pro Wagner (PO)

1. **Default de consentimento:** confirmo `AskWhenLoggedIn` + timeout de 30 s
   negando? É a escolha que privilegia a confiança do cliente sobre a conveniência do
   suporte. (Recomendação do architect: **sim** — e deixar `NeverAsk` disponível só
   por política explícita da organização.)
2. **Validade default do grant** (horas? dias? até revogar?) — é produto, não técnica.
3. **Retenção da auditoria local** no device (dias/tamanho) — tem implicação de
   privacidade e de suporte.

## 10. Resumo
O `remote-net` já tinha o essencial (token assinado, TTL, uso único, OPAQUE, teto de
capability, revogação). Faltavam três coisas, e elas entram sem trocar formato nem
adicionar dependência: **grant** (autorização longa e revogável que só *mints* ticket
curto), **default-deny no decodificador de controle** (o que "capability-por-mensagem"
significa pra nós, sem cripto no hot-path) e **consentimento com política local +
auditoria encadeada nas duas pontas** (pra o servidor deixar de ser o único guardião).
PASETO fica de fora: já temos a propriedade, não o rótulo.
