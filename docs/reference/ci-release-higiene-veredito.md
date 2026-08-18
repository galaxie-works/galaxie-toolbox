# #1056 — veredito medido dos cinco achados de CI/release

> Medido no `feat` `d336ee9`, **18/08/2026**. Fatos aqui são contexto perecível:
> re-derive antes de codar.
>
> O card é rollup de TST-05/08/09/10/11. Medi os cinco antes de propor qualquer
> mudança — dois estão vivos, um é meia-verdade, um é decisão consciente já
> tomada, e um é real mas menor.

| achado | veredito | gravidade |
|---|---|---|
| **TST-05** gate do release mais fraco que o do CI | ✅ **vivo** | **a maior do card** |
| **TST-08** cache do pnpm aponta para caminho errado | ✅ vivo | custo, não correção |
| **TST-09** runner + cache do Playwright | ⚠️ **meia-verdade** | menor |
| **TST-10** convenção dos 3 canais fora do processo | ✅ vivo | processo |
| **TST-11** oxlint sem regra de não-usado | ❌ **falso** — o defeito é outro | ver §5 |

---

## 1. TST-05 — o gate do release é mais fraco que o do CI (**e foi por aqui que a v0.44.0 saiu**)

Medido:

| | `ci.yml` | `release.yml` |
|---|---|---|
| `pnpm test` | ✅ `:56` | ✅ `:65` |
| `pnpm lint` | ✅ `:53` | ❌ |
| `pnpm test:component` | ✅ `:61` | ❌ |
| `pnpm test:browser` | ✅ `:70` | ❌ |
| `cargo test` (matriz: app + 6 crates, com e sem `--features remote`) | ✅ `:157-200` | ❌ |

O `release.yml` vai de `pnpm test` (`:65`) direto para `pnpm tauri build` (`:90`).

⇒ **O artefato que o cliente instala passa por um gate menor do que o de
qualquer PR.** Um PR que reprove em `cargo test` não integra; uma tag que
reprovaria no mesmo teste **é publicada**.

### A correção NÃO é copiar os steps

O reflexo é colar os steps do `ci.yml` no `release.yml`. Isso **recria a causa**:
as duas listas voltam a divergir na próxima vez que alguém acrescentar um gate
só num lado — que é exatamente como chegamos aqui.

Três caminhos, e por que escolho o terceiro:

1. **Copiar os steps** — duplicação declarada. Deriva de novo, com certeza.
2. **`release` exigir o veredito do CI daquele SHA** — bom, mas tem buraco: o
   `workflow_dispatch` pode disparar sobre uma tag antiga **sem run de CI
   associada**, que é o caso que o próprio card levanta.
3. **Extrair o gate para um workflow reutilizável (`workflow_call`)**, chamado
   pelo `ci.yml` **e** pelo `release.yml`. ✅

Com (3) existe **uma definição só** do gate; não há como um caminho ficar mais
fraco que o outro, porque não há dois lugares para escrever. É a mesma forma que
usei no gate de comando async (#1070 §5.2): **eliminar a possibilidade da
divergência em vez de detectá-la depois.**

> ⚠️ **Por isso NÃO entrego aqui um teste que compare as duas listas.** Um gate
> assim *legitimaria* a duplicação — passaria a exigir que as duas listas fossem
> iguais, quando o certo é não haver duas listas. Seria o mesmo erro que cometi
> no #1237, quando propus um gate que media a coisa errada.

**Custo honesto de (3):** o release passa a rodar a matriz de `cargo test`, que
é a parte cara. É decisão de PO se o release pode ficar mais lento — mas a
alternativa é continuar publicando com gate menor que o de PR.

## 2. TST-08 — o cache do pnpm nunca acerta

`ci.yml:42` (e o par no `release.yml`) usa `path: ~/.pnpm-store`. O store real do
pnpm 11 não fica lá — nesta máquina é
`C:\Users\consa\AppData\Local\pnpm\store\v11`; no runner Linux, sob
`~/.local/share/pnpm/store/<v>`.

⇒ O step nunca acerta: **salva um diretório vazio e restaura nada**, em todo run.
Não quebra nada — só paga download completo sempre e dá a *impressão* de que há
cache.

Correção: derivar o caminho de `pnpm store path` num step anterior e usar a
saída, em vez de literal. Somar `restore-keys` para acerto parcial.

É custo, não correção — mas é a definição de "gate/otimização que afirma e não
confere", o mesmo padrão do resto do dia.

## 3. TST-09 — meia-verdade

O card diz *"o job `rust` roda em `windows-latest` (minutos 2×)"*. Medido: o job
de frontend é `ubuntu-latest` (`:24`); os jobs Windows são `:121` e `:221`.

**Rodar o Rust no Windows é decisão consciente, não descuido** — está escrito no
próprio `ci.yml`: *"Roda no windows-latest (mesma plataforma do release, evita
as [divergências])"*. O app é Windows; testar Rust em Linux testaria outra
plataforma. **Não mexer.**

