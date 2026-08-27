# DR — Máquina nova / desastre (#1664)

> **Este runbook vive no REPO de propósito.** O que morre no desastre é a `memory/` — logo o guia para a recuperar **não pode viver lá dentro**. Está no GitHub, que sobrevive à máquina. Se estás a ler isto num clone acabado de fazer, estás no sítio certo.

**Dono:** Altair (Arquiteto). **Tempo:** ~15 min, dos quais 10 são colar tokens à mão.

---

## 0. O que existe, e em quantos sítios

O estado do time vive em **três** lugares, e **nenhum** está versionado hoje:

| lugar | o quê | medido em 2026-08-27 |
|---|---|---|
| `%USERPROFILE%\.claude\projects\G--galaxie-development-galaxie-toolbox\memory\` | ROSTER + Contexts + memórias + (futuro) `galaxie.db` | 67 ficheiros, 1,5 MB |
| `%LOCALAPPDATA%\galaxie-pat\` | cofre: 11 PATs cifrados DPAPI | 11 × `.dat`, ~620 B cada |
| repo (`galaxie-toolbox`) | código, canon, scripts, este runbook | GitHub — **já sobrevive** |

⚠️ **A `memory/` já perdeu dados 2×** (#1606). Não é hipótese: é histórico.

---

## 1. A regra central — **copiar vs RE-CRIAR**

Nem tudo se restaura. Meter os dois na mesma pasta convidaria a uma regra só, e **metade ficaria errada**:

| | cofre `*.dat` | `memory/` + `galaxie.db` |
|---|---|---|
| copiar para máquina nova | ❌ **INÚTIL** | ✅ **essencial** |
| porquê | **DPAPI é por-utilizador e por-máquina**: o ficheiro copiado é lixo cifrado que ninguém consegue abrir | é dado puro; copia e funciona |
| no desastre | **RE-REGISTAR** (colar os 11 tokens) | **RESTAURAR do backup** |

🔑 **Copiar o cofre não dá erro — dá um ficheiro que decifra a lixo.** É a pior classe de falha: parece que restauraste.

---

## 2. Rotina de backup — **o que falta hoje**

Não há nenhuma. É a causa das duas perdas do #1606.

**Recomendação (zero infra nova):** o OneDrive já está nesta máquina e já sincroniza. Uma cópia da `memory/` para dentro dele dá versionamento e cópia fora-da-máquina de graça:

```powershell
$origem  = "$env:USERPROFILE\.claude\projects\G--galaxie-development-galaxie-toolbox\memory"
$destino = "G:\OneDrive - Galaxie Works Ltd\Galaxie Works Ltd\_backup\memory"
robocopy $origem $destino /MIR /R:1 /W:1
```

⚠️ **`/MIR` espelha — apaga no destino o que sumiu na origem.** É o que se quer para um espelho, e é **exactamente errado** se a origem for corrompida antes da cópia. Quem quiser proteção contra isso usa destino com data (`_backup\memory-2026-08-27\`) em vez de espelho.

**O que NÃO vai para backup:** o cofre. Ver §1.

---

## 3. Restaurar — passos ordenados, com verificação em cada um

Faz na ordem. **Cada passo tem um comando que prova que correu** — não avances por fé.

**1. Clonar o repo**
```powershell
git clone https://github.com/galaxie-works/galaxie-toolbox.git
```
✔️ `Test-Path .\scripts\galaxie-pat.ps1` → `True`

**2. Restaurar a `memory/`** do backup para `%USERPROFILE%\.claude\projects\G--galaxie-development-galaxie-toolbox\memory\`
✔️ `(Get-ChildItem $destino).Count` ≥ 60 **e** `Test-Path "$destino\ROSTER.md"` → `True`

**3. Re-registar os 11 PATs** (não copiar!)
```powershell
.\scripts\galaxie-pat.ps1          # sem -Name = modo registo, pede os 11
```
Cada papel tem conta própria `galaxie-<papel>`; os tokens saem do gestor de segredos do PO. **Escopos largos (`project`+`repo`+`workflow`) são decisão registada do PO** (#1641) — não são descuido.
✔️ `(Get-ChildItem "$env:LOCALAPPDATA\galaxie-pat").Count` → `11`

**4. Provar a identidade, papel a papel**
```powershell
$env:GH_TOKEN = & .\scripts\galaxie-pat.ps1 -Name altair
gh api user --jq .login          # tem de dizer: galaxie-altair
```
⚠️ **Verifica com `gh api user`, NUNCA com `gh auth status`.** O script põe o PAT em `$env:GH_TOKEN` **por invocação** e **não toca no keyring** — de propósito, para não atropelar as outras sessões.

🔑 **A razão exata: `gh auth status` relata CONFIGURAÇÃO LOCAL; `gh api user` resolve IDENTIDADE NO SERVIDOR.** Com o `GH_TOKEN` vivo, o `auth status` mostra `(GH_TOKEN) Active: true` — não é um falso-negativo limpo, é **ambíguo**, que é pior. O `gh api user` bate no servidor, e por isso apanha **conta errada, token revogado e `Bad credentials`** — exatamente o que um DR precisa de distinguir. *(Correção da @galaxie-polaris sobre medição da @galaxie-mira; a minha primeira redação dizia "falso-negativo" e era imprecisa.)*

🔴 **E se o `gh api user` FALHAR (`Bad credentials`), pára — não é o mesmo que devolver o nome errado.** Um token inválido cega REST *e* GraphQL, e o erro é **indistinguível de "não encontrei nada"**. Três desfechos, não dois: nome certo → segue · nome errado → pára · **chamada falhou → pára, e investiga o token**.

**5. `galaxie.db`** — vem dentro da `memory/` restaurada (passo 2). Se não existir, é porque ainda não foi criada; a impl é o **#1655**.
✔️ `Test-Path "$destino\galaxie.db"`

**6. Despertador/Porteiro** — **não está aqui de propósito.** Kit de recriação no **#1650**.

---

## 4. Fronteiras (não duplicar)

- **#1650** — DR do Despertador/Porteiro.
- **#1655** — onde mora e como nasce o `galaxie.db`.
- **#1641** — migração conta-por-papel: mapa papel→username e a decisão dos escopos.

---

## 5. ⚠️ Este runbook não vale nada até ser EXERCIDO

Um DR nunca testado é uma redação, não um procedimento. **Antes de dar isto por bom**, alguém corre os passos 1–4 numa pasta limpa (não precisa de máquina nova: um utilizador Windows diferente já prova a parte do DPAPI, que é a única que engana).

**O que o teste tem de mostrar:** que o cofre copiado **falha** a decifrar noutro utilizador. Se não falhar, a premissa do §1 está errada e este documento inteiro precisa de revisão.
