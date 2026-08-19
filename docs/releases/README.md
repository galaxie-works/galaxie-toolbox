# Notas de release — a fonte única do changelog

**Dono:** Deploy Manager (`atlas`) · **Mecanismo:** #1270 · **Lei:** TEAM-CANON §6

## A regra

Toda tag `vX.Y.Z` precisa de um arquivo **`docs/releases/vX.Y.Z.md`**, commitado
**junto do bump de versão, dentro da tag**.

Esse arquivo é a **fonte única** de duas coisas que o canon §6.7 exige serem
iguais:

1. o **corpo da release** publicada em `galaxie-works/galaxie-toolbox-releases`;
2. o campo **`notes` do `latest.json`** — que é literalmente o texto que o
   usuário vê no modal de atualização.

## Sem o arquivo, a release NÃO sai

O `release.yml` resolve as notas em `scripts/notas-release.ps1`, **antes do
build**, e falha com mensagem explicando o que falta e como resolver.

Isso é intencional. Antes do #1270 o workflow gravava `notes = "GALAXIE <tag>"`
— um placeholder. A release saía "com sucesso", o feed nascia mudo, e o defeito
só aparecia quando alguém abria o modal de update. Na v0.45.1 o `latest.json`
teve de ser corrigido à mão depois de publicado.

**Falha ruidosa é mais barata que default silencioso.**

## Formato

Markdown livre, em **linguagem de usuário** — quem lê isto é quem usa o app, não
quem escreveu o commit. Derive de:

```bash
git log <tag-anterior>..vX.Y.Z --oneline
```

Exemplo:

```markdown
## O que mudou

- O Bridge agora abre anexos `.msg` direto na lista, sem baixar.
- Correção: o login em etapas voltava à primeira tela ao trocar de conta.
- Atualizações ficaram mais rápidas: o instalador não rebaixa mais a versão já instalada.
```

## Relação com o `RELEASES.md`

Não são a mesma coisa e não se substituem:

| Arquivo | O que é |
|---|---|
| `RELEASES.md` (raiz) | Ledger — **uma linha por versão**, "o que está no ar" |
| `docs/releases/vX.Y.Z.md` | Changelog **completo** daquela versão, que vai ao usuário |