A outra metade **é real**: `ci.yml:67` roda `playwright install --with-deps
chromium` sem nenhum cache de `~/.cache/ms-playwright` — baixa o browser em todo
run. Correção barata e sem risco.

## 4. TST-10 — a convenção dos 3 canais não está no processo

Confirmado, buscando no escopo inteiro: `test:component` e `test:browser` não
aparecem em **WORKFLOW.md, AGENTS.md, Rules.md, README.md nem docs/README.md**
(0 ocorrências em cada). A convenção existe só num comentário do
`vitest.config.ts`.

Consequência prática: o WORKFLOW.md §5 manda rodar `pnpm test`, então um agente
que siga o processo canônico **não roda** `test:component` nem `test:browser`
antes de abrir PR — e descobre no CI.

Correção: documentar os três canais no WORKFLOW.md (o que cada um cobre e quando
rodar). Barato e destrava todo mundo.

## 5. TST-11 — **falso como escrito**, e o defeito real é outro

O card diz que o `.oxlintrc.json` *"não tem nenhuma regra de variável/import não
usado"*. **Testei:** criei um arquivo com uma variável não usada e rodei o
`oxlint` — ele acusou:

```
warning eslint(no-unused-vars): Variable 'naoUsada' is declared but never used.
```

A regra **funciona** (vem do conjunto default do oxlint; não precisa estar
listada). A conclusão do card — "essa cobertura não existe" — está errada.

**O defeito real é o nível:** sai como `warning`, e `pnpm lint` é `oxlint` puro,
**sem `--deny-warnings`**. Ou seja, o CI **nunca reprova** por lint.

Medido hoje: **164 warnings** em `src/`. Nenhum gateia nada.

⇒ Não é "falta regra", é **"o gate não morde"**. E a correção não é ligar
`--deny-warnings` de uma vez (164 reprovações no dia seguinte): é ratchet, no
formato que já roda na casa (#1153, #1074 F1, #1070 §5.2) — baseline dos 164,
que só encolhe, com violação nova reprovando na hora.

---

## Resumo para quem for implementar

| # | ação | risco | decisão de quem |
|---|---|---|---|
| TST-05 | extrair o gate para `workflow_call`, chamado por CI **e** release | **alto** (mexe no caminho de release) + release fica mais lento | **PO** |
| TST-08 | derivar o path de `pnpm store path` + `restore-keys` | baixo | livre |
| TST-09 | cachear `~/.cache/ms-playwright` (só isto; o runner Windows fica) | baixo | livre |
| TST-10 | documentar os 3 canais no WORKFLOW.md | nenhum | livre |
| TST-11 | ratchet de warnings do oxlint (baseline 164, só encolhe) | baixo | livre |

Os quatro "livres" cabem numa fatia só. O TST-05 é o que vale o card — e é o
único que precisa de aval antes, porque torna o release mais lento e mexe no
caminho que publica.
