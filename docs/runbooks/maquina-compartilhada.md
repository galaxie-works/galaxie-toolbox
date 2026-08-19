## 9. MÁQUINA COMPARTILHADA — runtime (v1.4)

Os 11 papéis rodam **na mesma máquina do PO**. Tela, portas e processos são recurso comum.

1. **Ver a fatia rodando = navegador, nunca janela nativa.** Todo papel tem dois navegadores: o **embutido do Claude** (`mcp__Claude_Browser__*`: `preview_start` no vite da própria worktree, `read_page`, `screenshot`, console/network) e o **Chrome da máquina, integrado** (`mcp__claude-in-chrome__*`: `navigate`, `screenshot`, `read_page`). Sobe-se **`pnpm dev` (vite)**, não `pnpm tauri dev` — a janela nativa abre **na tela do PO, do nada**. Tauri só quando o card exige IPC/arquivo local: avisar na #133 **antes**, fechar **depois**.
2. **QA visual usa os dois antes de declarar "sem pixel".** Embutido: DOM sempre, pixel com o pane visível. Chrome integrado: pixel real sem depender do pane (limite: sem IPC Tauri — mock, sem arquivo local; `localhost:<porta>` alcançável). Screenshot real de qualquer um + classes conferidas no código = evidência visual válida (mandamento 7).
3. **Higiene: o que sobe, derruba no fim do tick** — vite/tauri/preview, abas, capturadores. **Porta 1420 é de todos:** ocupada → **não matar processo de companheiro**; subir em outra (`--port`) e dizer na #133 qual. Terminou o teste = servidor parado, aba fechada, porta livre. Deixar rodando = consumo e bloqueio silencioso pros outros.

