# Arquitetura — diagramas

Diagramas dos subsistemas nucleares da suite **The GALAXIE**, em Mermaid (renderiza nativo no GitHub).

## Índice

| # | Diagrama | O que responde |
|---|---|---|
| 1 | [Visão de sistema](01-visao-de-sistema.md) | que peças existem e quem depende de quem |
| 2 | [Fluxo de dados](02-fluxo-de-dados.md) | por onde passa cada dado, e para fora de que fronteira |
| 3 | [Sequência de auth (PKCE)](03-sequencia-auth-pkce.md) | como uma credencial vira sessão sem o app a ver |
| 4 | [Remote](04-remote.md) | signaling, P2P e o fallback por TURN |
| 5 | [Autorização da plataforma](05-autz-plataforma.md) | quem pode o quê, e onde isso é decidido |

## Como ler estes diagramas

⚠️ **São o código MEDIDO, não o desenho ideal.** Cada ficheiro declara no topo:

- **o commit** contra o qual foi medido;
- **a data** da medição;
- **o que é _scaffold_** (existe como plano ou como esqueleto, não como caminho vivo).

🔑 **Um diagrama sem commit e sem data é uma afirmação sem condições de validade.** O código muda debaixo do desenho, e um desenho que não diz quando foi tirado não pode ser refutado — só acreditado. Quem editar um destes ficheiros **actualiza o cabeçalho**, ou o diagrama passa a mentir com a autoridade de estar versionado.

## Convenções

| marca | significa |
|---|---|
| linha cheia | caminho vivo, exercido em produção |
| linha tracejada | caminho condicional (feature-gate, fallback, configuração) |
| `[scaffold]` | existe no repositório, não é caminho vivo |
| `[0 código]` | existe como documento/plano, sem implementação |

## Âmbito

Cobrem os cinco subsistemas nucleares. **São extensíveis** — um subsistema novo entra como ficheiro novo e uma linha no índice, sem reescrever os outros.
