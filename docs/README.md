# Documentação — GALAXIE

Docs escopados **por área do app**. Cada pasta agrupa specs, research e replans de um módulo. Specs de design descrevem a *intenção* — o comportamento real vive no código; onde um doc é snapshot histórico, ele traz um banner de estado no topo.

| Área | Pasta | Conteúdo |
|---|---|---|
| **Arquivo** (histórico) | [`arquivo/`](arquivo/) | [`atoms-ux-replan.md`](arquivo/atoms-ux-replan.md), [`atoms-dashboard-spec.md`](arquivo/atoms-dashboard-spec.md) — Atoms foi **removido do app** em #1320 (decisão do PO 19/08); ficam como histórico, não como spec |
| **Bridge** (e-mail · agenda · people · previews) | [`bridge/`](bridge/) | [`bridge-file-previews-spec.md`](bridge/bridge-file-previews-spec.md), [`bridge-people-ux.md`](bridge/bridge-people-ux.md), [`people-nav-detail-ux.md`](bridge/people-nav-detail-ux.md), [`people-bulk-edit-research.md`](bridge/people-bulk-edit-research.md) |
| **Navigator** (navegador) | [`navigator/`](navigator/) | [`navigator-ux-spec.md`](navigator/navigator-ux-spec.md), [`navigator-arquitetura-research.md`](navigator/navigator-arquitetura-research.md), [`navigator-password-spike.md`](navigator/navigator-password-spike.md) |
| **Astro** (Galaxie AI) | [`astro/`](astro/) | [`galaxie-ai-discovery.md`](astro/galaxie-ai-discovery.md), [`astro-architecture.md`](astro/astro-architecture.md), [`astro-financial-model.md`](astro/astro-financial-model.md) — **discovery, não construído** |
| **Explorer** (arquivos locais) | [`explorer/`](explorer/) | [`undo-spike.md`](explorer/undo-spike.md) |
| **Remote** (acesso remoto) | [`remote/`](remote/) | [`remote-s0-infra.md`](remote/remote-s0-infra.md), [`remote-s0-validation.md`](remote/remote-s0-validation.md), [`remote-s7-worker-session-channel.md`](remote/remote-s7-worker-session-channel.md), [`remote-s8-device-agent.md`](remote/remote-s8-device-agent.md), [`remote-s8-contrato-seguranca.md`](remote/remote-s8-contrato-seguranca.md), [`spike-rasystem.md`](remote/spike-rasystem.md) |
| **Referência** (cross-cutting) | [`reference/`](reference/) | [`graph-scopes.md`](reference/graph-scopes.md) — os 101 escopos Microsoft Graph concedidos · [`config-seam.md`](reference/config-seam.md) — seam de config/persistência, escopo por tenant e reset de sessão |

Arquivo solto: [`qa-visual.md`](qa-visual.md) — como capturar evidência visual de QA (app rodando, tema claro/escuro).

## Processo, operação e histórico

Pastas que **não** são de módulo — servem à equipe e à operação:

| Área | Pasta | Conteúdo |
|---|---|---|
| **Equipe** (processo/onboarding) | [`equipe/`](equipe/) | [`IDENTIDADES-DO-TIME.md`](equipe/IDENTIDADES-DO-TIME.md) e [`CONTEXT-SEEDS.md`](equipe/CONTEXT-SEEDS.md) — de onde nascem os papéis; [`CASOS.md`](equipe/CASOS.md), [`ROTEIRO-NASCIMENTO.md`](equipe/ROTEIRO-NASCIMENTO.md), auditorias |
| **Curadoria** (catálogo de apps) | [`curadoria/`](curadoria/) | os apps do command/launcher por categoria (`apps-*.md`) |
| **Releases** | [`releases/`](releases/) | notas de release por versão (`v0.46.0.md`…) + índice |
| **Runbooks** | [`runbooks/`](runbooks/) | [`maquina-compartilhada.md`](runbooks/maquina-compartilhada.md) — runtime na máquina do PO (navegador, portas, higiene) |
| **História** | [`historia/`](historia/) | [`cutover-2026-08-18.md`](historia/cutover-2026-08-18.md) — a migração de casa do projeto |

A **lei do processo** é o [`TEAM-CANON.md`](../TEAM-CANON.md) na raiz (fonte única; o antigo `WORKFLOW.md` é só um redirect pra ele). Instruções operacionais dos agentes: [`AGENTS.md`](../AGENTS.md) (método, board, fluxo) e [`Rules.md`](../Rules.md) (UI/UX, não-inventar-UI). O roadmap vivo é o board (GitHub Projects #3).
