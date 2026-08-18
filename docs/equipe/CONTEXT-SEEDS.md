# CONTEXT SEEDS — estado de nascimento de cada sessão
v1.0 · 2026-08-18 · No cutover, o Hiparco fatia em `<Nome>Context.md` na memória. Fatos apurados nas auditorias de 18/08 — **verificar o perecível antes de agir** (SHAs/IDs envelhecem).

**Fatos comuns (todos):** casa do projeto = **`G:\galaxie_development\galaxie-toolbox`** (clone novo, branch `pre-prod`; SSD fora do OneDrive). Worktrees: **`G:\galaxie_development\wt\<nome>-<issue>`**. `git -C` no PowerShell (`cd` no Bash pode dar ENAMETOOLONG). O mundo velho (`C:\dev\galaxie-toolbox` + ~150 worktrees) está **CONGELADO** — arquivo morto, não trabalhar lá. gh auth: `$env:GH_TOKEN=$env:GITHUB_PERSONAL_ACCESS_TOKEN`; REST > GraphQL (só board é GraphQL; paginar com cursor — 230+ itens). Board: project 3 do user `galaxie-works` (`PVT_kwHOD_4JN84BedaN`).

---

## PolarisContext (SM)
- **1º sweep (canon §8.6):** reconciliar o board inteiro. Já mapeado: `#440`/`#441` (mergeados no PR #447) e `#1000` (PRs #1002/#1005) → mover pra done · `#717` Shell 15/15 → fechar · confirmar IDs atuais das colunas via GraphQL (memória de IDs pode estar velha; semântica nova tem Done E Released separados).
- **Resgates pendentes:** cherry-pick do teste `lumen-provider-surface-contract.test.ts` (branch `lumen/802-803-adversarial-qa` — único órfão real em 640 PRs) · conferir se PR **#1263** (`altair/1262-ratchet-json`, oxlint-ratchet) já integrou; se não, integrar.
- **Remote:** #1132/#1133 (enrollment + ice_servers /v2/ws) estavam Ready sem PR enquanto o P0 #1108 foi "Released" — verificar dependência antes de despachar por cima.
- Gate de integração: tsc -b · vite build · node --test · cargo check (sem env OpenSSL). RC.EXE do Win SDK se testes Rust.

## MiraContext (Groomer)
- **Pendências de grooming a fechar com o `Wagner` (ou/ou fechado, uma por post):** ① Atoms A3–A7 (#442–446, mortos 15d) — retomar ou arquivar? ② "ajuste da animação" (#133 ~C599, 07/08, vago) — detalhar ou dar superado? ③ `.msg` no Salvar-como — decisão de remover (#651) nunca aplicada; fica ou sai? ④ docx #930 — fidelidade (docx-preview) vs responsividade (mammoth) — parado aguardando PO. ⑤ #1221 ícones órfãos (15 MB).
- Backlog atual: 307 issues; épicos de auditoria #1006–1013 em andamento; Astro #180 parqueado (0/4, 20d).
- Ao groomar: Size correto É a régua de execução; flag "sem superfície de runtime" nos cards de infra.

## AltairContext (Arquiteto)
- Infra do Remote é minha (#1184): stack `infra/remote/` (compose+coturn) OPERAR, não construir; relay endurecido, TTL ok, `turn_secret` rotacionado (18/08).
- Threat-models fechados: #1049 (canal v2), #1052 (SEC4). Parecer Iroh: não trocar (emenda #1187 após #1182).
- Padrões meus em voo: resolvedor único de Esc (#gatilho), webview/overlay do Navigator (#1163→#1179).

## Castor / Pollux / Mizar / AlcorContext (Devs)
- **Raia vazia — big-bang.** Aguardo primeiro despacho do `Polaris` (não pego card sozinho; livre = pingo na #133).
- Convenções: worktree `G:\galaxie_development\wt\<meunome>-<issue>` off pre-prod (canon §8.2; o path antigo `C:\dev\gt-…` está congelado) · core.autocrlf=true + conferir `git diff --cached` (EOL LF) · pnpm · gate local verde antes de In review · commit com `-c user.name` · PR `Closes #US` (ou `Ref` em fatia).
- (BE) OPENSSL_DIR do PostgreSQL 16 + OPENSSL_NO_VENDOR=1 só quando compilar str0m de fato; default é openssl-free.

## LumenContext (QA-A)
- Gate a partir de **Done**, snapshot confirmado (`git rev-parse HEAD` antes; bash quebrado no parse NÃO rodou o reset → snapshot velho já me enganou).
- Gates estáticos herdados: i18n-hardcoded (#861) em card de UI; botão-morto exige AST.
- Fila em Done: levantar no 1º sweep (mundo pós-cutover; não confiar em lista velha).
- Casos-lição: #1067 (rejeitei manifesto parcial 2×, ambas certas) — o padrão é reproduzir o caminho adversarial do AC, não re-rodar o teste do autor.

## IrisContext (QA-V)
- Ferramentas e limites: `preview_start http://localhost:1420` fora do Tauri = dados MOCK (loga qualquer email); `read_page` funciona headless, `screenshot` só com pane visível; Chrome do Wagner (claude-in-chrome) liberado mas NÃO alcança arquivo local (sem IPC Tauri).
- Regra de ouro: visual = screenshot real + classes conferidas NO CÓDIGO (padrão-ouro: FolderSidebar do Bridge / `SidebarNavItem`). Jornada completa: atalho precisa entrada E saída (rejeição #968).
- Primeiro alvo previsível: #1258+#1264 (modal de update — copy cósmica + loop do updater) quando integrarem.

## AtlasContext (Deploy Manager)
- **Feito antes de mim (18/08):** 47 releases (v0.9.4→v0.44.0) com changelog real backfilled; `RELEASES.md` seed pronto no scratchpad do Polaris I → **commitar na raiz do repo** (1ª tarefa).
- **Anomalia a investigar (2ª tarefa):** tag `v0.45.0` existe no código SEM release publicada no repo de dist — publicar com notas ou entender o corte.
- Esteira: 2 repos (código: galaxie-toolbox · dist/updater: galaxie-toolbox-releases; release.yml builda assinado). Cota do Actions Free já deu job-0-steps — vermelho ≠ código.
- Bugs do MEU domínio em aberto: #1258 (copy do modal — copy pronta: "A GALAXIE evoluiu" / "GALAXIE has evolved"...) e #1264 (updater oferece a versão já instalada). O changelog que eu escrever alimenta esse modal (`latest.json`/body).
- Cadência: ~3 PO Approved. DoD completo no canon §6.

## HiparcoContext (Bibliotecário)
- **1ª passada = cutover §8.4:** fatiar IDENTIDADES-DO-TIME.md e CONTEXT-SEEDS.md em arquivos individuais na memória · marcar como `SUPERSEDED → TEAM-CANON` as âncoras velhas: board-workflow-kanban, in-review-e-gate-da-lumen, qa-gate-dirigido-por-coluna, lumen-ii-* (gate/identidade/instancia), sweep-rotina-gestor, watchdog-liveness-polaris, time-multiagente, time-mudanca-codex-out, protocolo-entrega-agente, paralelizar-subagents, board-mover-cards-em-tempo-real, polaris-dono-do-board, workflow-md-fonte-de-verdade (aponta pro canon) · deletar/redirecionar WORKFLOW.md no repo.
- Auditorias-fonte (18/08, sessão do Polaris I): auditoria-time-galaxie.md · auditoria-trabalho-orfao.md · auditoria-completude-mapa.md — a linha de base do novo mundo.
- Vigiar: contagem de msgs do Polaris (teto ~3-4k); Context.md fósseis (>2 dias sem update com trabalho em voo = cobrar).
