#!/usr/bin/env python3
"""galaxie.db — base SQLite portatil de historico/metricas do time (#1655, design #1653).

Escritor de VERBOS FECHADOS: o agente chama `registrar-*`/`consultar`, NUNCA SQL cru
(AC1). sqlite3 do stdlib (sem .exe no repo, decisao 5 do design — evita supply-chain).
PRAGMA WAL + busy_timeout=5000 + foreign_keys=ON em cada conexao. Enums via CHECK
(tipo fora do enum PARTE a escrita). Nasce vazia, idempotente, sem migracao.

A base MORA em <memory>/galaxie.db (fora do repo, restaura do backup no DR — regras
OPOSTAS ao cofre DPAPI). O path vem de --db ou de $GALAXIE_DB; o wrapper
`galaxie-db.ps1` resolve o <memory> e passa. Retencao: NUNCA apaga (custo desprezavel,
valor da cauda alto; consumo_diario ja e rollup por PK).

Uso (via wrapper):  galaxie-db.ps1 <verbo> [--flags]
Uso (direto):       python galaxie_db.py --db <path> <verbo> [--flags]
"""
import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

# Enum fechado de eventos.tipo (design #1653: nascimentos, handoffs, incidentes, com o
# # do caso). Estender = adicionar aqui + o CHECK re-cria idempotente numa base nova;
# numa base viva, alterar CHECK e migracao consciente (append-only, raro).
TIPOS_EVENTO = ("nascimento", "handoff", "incidente", "reciclagem", "entrega", "decisao", "caso")

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS auto_reportes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    papel        TEXT NOT NULL,
    quando       TEXT NOT NULL,
    tempo_vivo_h REAL,
    turnos       INTEGER,
    contexto_kb  INTEGER,
    entregas     INTEGER,
    nota         TEXT
);
CREATE INDEX IF NOT EXISTS ix_auto_reportes_papel_quando ON auto_reportes(papel, quando);

CREATE TABLE IF NOT EXISTS reciclagens (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    papel           TEXT NOT NULL,
    encarnacao      INTEGER,
    quando          TEXT NOT NULL,
    motivo          TEXT,
    ordenada_por    TEXT,
    sucessor_sessao TEXT
);
CREATE INDEX IF NOT EXISTS ix_reciclagens_papel_quando ON reciclagens(papel, quando);

