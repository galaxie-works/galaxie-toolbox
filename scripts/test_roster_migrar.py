#!/usr/bin/env python3
"""Testes herméticos do migrador do roster (#1654 fatia 2a). O CI corre ISTO.

Prova, com linhas CONTROLADAS (nao depende do ROSTER.md real):
  * MIGRADO destila os campos certos e o JSON PASSA `roster_guarda.validar` (o contrato da fatia 1);
  * os casos dificeis da tabela-log real: papel ACENTUADO (Lúmen/Íris), `|` na prosa da col 5,
    variantes de encarnacao (`2ª`, `**IV** (4ª do nome)`, `7ª (...)`), `nasceu` com/sem `Z`;
  * os 3 desfechos sao distintos: MIGRADO vs RECUSADO (campo+porque) vs ILEGIVEL (papel fora dos 11);
  * a narrativa da col Estado e PRESERVADA no sidecar e NAO entra no `titulo`;
  * isolamento: uma linha ma nao contamina as boas.

Rodar:  python scripts/test_roster_migrar.py   (exit 0 = verde)
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roster_migrar as m
import roster_guarda as g

ID = "local_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"  # bate SESSAO_ID (36 chars pos-`local_`)


def linha(papel_col="Alcor (Dev BE)", enc="2ª (Alcor II)", sess=f'`{ID}` · "Alcor II" (canal)',
          nasceu="2026-08-20 14:18", resto="**vivo** · fez X | cron y | tick z"):
    return f"| {papel_col} | {enc} | {sess} | {nasceu} | {resto} |"


def so(res):
    """Desempacota o unico resultado de migrar_texto de uma linha."""
    assert len(res) == 1, f"esperava 1 resultado, veio {len(res)}: {res}"
    return res[0]


def main():
    # --- MIGRADO: destila os campos e o JSON valida (contrato da fatia 1) ---
    papel, status, obj, narrativa = so(m.migrar_texto(linha()))
    assert status == m.MIGRADO, (status, obj)
    assert papel == "alcor"
    assert obj["papel"] == "alcor"
    assert obj["titulo"] == "Dev BE", obj["titulo"]            # descritor, NAO a prosa da col 5
    assert obj["encarnacao"] == 2
    assert obj["sessao"] == {"id": ID, "titulo": "Alcor II"}
    assert obj["nasceu"] == "2026-08-20T14:18Z"                # ` ` -> `T`, `Z` acrescentado
    assert obj["estado"] == "vivo"
    assert obj["paragem_declarada"] is None and obj["tick_declarado"] is None  # migracao nao fabrica
    g.validar(obj)  # bate o schema fechado por construcao (redundante com o migrador -- de proposito)

    # --- papel ACENTUADO -> enum ASCII (nao cai por .lower()) ---
    _, st, o_iris, _ = so(m.migrar_texto(
        linha("Íris (QA-V)", "**II** (2ª do nome)", f'`{ID}` · "Íris II QA V" (x)', "2026-08-27 13:50Z")))
    assert st == m.MIGRADO and o_iris["papel"] == "iris" and o_iris["encarnacao"] == 2
    assert o_iris["nasceu"] == "2026-08-27T13:50Z", o_iris["nasceu"]  # `Z` ja presente nao duplica
    assert o_iris["titulo"] == "QA-V"
    _, _, o_lumen, _ = so(m.migrar_texto(linha("Lúmen (QA-A)")))
    assert o_lumen["papel"] == "lumen"

    # --- encarnacao: `7ª (Polaris VII)` -> 7 ---
    _, _, o_pol, _ = so(m.migrar_texto(linha("Polaris (SM de exceção)", "7ª (Polaris VII)")))
    assert o_pol["encarnacao"] == 7 and o_pol["papel"] == "polaris" and o_pol["titulo"] == "SM de exceção"

    # --- `|` na prosa da col 5 NAO parte a extracao (o defeito que o card existe pra matar) ---
    res = so(m.migrar_texto(linha(resto="**vivo** · tabela com | barras | a | vontade na prosa")))
    assert res[1] == m.MIGRADO, res
    assert res[2]["estado"] == "vivo"

    # --- estado por palavra-chave: RECICLADO / VIVO-em-prefixo / parado ---
    assert so(m.migrar_texto(linha(resto="**♻️ RECICLADO §7 ...**")))[2]["estado"] == "reciclado"
    assert so(m.migrar_texto(linha(resto="**[Alcor III · 20:13Z] VIVO — entregou #1695**")))[2]["estado"] == "vivo"
    assert so(m.migrar_texto(linha(resto="**parado** aguarda X")))[2]["estado"] == "parado"

    # --- linha NAO-de-papel (col 1 fora dos 11) -> ignorada em silencio (nao e ILEGIVEL) ---
    assert m.migrar_texto(linha("Ninguém (X)")) == [], "papel fora dos 11 nao e linha de papel -> ignora"
    assert m.migrar_texto("| so | duas |") == [], "tabela alheia de 2 colunas -> ignora"

    # --- ILEGIVEL: linha DE PAPEL (col 1 = um dos 11) truncada -> GRITA, nao some (perderia dado) ---
    p, st, motivo, _ = so(m.migrar_texto("| Alcor (Dev BE) | 2ª | truncada aqui |"))
    assert st == m.ILEGIVEL and p == "alcor", (st, p)
    assert "colunas a menos" in motivo, motivo

    # --- RECUSADO: cada campo que nao satisfaz o schema, com papel recuperado pro relatorio ---
    def recusa(l, dica_campo):
        p, st, motivo, _ = so(m.migrar_texto(l))
        assert st == m.RECUSADO, f"esperava RECUSADO ({dica_campo}): {st} {motivo}"
        assert dica_campo in motivo, f"motivo nao aponta {dica_campo!r}: {motivo}"
        return p
    assert recusa(linha(sess='`xyz` · "t" (x)'), "sessao.id") == "alcor"   # id nao-local_
    recusa(linha(sess=f'`{ID}` sem aspas de titulo (x)'), "sessao.titulo")
    recusa(linha("Alcor"), "titulo")                                        # col 1 sem (descritor)
    recusa(linha(nasceu="ontem"), "nasceu")                                 # nao-data
    recusa(linha(resto="**zumbi** wat"), "estado")                          # fora do enum
    recusa(linha(enc="sem ordinal"), "encarnacao")                          # sem `Nª`

    # --- isolamento + escrita: ILEGIVEL nao impede o MIGRADO; sidecar preserva a narrativa ---
    texto = "\n".join([
        "| papel | enc | estado | ... |",          # cabecalho -> ignorado
        "|---|---|---|",                             # separador -> ignorado
        linha("Ninguém (X)"),                        # nao-papel -> ignorado silente (nao entra)
        "| Alcor (Dev BE) | 2ª | truncada |",        # ILEGIVEL (papel conhecido, truncada)
        linha("Mizar (Dev BE)", "2ª", f'`{ID}` · "Mizar II" (x)', "2026-08-27 14:22Z",
              "**vivo** · NARRATIVA-A-PRESERVAR | col | col"),  # MIGRADO com `|` e prosa
    ])
    resultados = m.migrar_texto(texto)
    assert [r[1] for r in resultados] == [m.ILEGIVEL, m.MIGRADO], [r[1] for r in resultados]
    d = tempfile.mkdtemp()
    escritos = m.escrever_saidas(resultados, d)
    assert escritos == [os.path.join(d, "mizar.json")], escritos
    with open(os.path.join(d, "mizar.json"), encoding="utf-8") as f:
        mz = json.load(f)
    assert mz["papel"] == "mizar" and mz["titulo"] == "Dev BE"
    g.validar(mz)  # o ficheiro escrito passa a guarda -- round-trip pela fatia 1
    sidecar = open(os.path.join(d, "historico-narrativa.md"), encoding="utf-8").read()
    assert "NARRATIVA-A-PRESERVAR" in sidecar, "a prosa da col Estado tem de ir pro historico"
    assert "NARRATIVA-A-PRESERVAR" not in json.dumps(mz), "a prosa NAO pode entrar no schema"

    print("OK - migrador: MIGRADO/RECUSADO/ILEGIVEL + acento + `|`-na-prosa + variantes + sidecar + isolamento")


if __name__ == "__main__":
    main()
