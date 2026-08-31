#!/usr/bin/env python3
"""roster_guarda.py — a GUARDA de escrita do estado dos papeis (#1654, design #1652).

Substitui o ROSTER.md-markdown (LOG vestido de tabela: 3/11 linhas malformadas por `|`
na prosa, 2 truncagens por escrita full-file) por 1 JSON por papel com schema FECHADO.

O que a guarda faz, e porque:
  * VALIDA o schema ANTES de gravar — `schema`/`estado`/`papel` fechados tornam "dado
    inesperado" em ERRO RUIDOSO, nao string que passa (regra 2 do #1605 no formato).
  * ESCREVE ATOMICAMENTE (tempfile + fsync + os.replace) — mata as 2 truncagens de 24h:
    um leitor nunca ve meio-ficheiro.
  * ISOLAMENTO POR CONSTRUCAO — cada papel grava so `<papel>.json`; a escrita de um
    nunca toca o ficheiro de outro (sem depender de "nunca open('w')").
  * REGENERA os agregados a cada escrita: `ROSTER.md` (produto de build, header GERADO
    + hash anti-edicao-a-mao) e `sessoes.json` (mapa papel->sessao, FONTE UNICA — mata a
    deriva do mapa duplicado do Despertador, #1606).

O CI gateia ESTA guarda (test_roster_guarda.py); a guarda gateia os DADOS — porque o
ROSTER vive fora do repo (o CI nao o ve), mas a guarda vive no repo e nao morre com
ninguem (decisao 3 do design).

Uso:
  python roster_guarda.py --roster-dir <dir> escrever --file <papel.json>
  python roster_guarda.py --roster-dir <dir> escrever   # le o JSON do stdin
  python roster_guarda.py --roster-dir <dir> validar --file <papel.json>
  python roster_guarda.py --roster-dir <dir> regenerar
"""
import argparse
import hashlib
import json
import os
import re
import sys
import tempfile

SCHEMA = 1
PAPEIS = ("polaris", "mira", "altair", "castor", "pollux", "mizar",
          "alcor", "lumen", "iris", "atlas", "hiparco")
ESTADOS = ("vivo", "parado", "reciclado")
SESSAO_ID = re.compile(r"^local_[0-9a-fA-F-]{36}$")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$")

CABECALHO = "<!-- GERADO por scripts/roster_guarda.py -- NAO editar; fonte: roster/<papel>.json"


class RosterInvalido(Exception):
    """Schema violado (RECUSADO) — carrega o campo e o porque, nunca silencio."""


def validar(obj):
    """Valida o schema fechado. Levanta RosterInvalido(campo: porque) no 1o desvio."""
    if not isinstance(obj, dict):
        raise RosterInvalido("raiz: nao e objeto JSON")
    s = obj.get("schema")
    if s != SCHEMA:
        # Leitor/escritor com schema desconhecido PARA e grita — nao adivinha (#1605).
        raise RosterInvalido(f"schema: esperava {SCHEMA}, veio {s!r} (nao adivinho formato desconhecido)")
    papel = obj.get("papel")
    if papel not in PAPEIS:
        raise RosterInvalido(f"papel: {papel!r} nao esta no enum dos 11")
    if not isinstance(obj.get("titulo"), str) or not obj["titulo"]:
        raise RosterInvalido("titulo: obrigatorio, string nao-vazia")
    enc = obj.get("encarnacao")
    if not isinstance(enc, int) or isinstance(enc, bool) or enc < 1:
        raise RosterInvalido(f"encarnacao: inteiro >= 1, veio {enc!r}")
    sess = obj.get("sessao")
    if not isinstance(sess, dict):
        raise RosterInvalido("sessao: obrigatorio, objeto {id,titulo}")
    if not isinstance(sess.get("id"), str) or not SESSAO_ID.match(sess["id"]):
        raise RosterInvalido(f"sessao.id: esperava 'local_<uuid>', veio {sess.get('id')!r}")
    if not isinstance(sess.get("titulo"), str) or not sess["titulo"]:
        raise RosterInvalido("sessao.titulo: obrigatorio (e o que enderaca), string nao-vazia")
    if not isinstance(obj.get("nasceu"), str) or not ISO.match(obj["nasceu"]):
        raise RosterInvalido(f"nasceu: ISO-8601 UTC, veio {obj.get('nasceu')!r}")
    est = obj.get("estado")
    if est not in ESTADOS:
        raise RosterInvalido(f"estado: {est!r} fora do enum fechado {ESTADOS}")
    if "paragem_declarada" not in obj:
        raise RosterInvalido("paragem_declarada: obrigatorio (pode ser null)")
    pd = obj["paragem_declarada"]
    if pd is not None:
        if not isinstance(pd, dict) or not {"desde", "por", "motivo"} <= set(pd):
            raise RosterInvalido("paragem_declarada: null ou objeto {desde,por,motivo}")
    if "tick_declarado" not in obj:
        raise RosterInvalido("tick_declarado: obrigatorio (pode ser null)")
    td = obj["tick_declarado"]
    if td is not None and not (isinstance(td, str) and ISO.match(td)):
        raise RosterInvalido(f"tick_declarado: null ou ISO-8601 UTC, veio {td!r}")
    return papel


