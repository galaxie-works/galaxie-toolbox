# Default silencioso — decisão transversal (a partir do #1163)

**Autor:** Altair · **Base medida:** `feat` `26a61e9` (2026-08-18) · `Ref #1163`
**Quem coda:** raia de frontend. Este doc decide a forma, não implementa.

> Todas as linhas abaixo foram lidas no ref acima. Medição carrega ref e data: se o arquivo se mexer, re-derive por símbolo antes de aplicar.

---

## 1. O diagnóstico não é "o Provider está no lugar errado"

O #1163 foi relatado como z-order da WebView2 por cima do header, e o fix mecânico é subir o `Provider`. Fui medir o mecanismo inteiro e **são três falhas independentes que produzem o mesmo sintoma**. Subir o Provider conserta uma delas.

### Furo 1 — o default é um no-op que aceita tudo

```ts
// src/lib/navigator-overlay.tsx:14-16
export const OcultarWebviewContext = createContext<(aberto: boolean) => void>(
  () => {},
);
```

Consumidor fora do Provider recebe uma função que **aceita a chamada e não faz nada**. Não há erro, não há log, não há tipo que denuncie. O caminho de falha é indistinguível do caminho de sucesso.

### Furo 2 — o mecanismo é opt-in, e quase ninguém optou

Este é o furo grande, e não estava no relato.

`dialog.tsx:14` e `alert-dialog.tsx:16` **mencionam** `useOcultarWebviewEnquantoAberto` — **em comentário**. Nenhum dos dois chama. Os primitivos são controlados justamente para que *o chamador* se lembre de registrar.

Chamadas reais do mecanismo no app inteiro:

| Arquivo | Linha |
|---|---|
| `src/screens/navegador-favoritos.tsx` | `183`, `426`, `528` |
| `src/screens/navegador.tsx` | `2601` |

**Quatro.** Contra a superfície de overlay do app: 30 arquivos com `DropdownMenu`, 19 com `Popover`, 13 com `Dialog`, 12 com `Select`, 10 com `AlertDialog`, 9 com `ContextMenu`, 8 com `Sheet`.

Nem todo overlay precisa do mecanismo — ele só importa quando a caixa do overlay cruza o retângulo da webview, e a webview só existe na tela `navegador`. Mas a proporção diz o essencial: **o mecanismo cobre o que alguém lembrou de ligar, não o que precisa dele.** Um overlay novo na tela do navegador nasce quebrado e ninguém percebe.

### Furo 3 — o Provider está abaixo do header

```
src/screens/navegador.tsx:2139   <OcultarWebviewContext.Provider value={registrarOverlayWebview}>
src/App.tsx:1262                 <Tooltip> na title bar (fora do Provider)
src/App.tsx:1316                 <UndoPreviewDialog> (fora do Provider)
```

A title bar é renderizada no `App.tsx`. A barra de abas viaja pra lá por portal (`App.tsx:1371`, `tabStripSlot`) — e **portal preserva contexto React**, então a strip continua coberta. Mas o que é *declarado* no `App.tsx` não está na árvore React do Provider e cai no no-op do Furo 1.

### Não é um caso isolado — é a forma que se repete

| Onde | Código | O que o silêncio esconde |
|---|---|---|
| #1163 | `navigator-overlay.tsx:15` — `() => {}` | overlay registrado no vazio |
| #1152 | `pinned-apps.ts:41-42` — `if (app) out.push(app)` | id órfão descartado; a UI **diz que fixou** |
| #1040 | teste da tabela pura no lugar do teste do gate | dois furos passariam 100% verde |

Nos três, **o caminho de falha foi desenhado com a cara do caminho de sucesso.**

---

## 2. O princípio

> **Um default só pode ser silencioso se o caminho silencioso for correto.**

`() => {}` não é "nada a fazer" — é "não consegui fazer". Descartar id órfão não é "lista limpa" — é perda de dado. Quando o silêncio significa falha, ele precisa parar de ser silêncio.

Três regras que caem disso:

1. **Se a ausência é bug, o default não existe.** Nada de `createContext` com valor que parece funcionar. Ou o tipo admite ausência (`| null`) e o consumidor é obrigado a tratar, ou — melhor — não há contexto do qual estar fora.
2. **Mecanismo que depende de cada chamador lembrar não é mecanismo, é convenção.** Convenção não sobrevive a refatoração: o #1163 regrediu porque o #876 moveu componentes na árvore, e nada gritou. Leve o mecanismo pra junção por onde todo mundo já passa.
3. **Todo descarte silencioso vira observável.** Id órfão, registro sem dono, caminho não resolvido: log em dev, contagem em telemetria. Descartar pode ser a decisão certa — descartar *sem deixar rastro* nunca é.

---

## 3. As decisões

### D1 — o registrador vira slice do store, não contexto

Mata os Furos 1 e 3 de uma vez: **não existe Provider do qual estar fora**, e a posição na árvore deixa de ser condição de correção.

O precedente já está no repo e foi feito pelo mesmo motivo: o #987 subiu `ops` do `useState` do explorer-shell pra um slice app-level. Existem 30+ slices em `src/store/` sobre `zustand ^5.0.14` — é o padrão estabelecido da casa, não invenção minha.

