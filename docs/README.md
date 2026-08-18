# Documentação — GALAXIE

Docs escopados **por área do app**. Cada pasta agrupa specs, research e replans de um módulo. Specs de design descrevem a *intenção* — o comportamento real vive no código; onde um doc é snapshot histórico, ele traz um banner de estado no topo.

| Área | Pasta | Conteúdo |
|---|---|---|
| **Atoms** (dashboard) | [`atoms/`](atoms/) | [`atoms-ux-replan.md`](atoms/atoms-ux-replan.md) (retrabalho — **fonte de verdade**), [`atoms-dashboard-spec.md`](atoms/atoms-dashboard-spec.md) (spec original, superseded) |
| **Bridge** (e-mail · agenda · people · previews) | [`bridge/`](bridge/) | [`bridge-file-previews-spec.md`](bridge/bridge-file-previews-spec.md), [`bridge-people-ux.md`](bridge/bridge-people-ux.md), [`people-nav-detail-ux.md`](bridge/people-nav-detail-ux.md), [`people-bulk-edit-research.md`](bridge/people-bulk-edit-research.md) |
| **Navigator** (navegador) | [`navigator/`](navigator/) | [`navigator-ux-spec.md`](navigator/navigator-ux-spec.md), [`navigator-arquitetura-research.md`](navigator/navigator-arquitetura-research.md), [`navigator-password-spike.md`](navigator/navigator-password-spike.md) |
| **Astro** (Galaxie AI) | [`astro/`](astro/) | [`galaxie-ai-discovery.md`](astro/galaxie-ai-discovery.md), [`astro-architecture.md`](astro/astro-architecture.md), [`astro-financial-model.md`](astro/astro-financial-model.md) — **discovery, não construído** |
| **Explorer** (arquivos locais) | [`explorer/`](explorer/) | [`undo-spike.md`](explorer/undo-spike.md) |
| **Remote** (acesso remoto) | [`remote/`](remote/) | [`remote-s0-infra.md`](remote/remote-s0-infra.md), [`remote-s0-validation.md`](remote/remote-s0-validation.md), [`remote-s7-worker-session-channel.md`](remote/remote-s7-worker-session-channel.md), [`remote-s8-device-agent.md`](remote/remote-s8-device-agent.md), [`remote-s8-contrato-seguranca.md`](remote/remote-s8-contrato-seguranca.md), [`spike-rasystem.md`](remote/spike-rasystem.md) |
| **Referência** (cross-cutting) | [`reference/`](reference/) | [`graph-scopes.md`](reference/graph-scopes.md) — os 101 escopos Microsoft Graph concedidos · [`config-seam.md`](reference/config-seam.md) — seam de config/persistência, escopo por tenant e reset de sessão |

Instruções operacionais dos agentes ficam na raiz do repo: [`AGENTS.md`](../AGENTS.md) (método, board, fluxo) e [`Rules.md`](../Rules.md) (UI/UX, não-inventar-UI). O roadmap vivo é o board (GitHub Projects #3).
