#!/usr/bin/env python3
"""auditoria_consumo.py — produtor do consumo_diario do galaxie.db (#1663, feeder do #1653).

Le os transcripts do Claude Code (`<projects>/<session-id>.jsonl`, 1 por sessao; cada turno
de assistente traz um bloco `usage`), soma o consumo por (dia, papel) e escreve no galaxie.db
via o verbo FECHADO `registrar-consumo --substituir` (nao SQL cru -> AC1). O `--substituir`
faz o re-scan ser IDEMPOTENTE: re-rodar ATUALIZA a linha, nao dobra (AC2). O recibo de
domingo sai depois de `galaxie-db.ps1 consultar recibo-semanal` (AC3).

⚠️ **session -> papel e HEURISTICA, nao um join.** O nome do `.jsonl` e o id do HARNESS, nao
o id ccd (`local_<uuid>`) do roster/`sessoes.json` -- namespaces diferentes (FATOS: "tres ids
a solta"). Resolve-se por: (1) o boot `"Bem-vindo, <Papel>"` (sessoes novas); senao (2) o
`<Papel>Context.md` mais citado (sessoes antigas); senao `desconhecido`. Medido: um transcript
e predominantemente UM papel (ex.: um .jsonl cita `PolluxContext` 299x = sessao do Pollux).

peso = tokens FATURADOS (decisao do PO): input + output + cache_creation. cache_read conta a
parte (mais barato). chamadas = nº de turnos de assistente.

Uso: python auditoria_consumo.py --db <galaxie.db> [--transcripts-dir <dir>] [--desde YYYY-MM-DD] [--dry-run]
"""
import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import galaxie_db

PAPEIS = {"polaris", "mira", "altair", "castor", "pollux", "mizar",
          "alcor", "lumen", "iris", "atlas", "hiparco"}
_ACENTOS = str.maketrans("úíéóáãâêôç",
                         "uieoaaaeoc")  # ú í é ó á ã â ê ô ç -> ascii
BOOT = re.compile(r"Bem-vindo, ([A-Za-zÀ-ÿ]+)")
CTXREF = re.compile(r"([A-Za-zÀ-ÿ]+)Context", re.I)


def _canon(nome):
    s = nome.lower().translate(_ACENTOS)
    return s if s in PAPEIS else None


def escanear(caminho, desde):
    """Um passo pelo transcript: acumula usage por dia + colhe sinais de papel.
    Devolve (por_dia, boot_papel, votos_context)."""
    por_dia = defaultdict(lambda: [0, 0, 0, 0, 0])  # [chamadas, input, output, cache_read, cache_creation]
    boot = None
    votos = Counter()
    with open(caminho, encoding="utf-8", errors="replace") as fh:
        for linha in fh:
            if boot is None and "Bem-vindo," in linha:
                m = BOOT.search(linha)
                if m:
                    boot = _canon(m.group(1))
            if "ontext" in linha:  # captura Context/context sem custar em toda linha
                for m in CTXREF.finditer(linha):
                    c = _canon(m.group(1))
                    if c:
                        votos[c] += 1
            if '"usage"' not in linha:
                continue
            try:
                o = json.loads(linha)
            except (json.JSONDecodeError, ValueError):
                continue
            if o.get("type") != "assistant":
                continue
            u = (o.get("message") or {}).get("usage")
            if not isinstance(u, dict):
                continue
            dia = (o.get("timestamp") or "")[:10]
            if not dia or (desde and dia < desde):
                continue
            a = por_dia[dia]
            a[0] += 1
            a[1] += u.get("input_tokens") or 0
            a[2] += u.get("output_tokens") or 0
            a[3] += u.get("cache_read_input_tokens") or 0
            a[4] += u.get("cache_creation_input_tokens") or 0
    return por_dia, boot, votos


def resolver_papel(boot, votos):
    if boot:
        return boot
    if votos:
        return votos.most_common(1)[0][0]
    return "desconhecido"


def apurar(transcripts_dir, desde):
    """(dia, papel) -> [chamadas, output, cache_read, peso], mais a lista de ficheiros."""
    total = defaultdict(lambda: [0, 0, 0, 0])
    ficheiros = sorted(x for x in os.listdir(transcripts_dir) if x.endswith(".jsonl"))
    for nome in ficheiros:
        por_dia, boot, votos = escanear(os.path.join(transcripts_dir, nome), desde)
        papel = resolver_papel(boot, votos)
        for dia, (chamadas, inp, out, cread, ccreate) in por_dia.items():
            t = total[(dia, papel)]
            t[0] += chamadas
            t[1] += out
            t[2] += cread
            t[3] += inp + out + ccreate  # peso = tokens faturados
    return total, ficheiros


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    p = argparse.ArgumentParser(description="Produtor do consumo_diario (#1663)")
    p.add_argument("--db", default=os.environ.get("GALAXIE_DB"), help="galaxie.db (default $GALAXIE_DB)")
    p.add_argument("--transcripts-dir", default=os.path.join(
        os.environ.get("USERPROFILE", os.path.expanduser("~")),
        ".claude", "projects", "G--galaxie-development-galaxie-toolbox"))
    p.add_argument("--desde", help="so dias >= YYYY-MM-DD")
    p.add_argument("--dry-run", action="store_true", help="imprime, nao escreve")
    a = p.parse_args(argv)

    if not os.path.isdir(a.transcripts_dir):
        raise SystemExit(f"transcripts-dir nao existe: {a.transcripts_dir}")

    total, ficheiros = apurar(a.transcripts_dir, a.desde)
    linhas = sorted(total.items())

    if a.dry_run:
        for (dia, papel), (chamadas, out, cread, peso) in linhas:
            print(f"{dia} {papel:12} chamadas={chamadas} output={out} cache_read={cread} peso={peso}")
        print(f"# DRY-RUN: {len(linhas)} linhas (dia,papel) de {len(ficheiros)} transcripts. Nada escrito.")
        return

    if not a.db:
        raise SystemExit("faltou --db (ou $GALAXIE_DB) -- ou usa --dry-run")
    con = galaxie_db.conectar(a.db)
    try:
        galaxie_db.init(con)
        for (dia, papel), (chamadas, out, cread, peso) in linhas:
            galaxie_db.reg_consumo(con, SimpleNamespace(
                dia=dia, papel=papel, chamadas=chamadas, output=out,
                cache_read=cread, peso=peso, substituir=True))
    finally:
        con.close()
    print(json.dumps({"escritas": len(linhas), "transcripts": len(ficheiros)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