O contador (`navegador.tsx:1267-1269`) migra como está; a auto-cura por chave estável (`navegador.tsx:1277-1279`, que impede a webview de ficar presa escondida quando um chip desmonta com o menu aberto) **precisa vir junto** — é ela que evita a tela preta, e foi ganha numa regressão anterior do #275.

### D2 — o mecanismo deixa de ser opt-in: entra nos primitivos

`dialog`, `alert-dialog`, `dropdown-menu`, `popover`, `context-menu`, `select` e `sheet` passam a registrar sozinhos, a partir do estado controlado que já possuem. Overlay novo nasce coberto **por construção**.

Isto é o oposto de tapar os buracos visíveis: são ~100 arquivos usando overlay e 4 registrando. Corrigir chamada por chamada deixa a próxima de fora. A junção única é o primitivo — e aí o gate é o compilador, não a memória de quem revisa.

### D3 — `Tooltip` fica FORA, por decisão escrita

`tooltip.tsx` não referencia o mecanismo hoje (zero ocorrências), e **deve continuar assim**.

O critério não é "qual primitivo" — é **a caixa do overlay cruza o retângulo da webview?**. Dropdown, dialog, popover e context-menu na tela do navegador quase sempre cruzam. Tooltip é disparado por *hover*, que é alta frequência: ligar a webview no ciclo de hover a faria repintar a cada passagem de mouse. **A cura seria pior que a doença.**

O tooltip do `App.tsx:1262` é `side="bottom"` ancorado na title bar — desce sobre a faixa de abas, não sobre a webview. **Não afirmo que ele está cortado: não medi o retângulo.** Se aparecer um tooltip que genuinamente cruza a webview, a resposta é registrar *naquele* ponto de uso, não ligar todos os tooltips.

Ou seja: dialogs entram por padrão, tooltip entra por exceção explícita.

### D4 — o gate, porque hoje não existe nenhum

**Zero testes tocam este mecanismo** (`grep` por `OcultarWebview` em `*.test.ts*` → nada). Ele já regrediu duas vezes: #275 e agora #1163.

Depois de D1+D2 o gate certo é estático, no estilo dos que já rodam (`lumen-botoes-ast`, `lumen-i18n-hardcoded`): **varrer a subárvore da tela `navegador` e falhar se um overlay for montado por um primitivo não-ligado**. Enquanto D2 não existir, um teste de comportamento sobre o contador (abre 2, fecha 1, conta = 1; desmonta com aberto, conta = 0) já cobre a auto-cura, que é a parte que produz tela preta.

---

## 4. O que isso não decide

- **Não decide o fix imediato do #1163.** Se a raia de frontend precisar destravar o PO hoje, subir o Provider pro `App.tsx` resolve o sintoma e é compatível com D1 — vira passo intermediário, não trabalho jogado fora.
- **Não toca o #1152.** Lá a decisão é de produto (o que fazer com pin de app fora do `APPS_CATALOGO`), não de arquitetura. Só a regra 3 se aplica: qualquer que seja a escolha, o descarte precisa deixar rastro.

---

## 8. Emenda pós-implementação (2026-08-18) — dois pontos que o `Sirius` acertou melhor que o desenho

Revisei o **PR #1176** contra este doc. D1, D2, D3 e D4 estão cumpridos, o `OcultarWebviewContext` **deixou de existir** (o Furo 1 não foi contornado, foi removido) e a auto-cura por chave estável migrou junto (`navegador.tsx:1272` + efeito de limpeza `:1965-1970`). Duas correções ao desenho:

### 8.1 O D2 tinha um buraco: abertura PROGRAMÁTICA

Eu escrevi que os primitivos deveriam registrar-se *"a partir do estado controlado que já possuem"*. **Isso não basta:** o Radix só dispara `onOpenChange` em **interação do usuário** — um overlay aberto por código (`setAberto(true)`) nunca notificaria, e o registro não aconteceria.

A implementação cobre os três modos: controlado (efeito sincronizando o store ao `open`), não-controlado (pelo `onOpenChange`) e desmonte com o overlay aberto (cleanup). **O desenho previa um; eram três.**

### 8.2 O `Tooltip` do D3 já tinha um caminho próprio — e ele deve continuar existindo

O D3 diz que `Tooltip` fica fora do D2 porque hover é alta frequência. Correto — **mas não quer dizer que nenhum tooltip precise esconder a webview**. Já existe um caso tratado por outro mecanismo: o tooltip do sidebar colapsado (#358) entra pelo `chromeOverlays`, por window-event, e não pelo registrador.

⚠️ **Isso precisa estar escrito, senão alguém "conserta" a incoerência aparente** ligando o `Tooltip` ao D2 e devolvendo o flicker. A regra completa é: **`Tooltip` fora do D2; o tooltip que comprovadamente cruza a webview entra pelo caminho pontual (`chromeOverlays`), nunca pelo primitivo.**

### 8.3 Acoplamento novo, benigno hoje — registrado para não virar surpresa

A conta agora é **app-global** (slice do store), enquanto o consumidor é **só a tela do navegador**. Um diálogo aberto no Bridge incrementa a mesma conta.

Hoje é inofensivo: o efeito tem saída antecipada em `!visivel` (`navegador.tsx:1913-1918`) — se a tela não está à frente, a webview já é escondida por outro caminho. **Fica registrado para o dia em que houver um segundo consumidor de webview:** aí a conta única passa a ser acoplamento de verdade, e o slice precisa virar conta por-consumidor.
