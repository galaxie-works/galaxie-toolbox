//! Porteiro de comandos do pipe SYSTEM — S7.1 (#1456, AC6), **DEFAULT-DENY**.
//!
//! Esta é a **fatia 1 (por risco) do #690**: o gate existe ANTES de qualquer
//! capability. Depois do `helloAck`, todo payload que chegar no pipe passa por
//! aqui — e nesta fatia **nenhum comando existe**, então tudo é recusado.
//!
//! O AC6 são **dois invariantes** (refino do Altair no #1456, design owner do S7):
//!
//! - **I1 — invariante de COMPILAÇÃO** ([`despachar`]): `match` exaustivo, sem
//!   catch-all, sobre o enum vazio [`Comando`]. Hoje é inalcançável (nada constrói
//!   um `Comando`), mas guarda o **autor futuro**: adicionar uma variante SEM decidir
//!   a política dela NÃO COMPILA (doutrina do funil único do #1000/#690).
//!
//! - **I2 — invariante de RUNTIME** ([`decidir_comando`]): o default-deny que de
//!   fato **executa** mora na **fronteira de desserialização**, não no `match`. Como
//!   `Comando` é não-habitado, `parse_mensagem::<Comando>` recusa QUALQUER payload —
//!   e isso é local-testável, com bytes, sem runtime SYSTEM nenhum.
//!
//! **Anti-oráculo (req. do Altair):** a recusa é **uniforme**. O que volta pro
//! cliente NÃO distingue "comando desconhecido" de "payload malformado" de
//! "> 64 KiB" — erro diferenciado viraria oráculo de enumeração conforme comandos
//! ganhem política. O motivo fica no `Err` interno (log), nunca no wire — por isso
//! [`Decisao`] carrega só `Negar`, sem detalhe.
//!
//! ⚠️ O serve-loop (ler comando do pipe, responder) é **o fio** da decisão
//! #1234/#1070 — runtime SYSTEM privilegiado, fora desta fatia local-verificável.
//! Este módulo entrega o porteiro PURO que esse fio vai chamar.

use crate::session_channel::parse_mensagem;

/// Comandos aceitos no pipe SYSTEM **após** o `helloAck`. **VAZIO nesta fatia
/// (S7.1)** — o gate nasce sem nenhuma capability. `Deserialize` sobre um enum
/// não-habitado é a espinha do I2: nenhum payload no universo vira um `Comando`.
#[derive(Debug, serde::Deserialize)]
pub enum Comando {}

/// Decisão do porteiro pra um comando recebido. **Só `Negar`, de propósito**
/// (anti-oráculo, I2): a resposta no wire não pode revelar o motivo da recusa.
#[derive(Debug, PartialEq, Eq)]
pub enum Decisao {
    /// Fail-closed: nenhuma capability nesta fatia ⇒ todo comando é recusado.
    Negar,
}

/// **I1 (compilação).** Despacha um `Comando` já desserializado. `match` exaustivo,
/// sem catch-all: como `Comando` é vazio, o corpo é inalcançável hoje; uma variante
/// nova sem braço explícito de política **não compila**.
pub fn despachar(cmd: Comando) -> Decisao {
    match cmd {}
}

/// **I2 (runtime).** Default-deny na fronteira de desserialização. Todo payload
/// pós-`helloAck` passa por `parse_mensagem::<Comando>`; `Comando` é não-habitado ⇒
/// falha SEMPRE ⇒ [`Decisao::Negar`]. Uniforme: o motivo (`Ok` inalcançável, JSON
/// inválido ou `MuitoGrande`) não vaza pro chamador — só a mesma recusa.
#[must_use]
pub fn decidir_comando(raw: &[u8]) -> Decisao {
    match parse_mensagem::<Comando>(raw) {
        // Inalcançável enquanto `Comando` for vazio; fica pra quando houver política.
        Ok(cmd) => despachar(cmd),
        // Motivo interno (`_e`) poderia ir pro log; NUNCA pro wire (anti-oráculo).
        Err(_e) => Decisao::Negar,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_channel::MAX_MESSAGE_BYTES;

    /// AC6/I2 (DoD): JSON de verdade, objeto vazio, lixo e > 64 KiB — TODOS recusados
    /// na desserialização (não é o `match` inalcançável que prova isto, são os bytes).
    #[test]
    fn i2_recusa_todo_payload_pos_helloack() {
        let casos: &[&[u8]] = &[
            br#"{"tipo":"desligar"}"#,       // comando plausível
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