def _atomico(caminho, texto):
    """Escreve `texto` em `caminho` atomicamente: tempfile no MESMO dir + fsync + replace.
    Um leitor concorrente ve o ficheiro velho INTEIRO ou o novo INTEIRO, nunca meio."""
    d = os.path.dirname(caminho) or "."
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(texto)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, caminho)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _hash(corpo):
    return hashlib.sha256(corpo.encode("utf-8")).hexdigest()[:16]


def _ler_papeis(roster_dir):
    """Le todos os <papel>.json validos. Um invalido nao contamina os outros (isolamento)."""
    out = {}
    for p in PAPEIS:
        caminho = os.path.join(roster_dir, f"{p}.json")
        if not os.path.exists(caminho):
            continue
        with open(caminho, encoding="utf-8") as f:
            obj = json.load(f)
        validar(obj)  # um <papel>.json corrompido no disco GRITA na regeneracao
        out[p] = obj
    return out


def _render_roster_md(papeis):
    linhas = ["# ROSTER — estado vivo (gerado dos roster/<papel>.json)", "",
              "| papel | enc | estado | sessao.id | sessao.titulo | tick_declarado | nasceu |",
              "|---|---|---|---|---|---|---|"]
    for p in PAPEIS:
        o = papeis.get(p)
        if not o:
            continue
        linhas.append(
            f"| {o['papel']} | {o['encarnacao']} | {o['estado']} | `{o['sessao']['id']}` | "
            f"{o['sessao']['titulo']} | {o['tick_declarado'] or '-'} | {o['nasceu']} |"
        )
    return "\n".join(linhas) + "\n"


def regenerar(roster_dir, force=False):
    """Regenera ROSTER.md (com hash-guard) + sessoes.json a partir dos <papel>.json.
    RECUSA regenerar o ROSTER.md se ele foi editado a mao desde a ultima geracao — a
    recuperacao deliberada e `force=True` (relocar o que foi editado a mao PRIMEIRO, depois
    forcar). O `escrever` normal NAO forca: um hand-edit bloqueia (ruidoso) ate ser resolvido,
    que e o design -- recusar > apagar o trabalho de alguem em silencio."""
    papeis = _ler_papeis(roster_dir)

    # ROSTER.md agregado, com header GERADO + hash do corpo (anti-edicao-a-mao).
    corpo = _render_roster_md(papeis)
    caminho_md = os.path.join(roster_dir, "ROSTER.md")
    if os.path.exists(caminho_md) and not force:
        with open(caminho_md, encoding="utf-8") as f:
            atual = f.read()
        m = re.search(r"hash:([0-9a-f]{16})", atual.split("\n", 1)[0])
        corpo_atual = atual.split("\n", 1)[1] if "\n" in atual else ""
        if m and m.group(1) != _hash(corpo_atual):
            raise RosterInvalido(
                "ROSTER.md foi EDITADO A MAO desde a ultima geracao (hash do corpo != header). "
                "O ROSTER.md e produto de build -- edite os roster/<papel>.json. Recuso sobrescrever "
                "em silencio; relocar o hand-edit e depois `regenerar --force`."
            )
    header = f"{CABECALHO} · hash:{_hash(corpo)} -->\n"
    _atomico(caminho_md, header + corpo)

    # sessoes.json: mapa papel->sessao.id, FONTE UNICA (mata o duplicado do Despertador).
    mapa = {"_gerado": f"por scripts/roster_guarda.py de roster/<papel>.json -- NAO editar a mao"}
    for p in PAPEIS:
        if p in papeis:
            mapa[p] = papeis[p]["sessao"]["id"]
    _atomico(os.path.join(roster_dir, "sessoes.json"),
             json.dumps(mapa, ensure_ascii=False, indent=2) + "\n")
    return {"papeis": sorted(papeis), "roster_md": caminho_md}


def escrever(roster_dir, obj):
    """Valida + grava <papel>.json atomicamente + regenera os agregados."""
    papel = validar(obj)
    os.makedirs(roster_dir, exist_ok=True)
    caminho = os.path.join(roster_dir, f"{papel}.json")
    _atomico(caminho, json.dumps(obj, ensure_ascii=False, indent=2) + "\n")
    regenerar(roster_dir)
    return {"escrito": caminho}


def _carregar(args):
    if args.file:
        with open(args.file, encoding="utf-8") as f:
            return json.load(f)
    return json.load(sys.stdin)


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    p = argparse.ArgumentParser(description="Guarda de escrita do roster (#1654)")
    p.add_argument("--roster-dir", required=True, help="dir dos roster/<papel>.json")
    sub = p.add_subparsers(dest="verbo", required=True)
    for v in ("escrever", "validar"):
        s = sub.add_parser(v)
        s.add_argument("--file", help="JSON do papel (default: stdin)")
    sr = sub.add_parser("regenerar")
    sr.add_argument("--force", action="store_true",
                    help="regenera por cima de um ROSTER.md editado a mao (recuperacao deliberada)")
    a = p.parse_args(argv)
    try:
        if a.verbo == "validar":
            validar(_carregar(a))
            print(json.dumps({"ok": True}))
        elif a.verbo == "escrever":
            print(json.dumps(escrever(a.roster_dir, _carregar(a)), ensure_ascii=False))
        elif a.verbo == "regenerar":
            print(json.dumps(regenerar(a.roster_dir, force=a.force), ensure_ascii=False))
    except RosterInvalido as e:
        print(f"RECUSADO -- {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
