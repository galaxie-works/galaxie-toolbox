//! Enforcement de capability **por-frame**, fail-closed (S7 #690, passo 3 — §8.4 do
//! contrato S8 do @Altair). No modo não-supervisionado, o worker SYSTEM injeta
//! input / cola clipboard / grava arquivo no secure desktop a partir de frames que
//! chegam pelo DataChannel. **Cada frame passa por [`autorizar`] ANTES de ter
//! efeito**, contra as capabilities do **ticket assinado do S8** (via 2b-verify) —
//! não contra o `session.start` do owner (que não é autoridade).
//!
//! **Default-deny por construção:** o `match` é EXAUSTIVO sobre `Frame`/
//! `ControlMessage`. Um frame novo (ex.: áudio-in, futuro) **não compila** sem uma
//! decisão explícita de capability — é o "custa um match" do porteiro, garantido
//! pelo compilador, não por convenção.

use galaxie_remote_net::protocol::Capabilities;
use galaxie_remote_transport::{ControlMessage, Frame};

/// `true` se o frame recebido do controlador pode ter efeito no host, dadas as
/// `caps` autoritativas (do ticket). Mapeia:
/// - input (teclado/mouse) → `caps.input` (o mais sensível: controla o secure desktop);
/// - clipboard (texto/imagem) → `caps.clipboard`;
/// - file transfer (oferta/aceite/chunk/…) → `caps.file_transfer`;
/// - anúncio de `Capabilities` → handshake, sem efeito privilegiado (permitido).
///
/// `screen`/`audio` NÃO gateiam frames de entrada — são a MÍDIA que o host ENVIA
/// (gated no caminho de escrita do pump, não aqui).
#[must_use]
pub fn autorizar(caps: &Capabilities, frame: &Frame) -> bool {
    match frame {
        Frame::Input(_) => caps.input,
        Frame::Chunk { .. } => caps.file_transfer,
        Frame::Control(msg) => match msg {
            ControlMessage::Capabilities { .. } => true,
            ControlMessage::ClipboardText { .. } | ControlMessage::ClipboardImage { .. } => {
                caps.clipboard
            }
            ControlMessage::FileOffer { .. }
            | ControlMessage::FileAccept { .. }
            | ControlMessage::FileReject { .. }
            | ControlMessage::FileComplete { .. }
            | ControlMessage::FileCancel { .. } => caps.file_transfer,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use galaxie_remote_transport::{BotaoMouse, InputEvent};

    /// Só a capability nomeada ligada; o resto desligado (prova o isolamento).
    fn so(cap: &str) -> Capabilities {
        Capabilities {
            screen: false,
            input: cap == "input",
            file_transfer: cap == "file",
            clipboard: cap == "clipboard",
            audio: false,
        }
    }

    fn input_frame() -> Frame {
        Frame::Input(InputEvent::MouseButton {
            botao: BotaoMouse::Left,
            pressed: true,
        })
    }

    #[test]
    fn input_exige_a_capability_input() {
        assert!(autorizar(&so("input"), &input_frame()));
        // sem a cap de input, o frame de input é NEGADO (o mais crítico: secure desktop).
        assert!(!autorizar(&so("clipboard"), &input_frame()));
        assert!(!autorizar(&Capabilities::default(), &input_frame()));
    }

    #[test]
    fn clipboard_exige_a_capability_clipboard() {
        let f = Frame::Control(ControlMessage::ClipboardText { text: "x".into() });
        assert!(autorizar(&so("clipboard"), &f));
        assert!(!autorizar(&so("input"), &f));
        assert!(!autorizar(&Capabilities::default(), &f));
    }

    #[test]
    fn file_transfer_exige_a_capability_file() {
        let oferta = Frame::Control(ControlMessage::FileOffer {
            transfer_id: 1,
            name: "a".into(),
            size: 10,
        });
        let chunk = Frame::Chunk {
            transfer_id: 1,
            offset: 0,
            data: vec![1, 2, 3],
        };
        assert!(autorizar(&so("file"), &oferta));
        assert!(autorizar(&so("file"), &chunk));
        assert!(!autorizar(&so("clipboard"), &oferta));
        assert!(!autorizar(&so("clipboard"), &chunk)); // chunk sem file_transfer = negado
    }

    #[test]
    fn default_deny_com_capabilities_zeradas() {
        let vazio = Capabilities::default(); // tudo false
        for f in [
            input_frame(),
            Frame::Control(ControlMessage::ClipboardImage {
                mime: "image/png".into(),
                bytes_base64: "AA==".into(),
            }),
            Frame::Chunk {
                transfer_id: 1,
                offset: 0,
                data: vec![],
            },
        ] {
            assert!(!autorizar(&vazio, &f), "default-deny falhou pra {f:?}");
        }
    }

    #[test]
    fn anuncio_de_capabilities_e_handshake_permitido() {
        let f = Frame::Control(ControlMessage::Capabilities {
            clipboard: true,
            file_transfer: false,
        });
        // anúncio não é ação privilegiada; passa mesmo com caps zeradas.
        assert!(autorizar(&Capabilities::default(), &f));
    }
}
