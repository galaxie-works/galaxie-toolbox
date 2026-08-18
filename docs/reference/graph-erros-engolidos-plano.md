# #1075 — erros engolidos no Graph: re-derivação e plano de fatias

> Medido no `feat` `1e10cf7`, **18/08/2026**. Números aqui são contexto
> perecível: re-derive por símbolo antes de codar, não confie nas linhas.

Este documento faz para o #1075 o que o `graph-consolidacao-plano.md` fez para o
#1074: re-deriva os achados no código real e corta em fatias que dá para
verificar uma a uma.

---

## 1. O que a re-derivação mudou em relação ao card

O card lista RB45, RB46 (4 pontos) e RB47. Conferido símbolo a símbolo:

| card diz | realidade em `1e10cf7` |
|---|---|
| `cr_email` (não_lidos vira 0) | **o símbolo não existe.** A lógica está em `atoms_email_de_batch` (`graph.rs:971`) — e **já está quase toda corrigida** (ver §2.1) |
| `cr_mail_folders` (pasta 0/0) | confirmado, `graph.rs:3686` |
| `cr_tarefas_inner` (403 some) | confirmado, `graph.rs:1039` — é o mais silencioso dos quatro |
| `cr_salvar_contatos` (assume duplicata) | confirmado, `graph.rs:8448` |
| RB47 `contains("403")` | **vivo**, mas não com esse texto — ver §2.5 |
| `enum ErroGraph` | não existe, a criar |

⚠️ **Duas armadilhas de medição** que já custaram tempo nesta série:

1. `grep 'contains("403")'` devolve **zero** e faz o RB47 parecer resolvido. O
   código real é `contains("(403)") || contains(" 403") || contains("403 ")`.
2. `grep 'fn cr_email'` casa `cr_email_corpo` e `cr_email_seguranca`, que são
   funções vivas e sem relação com o achado.

---

## 2. O defeito é UM, com cinco caras

Os três RBs parecem três assuntos. Não são. Em todos os cinco pontos o tipo
usado **não consegue representar "não sei"** — e, sem esse estado, a camada de
cima é obrigada a inventar um significado para o buraco. O significado que ela
inventa é sempre o mesmo: *"então está tudo bem"*.

> **A informação do erro é destruída no ponto de captura, e a UI apresenta a
> ausência como fato.**

É a mesma família do #1017 e da decisão da F7 do #1074 (ID inválido que sumia em
silêncio). Vale enunciar assim porque muda o critério de pronto: não basta
propagar `Err` — o tipo tem que **ter** o estado intermediário.

### 2.1 `atoms_email_de_batch` — em grande parte JÁ corrigido

`graph.rs:975-990`. Contra o que o card descreve, hoje existem duas guardas:

```rust
if !leitura_status_ok(status) {
    return Err(format!("sub-resposta naoLidos: status {status}"));
}
...
if !viu_nao_lidos {
    return Err("resposta do $batch sem a sub-resposta naoLidos".to_string());
}
```

