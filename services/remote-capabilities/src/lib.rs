//! Vocabulário ÚNICO de capability do Remote — o crate FOLHA (#1070 RB7, decisão do
//! Altair no #1234). É o contrato ENTRE `remote-net` (que CONCEDE via ticket S8) e
//! `remote-transport` (que APLICA no DataChannel): os dois são pares, nenhum abaixo do
//! outro, então o tipo mora num terceiro lugar em vez de uma dep entre irmãos.
//!
//! Dep única: `serde`. Sem runtime, sem async, sem OpenSSL — barato pra qualquer
//! consumidor (inclusive o binário SYSTEM que verifica o ticket).

use serde::{Deserialize, Serialize};

/// Capabilities da sessão remota — assinado no ticket S8 e o que cruza o IPC do app.
///
/// `#[serde(default)]`: um campo AUSENTE no payload desserializa como `false` = **DENY**
/// (fail-closed) — casa com o `Default` e deixa um cliente que manda só um subconjunto
/// (ex.: `screen`/`input`) válido, com o resto negado até ser concedido. `deny_unknown_fields`
/// rejeita campo estranho. `Copy` porque são 5 bools (o app copia por valor).
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Capabilities {
    pub screen: bool,
    pub input: bool,
    pub file_transfer: bool,
    pub clipboard: bool,
    pub audio: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_e_deny_em_todos() {
        // Fail-closed: nada concedido por default.
        assert_eq!(Capabilities::default(), Capabilities {
            screen: false,
            input: false,
            file_transfer: false,
            clipboard: false,
            audio: false,
        });
    }

    #[test]
    fn campo_ausente_desserializa_como_deny() {
        // O front manda só screen/input; o resto tem que virar false (deny).
        let c: Capabilities = serde_json::from_str(r#"{"screen":true,"input":true}"#).unwrap();
        assert!(c.screen && c.input);
        assert!(!c.file_transfer && !c.clipboard && !c.audio);
    }

    #[test]
    fn campo_desconhecido_e_rejeitado() {
        assert!(serde_json::from_str::<Capabilities>(r#"{"screen":true,"x":1}"#).is_err());
    }

    #[test]
    fn round_trip_camel_case() {
        let c = Capabilities {
            screen: true,
            input: false,
            file_transfer: true,
            clipboard: false,
            audio: true,
        };
        let j = serde_json::to_string(&c).unwrap();
        assert!(j.contains("fileTransfer"));
        assert_eq!(serde_json::from_str::<Capabilities>(&j).unwrap(), c);
    }
}
