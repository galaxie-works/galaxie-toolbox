#!/usr/bin/env python3
"""Testes herméticos da guarda do roster (#1654). O CI corre ISTO — se a guarda deixar
de recusar um mutante, o CI parte (decisão 3 do design #1652).

Rodar:  python scripts/test_roster_guarda.py   (exit 0 = verde)
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roster_guarda as g


def base(papel="mizar", **over):
    o = {
        "schema": 1, "papel": papel, "titulo": "Dev BE", "encarnacao": 2,
        "sessao": {"id": "local_" + "a" * 8 + "-" + "b" * 4 + "-" + "c" * 4 + "-" + "d" * 4 + "-" + "e" * 12,
                   "titulo": f"{papel} sess"},
        "nasceu": "2026-08-31T14:22:00Z", "estado": "vivo",
        "paragem_declarada": None, "tick_declarado": "2026-08-31T15:00:00Z",
    }
    o.update(over)
    return o


def recusa(obj, dica):
    try:
        g.validar(obj)
    except g.RosterInvalido:
        return
    raise AssertionError(f"esperava RECUSADO ({dica}), mas passou: {obj}")


def main():
    d = tempfile.mkdtemp()

    # --- MUTANTES OBRIGATORIOS (design #1652 §3): cada um TEM de morder ---
    recusa(base(schema=2), "schema desconhecido")                 # nao adivinha formato novo
    recusa(base(schema=None), "schema ausente")
    recusa(base(estado="zumbi"), "estado fora do enum")           # enum fechado
    recusa(base(papel="ninguem"), "papel fora dos 11")
    b = base(); del b["titulo"]; recusa(b, "campo em falta (titulo)")
    b = base(); del b["paragem_declarada"]; recusa(b, "paragem_declarada ausente (obrig. mesmo null)")
    b = base(); del b["tick_declarado"]; recusa(b, "tick_declarado ausente")
    recusa(base(sessao={"id": "xyz", "titulo": "t"}), "sessao.id malformado")
    recusa(base(encarnacao=0), "encarnacao < 1")
    recusa(base(encarnacao="2"), "encarnacao nao-inteiro")
    recusa(base(nasceu="ontem"), "nasceu nao-ISO")
    recusa(base(tick_declarado="14h"), "tick nao-ISO")
    recusa(base(paragem_declarada={"desde": "x"}), "paragem sem por/motivo")
    recusa("nao sou objeto", "raiz nao-objeto (JSON truncado -> nao-dict)")

    # --- caminho feliz + isolamento (AC1) ---
    g.escrever(d, base("mizar"))
    g.escrever(d, base("altair", titulo="Arquiteto"))
    assert os.path.exists(os.path.join(d, "mizar.json"))
    assert os.path.exists(os.path.join(d, "altair.json"))
    # escrever alcor NAO toca mizar/altair
    antes = open(os.path.join(d, "mizar.json"), encoding="utf-8").read()
    g.escrever(d, base("alcor", titulo="Dev BE"))
    depois = open(os.path.join(d, "mizar.json"), encoding="utf-8").read()
    assert antes == depois, "AC1 violado: escrever alcor mexeu no mizar.json"

    # <papel>.json e JSON valido round-trip
    with open(os.path.join(d, "mizar.json"), encoding="utf-8") as f:
        assert json.load(f)["papel"] == "mizar"

    # --- agregados gerados (AC5: mapa unico; ROSTER.md build-product) ---
    with open(os.path.join(d, "sessoes.json"), encoding="utf-8") as f:
        mapa = json.load(f)
    assert mapa["mizar"].startswith("local_") and mapa["altair"].startswith("local_"), "mapa nao gerou"
    assert "alcor" in mapa
    md = open(os.path.join(d, "ROSTER.md"), encoding="utf-8").read()
    assert md.startswith("<!-- GERADO") and "hash:" in md.split("\n", 1)[0], "ROSTER.md sem header GERADO+hash"
    assert "| mizar |" in md and "| altair |" in md

    # --- hash-guard: editar o ROSTER.md a mao -> regenerar RECUSA (nao sobrescreve em silencio) ---
    caminho_md = os.path.join(d, "ROSTER.md")
    conteudo = open(caminho_md, encoding="utf-8").read()
    open(caminho_md, "w", encoding="utf-8").write(conteudo + "\nlinha metida a mao\n")
    try:
        g.regenerar(d)
        raise AssertionError("hash-guard falhou: regenerou por cima de edicao-a-mao")
    except g.RosterInvalido:
        pass  # recusou, correto
    # o escrever TAMBEM bloqueia com hand-edit -- e e TUDO-OU-NADA: o <papel>.json NAO muda
    # (achado do @galaxie-altair #1688: antes, o escrever gravava o json e SO DEPOIS falhava).
    mizar_antes = open(os.path.join(d, "mizar.json"), encoding="utf-8").read()
    try:
        g.escrever(d, base("mizar", encarnacao=9))  # valor DIFERENTE do que esta no disco
        raise AssertionError("hash-guard falhou: escrever regenerou por cima do hand-edit")
    except g.RosterInvalido:
        pass
    mizar_depois = open(os.path.join(d, "mizar.json"), encoding="utf-8").read()
    assert mizar_antes == mizar_depois, "escrever NAO foi tudo-ou-nada: gravou o <papel>.json e depois falhou"

    # recuperacao DELIBERADA: regenerar(force=True) sobrescreve e volta a bater o hash
    g.regenerar(d, force=True)
    conteudo2 = open(caminho_md, encoding="utf-8").read()
    import re as _re
    h = _re.search(r"hash:([0-9a-f]{16})", conteudo2.split("\n", 1)[0]).group(1)
    assert h == g._hash(conteudo2.split("\n", 1)[1]), "hash do header nao bate o corpo apos force"

    print("OK - guarda: 14 mutantes + isolamento(AC1) + agregados(AC5) + hash-guard tudo-ou-nada + force")


if __name__ == "__main__":
    main()
