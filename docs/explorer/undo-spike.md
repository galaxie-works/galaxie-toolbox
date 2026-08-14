# SPIKE — Undo de copy/move/delete no Explorer (#899)

> **Status:** spike (pesquisa/design). **Sem código de produção.**
> Alimenta a ação **"Desfazer"** do activity-dropdown do Status Center (#898).
> Sub do Explorer (#675). Cross-ref: #680 (motor copy/move), #875 (Status Center/verify),
> #850 (log/journal métrico), #555 (seam de reset), #898 (activity-dropdown).
> **Autor:** Sirius ✨ · **Raia:** Confucius (motor/journal) + Vega (preview/UX).

---

## 1. Objetivo

Mapear **o que é possível desfazer, como verificar com segurança, e o resumo a mostrar
ao usuário antes de executar** o undo de operações de arquivo já concluídas. O spike
decide **viabilidade + desenho**; a implementação é faseada (§9) e sai em stories próprias.

O undo do Explorer **não é** um `Ctrl+Z` de editor (buffer em memória). É a **reversão de
efeitos colaterais no disco**, que podem ter sido alterados por fora entre a op e o undo.
Logo a regra-mãe deste spike:

> **Undo é uma operação NOVA, verificada e revogável — nunca um "rewind" cego.**
> Só reverte o que ele mesmo consegue provar que ainda está no estado que deixou.

---

## 2. Inventário — o que o motor JÁ tem (grounding)

Este design **não inventa infra**; encaixa no que #680/#875/#850 já entregaram. Confirmado
lendo `src-tauri/src/fs_explorer.rs` + `src/components/explorer/operacao.ts` + `src/lib/types.ts`
no feat (`edae096`):

| Peça existente | Onde | Serve ao undo como… |
|---|---|---|
| `PlanoItem { from, to }` | `operacao.ts` | **a lista origem→destino já resolvida** de cada op = espinha do manifesto. |
| `ResolucaoConflito` (`substituir`/`pular`/`manterAmbos`) | `operacao.ts` | diz **se houve sobrescrita** (o divisor de reversível/parcial). |
| `Conflict { source, name, dest, isDir }` | `fs_explorer.rs` + `types.ts` | quais destinos **já existiam** antes → candidatos a "original perdido". |
| `FsOpProgress { opId, processedBytes, totalBytes, percent, status }` | `types.ts` | `opId` já **identifica a op** (chave do journal); `status` enum in-progress/success/error. |
| `VerifyAlg` (xxh3/blake3/sha256) + `Hasher` | `fs_explorer.rs` (#875 verify) | **hash já é computado no fluxo** → gravar no journal é quase de graça (§4). |
| `trash::delete_all` (Lixeira do Windows) | `fs_explorer.rs` | delete "normal" vai pra Lixeira → **restaurável** (§3). |
| Cancel remove destino parcial (`executar_progresso`) | `fs_explorer.rs` | precedente de "limpar o que a op criou" — a **mesma mecânica** do undo de cópia. |
| `FsChange` (watcher, evento `fs-change`) | `fs_explorer.rs` + `types.ts` | detecta **modificação externa** pós-op → invalida a reversibilidade (§5). |
| Log métrico START/PROGRESS/END (#850) | `fs_explorer.rs` | onde o **journal-record** pendura (mesmo ponto de emissão). |

**Conclusão do inventário:** o motor já carrega ~80% dos dados que o undo precisa. O que
**falta** é (a) persistir um **manifesto por-op** (§4), (b) um comando `fs_undo_op` que
consome o manifesto com verificação (§5/§9), e (c) a UI de resumo/confirmação (§6).

---

## 3. Matriz de reversibilidade

Legenda: ✅ reverte total · 🟡 parcial (alguns itens não) · ⛔ não-reversível (só avisa).

| Operação | Undo = | Condição p/ ✅ | Quando vira 🟡 / ⛔ |
|---|---|---|---|
| **Cópia** | apagar no destino **só o que a op criou** | nenhum item de destino modificado desde a op; nenhuma sobrescrita | sobrescreveu (`substituir`) → o original NÃO volta → 🟡 nos itens sobrescritos; item modificado desde → pula (🟡) |
| **Movimentação** | mover de volta origem→destino | caminho de origem ainda **livre**; alvo não modificado | origem reocupada → conflito (🟡); alvo modificado → pula (🟡) |
| **Renomear** | renomear de volta | nome antigo livre; item não modificado | nome antigo reocupado → 🟡 |
| **Delete → Lixeira** (`trash`) | restaurar da Lixeira | item ainda na Lixeira | esvaziada/purgada pelo SO → ⛔ |
| **Delete permanente** (Shift+Del) | — | — | **⛔ sempre** — avisar no ato ("sem desfazer") e **não** oferecer undo |
| **"Manter ambos"** (cópia c/ rename) | apagar os `(2)`/`(3)` criados | os novos nomes não modificados | igual cópia |
| **Sobrescrita** (`substituir`) | ⛔ do dado antigo | — | o conteúdo original foi perdido no disco; undo só remove o **novo**, **não ressuscita** o antigo → sempre marcar 🟡/⛔ e ser explícito no preview |

**Regra de ouro da sobrescrita:** o motor **não** faz backup do arquivo sobrescrito hoje.
Então "desfazer uma cópia que substituiu" **nunca** restaura o original — no máximo remove o
novo (deixando o caminho vazio, o que pode ser *pior*). **Decisão de design:** itens com
`overwritten=true` no manifesto são marcados **não-reversíveis** e ficam **de fora** do plano
de undo por padrão (§6 os lista como "não dá pra desfazer"). *(Opção futura em §8: cópia
opcional pra `.undo-backup` — fora do escopo v1.)*

---

## 4. Modelo de journal (o manifesto por-op)

Um registro **por operação**, gravado **no END** de cada op mutante (mesmo ponto do log #850).
Persistido (não só em memória) pra sobreviver a um refresh do webview — mas **efêmero**
(TTL/limite, §7). Shape proposto (nomes camelCase p/ casar com `types.ts`):

```jsonc
// OperationJournalEntry — 1 por op mutante
{
  "opId": 4182,                 // = FsOpProgress.opId (já existe)
  "kind": "copy",              // copy | move | rename | trash | delete
  "startedAtMs": 1734200000000,
  "endedAtMs":   1734200004120,
  "status": "success",         // success | partial | error (não journalar 'error' puro)
  "resolucao": "manterAmbos",  // ResolucaoConflito da op (null p/ trash/rename)
  "items": [
    {
      "from": "C:\\a\\foto.png",       // origem (vazio p/ trash restore-by-id)
      "to":   "C:\\b\\foto (2).png",   // o que a op CRIOU no destino
      "isDir": false,
      "createdByOp": true,             // a op criou este caminho (candidato a apagar no undo)
      "overwritten": false,            // substituiu algo pré-existente? (⛔ p/ undo)
      "sizeAtEnd": 20481,              // tamanho no fim da op
      "mtimeAtEnd": 1734200004000,     // mtime no fim da op  → detecta modificação externa
      "hashAtEnd": "xxh3:9af2…",      // #875 já computa; barato gravar → verificação forte
      "hashAlg": "xxh3"
    }
  ],
  "trashRecordIds": []          // p/ kind=trash: handles do SO pra restaurar da Lixeira
}
```

**Notas de design:**
- **Barato:** `sizeAtEnd`/`mtimeAtEnd` saem de um `stat` que a op já faz; `hashAtEnd` reusa o
  `Hasher` do verify (#875) — se o verify estiver ligado, é **zero custo extra**; se desligado,
  cai pra size+mtime (verificação mais fraca, ainda útil — §5).
- **`createdByOp`** é o campo crítico: undo de cópia **só** apaga caminhos com essa flag =
  **nunca** apaga um arquivo que já existia. Espelha a mecânica do cancel (que já remove só o
  destino parcial que criou).
- **Move** grava `from` **e** `to` (undo = `to`→`from`); cópia grava só `to` populado.
- **Trash** não tem `to`; grava `trashRecordIds` (o handle da Lixeira do Windows) p/ restaurar.
- **Onde persiste:** arquivo append-only em `appDataDir/explorer-journal.jsonl` (fora do
  `toolbox.json` de config — é estado efêmero, não configuração; **não** entra no seam de nuvem
  do #555/#560). Tenant-scope não se aplica (é op de FS local da máquina).

---

## 5. Fluxo de verificação (pré-undo)

Antes de **qualquer** ação, o `fs_undo_op(opId)` classifica **cada item** do manifesto:

```
p/ cada item do manifesto:
  1. o alvo (to) ainda existe?            não → SUMIU (nada a fazer / avisar)
  2. createdByOp && !overwritten?         não → NÃO-REVERSÍVEL (sobrescrita) → pula
  3. foi modificado desde a op?
        hash disponível  → compara hashAtEnd
        senão            → compara size+mtime
        difere           → MODIFICADO → pula (não apagar/mover trabalho novo do usuário)
  4. (move/rename) o caminho de retorno (from) está livre?
        ocupado          → CONFLITO → pula (ou oferece "manter ambos" no retorno)
  5. permissão de escrita no alvo e no destino de retorno?
        não              → SEM PERMISSÃO → pula
  → sobra: SEGURO  →  entra no plano de undo
```

Saída da verificação = **três baldes**: `seguros[]`, `pulados[] (motivo)`, `naoReversiveis[]`.
Isso alimenta o preview (§6) **sem executar nada ainda**.

**Detecção de modificação externa** tem duas fontes que se reforçam:
- **Passiva/forte:** `hashAtEnd` vs hash atual (ou size+mtime como fallback).
- **Ativa/barata:** se o watcher (`FsChange`, evento `fs-change`) reportou `modified` num
  caminho do manifesto **entre a op e o undo**, já marca "sujo" sem reler o disco.

---

## 6. Resumo / preview (UX — raia Vega)

O undo **sempre** passa por um resumo com **confirmação explícita** (nunca dispara direto do
dropdown). Espelha o padrão do `conflito-dialog.tsx` já existente. Conteúdo:

```
┌ Desfazer: Copiar 12 itens → Documentos\Projetos ───────────────┐
│                                                                 │
│  ✅ Vai desfazer  (9 itens)                                     │
│     • apagar 9 arquivos copiados (2,3 MB) em Documentos\Projetos │
│                                                                 │
│  ⏭  Não vai mexer  (2 itens)                                    │
│     • "relatorio.docx" — modificado depois da cópia             │
│     • "notas.txt" — não está mais lá                            │
│                                                                 │
│  ⛔ Não dá pra desfazer  (1 item)                               │
│     • "logo.png" — substituiu um arquivo que já existia         │
│       (o original não volta)                                    │
│                                                                 │
│                          [ Cancelar ]   [ Desfazer 9 itens ]    │
└─────────────────────────────────────────────────────────────────┘
```

**Princípios do resumo:**
- **Contagem honesta no botão** ("Desfazer 9 itens", não "Desfazer") — o usuário sabe que 3
  ficam de fora **antes** de clicar.
- **Cada exclusão tem motivo** em linguagem humana (não código de erro).
- **Sobrescrita é destacada** com a consequência explícita ("o original não volta").
- **i18n desde o nascimento** (pt-BR/en) — AC obrigatório (regra da casa `i18n-copy-na-task`).
- O undo é uma op como outra → **emite `fs-op-progress`** e aparece no próprio Status Center
  (é **auto-journalável**: dá pra ter "refazer" no futuro — §8).

---

## 7. Escopo do reversível (política)

Recomendação p/ **v1 (mínimo defensável):**

- **Histórico da sessão**, não só a última op. O activity-dropdown (#898) já lista as ops da
  sessão; cada uma com manifesto ganha um "Desfazer" individual. **Undo é por-op, não uma pilha
  global** (mais simples e previsível que um `Ctrl+Z` em cadeia).
- **Undo em cadeia (Ctrl+Z repetido)** e **Redo**: **fora do v1** — vira backlog (§8). Cadeia
  exige lidar com dependências entre ops (desfazer B depois A quando B moveu o que A copiou),
  complexidade que o spike recomenda **não** pagar antes de validar o undo simples.
- **Limite/TTL do journal:** guardar as últimas **N ops** (proposto N=50) **ou** ops das
  últimas **24h**, o que estourar primeiro. Journal é efêmero: some ao trocar de conta? **Não
  precisa** — é FS local, não tenant-scoped; mas **é limpo no logout completo** por higiene
  (encaixa no `resetSessaoCompleta` do #555 como um clear opcional, não como estado tenant).

---

## 8. Riscos & armadilhas

| Risco | Mitigação |
|---|---|
| **Apagar trabalho novo do usuário** (arquivo modificado pós-op) | verificação hash/mtime (§5) → modificado **nunca** entra no plano; balde "não vou mexer". |
| **Sobrescrita irreversível** dá falsa sensação de undo | marcada ⛔ no manifesto e no preview; removê-la deixaria o caminho **vazio** (pior) → fica de fora por padrão. |
| **TOCTOU** (muda entre verificar e executar) | re-checar item **imediatamente antes** de apagar/mover (verificação dupla, barata); watcher `fs-change` como sinal de abortar. |
| **Undo de move com conflito no retorno** | caminho de origem reocupado → não sobrescreve; oferece "manter ambos" no retorno ou pula. |
| **Undo parcial que falha no meio** | undo também é **transacional-best-effort + journalado**: o que já reverteu fica registrado; erro por-item não aborta os outros; relatório final no Status Center. |
| **Delete permanente** aparecer como desfazível | **nunca** journalar `kind=delete` como reversível; avisar "sem desfazer" **no ato** da op. |
| **Journal cresce sem fim / vaza caminhos** | TTL + limite N (§7); arquivo local só, fora do seam de nuvem. |
| **Pasta grande copiada** — apagar recursivo no undo | reusa o motor de delete→Lixeira (undo de cópia manda pra **Lixeira**, não delete permanente → o undo do undo é a própria Lixeira). ⚑ decisão-chave: **undo de cópia = mandar pra Lixeira, não apagar de vez.** |

**Backlog explícito (fora do v1):** redo · undo em cadeia · backup opcional do sobrescrito
(`.undo-backup`) pra tornar `substituir` reversível · undo cross-sessão (persistir journal
além do fechamento do app).

---

## 9. Plano de implementação faseado

| Fase | Escopo | Raia | Depende |
|---|---|---|---|
| **U0** | **Journal** — gravar `OperationJournalEntry` no END de cada op mutante (append `explorer-journal.jsonl`); reusar size/mtime/hash já computados. Sem UI. | Confucius | #680, #875 |
| **U1** | **`fs_undo_op(opId)`** — verificação (§5) → 3 baldes → executa `seguros` (cópia=trash dos criados; move=mover de volta); emite `fs-op-progress`. | Confucius | U0 |
| **U2** | **Preview/confirm** — dialog de resumo (§6) reusando o padrão do `conflito-dialog.tsx`; contagem honesta; i18n pt/en. | Vega/Sirius | U1 |
| **U3** | **Wiring no #898** — "Desfazer" por-op no activity-dropdown → chama U2→U1; estado no Status Center. | Vega | U2, #898 |
| **U4** (backlog) | redo · cadeia · backup do sobrescrito · cross-sessão. | — | valida U1–U3 antes |

**Gate de cada fase:** `node --test` nos helpers puros (classificador de reversibilidade é
`.ts` puro, testável sem fs — mesma disciplina do `operacao.ts`); `cargo test` no `fs_undo_op`
(RC.EXE + OpenSSL local); live-QA no app dev.

---

## 10. Recomendação

**Viável e de baixo risco** — o motor já carrega ~80% dos dados (manifesto ≈ `PlanoItem` +
`Conflict` + hash do verify). O único trabalho novo real é **persistir o manifesto** (U0) e um
**comando de undo verificado** (U1); o resto reusa padrões existentes (cancel→remove-parcial,
conflito-dialog, trash→Lixeira, fs-op-progress).

**Duas decisões de design que travam o v1 seguro:**
1. **Sobrescrita é não-reversível** — marcada e excluída do plano (sem backup no v1).
2. **Undo de cópia manda pra Lixeira, não apaga de vez** — o undo é ele mesmo revogável.

**Sequência recomendada:** U0 → U1 (Confucius) desbloqueiam U2/U3 (o "Desfazer" do #898).
Redo e cadeia ficam explicitamente no backlog até o undo simples ser validado no runtime do Wagner.
