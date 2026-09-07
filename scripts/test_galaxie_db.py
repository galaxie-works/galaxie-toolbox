#!/usr/bin/env python3
"""Testes herméticos do galaxie.db (#1655) — provam os 4 ACs pela interface REAL (CLI).

Rodar:  python scripts/test_galaxie_db.py   (exit 0 = tudo verde; !=0 = falhou)
Sem rede, sem tocar o <memory> vivo: usa um .db temporário.
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join(AQUI, "galaxie_db.py")


def corre(db, *args, espera_erro=False):
    """Chama o CLI. Devolve o stdout (JSON parseado se houver). espera_erro=True exige exit!=0."""
    r = subprocess.run(
        [sys.executable, CLI, "--db", db, *args],
        capture_output=True, text=True,
    )
    if espera_erro:
        assert r.returncode != 0, f"esperava FALHA em {args}, mas passou: {r.stdout}"
        return None
    assert r.returncode == 0, f"{args} falhou (exit {r.returncode}): {r.stderr}"
    return json.loads(r.stdout) if r.stdout.strip() else None


def main():
    tmp = tempfile.mkdtemp()
    db = os.path.join(tmp, "t.db")

    # init idempotente (2x sem erro)
    corre(db, "init")
    corre(db, "init")

    # AC1 — operações fechadas: verbo desconhecido e enum inválido FALHAM (não SQL cru)
    corre(db, "DROP-TABLE-eventos", espera_erro=True)
    corre(db, "registrar-evento", "--papel", "mizar", "--tipo", "LIXO", espera_erro=True)

    # AC1 defesa-em-profundidade: o CHECK morde no nível SQL mesmo contornando o argparse
    con = sqlite3.connect(db)
    try:
        con.execute("INSERT INTO eventos(quando,papel,tipo) VALUES ('2026-01-01T00:00:00Z','x','LIXO')")
        raise AssertionError("o CHECK de eventos.tipo NAO mordeu no nível SQL")
    except sqlite3.IntegrityError:
        pass
    finally:
        con.close()

    # rollup do consumo (UPSERT soma por PK) — base do recibo (AC3)
    corre(db, "registrar-consumo", "--dia", "2026-08-31", "--papel", "mizar", "--chamadas", "10", "--output", "5000")
    corre(db, "registrar-consumo", "--dia", "2026-08-31", "--papel", "mizar", "--chamadas", "5", "--output", "2000")

    # AC3 — recibo sai de UMA query (não parsing de JSONL)
    recibo = corre(db, "consultar", "recibo-semanal")
    linha = next(r for r in recibo["por_papel"] if r["papel"] == "mizar")
    assert linha["chamadas"] == 15 and linha["output"] == 7000, f"rollup errado: {linha}"

    # --substituir: SET (nao soma) -> idempotente pro produtor de re-scan (#1663)
    corre(db, "registrar-consumo", "--substituir", "--dia", "2026-08-31", "--papel", "mizar", "--chamadas", "3", "--output", "999")
    r2 = next(x for x in corre(db, "consultar", "recibo-semanal")["por_papel"] if x["papel"] == "mizar")
    assert r2["chamadas"] == 3 and r2["output"] == 999, f"substituir nao fez SET (somou?): {r2}"
    corre(db, "registrar-consumo", "--substituir", "--dia", "2026-08-31", "--papel", "mizar", "--chamadas", "3", "--output", "999")
    r3 = next(x for x in corre(db, "consultar", "recibo-semanal")["por_papel"] if x["papel"] == "mizar")
    assert r3["chamadas"] == 3 and r3["output"] == 999, f"substituir nao foi idempotente: {r3}"

    # AC2 — consulta em 1 comando (média de contexto)
    corre(db, "registrar-auto-reporte", "--papel", "mizar", "--contexto-kb", "100")
    corre(db, "registrar-auto-reporte", "--papel", "mizar", "--contexto-kb", "200")
    media = corre(db, "consultar", "media-contexto")
    m = next(r for r in media if r["papel"] == "mizar")
    assert m["media_kb"] == 150.0 and m["amostras"] == 2, f"media errada: {m}"

    # despertares + detetor de mudez do §7 (não-agiu -> aparece; agiu -> some)
    corre(db, "registrar-despertar", "--notif-id", "n1", "--papel", "mizar", "--titulo", "US #1655")
    mudez = corre(db, "consultar", "mudez", "--horas", "0")
    assert any(d["notif_id"] == "n1" for d in mudez), "despertar não-agido devia aparecer na mudez"
    r = corre(db, "marcar-agiu", "--notif-id", "n1")
    assert r["marcadas"] == 1
    mudez2 = corre(db, "consultar", "mudez", "--horas", "0")
    assert not any(d["notif_id"] == "n1" for d in mudez2), "despertar já-agido não devia aparecer"

    # dedup do despertar por (notif_id, atualizado): re-entrega idêntica é no-op
    corre(db, "registrar-despertar", "--notif-id", "n2", "--papel", "alcor", "--atualizado", "2026-08-31T00:00:00Z")
    corre(db, "registrar-despertar", "--notif-id", "n2", "--papel", "alcor", "--atualizado", "2026-08-31T00:00:00Z")
    con = sqlite3.connect(db)
    n = con.execute("SELECT COUNT(*) FROM despertares WHERE notif_id='n2'").fetchone()[0]
    con.close()
    assert n == 1, f"dedup falhou: {n} linhas pra n2 (esperava 1)"

    print("OK - 4 ACs + rollup + enum(CHECK) + mudez + dedup verdes")


if __name__ == "__main__":
    main()
