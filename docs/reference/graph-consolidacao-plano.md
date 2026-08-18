# #1074 — re-derivação e plano de fatiamento

**Autor:** Altair · **Medido em:** `feat` `3479b36` (2026-08-18) · `Ref #1074`
**Contexto:** herdei a raia do `Orion`. O commit dele (`22b5f1e`) **não pode ser aplicado** — está baseado no `303b9c` e reverteria o #1163 e os seams do #1019. Re-derivei por símbolo, que é o que a US de auditoria exige.

---

## 1. Os números da US estão desatualizados — e **para menos**

A US foi escrita na auditoria #994 com linhas de um commit antigo. Medido hoje:

| Achado | US diz | Medido em `3479b36` | |
|---|---|---|---|
| **RB37** call sites fora do `graph_enviar` | 22 | **81** chamadas `client.(get\|post\|patch\|delete)` diretas | 🔺 3,7× |
| **RB39** comandos mortos | 4 | **4** — `cr_reunioes`, `cr_email`, `cr_inbox_dia`, `cr_contar` | = |
| **RB40** write duplicado | 2 fn | **2** — `:7658` e `:7766` | = |
| **RB41** laços de paginação | 4 | **13** ocorrências de `@odata.nextLink`; `fn paginar` **não existe** | 🔺 3,2× |
| **RB42** `$select` repetido | 3 | **5 pares** literalmente idênticos | 🔺 |
| **RB43** parsers de `$batch` | 3 | **3** (`:1025`, `:8681`, `:9393`) + 12 usos de `"responses"` | = |
| **RB44** `Client::new()` | 87 | **87 no `graph.rs`** + 8 `auth.rs` + 2 `gdrive.rs` = **97** | 🔺 |

O `graph.rs` está com **9.711 linhas**.

> **Achado de auditoria é hipótese com data.** Aqui as hipóteses continuam verdadeiras, mas **a dívida cresceu** entre a auditoria e hoje. Quem executar precisa medir de novo antes de cada fatia — não confiar nesta tabela daqui a uma semana, inclusive.

## 2. O erro que essa US convida a cometer

O DoD lista *"22 call sites convertidos"*. Com **81**, a leitura ingênua é *"converter os 81 e pronto"*. **Isso é tapar buraco visível**, e é o modo de falha que já registramos: alguém converte os que achou, o gate não existe, e o 82º entra na semana seguinte.

O próprio DoD já traz a cura, mas **listada por último**:

> *"lint/teste que falha se `client.get|post|patch|delete` aparecer fora de um closure de `graph_enviar`"*

**Essa linha tem que vir primeiro, não por último.** É a mesma forma do gate de ícone do `Confucius` (#1153): **baseline-ratchet** — registra os 81 numa baseline que **só encolhe**, e qualquer chamada direta **nova** reprova na hora. Aí a conversão vira trabalho incremental seguro em vez de um PR de 81 pontos que ninguém revisa.

## 3. Fatiamento — 7 fatias, por risco crescente

Ordem escolhida para que **cada fatia seja reconferível sozinha** e nenhuma dependa da seguinte.

| # | Fatia | Achado | Por que aqui |
|---|---|---|---|
| **F1** | **Gate ratchet** de `client.*` fora do `graph_enviar` | RB37 | **Primeiro.** Congela a dívida antes de qualquer refatoração. Sem produção tocada. |
| **F2** | Apagar os 4 comandos mortos (Rust + `generate_handler` + wrapper TS + tipos) | RB39 | Só deleção; some junto a cópia divergente de `montar_email_item`. ⚠️ **Conferir o gate do #1017** — remover superfície de `api.ts` já derrubou o CI antes. |
| **F3** | `static CLIENT: OnceLock<Client>` com `timeout`/`connect_timeout` | RB44 | Mecânico e de alto retorno: hoje **nenhuma** chamada tem timeout. 4 conexões penduradas param todo o Graph **sem erro**. |
| **F4** | `const SELECT_*` de módulo nos caminhos de listagem | RB42 | Mecânico, diff pequeno, impossível divergir depois. |
| **F5** | `fn paginar<T>` único com validação de host + anti-loop | RB41 | ⚠️ **A única fatia com bug de disponibilidade real** — `nextLink` cíclico = laço infinito. Precisa do **teste que reproduz antes de corrigir**. |
| **F6** | `mod batch` com sucesso explícito **por operação** | RB43 | Muda semântica: delete aceita 404/410, escrita exige 2xx. Merece PR próprio. |
| **F7** | `patch_contatos_em_lote` unificando os dois `*_write` | RB40 | Por último: é o de maior superfície de comportamento (retry por item passa a existir nos dois). |

**F1→F4 são independentes entre si.** F5, F6 e F7 mudam comportamento e vão uma por PR.

## 4. O que eu recomendo NÃO fazer

- **Não aproveitar o `22b5f1e`.** Ele tem o desenho certo — client único, paginação sem ciclo, `patch_contatos_em_lote`, parser de `$batch` centralizado — mas o **diff** está velho: `git diff --stat origin/feat 22b5f1e` acusa **4.781 deleções**, incluindo o `overlay-webview-slice.ts` inteiro (#1163) e a devolução de 647 linhas ao `control-room` (#1019). **Aproveitar o diff desfaz trabalho de duas pessoas.** O desenho reaproveita; o patch, não.
- **Não fazer as 7 num PR.** São 9.711 linhas e três mudanças de comportamento. Um PR desses não é revisável, e colide com todo mundo que toca `graph.rs`.
- **Não converter os 81 antes do gate.** Sem ratchet, a contagem volta a subir enquanto a PR está aberta.

## 5. Estado

**F1 é a próxima**, e é a única que não depende de decisão nenhuma.
