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

## Fluxo obrigatório para PR de UI

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
| `atoms` | dashboard inicial após o login mock |
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
