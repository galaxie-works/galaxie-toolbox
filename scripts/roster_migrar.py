#!/usr/bin/env python3
"""roster_migrar.py -- migrador do ROSTER.md-markdown -> 11 roster/<papel>.json (#1654 fatia 2a).

A fatia 1 (`roster_guarda.py`) instalou o schema FECHADO + a guarda de escrita. Esta fatia LE o
ROSTER.md-log velho (a "tabela" que e um LOG: 3/11 linhas partidas por `|` na prosa) e destila cada
linha nos campos do schema, produzindo um `<papel>.json` que PASSA a `roster_guarda.validar`.

Fronteira (contrato do split, @galaxie-polaris):
  * **Zero mutacao de memoria viva.** Escreve so no `--out-dir` (staging); NAO toca o ROSTER.md/
    sessoes.json vivos. O cutover (fatia 2b, Mizar+Hiparco) e outra raia.
  * **A narrativa da coluna Estado NAO entra no schema.** O `**...**` inicial da vira o `estado`
    (enum); todo o resto da coluna (+ cron + tick-log) e PROSA -> vai pro historico (#1653), nunca
    pro `titulo` nem pra campo nenhum. O migrador PRESERVA essa prosa num sidecar pra ela nao se
    perder -- destilar nao e deitar fora.
  * **O JSON bate o schema da fatia 1 por CONSTRUCAO** -- cada objeto passa por `roster_guarda.validar`
    antes de contar como MIGRADO; falhar a validacao e RECUSADO (com o campo+porque da guarda).

Tres desfechos por linha (o PO pediu-os explicitos):
  * **MIGRADO** -- extraiu os campos e o JSON validou.
  * **RECUSADO** -- e uma linha de papel, mas um campo nao satisfaz o schema (id de sessao ausente,
    `nasceu` nao-data, estado desconhecido, ...). Diz QUAL campo e porque.
  * **ILEGIVEL** -- nem da pra reconhecer como linha de papel (papel fora dos 11, colunas a menos).

Uso:
  python roster_migrar.py --roster-md <ROSTER.md> --out-dir <dir>   # migra
  python roster_migrar.py --roster-md <ROSTER.md> --out-dir <dir> --dry-run   # so relatorio
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roster_guarda as g  # o schema fechado + validar() = o contrato desta migracao

# Nome de exibicao (col 1 do ROSTER.md velho) -> chave do enum. Os acentos (Lumen/Iris) NAO caem por
# `.lower()` (daria "lumen"/"iris" com acento -> fora do enum ASCII); o mapa e explicito e fechado.
PAPEL_DISPLAY = {
    "Polaris": "polaris", "Mira": "mira", "Altair": "altair", "Castor": "castor",
    "Pollux": "pollux", "Mizar": "mizar", "Alcor": "alcor", "Lúmen": "lumen",
    "Íris": "iris", "Atlas": "atlas", "Hiparco": "hiparco",
}

MIGRADO, RECUSADO, ILEGIVEL = "MIGRADO", "RECUSADO", "ILEGIVEL"

# `2026-08-20 14:18` ou `2026-08-27 14:22Z` (space ou T; Z opcional) -> ISO `...T...Z` do schema.
_DATA = re.compile(r"(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)Z?")
_ENC_ORD = re.compile(r"(\d+)ª")            # "2ª", "(4ª do nome)", "7ª (Polaris VII)"
_SESSAO_ID = re.compile(r"`(local_[0-9a-fA-F-]{36})`")  # id entre crases na col 3
_ASPAS = re.compile(r'"([^"]+)"')           # 1o "titulo da sessao" na col 3
_BOLD = re.compile(r"\*\*(.+?)\*\*")        # 1o **marcador** da col 5 (o estado)


class LinhaIlegivel(Exception):
    """Nem da pra reconhecer como linha de papel (ILEGIVEL)."""


class LinhaRecusada(Exception):
    """E linha de papel, mas um campo nao satisfaz o schema (RECUSADO). Carrega campo+porque."""


def _papel_da_col(col1):
    """Chave do enum a partir da col 1 (`Alcor (Dev BE)`). ILEGIVEL se o nome nao e dos 11."""
    nome = col1.strip().split("(")[0].strip()
    papel = PAPEL_DISPLAY.get(nome)
    if papel is None:
        raise LinhaIlegivel(f"papel {nome!r} fora dos 11 (col 1 nao e linha de papel)")
    return papel


def _titulo_da_col(col1):
    """`titulo` (descritor do papel) = o que esta nos parenteses da col 1: `Alcor (Dev BE)` -> 'Dev BE'."""
    m = re.search(r"\((.+)\)", col1)
    if not m or not m.group(1).strip():
        raise LinhaRecusada("titulo: col 1 sem descritor entre parenteses (`Papel (descritor)`)")
    return m.group(1).strip()


def _encarnacao_da_col(col2):
    """`encarnacao` (int >= 1) do 1o `\\d+ª` da col 2. '2ª (Alcor II)'->2, '**IV** (4ª do nome)'->4."""
    m = _ENC_ORD.search(col2)
    if not m:
        raise LinhaRecusada(f"encarnacao: col 2 {col2.strip()!r} sem ordinal `Nª`")
    return int(m.group(1))


def _sessao_da_col(col3):
    """`sessao` {id, titulo} da col 3: `local_<uuid>` entre crases + 1o \"titulo\" entre aspas."""
    mid = _SESSAO_ID.search(col3)
    if not mid:
        raise LinhaRecusada("sessao.id: col 3 sem `local_<uuid>` entre crases")
    mtit = _ASPAS.search(col3)
    if not mtit:
        raise LinhaRecusada("sessao.titulo: col 3 sem \"titulo\" entre aspas")
    return {"id": mid.group(1), "titulo": mtit.group(1).strip()}


