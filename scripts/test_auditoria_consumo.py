#!/usr/bin/env python3
"""Testes herméticos do produtor de consumo (#1663). Rodar: python scripts/test_auditoria_consumo.py"""
import json
import os
import sys
import tempfile
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import auditoria_consumo as ac
import galaxie_db


def turno(dia, inp, out, cread, ccreate, hora="10:00:00"):
    return json.dumps({
        "type": "assistant",
        "timestamp": f"{dia}T{hora}Z",
        "message": {"usage": {
            "input_tokens": inp, "output_tokens": out,
            "cache_read_input_tokens": cread, "cache_creation_input_tokens": ccreate}},
    })


def escrever_jsonl(d, nome, linhas):
    with open(os.path.join(d, nome), "w", encoding="utf-8") as f:
        f.write("\n".join(linhas) + "\n")


def main():
    d = tempfile.mkdtemp()

    # sess1 = Mizar por BOOT marker; 2 turnos no mesmo dia
    escrever_jsonl(d, "sess1.jsonl", [
        json.dumps({"type": "user", "message": {"content": "Bem-vindo, Mizar - Dev BE. Sou a Polaris"}}),
        turno("2026-08-31", 100, 50, 10, 20),
        turno("2026-08-31", 100, 50, 10, 20),
    ])
    # sess2 = Pollux por CONTEXT dominante (sem boot); 1 turno
    escrever_jsonl(d, "sess2.jsonl", [
        json.dumps({"type": "user", "message": {"content": "vê o PolluxContext.md e o PolluxContext outra vez, PolluxContext"}}),
        turno("2026-08-31", 200, 80, 5, 0),
    ])
    # sess3 = desconhecido (sem boot, sem Context); 1 turno noutro dia
    escrever_jsonl(d, "sess3.jsonl", [turno("2026-08-30", 1, 1, 0, 0)])

    total, ficheiros = ac.apurar(d, desde=None)
    assert len(ficheiros) == 3

    # mizar 08-31: chamadas=2, output=100, cache_read=20, peso=2*(100+50+20)=340
    m = total[("2026-08-31", "mizar")]
    assert m == [2, 100, 20, 340], f"mizar errado: {m}"
    # pollux 08-31 (via Context fallback): chamadas=1, output=80, cache_read=5, peso=200+80+0=280
    pp = total[("2026-08-31", "pollux")]
    assert pp == [1, 80, 5, 280], f"pollux (context-fallback) errado: {pp}"
    # desconhecido 08-30: peso=1+1+0=2
    dk = total[("2026-08-30", "desconhecido")]
    assert dk == [1, 1, 0, 2], f"desconhecido errado: {dk}"

    # boot ganha do context: um ficheiro com boot=Alcor E PolluxContext -> alcor
    escrever_jsonl(d, "sess4.jsonl", [
        json.dumps({"type": "user", "message": {"content": "Bem-vindo, Alcor. lê o PolluxContext PolluxContext"}}),
        turno("2026-08-29", 10, 10, 0, 0),
    ])
    total2, _ = ac.apurar(d, desde=None)
    assert ("2026-08-29", "alcor") in total2, f"boot devia ganhar do context: {[k for k in total2 if k[0]=='2026-08-29']}"

    # --desde filtra
    total3, _ = ac.apurar(d, desde="2026-08-31")
    assert all(dia >= "2026-08-31" for (dia, _p) in total3), "--desde nao filtrou"

    # fluxo ate a base + IDEMPOTENCIA (substituir): rodar 2x -> mesma linha, nao dobra
    db = os.path.join(d, "t.db")
    con = galaxie_db.conectar(db); galaxie_db.init(con)
    for _ in range(2):  # re-scan idempotente: 2 corridas -> mesma linha
        for (dia, papel), (ch, out, cr, pw) in total.items():
            galaxie_db.reg_consumo(con, SimpleNamespace(dia=dia, papel=papel, chamadas=ch, output=out, cache_read=cr, peso=pw, substituir=True))
    row = con.execute("SELECT chamadas,output,peso FROM consumo_diario WHERE dia='2026-08-31' AND papel='mizar'").fetchone()
    con.close()
    assert tuple(row) == (2, 100, 340), f"idempotencia falhou (dobrou?): {tuple(row)}"

    print("OK - auditoria: boot>context>desconhecido + soma por (dia,papel) + peso faturado + --desde + idempotente")


if __name__ == "__main__":
    main()
