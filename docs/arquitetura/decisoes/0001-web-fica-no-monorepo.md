# ADR 0001 — O `web/` fica no monorepo

> **Decisão:** não separar · **Data:** 2026-08-31 · **Autor:** Altair (Arquiteto)
> **Card:** [#1496](https://github.com/galaxie-works/galaxie-toolbox/issues/1496) (spike pedido pelo PO) · **Medido contra:** `pre-prod` em 2026-08-31

## A pergunta

A interface web da plataforma (`web/`, destino `platform.thegalaxie.cloud`) deve ser um **repositório separado** em vez de um workspace dentro do `galaxie-toolbox`?

**Gatilho:** o job `web` do CI corre mas não é *required*, e o dilema *"o web deve barrar o merge do desktop?"* foi lido como sintoma do monorepo.

## O que foi medido

```
web/src                             33 ficheiros · 187 KB
imports de web/ para FORA de web/   ZERO
   (o alias `@` do web aponta para o ./src DELE — web/vite.config.ts:23,
    web/tsconfig.json paths)
i18n                                web/src/i18n.ts
                                    vs  src/lib/{idioma-core,strings,...}
                                    -> sistemas SEPARADOS, nao partilhados
dependencias                        react-router-dom so no web · zero Tauri
                                    zero shadcn/plate/reui
   -> a sobreposicao e React/Tailwind/Vite/TS/Vitest = FERRAMENTA, nao codigo
```

⚠️ O enquadramento do card supunha que o código partilhado *"parece fino"* e citava *"contrato/i18n partilhados"* como argumento pró-monorepo. **O partilhado não é fino — é zero, e o i18n não é partilhado.**

## A decisão

**Não separar.** E o motivo **não** é o código partilhado.

🔑 **Pela régua que o card deu para decidir — *"o que decide é quanto código é partilhado"* — a resposta seria SEPARAR.** A decisão é a contrária porque a régua olhava para a coisa errada.

**Partilhar zero código é perfeitamente compatível com forte acoplamento.** O que liga o `web/` a este repositório é o **contrato HTTP** com o `platform-http` ([#1503](https://github.com/galaxie-works/galaxie-toolbox/issues/1503)): o `web/` não faz nada sozinho — cada ecrã é uma chamada a uma rota que vive aqui.

⚠️ **O split não muda o custo de partilhar. Muda ONDE a quebra aparece:**

| | monorepo (hoje) | repo separado |
|---|---|---|
| mudar uma rota consumida pelo web | **falha no MESMO PR**, antes de entrar | entra verde; parte **depois**, no outro repo |
| quem descobre | a CI, automaticamente | **uma pessoa**, quando lá for |

Hoje há deteção de deriva de contrato **de graça, por co-merge**. Separar troca um sinal **automático e imediato** por um **manual e diferido** — e paga-se essa troca para resolver um problema de *gate*, que é configuração.

## O problema real resolve-se sem mudar de repositório

O atrito não era do monorepo: era **um gate que não sabe o que mudou**. Cura:

- alterações que tocam `web/**` ⇒ o job `web` é **required**;
- alterações que não tocam `web/**` ⇒ o job **não corre** e não barra nada.

*(É a mesma forma de erro que aparece noutros sítios do projeto: perguntar **"correu?"** em vez de **"aplica-se?"**.)*

## ⚠️ A condição que INVERTE esta decisão

Separar passa a ser certo no primeiro dos dois que acontecer:

1. **O `web/` ganhar cadência de deploy própria** — quando tiver de sair sem o desktop sair (ou vice-versa), o co-merge deixa de descrever a realidade e passa a ser atrito puro; **ou**
2. **O contrato ficar verificável sozinho** — um teste de contrato que falhe no `platform-http` quando uma rota consumida pelo web muda. Aí a rede de segurança deixa de precisar do monorepo, e **o único argumento que sustenta esta decisão desaparece**.

🔑 **Quem reabrir o assunto com um destes dois medido tem razão contra este documento.** Uma decisão sem a condição que a inverte é um dogma.

## Consequências imediatas

- **Repositório novo:** não. `web/` fica como workspace pnpm.
- **CI/ruleset:** tornar o job `web` *required* **com filtro de caminho `web/**`**.
- **Cards em voo** (#1484 scaffold, #1489–1492): **zero impacto**.
- `platform.thegalaxie.cloud` continua o destino do `web/` — o registo DNS foi criado a 2026-08-31 ([#1549](https://github.com/galaxie-works/galaxie-toolbox/issues/1549)).