def _nasceu_da_col(col4):
    """`nasceu` ISO do 1o timestamp da col 4. '2026-08-20 14:18' -> '2026-08-20T14:18Z'."""
    m = _DATA.search(col4)
    if not m:
        raise LinhaRecusada(f"nasceu: col 4 {col4.strip()!r} sem data `YYYY-MM-DD HH:MM`")
    return f"{m.group(1)}T{m.group(2)}Z"


def _estado_da_col(col5):
    """`estado` (enum) do 1o **marcador** da col 5, por palavra-chave. O RESTO da col e narrativa."""
    m = _BOLD.search(col5)
    alvo = (m.group(1) if m else col5).upper()
    if "RECICLAD" in alvo:
        return "reciclado"
    if "PARAD" in alvo:
        return "parado"
    if "VIVO" in alvo or "VIVA" in alvo:
        return "vivo"
    raise LinhaRecusada(
        f"estado: marcador {alvo[:40]!r} nao mapeia pra {g.ESTADOS} (vivo/parado/reciclado)")


def _papel_candidato(linha):
    """O papel se `linha` E um candidato a linha de papel (col 1 comeca por um dos 11), senao None.

    A CANDIDATURA e por NOME de papel, nao por contagem de colunas: uma linha `|`-tabela cujo col 1
    nao e um dos 11 e outra tabela/nota do doc -> ignora-se em SILENCIO (nao e ILEGIVEL). ILEGIVEL fica
    reservado a uma linha que E de papel (col 1 reconhecido) mas esta partida demais pra migrar -- ai
    perde-se dado real e tem de GRITAR, nao sumir."""
    partes = linha.split("|")
    if len(partes) < 2:
        return None
    try:
        return _papel_da_col(partes[1])
    except LinhaIlegivel:
        return None


def migrar_linha(linha):
    """Destila UMA linha de papel (ja sabida candidata + com >= 5 colunas) nos campos do schema.
    Retorna (papel, MIGRADO, obj, narrativa) ou levanta `LinhaRecusada(campo: porque)`.

    O split e por `|` mas so consome as 5 primeiras colunas: a col 5 traz o **estado** no inicio e a
    prosa (com `|` a vontade) no resto -- por isso `|` na narrativa NAO parte a extracao dos campos."""
    partes = linha.split("|")
    col1, col2, col3, col4 = partes[1], partes[2], partes[3], partes[4]
    # Col 5 em diante = estado + narrativa (a prosa pode ter `|`, por isso re-junta o resto).
    resto = "|".join(partes[5:])
    papel = _papel_da_col(col1)
    try:
        obj = {
            "schema": g.SCHEMA,
            "papel": papel,
            "titulo": _titulo_da_col(col1),
            "encarnacao": _encarnacao_da_col(col2),
            "sessao": _sessao_da_col(col3),
            "nasceu": _nasceu_da_col(col4),
            "estado": _estado_da_col(resto),
            # A migracao NAO fabrica paragem nem tick: a prosa da col 5+ nao da um {desde,por,motivo}
            # nem um ISO limpo com confianca -> null honesto (o proximo boot do papel preenche).
            "paragem_declarada": None,
            "tick_declarado": None,
        }
        g.validar(obj)  # o contrato: bate o schema fechado da fatia 1 por CONSTRUCAO
    except g.RosterInvalido as e:
        raise LinhaRecusada(f"schema: {e}") from e
    return papel, MIGRADO, obj, resto.strip()


