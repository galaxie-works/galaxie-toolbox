# QA visual de PRs de UI

## Decisão da #602

O browser mock permite capturas reais e reproduzíveis em tema claro e escuro.
Porém, o app não possui uma rota URL por tela: a navegação depende do estado do
`useAppStore` e de cliques na interface. Por isso, inferir automaticamente a tela
a partir dos arquivos alterados seria frágil. A automação usa **cenários
explícitos**, selecionados pelo autor da PR.

O script usa `agent-browser@0.33.2` via `pnpm dlx` (versão pinada, sem adicionar
o binário de 91 MB às dependências), um e-mail fictício e a API mock do browser.
Nenhuma credencial, token ou sessão real é necessária.

## Status: ferramental sob demanda — **não** é obrigação de PR (#1029, DOC-11)

⚠️ Este documento dizia **"Fluxo obrigatório para PR de UI"**. Não é, e nunca
chegou a ser: o `AGENTS.md` já classificava este mesmo arquivo como
*"ferramental do gate da `Lúmen II`, não instrução de orquestração"*, e o
`WORKFLOW.md` — que é a fonte canônica e supersede o `AGENTS.md` — nunca o
adotou. Medido em `56ddc51` (18/08): **nenhuma PR de UI do dia anexou PNG, e
nenhuma foi reprovada por isso.**

Obrigação que ninguém cumpre e ninguém cobra é pior que obrigação nenhuma:
ela corrói a confiança no resto do processo, porque quem lê não sabe mais
quais regras valem.

**O que substituiu a parte automatizável:** o #786 criou `pnpm test:component`
(vitest + happy-dom) e `pnpm test:browser` (navegador real, Playwright) — os
dois **rodam no CI** e travam a classe de regressão que motivou este doc
(foco/ponteiro, o erase do compose). Ver `WORKFLOW.md` §5.0-bis.

**O que este ferramental ainda faz, e nenhum teste faz:** olhar. Espaçamento,
contraste, dark mode, alinhamento — coisas que um assert não afirma.

### Quando usar (sob demanda, não por regra)

- A `Lúmen II` pede, no gate de um card de UI.
- O autor mexeu em layout/tema e quer evidência na PR.
- O PO pede print de uma tela específica.

## Como capturar


1. Em um terminal, inicie o mock:

   ```powershell
   pnpm dev -- --host 127.0.0.1
   ```

2. Em outro terminal, capture o cenário alterado:

   ```powershell
   pnpm qa:visual -- -Scenario onedrive-my-files -Prefix 616
   ```

3. Confira os dois PNGs em `artifacts/qa-visual/` e anexe-os à PR:

   - `<prefixo>-<cenario>-light.png`
   - `<prefixo>-<cenario>-dark.png`

4. Na descrição da PR, cite:

   - cenário usado;
   - estados/interações exercitados;
   - limitações que exigem validação no Tauri/Graph real.

Os PNGs são evidência da PR, não artefatos versionados; a pasta de saída está no
`.gitignore`.

## Cenários disponíveis

| Cenário | Estado capturado |
| --- | --- |
| `astro` | tela oculta alcançada pela porta `?tela=` (o cenário era `atoms`, removido em #1320) |
| `onedrive-my-files` | M365 Copilot > OneDrive > My files, com o card de uso em foco |

Para incluir outra tela, adicione ao mapa `$scenarios` em
`scripts/Capturar-QA-Visual.ps1` uma sequência de ações semânticas
(`role` + `name`), um texto estável de prontidão e, se necessário, o elemento a
rolar para o viewport. Evite seletores CSS ligados à estrutura interna.

## Limites da evidência

As capturas provam layout, tema, conteúdo mock e o estado exercitado. Elas não
provam integrações do Graph, permissões, dados reais, WebView2 nativa, hover,
teclado, animação ou estados não reproduzidos pelo cenário. Esses pontos devem
continuar listados para o live-QA do PO quando fizerem parte dos critérios de
aceite.

## Validação sem login Graph (mock do Vite)

> Movido do `AGENTS.md` pelo #1043: é **ferramental do gate**, não instrução de orquestração.
> O papel era descrito como "subagente QA"; hoje quem executa é a **`Lúmen II`** (QA frontend).

🖥️ **A `Lúmen II` PODE validar visualmente** (ACs de layout/estrutura), sem login Graph real. O Vite dev server serve o frontend em `http://localhost:1420`; aberto **fora do Tauri** (browser), o `api.ts` usa **dados MOCK** (`inTauri()` = false). Fluxo: `preview_start {url:"http://localhost:1420"}` → `read_page` (login screen) → `form_input` email + `left_click` "Sign in with Microsoft" (o mock loga qualquer email como usuário fake) → cai no Bridge com dados mock → **`read_page`** inspeciona a árvore de acessibilidade **renderizada** (posição/presença de componentes, estados colapsado/expandido, tema, labels). **`read_page` funciona headless** (não precisa da pane visível); **screenshot** só funciona com a pane exibida. **Limite:** mock ≠ Graph real — comportamento dependente de dados reais (carregar/ordenar e-mail, contadores, `$search`, fotos, autocomplete, 429/retry) continua sendo validação de **runtime do PO**. Use validação visual para todo AC de UI que o mock consiga exercer; deixe explícito quais ACs sobraram pro PO.
