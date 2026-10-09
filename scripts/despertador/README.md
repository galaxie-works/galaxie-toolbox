# Despertador — kit de recriação (DR)

**Glossário (fixado, para a palavra não virar lei torta):**
- **DESPERTADOR** = o sistema inteiro (pasta `G:\galaxie_development\despertador\`).
- **POLLER** = a metade grátis: `poller.ps1` + task Windows "GALAXIE-Despertador" (5/5 min, zero tokens). Pesca as notificações das 11 contas `galaxie-<papel>` (cofre DPAPI via `scripts/galaxie-pat.ps1`) e escreve `inbox\<papel>.json`.
- **PORTEIRO** = a metade de um neurônio: sessão Haiku, único LLM de plantão. Lê a inbox, entrega o payload ao dono por canal direto, move pra `entregues\`.

Na frase: *o poller pesca, o Porteiro entrega, o conjunto é o Despertador.*

## Máquina nova / formatação
```powershell
.\scripts\despertador\install.ps1
```
O instalador recria pasta, poller, template do `sessoes.json` e a task — e imprime o checklist do que só o humano faz (o cofre DPAPI **morre** com a formatação: reemitir os 11 PATs; abrir a sessão Porteiro; preencher `sessoes.json`).

## O que fica FORA do repo, e por quê
- `%LOCALAPPDATA%\galaxie-pat\*.dat` — segredos (DPAPI, por usuário). `.gitignore` já blinda `*.dat`.
- `despertador\sessoes.json` real, `state.json`, `poller.log`, `inbox\`, `entregues\` — estado de runtime da máquina.

## Armadilhas conhecidas (pagas em produção)
- A task **deve rodar como o usuário do PO** — como SYSTEM, o DPAPI não abre o cofre.
- `gh auth logout` limpa o hosts.yml mas **deixa resíduo no Credential Manager** → `cmdkey /delete:"gh:github.com:<conta>"`.
- O `ScheduleWakeup` do Porteiro é **session-only**: morre com o app/reboot → protocolo de amanhecer = um toque no Porteiro.
- Contas-papel em **Unwatch** do repo (Participating and @mentions), senão o sinal afoga.
