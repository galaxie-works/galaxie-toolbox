//! Porteiro de comandos do pipe SYSTEM — S7.1 (#1456, AC6), **DEFAULT-DENY**.
//!
//! Fatia 1 (#1456) foi o gate com o enum VAZIO (tudo recusado). **Esta é a fatia 2
//! (S7.2, #1457):** o 1º comando enumerado — [`Comando::Ping`], diagnóstico benigno —
//! e a doutrina de **autorização POR COMANDO** que ele estabelece pros próximos.
//! Depois do `helloAck`, todo payload passa por aqui; só uma variante ENUMERADA e
//! autorizada responde, o resto é recusado.
//!
//! O AC6 são **dois invariantes** (refino do Altair no #1456, design owner do S7):
//!
//! - **I1 — invariante de COMPILAÇÃO** ([`despachar`]): `match` exaustivo, sem
//!   catch-all, sobre [`Comando`]. Cada comando declara sua política AQUI; adicionar
//!   uma variante SEM decidir a política dela NÃO COMPILA (doutrina do funil único do
//!   #1000/#690). O `Ping` é o 1º braço; um comando com EFEITO nasce negando até
//!   decidir quem chama.
//!
//! - **I2 — invariante de RUNTIME** ([`decidir_comando`]): o default-deny mora na
//!   **fronteira de desserialização**, não no `match`. Só `{"tipo":"<comando
//!   enumerado>"}` vira um `Comando`; QUALQUER outro payload (desconhecido, malformado,
//!   > 64 KiB) falha o parse ⇒ [`Decisao::Negar`] — local-testável, com bytes, sem
//!   runtime SYSTEM nenhum.
//!
//! **Anti-oráculo (req. do Altair):** a RECUSA é **uniforme**. O que volta pro
//! cliente NÃO distingue "comando desconhecido" de "payload malformado" de
//! "> 64 KiB" — erro diferenciado viraria oráculo de enumeração conforme comandos
//! ganhem política. O motivo fica no `Err` interno (log), nunca no wire — por isso
//! [`Decisao::Negar`] não carrega detalhe. `Responder` NÃO é recusa: é um comando
//! enumerado (superfície conhecida por desenho) respondendo — visível de propósito.
//!
//! ⚠️ O serve-loop (ler comando do pipe, responder) é **o fio** da decisão
//! #1234/#1070 — runtime SYSTEM privilegiado, fora desta fatia local-verificável.
//! Este módulo entrega o porteiro PURO que esse fio vai chamar.

use crate::session_channel::parse_mensagem;

/// Comandos aceitos no pipe SYSTEM **após** o `helloAck`. Superfície MÍNIMA e
/// ENUMERADA (doutrina #1000/#690): "serviço SYSTEM com comando genérico é rootkit
/// com papelada". **S7.2 (#1457): o 1º comando é [`Comando::Ping`]** — diagnóstico
/// benigno, SEM efeito privilegiado. Tudo que NÃO for uma variante enumerada segue
/// recusado na desserialização (I2). Internamente-tagueado por `tipo` pra o wire ser
/// explícito (`{"tipo":"ping"}`), nunca posicional.
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "tipo", rename_all = "snake_case")]
pub enum Comando {
    /// Diagnóstico de liveness: prova o pipe vivo, **sem tocar o sistema**. Política
    /// (S7.2): permitido a QUALQUER par que passou o gate S7.1 — é um ping, não uma
    /// capability. Não carrega payload de entrada (recon-free); a resposta é [`Resposta::Pong`].
    Ping,
}

/// A resposta benigna de um comando autorizado. **`Pong` NÃO carrega versão/host/PID/
/// segredo** — diagnóstico não pode virar vetor de reconhecimento pra quem passou o gate.
#[derive(Debug, PartialEq, Eq)]
pub enum Resposta {
    /// Liveness do `Ping`. Sem dado — só "vivo".
    Pong,
}

/// Decisão do porteiro pra um comando recebido. `Negar` é **uniforme** (anti-oráculo,
/// I2): toda RECUSA volta igual, sem revelar o motivo. `Responder` é o caminho de um
/// comando ENUMERADO e autorizado — visível de propósito (não é recusa; a superfície
/// é conhecida por desenho), carrega só a resposta benigna.
#[derive(Debug, PartialEq, Eq)]
pub enum Decisao {
    /// Fail-closed: payload desconhecido/malformado/grande, ou comando cuja política nega.
    Negar,
    /// Comando enumerado e autorizado ⇒ responde SEM efeito privilegiado.
    Responder(Resposta),
}

