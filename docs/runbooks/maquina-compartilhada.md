## 9. MÁQUINA COMPARTILHADA — runtime (v1.4)

Os 11 papéis rodam **na mesma máquina do PO**. Tela, portas e processos são recurso comum.

1. **Ver a fatia rodando = navegador, nunca janela nativa.** Todo papel tem dois navegadores: o **embutido do Claude** (`mcp__Claude_Browser__*`: `preview_start` no vite da própria worktree, `read_page`, `screenshot`, console/network) e o **Chrome da máquina, integrado** (`mcp__claude-in-chrome__*`: `navigate`, `screenshot`, `read_page`). Sobe-se **`pnpm dev` (vite)**, não `pnpm tauri dev` — a janela nativa abre **na tela do PO, do nada**. Tauri só quando o card exige IPC/arquivo local: avisar na #133 **antes**, fechar **depois**.
2. **QA visual usa os dois antes de declarar "sem pixel".** Embutido: DOM sempre, pixel com o pane visível. Chrome integrado: pixel real sem depender do pane (limite: sem IPC Tauri — mock, sem arquivo local; `localhost:<porta>` alcançável). Screenshot real de qualquer um + classes conferidas no código = evidência visual válida (mandamento 7).
3. **Higiene: o que sobe, derruba no fim do tick** — vite/tauri/preview, abas, capturadores. **Porta 1420 é de todos:** ocupada → **não matar processo de companheiro**; subir em outra (`--port`) e dizer na #133 qual. Terminou o teste = servidor parado, aba fechada, porta livre. Deixar rodando = consumo e bloqueio silencioso pros outros.

## 10. TOOLCHAIN DO REMOTE — build/test `--features remote` (OpenSSL) — #1468

O backend Remote (`str0m`/WebRTC) fica atrás da feature `remote` do `src-tauri`, que puxa `openssl-sys`. **Sem o env de OpenSSL, `--features remote` não compila** — e foi por isso que `remote-transport` (str0m) ficou "cego nesta máquina", NÃO por gate de infra/PO. O toolchain **já está na máquina**: o **PostgreSQL 16** traz o OpenSSL do sistema, então `OPENSSL_NO_VENDOR=1` evita os ~10 min do `openssl/vendored`.

**Env (uma vez por shell):**

```bash
export OPENSSL_NO_VENDOR=1
export OPENSSL_DIR="C:/Program Files/PostgreSQL/16"
```

**Buildar/testar o Remote** (de `src-tauri/`):

```bash
cargo check --features remote     # compila remote-transport/str0m
cargo test  --features remote     # roda a suíte incluindo o Remote
```

**Regras que valem aqui:**
- **O build DEFAULT (sem `--features remote`) é openssl-free** — NÃO exportar o env pra ele; é o que pega vazamento de OpenSSL no caminho comum (lição #809). `cargo check`/`cargo test` sem feature e sem env continuam verdes.
- **Só `remote-transport` (str0m) precisa do OpenSSL.** `remote-net` e `remote-signaling` usam **rustls** e compilam sem o env — rodar do próprio dir (são Cargo independentes; `services/` não é workspace).
- Medido em 24/08 (#1468): `cargo check --features remote` compila `str0m`/`remote-transport`/`remote-capture`; `cargo test --features remote` executa; o build default segue verde sem o env. Com isto a família Remote local (#1148/#1129/#1130/#1132) deixa de ser "cega".