-- Rollup por PK (dia, papel): reg-consumo faz UPSERT somando — a auditoria de cota
-- alimenta isto (feeder e card propria, #1662/#1663; fora deste escopo).
CREATE TABLE IF NOT EXISTS consumo_diario (
    dia        TEXT NOT NULL,
    papel      TEXT NOT NULL,
    chamadas   INTEGER NOT NULL DEFAULT 0,
    peso       INTEGER NOT NULL DEFAULT 0,
    cache_read INTEGER NOT NULL DEFAULT 0,
    output     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (dia, papel)
);

CREATE TABLE IF NOT EXISTS eventos (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    quando TEXT NOT NULL,
    papel  TEXT,
    tipo   TEXT NOT NULL CHECK (tipo IN ({",".join(repr(t) for t in TIPOS_EVENTO)})),
    ref    TEXT
);
CREATE INDEX IF NOT EXISTS ix_eventos_quando ON eventos(quando);

-- Detetor de mudez do vigia no regime sem-cron (#1655): o Porteiro registra a entrega
-- (agiu_em NULL = ainda nao agiu). UNIQUE(notif_id, atualizado) = a chave emendada no
-- design #1653 (uma notificacao pode ser re-entregue quando 'atualizado' muda).
CREATE TABLE IF NOT EXISTS despertares (
    notif_id   TEXT NOT NULL,
    papel      TEXT NOT NULL,
    motivo     TEXT,
    titulo     TEXT,
    url        TEXT,
    quando     TEXT NOT NULL,
    atualizado TEXT NOT NULL,
    agiu_em    TEXT,
    UNIQUE (notif_id, atualizado)
);
CREATE INDEX IF NOT EXISTS ix_despertares_papel ON despertares(papel, agiu_em);
"""


def agora():
    """ISO-8601 UTC em segundos (Z). Estavel e ordenavel como TEXT."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def conectar(path):
    con = sqlite3.connect(path)
    con.execute("PRAGMA journal_mode=WAL;")
    con.execute("PRAGMA busy_timeout=5000;")
    con.execute("PRAGMA foreign_keys=ON;")
    con.row_factory = sqlite3.Row
    return con


def init(con):
    con.executescript(SCHEMA)
    con.commit()


# ---- verbos de ESCRITA (parametrizados; zero SQL cru do agente) ------------------

def reg_auto_reporte(con, a):
    con.execute(
        "INSERT INTO auto_reportes(papel,quando,tempo_vivo_h,turnos,contexto_kb,entregas,nota)"
        " VALUES (?,?,?,?,?,?,?)",
        (a.papel, a.quando or agora(), a.tempo_vivo_h, a.turnos, a.contexto_kb, a.entregas, a.nota),
    )
    con.commit()


def reg_reciclagem(con, a):
    con.execute(
        "INSERT INTO reciclagens(papel,encarnacao,quando,motivo,ordenada_por,sucessor_sessao)"
        " VALUES (?,?,?,?,?,?)",
        (a.papel, a.encarnacao, a.quando or agora(), a.motivo, a.ordenada_por, a.sucessor_sessao),
    )
    con.commit()


def reg_consumo(con, a):
    # UPSERT: soma no rollup do (dia, papel) — reidempotente por chamada de auditoria.
    con.execute(
        "INSERT INTO consumo_diario(dia,papel,chamadas,peso,cache_read,output) VALUES (?,?,?,?,?,?)"
        " ON CONFLICT(dia,papel) DO UPDATE SET"
        "  chamadas=chamadas+excluded.chamadas, peso=peso+excluded.peso,"
        "  cache_read=cache_read+excluded.cache_read, output=output+excluded.output",
        (a.dia, a.papel, a.chamadas, a.peso, a.cache_read, a.output),
    )
    con.commit()


def reg_evento(con, a):
    con.execute(
        "INSERT INTO eventos(quando,papel,tipo,ref) VALUES (?,?,?,?)",
        (a.quando or agora(), a.papel, a.tipo, a.ref),
    )
    con.commit()


def reg_despertar(con, a):
    # Dedup por (notif_id, atualizado): re-entrega da mesma notif com o mesmo 'atualizado'
    # e no-op; 'atualizado' novo cria linha nova (a notif mudou).
    con.execute(
        "INSERT OR IGNORE INTO despertares(notif_id,papel,motivo,titulo,url,quando,atualizado,agiu_em)"
        " VALUES (?,?,?,?,?,?,?,NULL)",
        (a.notif_id, a.papel, a.motivo, a.titulo, a.url, a.quando or agora(), a.atualizado or agora()),
    )
    con.commit()


def marcar_agiu(con, a):
    cur = con.execute(
        "UPDATE despertares SET agiu_em=? WHERE notif_id=? AND agiu_em IS NULL",
        (a.agiu_em or agora(), a.notif_id),
    )
    con.commit()
    return {"marcadas": cur.rowcount}


# ---- CONSULTAS nomeadas (fechadas — sem SQL livre) -------------------------------

def q_media_contexto(con, a):
    rows = con.execute(
        "SELECT papel, ROUND(AVG(contexto_kb),1) AS media_kb, COUNT(*) AS amostras"
        " FROM auto_reportes WHERE quando >= ? GROUP BY papel ORDER BY media_kb DESC",
        (_dias_atras(a.dias),),
    ).fetchall()
    return [dict(r) for r in rows]


def q_recibo_semanal(con, a):
    inicio = _dias_atras(a.dias)
    rows = con.execute(
        "SELECT papel, SUM(chamadas) AS chamadas, SUM(peso) AS peso,"
        " SUM(cache_read) AS cache_read, SUM(output) AS output"
        " FROM consumo_diario WHERE dia >= ? GROUP BY papel ORDER BY output DESC",
        (inicio[:10],),
    ).fetchall()
    return {"desde": inicio[:10], "por_papel": [dict(r) for r in rows]}


def q_mudez(con, a):
    # Despertares entregues ha mais de N horas e ainda sem agiu_em = candidato a mudez.
    limite = _horas_atras(a.horas)
    rows = con.execute(
        "SELECT papel, notif_id, titulo, quando FROM despertares"
        " WHERE agiu_em IS NULL AND quando <= ? ORDER BY quando",
        (limite,),
    ).fetchall()
    return [dict(r) for r in rows]


def _dias_atras(n):
    from datetime import timedelta
    return (datetime.now(timezone.utc) - timedelta(days=int(n))).strftime("%Y-%m-%dT%H:%M:%SZ")


def _horas_atras(n):
    from datetime import timedelta
    return (datetime.now(timezone.utc) - timedelta(hours=int(n))).strftime("%Y-%m-%dT%H:%M:%SZ")


CONSULTAS = {
    "media-contexto": q_media_contexto,
    "recibo-semanal": q_recibo_semanal,
    "mudez": q_mudez,
}


def consultar(con, a):
    fn = CONSULTAS.get(a.nome)
    if fn is None:
        raise SystemExit(f"consulta desconhecida: {a.nome!r}. Fechadas: {', '.join(sorted(CONSULTAS))}")
    return fn(con, a)


def build_parser():
    p = argparse.ArgumentParser(description="galaxie.db — verbos fechados (#1655)")
    p.add_argument("--db", default=os.environ.get("GALAXIE_DB"),
                   help="caminho do galaxie.db (default $GALAXIE_DB)")
    sub = p.add_subparsers(dest="verbo", required=True)

    sub.add_parser("init", help="cria as tabelas (idempotente)")

    ar = sub.add_parser("registrar-auto-reporte")
    ar.add_argument("--papel", required=True)
    ar.add_argument("--tempo-vivo-h", type=float, dest="tempo_vivo_h")
    ar.add_argument("--turnos", type=int)
    ar.add_argument("--contexto-kb", type=int, dest="contexto_kb")
    ar.add_argument("--entregas", type=int)
    ar.add_argument("--nota")
    ar.add_argument("--quando")

    rc = sub.add_parser("registrar-reciclagem")
    rc.add_argument("--papel", required=True)
    rc.add_argument("--encarnacao", type=int)
    rc.add_argument("--motivo")
    rc.add_argument("--ordenada-por", dest="ordenada_por")
    rc.add_argument("--sucessor-sessao", dest="sucessor_sessao")
    rc.add_argument("--quando")

    co = sub.add_parser("registrar-consumo")
    co.add_argument("--dia", required=True, help="YYYY-MM-DD")
    co.add_argument("--papel", required=True)
    co.add_argument("--chamadas", type=int, default=0)
    co.add_argument("--peso", type=int, default=0)
    co.add_argument("--cache-read", type=int, dest="cache_read", default=0)
    co.add_argument("--output", type=int, default=0)

    ev = sub.add_parser("registrar-evento")
    ev.add_argument("--papel")
    ev.add_argument("--tipo", required=True, choices=TIPOS_EVENTO)
    ev.add_argument("--ref")
    ev.add_argument("--quando")

    de = sub.add_parser("registrar-despertar")
    de.add_argument("--notif-id", required=True, dest="notif_id")
    de.add_argument("--papel", required=True)
    de.add_argument("--motivo")
    de.add_argument("--titulo")
    de.add_argument("--url")
    de.add_argument("--quando")
    de.add_argument("--atualizado")

    ma = sub.add_parser("marcar-agiu")
    ma.add_argument("--notif-id", required=True, dest="notif_id")
    ma.add_argument("--agiu-em", dest="agiu_em")

    cs = sub.add_parser("consultar")
    cs.add_argument("nome", help="media-contexto | recibo-semanal | mudez")
    cs.add_argument("--dias", type=int, default=7)
    cs.add_argument("--horas", type=int, default=6)
    return p


ESCRITAS = {
    "registrar-auto-reporte": reg_auto_reporte,
    "registrar-reciclagem": reg_reciclagem,
    "registrar-consumo": reg_consumo,
    "registrar-evento": reg_evento,
    "registrar-despertar": reg_despertar,
    "marcar-agiu": marcar_agiu,
}


def main(argv=None):
    # stdout UTF-8: o output leva conteudo pt (acentos) e ensure_ascii=False; sem isto o
    # cp1252 default do Windows pode PartIr com UnicodeEncodeError (licao ASCII-no-stdout).
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    a = build_parser().parse_args(argv)
    if not a.db:
        raise SystemExit("faltou --db (ou $GALAXIE_DB) — o wrapper galaxie-db.ps1 resolve o <memory>")
    con = conectar(a.db)
    try:
        init(con)  # idempotente: garante o schema em toda chamada (nasce vazia)
        if a.verbo == "init":
            print(json.dumps({"ok": True, "db": a.db}))
        elif a.verbo in ESCRITAS:
            r = ESCRITAS[a.verbo](con, a)
            print(json.dumps(r if r is not None else {"ok": True}, ensure_ascii=False))
        elif a.verbo == "consultar":
            print(json.dumps(consultar(con, a), ensure_ascii=False, indent=2))
    finally:
        con.close()


if __name__ == "__main__":
    main()
