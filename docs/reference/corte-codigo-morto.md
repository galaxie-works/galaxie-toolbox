# Corte de código morto do `src/` — desenho

> **Desenho de arquitetura (#1030, épico #1007, auditoria #994).** Altair mede e
> decide o corte; Vega executa a exclusão. Medido em `46ede70`.
>
> O AC pedia "confirmar que nada vivo depende da cadeia do Plate AI". Confirmado — **e
> a cadeia é bem maior do que o achado FE9 registrou.** Números abaixo, com o método.

---

## 1. Método (e seu limite)

Grafo de imports de todo o `src/`, alcançabilidade a partir de **`src/main.tsx` + todos
os `*.test.*`** (a rede de teste conta como consumidor vivo). Órfão = não alcançável.

O regex de import cobre `from '…'`, `import('…')`, **`import '…'` sem `from`** (efeito
colateral) e `require('…')`.

> ⚠️ **Limite, e ele já me mordeu.** Minha primeira versão não capturava o import de
> efeito colateral e marcou `src/lib/menu-contexto-nativo.ts` como órfão — quando ele é
> importado exatamente assim pelo `main.tsx:5`. Corrigi e o total caiu de 190 para 189.
>
> Continua sem cobrir **import dinâmico com caminho construído em runtime** (`import(\`./\${x}\`)`).
> Não achei nenhum no repo, mas por isso a execução é **em lotes com `pnpm build` a cada
> lote** — a análise estática indica, o build confirma.

## 2. O tamanho real

| Grupo | Arquivos | Linhas |
|---|---:|---:|
| `components/editor/` — a cadeia do Plate AI | 60 | 4.800 |
| `components/ui/` — nós/toolbars do Plate | 91 | 15.138 |
| `components/examples/` | 21 | 1.433 |
| `components/reui/` | 6 | 1.811 |
| `animate-ui/…/community/` | 2 | 212 |
| outros (`compor-email`, `hooks/`, `lib/`, `.d.ts`) | 9 | 1.243 |
| **TOTAL ÓRFÃO** | **189** | **24.637** |
| vivo | 415 | 108.166 |

**~19% do `src/` não é alcançável a partir do app.**

O achado FE9 estimou ~4.600 linhas — e acertou **a cadeia** (meus 4.800 em `editor/`). O
que ele não contou foi o **rastro**: os 91 arquivos de `components/ui/` que existem só
para servir aquela cadeia, e que sozinhos pesam **três vezes mais** que ela.

## 3. O corte, em três camadas — e só a primeira é mecânica

### Camada 1 — apagar agora (é exatamente o AC, risco baixo)

- `components/editor/**` (60 arquivos): `plate-editor.tsx` (zero importadores),
  `editor-kit`, `editor-base-kit`, `plugins/**` (53), `use-chat.ts`, `settings-dialog`.
- `components/examples/**` (21) — o AC diz que só `c-empty-19` é usado; ele **não** aparece
  como órfão, confirmando.
- `components/compor-email.tsx` — o compose vivo é `compose/compor-mensagem.tsx`. A única
  referência ao morto é **um comentário** (`compor-mensagem.tsx:88`), não um import.
- `lib/block-discussion-index.ts`, `lib/markdown-joiner-transform.ts`, `lib/uploadthing.ts`
  e os shims `plate-shims.d.ts` / `reui-env.d.ts` (conferir os shims por último — `.d.ts`
  não aparece em grafo de import, então **valem por build**, não por análise).
- **`@faker-js/faker` sai de `dependencies`**: os dois únicos usos são
  `editor/plugins/copilot-kit.tsx:5` e `editor/use-chat.ts:8`, ambos na camada 1.

### Camada 2 — decisão de produto, não de código (não apagar por conta)

Os **91** de `components/ui/`, os **6** de `reui/`, os **2** de `animate-ui/…/community/`
e `hooks/use-upload-file.ts` / `use-is-touch-device.ts` são **componentes de registry** —
instalados por CLI, não escritos por nós. A regra da casa é usar o componente de
referência como ele vem.

Apagar está certo **se** o editor Plate está morto como produto. Se ele está apenas
dormente, esses 91 arquivos voltam no próximo `shadcn add` e o trabalho evapora — pior,
volta divergente do que estava aqui.

**Pergunta para o PO, não para o dev:** *o editor rico do Plate sai do produto?*
- **Sai** → apagar as três camadas, e o ganho vai de ~7,5 mil para ~24,6 mil linhas.
- **Fica dormente** → apagar só a camada 1 e **registrar em doc** por que 91 arquivos
  órfãos permanecem, senão a próxima auditoria reabre o mesmo achado.

### Camada 3 — órfão que NÃO é lixo (🔴 não apagar)

**`src/components/universal-search.tsx` aparece como órfão — e isso é o bug UX1, não código morto.**

É o mesmo achado do **#1065**: o `UniversalSearch` era o único gravador de
`store.busca`/`peopleSearchQuery` e deixou de ser montado no #876, matando a busca por
texto do Bridge. O #1065 está **parado esperando a decisão A/B do PO** (remontar × remover).

> Se o #1030 apagar esse arquivo mecanicamente, **decide o #1065 por omissão** — escolhe
> "remover" sem que ninguém tenha escolhido, e joga fora o componente que a opção "remontar"
> precisa. **Excluir `universal-search.tsx` do escopo do #1030**, com nota no PR.

É o motivo de "órfão" e "morto" não serem sinônimos: um órfão pode ser um consumidor que
sumiu, não um produtor inútil.

## 4. `noUnusedLocals`: a expectativa do AC é otimista

O AC quer religar `noUnusedLocals`/`noUnusedParameters` depois da limpeza. Medido hoje:

- **59 arquivos** acusam erro com a flag ligada;
- **42 desses morrem** com o corte (camadas 1 e 2);
- **17 continuam vivos** e teriam que ser triados de verdade.

Os 17: `compose/campo-pessoas.tsx`, `screens/control-room.tsx`, 4 do
`reui/event-calendar/**`, 4 de `animate-ui/**`, e 7 nós do Plate em `components/ui/`
(`code-node`, `heading-node`, `highlight-node`, `hr-node`, `kbd-node`, `link-node`,
`paragraph-node`) — que são **vivos** porque o compose usa o Plate de verdade.

Ou seja: religar a flag **não sai de graça** com a exclusão. Ou o PR do #1030 triage os
17, ou a flag fica desligada e o comentário do `tsconfig.app.json:22-26` é **atualizado**
(não removido) explicando o resíduo real.

⚠️ E há dependência de ordem: `control-room.tsx` está nesse resíduo, e o **#1019** vai
fatiá-lo em seis. Triar `noUnusedLocals` nele antes da extração é trabalho jogado fora.

## 5. Ordem sugerida

1. Camada 1 + `faker` fora de `dependencies` → `pnpm build`.
2. Decisão do PO sobre o Plate (§3) → se "sai", camada 2 em lotes, `pnpm build` por lote.
3. `noUnusedLocals`: só depois do #1019, e triando os 17 (ou documentando o resíduo).
4. `universal-search.tsx` **fora**, até o #1065 ser decidido.

## 6. Reprodutível

O grafo é ~40 linhas de Python: caminha `src/`, extrai imports com o regex da §1, resolve
`@/` e relativo (com `.tsx`/`.ts`/`index`), BFS a partir de `main.tsx` + testes. Vale
re-rodar depois de cada lote — o conjunto órfão **encolhe** conforme se apaga (arquivo que
só era alcançado pelo que morreu vira órfão também).