/// **I1 (compilação) + doutrina de autz por comando.** Despacha um `Comando` já
/// desserializado. `match` EXAUSTIVO, sem catch-all: cada comando declara AQUI a sua
/// política (default-deny é o teto — um comando novo com efeito nasce negando até
/// decidir quem chama). Uma variante nova sem braço explícito **não compila**.
pub fn despachar(cmd: Comando) -> Decisao {
    match cmd {
        // Ping: benigno, sem efeito → autorizado a quem passou o gate. Responde liveness.
        Comando::Ping => Decisao::Responder(Resposta::Pong),
    }
}

/// **I2 (runtime).** Default-deny na fronteira de desserialização. Todo payload
/// pós-`helloAck` passa por `parse_mensagem::<Comando>`; `Comando` é não-habitado ⇒
/// falha SEMPRE ⇒ [`Decisao::Negar`]. Uniforme: o motivo (`Ok` inalcançável, JSON
/// inválido ou `MuitoGrande`) não vaza pro chamador — só a mesma recusa.
#[must_use]
pub fn decidir_comando(raw: &[u8]) -> Decisao {
    match parse_mensagem::<Comando>(raw) {
        // Comando enumerado (hoje: `Ping`) ⇒ a política dele decide (despachar).
        Ok(cmd) => despachar(cmd),
        // Motivo interno (`_e`) poderia ir pro log; NUNCA pro wire (anti-oráculo).
        Err(_e) => Decisao::Negar,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_channel::MAX_MESSAGE_BYTES;

    // #1457 (S7.2): o 1º comando enumerado — `{"tipo":"ping"}` — é AUTORIZADO e responde
    // liveness (`Pong`), SEM efeito. Prova a doutrina end-to-end: parse → despachar → Responder.
    #[test]
    fn ping_e_autorizado_e_responde_pong() {
        assert_eq!(
            decidir_comando(br#"{"tipo":"ping"}"#),
            Decisao::Responder(Resposta::Pong),
            "o ping (comando enumerado) é autorizado e responde liveness, sem efeito",
        );
    }

    /// AC6/I2 (DoD): comando DESCONHECIDO, objeto vazio, lixo e > 64 KiB — TODOS recusados
    /// na desserialização (não é o `match` que prova isto, são os bytes). Só o `Ping` passa.
    #[test]
    fn i2_recusa_todo_payload_nao_enumerado() {
        let casos: &[&[u8]] = &[
            br#"{"tipo":"desligar"}"#,       // comando plausível, NÃO enumerado
            br#"{"cmd":"exec","arg":"x"}"#,  // outro formato plausível
            b"{}",                            // objeto vazio
            b"\"desligar\"",                 // string JSON
            b"lixo \xff\x00 nao-json",       // bytes malformados
            b"",                              // vazio
        ];
        for raw in casos {
            assert_eq!(
                decidir_comando(raw),
                Decisao::Negar,
                "payload {raw:?} tinha de ser NEGADO (nenhuma capability nesta fatia)",
            );
        }
        // > 64 KiB: recusado pelo teto do envelope, e pela MESMA decisão.
        let grande = vec![b'x'; MAX_MESSAGE_BYTES + 1];
        assert_eq!(decidir_comando(&grande), Decisao::Negar);
    }

    /// Anti-oráculo (req. do Altair): a decisão devolvida é IDÊNTICA seja qual for o
    /// motivo. Comando plausível, JSON malformado e payload gigante não podem se
    /// distinguir no que volta — senão o atacante enumera comandos pela diferença.
    #[test]
    fn i2_recusa_uniforme_nao_vira_oraculo() {
        let plausivel = decidir_comando(br#"{"tipo":"desligar"}"#);
        let malformado = decidir_comando(b"\xff nao-e-json");
        let gigante = decidir_comando(&vec![b'x'; MAX_MESSAGE_BYTES + 1]);
        assert_eq!(plausivel, malformado, "desconhecido vs malformado divergiu (oráculo)");
        assert_eq!(malformado, gigante, "malformado vs >64KiB divergiu (oráculo)");
        assert_eq!(plausivel, Decisao::Negar);
    }
}