Sub-resposta ausente e status não-200 **já viram `Err`** (a segunda guarda veio
com o #1163; a primeira, com a F6 do #1074). O que sobra é estreito:
`unwrap_or(0)` num corpo 200 sem `unreadItemCount`.

**Consequência de escopo:** este ponto é o MENOR da lista, não um dos maiores.
Fatiar por ele primeiro seria otimizar o já resolvido.

### 2.2 `cr_mail_folders` — `bool` para três estados

`graph.rs:3734-3750`. Duas rotas de falha caem no mesmo lugar:

```rust
Ok(resp) => { acesso_negado = resp.status().as_u16() == 403; log::warn!(...); }
Err(e)   => { log::warn!("[mail] pasta '{id}' falhou: {e}"); }
// e em AMBAS a pasta é empurrada com:
pastas.push(PastaEmail { nao_lidos: 0, total: 0, acesso_negado, ... });
```

- 500/429 → `acesso_negado = false`, pasta com 0/0 → **igual a pasta vazia**.
- falha de transporte → idem, e nem o 403 é registrado.

`acesso_negado: bool` tem dois estados para uma realidade de três: **ok**,
**negado**, **não sei**. O terceiro não existe, então vira o primeiro.

### 2.3 `cr_tarefas_inner` — o erro não tem representação nenhuma

`graph.rs:1072-1096`. Quatro níveis de `if let Ok` / `is_success()` **sem um
único `else`**:

```rust
if let Ok(r) = graph_enviar(...) {
    if r.status().is_success() {
        if let Ok(vt) = r.json::<serde_json::Value>() {
            if let Some(items) = vt["value"].as_array() {
```

403 numa lista, falha de transporte e corpo ilegível produzem **exatamente o
mesmo resultado**: a lista contribui zero tarefas e a agregação parece completa.
É o ponto mais silencioso dos quatro — aqui o erro nem chega a virar valor
neutro, ele simplesmente não é observado.

### 2.4 `cr_salvar_contatos` — falha de checagem vira "já existe"

`graph.rs:8448+`. Ao consultar duplicata:

```rust
Ok(resp) => { /* Nao da pra ter certeza: pula para nao arriscar duplicar. */ }
Err(e)   => { /* idem */ }
...
if existe { continue; }
```

A intenção é defensável (não duplicar). O defeito é o **canal**: a função
devolve `Result<u64, String>` — só quantos foram salvos. Não há onde dizer
"pulei M porque não consegui checar". O usuário pediu N contatos, vê "salvei
N−M" e nada explica o M.

### 2.5 `eh_erro_permissao` — status reconstruído por substring

`graph.rs:4324`:

```rust
fn eh_erro_permissao(erro: &str) -> bool {
    erro.contains("(403)") || erro.contains(" 403") || erro.contains("403 ")
}
```

Três consumidores decidem **abortar o lote inteiro** com isso —
`graph.rs:4387` (`cr_excluir_emails`), `4415` (`cr_mover_emails`) e `8727`.

O `StatusCode` existia em `deletar_msg`/`mover_msg` (`graph.rs:4272`/`4331`) e
foi jogado fora ao formatar a mensagem; aqui ele é **adivinhado de volta** a
partir do texto. Uma falha de transporte cuja mensagem contenha "403" por
coincidência (um id, um timestamp, uma porta) aborta o lote.

### 2.6 `org_settings_get` — 404 conflado com erro real

`graph.rs:6009-6026`. `OrgGetOutcome` tem `Ok` / `Forbidden` / `Error`, e:

```rust
Ok(_)  => OrgGetOutcome::Error,   // 404 cai aqui
Err(_) => OrgGetOutcome::Error,   // transporte cai aqui também
```

"O endpoint beta não existe neste tenant" e "a rede caiu" são o mesmo card
vermelho. Falta o quarto estado: **indisponível**.

O caminho de ESCRITA do mesmo card é código morto atrás de
`TODO_RW_HABILITADO = false` (`src/components/organization-settings.tsx:83`),
com 4 camadas vivas (Rust → comando → wrapper TS → UI).

---

## 3. Plano de fatias

Ordem por **valor e independência**, não pela numeração dos RBs. Cada fatia sai
em PR própria com teste que reproduz o defeito ANTES e passa DEPOIS.

| # | Fatia | Achado | Por que nesta ordem |
|---|---|---|---|
| **F1** | `enum ErroGraph { Permissao, NaoEncontrado, Outro(StatusCode), Transporte(String) }`; `deletar_msg`/`mover_msg` param de formatar em texto; `eh_erro_permissao` some | RB47 | É a **fundação tipada** que o DoD pede. As outras fatias passam a ter um vocabulário de erro para usar |
| **F2** | `cr_tarefas_inner`: lista com erro entra sinalizada na agregação | RB46-c | Maior silêncio, correção mais contida |
| **F3** | `cr_mail_folders`: `acesso_negado: bool` → estado de 3 | RB46-b | Muda contrato para a UI — vale isolar |
| **F4** | `cr_salvar_contatos`: retorno com contagem de falhas, no formato de `SalvarEmailResultado` | RB46-d | Muda assinatura pública |
| **F5** | `org_settings_get`: 404 vira estado próprio | RB45 (leitura) | Independente das outras |
| **F6** | `atoms_email_de_batch`: o `unwrap_or(0)` restante | RB46-a | Menor de todos (§2.1) |
| **F7** | Decisão `/admin/todo`: ativar ou remover as 4 camadas | RB45 (escrita) | **Não é minha** — pede live-QA com conta admin, é decisão do PO |

### Nota de sequenciamento

F1 é pré-requisito **conceitual** das outras, não textual: F2–F6 mexem em
funções diferentes e poderiam sair em paralelo. Mas todas editam `graph.rs`,
então na prática vão **empilhadas**, como as 7 fatias do #1074 — e cada uma
rebasada na base atual antes do push (`git diff --stat origin/<base> HEAD`).

### O que NÃO fazer

Trocar `unwrap_or(0)` por `?` em varredura. Metade dos `unwrap_or` do arquivo
são defaults legítimos (campo opcional do Graph). O alvo é **onde a ausência
vira afirmação para o usuário** — os cinco pontos de §2, enumerados por
invariante, não por padrão textual.
