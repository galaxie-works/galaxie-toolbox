# Rules.md — Regras de UI/UX e componentes (GALAXIE)

Regras **obrigatórias** para **qualquer agente que produz UI ou entrega código** neste repo — a lista viva do time está no [`WORKFLOW.md`](./WORKFLOW.md) §1, e é lá que ela se mantém atualizada. Ligado ao [`AGENTS.md`](./AGENTS.md). Nasceu das rejeições recorrentes do PO (scrollbar fora do padrão #311, webview órfã #310, ícone info minúsculo #269, árvore custom em vez do registry #176, primário no lugar errado #282, org some no restart #295). **Se a entrega quebra uma regra daqui, o PO reprova.**

## 1. Componentes — NÃO INVENTAR UI
- Use os componentes **reui/shadcn LITERAIS do registry**. Instale com `pnpm dlx shadcn@latest add @reui/<componente>` (ou o registry do projeto) e use **como veio** — não recrie árvore, botão, input, sortable, etc. do zero.
- Precisou de um componente novo? Procure no registry primeiro. Só componha do zero se realmente não existir — e mesmo assim, com os primitivos do design system.
- **Dúvida de UI/UX/design** (padrão de componente, interação, hierarquia, quando mostrar/esconder) → **levante um subagente de UX Research** (`design:user-research`, `ux-researcher-designer`, `design:design-critique`) e traga a recomendação pro PO. Não decida por achismo.

## 2. Overlays, modais e webview
- **Modal = `Sheet`** (padrão do app), não `Dialog` custom. Sheets abrem com **fade + slide 300ms** (o plugin `tw-animate-css` já está no projeto — use as classes `animate-in`/`slide-in-from-*`/`fade-in-0`/`duration-300`).
- **Z-order da webview nativa (Navigator):** a WebView2 pinta acima do DOM. Qualquer overlay DOM sobre o Navigator precisa **esconder/repintar a webview** (`browser.esconderTodas()` / padrão `navigator-overlay` #174/#275). Nunca deixe webview órfã pintando por cima (bug #310).

## 3. Scrollbar
- **Sempre** o padrão do app: `ScrollArea` do reui ou o utilitário de scrollbar já usado no resto do app. **Nunca** scrollbar OS default (bug #311). A única exceção legítima é o conteúdo remoto DENTRO da webview nativa (scrollbar do site, fora do nosso controle) — aí documente como não-aplicável.

## 4. Botões e ações
- **Primário sempre na extremidade DIREITA** do toolbar/rodapé/footer (padrão do app, #282).
- Hierarquia clara: um primário por contexto; secundários com `variant` apropriado do design system. Nada de dois primários competindo.

## 5. Ícones e cores
- Cores **semânticas** do tema: `text-muted-foreground`, `text-foreground`, `text-primary`, `text-info`, etc. **Nunca** cor solta/hardcoded (#269).
- Tamanho adequado (`size-4`/`size-5` conforme o contexto) — nada de ícone minúsculo ilegível (#269).
- SVG que precisa recolorir/herdar tema → `fill="currentColor"` (não fill fixo).

## 6. Tema claro/escuro
- **Toda** UI funciona em claro E escuro. Teste os dois. Sem texto invisível, contraste quebrado ou cor que só funciona num modo.

## 7. Empty states e feedback
- **Empty states** centrados, honestos (mensagem clara do porquê está vazio) e com CTA quando fizer sentido.
- **Feedback** em toda ação: toast/`sonner` em sucesso/erro, estados de loading, otimista+rollback em mutação.

## 8. Layout e espaçamento
- Use os tokens de spacing do design system. Sem faixas/gutters vazios aleatórios (bug #230). Alinhamento e densidade consistentes com o resto do app.

## 9. Persistência
- Estado que o **usuário define** (preferência, org, seleção de provider, config) **PERSISTE** — no store zustand (partialize em `store/index.ts`) ou na chave localStorage legada (padrão `*_KEYS`). **Nunca session-only** (bug de data-loss #295: org sumia no restart). Se somir ao fechar/reabrir o app, está errado.

## 10. Acessibilidade
- `aria-label`/`aria-current`/semântica correta; foco visível e ordem de tab sã; alvos clicáveis com tamanho decente.

## 11. Custo e eficiência do agente (não queimar créditos)
- Quem **ENTREGA** (qualquer agente de dev ou subagente) faz só: **build local verde** (`tsc` + `cargo` se tocar Rust + `vite`) + **comentário de evidência conciso** (o que mudou, arquivos, commit, ACs) → PR e **PARA**.
- **A integração + code-QA é do Polaris** (merge da feat, builds, evidência ao mover pra QA Approved). **NÃO** rode um subagente de QA/review separado nem re-revise o código inteiro linha-a-linha — duplica o Polaris e queima o limite semanal.
- **Subagente só pra tarefa GRANDE** (~150-400k tokens cada). Solo pro pequeno/mecânico. **Sem auditoria/review espontâneo** — achou algo fora do escopo, abre issue curta (finding) e segue.
- ⚠️ **O ~150-400k é o CUSTO a evitar, não um orçamento a gastar.** O teste é a TAREFA, não o hábito. **Dois sinais de que era pra ser SOLO:**
  1. **Vais re-revisar o diff linha a linha?** Então já fizeste o entendimento — o subagente só somou custo, não alavancou. Quem revisa linha a linha entende linha a linha; então escreve.
  2. **É uma mudança FOCADA** (um arquivo, uma função, um spec já escrito por ti ou pelo Altair)? Solo. Subagente é pra trabalho que **não cabe num contexto** ou que **abre em paralelo de verdade** — não pra fatia cirúrgica que tu ias verificar de qualquer jeito.
  Espec cirúrgica + review linha-a-linha do resultado = **fazer solo com passo extra**. Uma fatia de ~500 linhas com vetor de teste (ex.: codec TURN) é solo.

## 12. Nomenclatura de arquivos
- kebab-case sempre para nomes de arquivo; domínio em pt-BR, infra/técnico em en.

---
*Toda issue de story herda estas regras na Definition of Done. PO reprova entrega que as viole.*