def migrar_texto(texto):
    """Migra as linhas de PAPEL do ROSTER.md (col 1 = um dos 11). Linhas de outras tabelas/notas sao
    ignoradas em silencio. Uma linha ma NAO contamina as outras (isolamento). Ordem = a do ficheiro."""
    resultados = []
    for linha in texto.splitlines():
        s = linha.strip()
        if not s.startswith("|") or set(s) <= set("|-: "):  # nao-tabela ou separador `|---|`
            continue
        if s.startswith("| papel |") or s.startswith("| Papel |"):  # cabecalho da tabela nova
            continue
        papel = _papel_candidato(linha)
        if papel is None:
            continue  # nao e linha de papel -> ignora silente (nao e ILEGIVEL)
        if len(linha.split("|")) < 6:  # candidata mas truncada: E de papel e nao migra -> GRITA
            resultados.append(
                (papel, ILEGIVEL, f"colunas a menos ({len(linha.split('|')) - 1} < 5) -- linha de papel truncada", ""))
            continue
        try:
            resultados.append(migrar_linha(linha))
        except LinhaRecusada as e:
            resultados.append((papel, RECUSADO, str(e), ""))
    return resultados


def escrever_saidas(resultados, out_dir):
    """Escreve os `<papel>.json` MIGRADOS + um sidecar com a narrativa preservada (pro #1653).
    NAO toca memoria viva -- tudo em `out_dir` (staging)."""
    os.makedirs(out_dir, exist_ok=True)
    hist = ["# Narrativa da coluna Estado do ROSTER.md velho -- preservada na migracao (#1654 2a).",
            "# Destilada FORA do schema (nao entra no titulo nem em campo nenhum); alvo = #1653.", ""]
    escritos = []
    for papel, status, payload, narrativa in resultados:
        if status != MIGRADO:
            continue
        caminho = os.path.join(out_dir, f"{papel}.json")
        with open(caminho, "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        escritos.append(caminho)
        if narrativa:
            hist.append(f"## {papel}\n{narrativa}\n")
    with open(os.path.join(out_dir, "historico-narrativa.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(hist) + "\n")
    return escritos


def _relatorio(resultados):
    linhas, contagem = [], {MIGRADO: 0, RECUSADO: 0, ILEGIVEL: 0}
    for papel, status, payload, _ in resultados:
        contagem[status] += 1
        alvo = papel or "?"
        detalhe = "" if status == MIGRADO else f" -- {payload}"
        linhas.append(f"  [{status}] {alvo}{detalhe}")
    cab = (f"{contagem[MIGRADO]} MIGRADO, {contagem[RECUSADO]} RECUSADO, "
           f"{contagem[ILEGIVEL]} ILEGIVEL (de {len(resultados)} linhas de tabela)")
    return cab, "\n".join(linhas), contagem


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    p = argparse.ArgumentParser(description="Migrador ROSTER.md -> roster/<papel>.json (#1654 2a)")
    p.add_argument("--roster-md", required=True, help="o ROSTER.md-log velho a migrar")
    p.add_argument("--out-dir", required=True, help="staging dos <papel>.json (NAO a memoria viva)")
    p.add_argument("--dry-run", action="store_true", help="so relatorio; nao escreve nada")
    a = p.parse_args(argv)

    with open(a.roster_md, encoding="utf-8") as f:
        resultados = migrar_texto(f.read())
    cab, corpo, contagem = _relatorio(resultados)

    if not a.dry_run:
        escritos = escrever_saidas(resultados, a.out_dir)
        print(f"Escritos {len(escritos)} <papel>.json + historico-narrativa.md em {a.out_dir}")
    print(cab)
    print(corpo)
    # Exit 0 se nada RECUSADO/ILEGIVEL; 3 se houve algo a rever (verde do CI = migracao limpa).
    sys.exit(0 if contagem[RECUSADO] == 0 and contagem[ILEGIVEL] == 0 else 3)


if __name__ == "__main__":
    main()
