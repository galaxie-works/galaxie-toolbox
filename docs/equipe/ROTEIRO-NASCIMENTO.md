# ROTEIRO DE NASCIMENTO — as 11 sessões do time novo
Wagner: você cria as sessões no app; este roteiro faz cada uma nascer em ~30s. **Ordem importa:** Hiparco → Polaris → resto.

## Regra única, pra TODAS
| Campo | Valor |
|---|---|
| **cwd** | `G:\galaxie_development\galaxie-toolbox` ← o CLONE (não a pasta-mãe `G:\galaxie_development`, que não é git). É isso que faz todos caírem na MESMA memória e enxergarem o canon. |
| **Título** | o nome de batismo (Polaris, Mira, …) |
| **Modelo** | Opus 5 high: Polaris · Altair · Castor · Pollux · Mizar · Alcor · Lúmen · Íris. Sonnet 5 high (ou Fable): Mira · Atlas · Hiparco. |
| **1ª mensagem** | o PROMPT DE BOOT abaixo, colado inteiro |

---

## PROMPT DE BOOT (colar como 1ª mensagem — trocar só `<NOME>`)

```
Você é <NOME>, membro do time GALAXIE. Faça o boot nesta ordem, lendo do repo em que está (G:\galaxie_development\galaxie-toolbox):
1. TEAM-CANON.md (raiz) — a lei. Leia inteiro.
2. docs/equipe/IDENTIDADES-DO-TIME.md — sua seção "<NOME>" + as regras comuns do topo. (Sua identidade também já está na memória como identidade-<nome>.md, semeada pelo Hiparco — leia; NÃO recrie.)
3. docs/equipe/CONTEXT-SEEDS.md — sua seção "<NOME>Context" + os fatos comuns.
Depois: (a) crie o seu <NOME>Context.md na pasta de memória desta sessão (a derivada do cwd — os outros papéis usam a mesma pasta) com o seed como ponto de partida, e adicione UMA linha dele no MEMORY.md; (b) confirme que o gh está autenticado ($env:GH_TOKEN=$env:GITHUB_PERSONAL_ACCESS_TOKEN) e poste na issue #133 do repo galaxie-works/galaxie-toolbox um "🌱 <NOME> nasceu — papel X, boot completo" curto; (c) me responda em 3 linhas: quem você é, o que fará primeiro, e o que precisa de mim. Nada além disso até eu confirmar.
```
> Só o Hiparco escreve arquivos de identidade (nasce primeiro e semeia os 11). Os outros só LEEM a sua e criam o próprio Context — um autor por arquivo, sempre.

---

## Ordem e particularidades

### 1º — Hiparco (Bibliotecário) · Sonnet/Fable
Nasce PRIMEIRO porque prepara a casa (por isso o boot dele é a exceção: no passo 2 ainda não existe identidade-hiparco.md — ele lê direto do repo). Além do boot padrão, a 2ª mensagem dele é:
```
Execute sua 1ª passada (CONTEXT-SEEDS §Hiparco / canon §8.6):
(1) Semeie a memória DESTA sessão (a pasta de memória derivada do cwd G:\galaxie_development\galaxie-toolbox — é a mesma que os outros 10 papéis vão usar): MEMORY.md como índice + um identidade-<nome>.md por papel (fatie docs/equipe/IDENTIDADES-DO-TIME.md em 11 arquivos, repetindo as "regras comuns" do topo em cada um). Os Context.md NÃO — cada papel cria o próprio no boot.
(2) Na memória VELHA (C:\Users\consa\.claude\projects\G--OneDrive---Galaxie-Works-Ltd-Galaxie-Works-Ltd-Customer--voaz\memory\) adicione, no TOPO das âncoras listadas no seu seed, o header "SUPERSEDED → TEAM-CANON (repo galaxie-toolbox)". Só o header — NÃO migre o sprawl, NÃO delete nada (é o arquivo histórico).
(3) Reporte na #133: o que semeou (lista dos 11) e o que marcou.
```

### 2º — Polaris (SM/Integrador) · Opus 5
Boot padrão. Depois, 2ª mensagem:
```
Faça seu 1º sweep (CONTEXT-SEEDS §Polaris): reconcilie o board (IDs de coluna via GraphQL — a semântica nova tem Done E Released), mova #440/#441/#1000 pra done, feche #717, drene Rejected, confira #1263 e o resgate do teste lumen/802-803. Reporte na #133. Sessões novas de produtor XL você cria; os 4 devs já vão existir.
```

### 3º ao 11º — em qualquer ordem, boot padrão
Mira · Altair · Castor · Pollux · Mizar · Alcor · Lúmen · Íris · Atlas.
- **Atlas** 2ª mensagem: `Suas 2 primeiras tarefas do seed: (1) confirmar que RELEASES.md e as notas da v0.45.1 estão publicados; (2) investigar/fechar #1258+#1264 (modal de update) junto com um dev FE via Polaris.`
- **Devs**: só o boot; ficam livres até o Polaris despachar (dizem isso na #133).

---

## Sobre a thread que você já abriu (local_b39bfeaa…, Fable 5)
cwd dela = `G:\galaxie_development` (pasta-mãe, não-git) → memória em pasta errada. **Feche/arquive e reabra como Hiparco com o cwd certo** (`...\galaxie-toolbox`). Modelo Fable serve pro papel.

## Atalho do PO
Reconstruir `Bridge (pre-prod).lnk` apontando pro clone novo (`G:\galaxie_development\galaxie-toolbox`, `pnpm tauri dev` na branch pre-prod).

## Checklist final do cutover
- [ ] 11 sessões nascidas com cwd certo (11 "🌱 nasceu" na #133)
- [ ] Hiparco: memória semeada + velhas marcadas superseded
- [ ] Polaris: 1º sweep reportado
- [ ] Sessões velhas (Polaris II, Confucius, Vega, Sirius, Lúmen II, Altair) arquivadas
- [ ] `Bridge (pre-prod).lnk` funcionando
- [ ] `C:\dev` congelado (não deletar por 1-2 releases)
