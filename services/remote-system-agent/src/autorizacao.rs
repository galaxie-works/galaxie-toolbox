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

use std::collections::HashSet;

use galaxie_remote_net::protocol::Capabilities;
use galaxie_remote_transport::{ControlMessage, Frame, InputEvent};

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

/// A DECISÃO do pump pra um frame recebido — o dispatch estrutural (passo 3), com
/// as 3 ressalvas do review do @Altair (#1000) viradas CÓDIGO, não comentário:
/// - **anúncio de `Capabilities` do controlador ⇒ `Ignorar`** (braço explícito;
///   o host nunca APLICA o que o controlador anuncia — mata auto-promoção);
/// - **`Chunk` sem oferta aceita ⇒ `Rejeitar`** (state check: chunk órfão é escrita
///   por índice);
/// - **`Input(Screen)` (host→controlador) chegando no host ⇒ `Rejeitar`** (guard de
///   direção: aceitar reescreveria a geometria do mapeamento de coordenadas).
#[derive(Debug, Clone, PartialEq)]
pub enum AcaoFrame {
    InjetarInput(InputEvent),
    AplicarClipboard(ControlMessage),
    ControleTransfer(ControlMessage),
    EscreverChunk { transfer_id: u32, offset: u64, data: Vec<u8> },
    /// Sem efeito privilegiado (anúncio de handshake). O motivo é pra log.
    Ignorar(&'static str),
    /// Fail-closed: capability ausente, direção errada, ou chunk órfão.
    Rejeitar(&'static str),
}

/// Decide o que o pump faz com um frame do controlador, dadas as `caps` do ticket
/// e o conjunto de transfers já ACEITOS (oferta→accept). Consistente com
/// [`autorizar`] no gating de capability, + as 3 guardas estruturais (§ acima).
#[must_use]
pub fn decidir_acao(
    caps: &Capabilities,
    frame: Frame,
    transfers_aceitos: &HashSet<u32>,
) -> AcaoFrame {
    match frame {
        // Guard de direção: Screen é host→controlador; no host é rejeitado ANTES do cap.
        Frame::Input(InputEvent::Screen { .. }) => {
            AcaoFrame::Rejeitar("Input(Screen) é host→controlador; não aceito no host")
        }
        Frame::Input(ev) => {
            if caps.input {
                AcaoFrame::InjetarInput(ev)
            } else {
                AcaoFrame::Rejeitar("sem capability input")
            }
        }
        // Braço EXPLÍCITO (não catch-all): anúncio do controlador é ignorado no host.
        Frame::Control(ControlMessage::Capabilities { .. }) => {
            AcaoFrame::Ignorar("anúncio de Capabilities do controlador: host ignora")
        }
        Frame::Control(msg @ (ControlMessage::ClipboardText { .. } | ControlMessage::ClipboardImage { .. })) => {
            if caps.clipboard {
                AcaoFrame::AplicarClipboard(msg)
            } else {
                AcaoFrame::Rejeitar("sem capability clipboard")
            }
        }
        Frame::Control(
            msg @ (ControlMessage::FileOffer { .. }
            | ControlMessage::FileAccept { .. }
            | ControlMessage::FileReject { .. }
            | ControlMessage::FileComplete { .. }
            | ControlMessage::FileCancel { .. }),
        ) => {
            if caps.file_transfer {
                AcaoFrame::ControleTransfer(msg)
            } else {
                AcaoFrame::Rejeitar("sem capability file_transfer")
            }
        }
        Frame::Chunk { transfer_id, offset, data } => {
            if !caps.file_transfer {
                AcaoFrame::Rejeitar("sem capability file_transfer")
            } else if !transfers_aceitos.contains(&transfer_id) {
                // AC #2: chunk sem oferta aceita = escrita por índice → recusa.
                AcaoFrame::Rejeitar("chunk órfão: nenhuma transferência aceita com este id")
            } else {
                AcaoFrame::EscreverChunk { transfer_id, offset, data }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use galaxie_remote_transport::{BotaoMouse, InputEvent, ScreenInfo};

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

    fn todas() -> Capabilities {
        Capabilities {
            screen: true,
            input: true,
            file_transfer: true,
            clipboard: true,
            audio: true,
        }
    }

    #[test]
    fn ac3_input_screen_rejeitado_no_host() {
        // Screen é host→controlador; recusado no host MESMO com todas as caps.
        let f = Frame::Input(InputEvent::Screen {
            info: ScreenInfo {
                origin_x: 0,
                origin_y: 0,
                width: 1920,
                height: 1080,
                device_pixel_ratio: 1.0,
            },
        });
        assert!(matches!(
            decidir_acao(&todas(), f, &HashSet::new()),
            AcaoFrame::Rejeitar(_)
        ));
    }

    #[test]
    fn input_real_injeta_com_cap_e_rejeita_sem() {
        let mk = || {
            Frame::Input(InputEvent::MouseButton {
                botao: BotaoMouse::Left,
                pressed: true,
            })
        };
        assert!(matches!(
            decidir_acao(&so("input"), mk(), &HashSet::new()),
            AcaoFrame::InjetarInput(_)
        ));
        assert!(matches!(
            decidir_acao(&Capabilities::default(), mk(), &HashSet::new()),
            AcaoFrame::Rejeitar(_)
        ));
    }

    #[test]
    fn ac1_anuncio_de_capabilities_e_ignorado_estruturalmente() {
        let f = Frame::Control(ControlMessage::Capabilities {
            clipboard: true,
            file_transfer: true,
        });
        // Ignorar (não Aplicar) — o host nunca aplica o anúncio do controlador.
        assert!(matches!(
            decidir_acao(&todas(), f, &HashSet::new()),
            AcaoFrame::Ignorar(_)
        ));
    }

    #[test]
    fn ac2_chunk_orfao_rejeitado_e_com_oferta_aceita_escreve() {
        let chunk = |id| Frame::Chunk {
            transfer_id: id,
            offset: 0,
            data: vec![1, 2, 3],
        };
        // sem oferta aceita → rejeitado, mesmo com file_transfer ligado.
        assert!(matches!(
            decidir_acao(&so("file"), chunk(7), &HashSet::new()),
            AcaoFrame::Rejeitar(_)
        ));
        // com a oferta 7 aceita → escreve.
        let aceitos: HashSet<u32> = [7].into_iter().collect();
        assert!(matches!(
            decidir_acao(&so("file"), chunk(7), &aceitos),
            AcaoFrame::EscreverChunk { transfer_id: 7, .. }
        ));
        // chunk de OUTRA transferência (não aceita) → rejeitado.
        assert!(matches!(
            decidir_acao(&so("file"), chunk(9), &aceitos),
            AcaoFrame::Rejeitar(_)
        ));
    }

    #[test]
    fn decidir_acao_consistente_com_autorizar_no_gating() {
        // Pra frames que dependem só de capability (não das guardas estruturais),
        // Rejeitar ⟺ !autorizar.
        let aceitos: HashSet<u32> = [1].into_iter().collect();
        for caps in [Capabilities::default(), so("input"), so("clipboard"), so("file"), todas()] {
            for f in [
                Frame::Input(InputEvent::MouseMove { x: 0.5, y: 0.5 }),
                Frame::Control(ControlMessage::ClipboardText { text: "x".into() }),
                Frame::Control(ControlMessage::FileOffer {
                    transfer_id: 1,
                    name: "a".into(),
                    size: 1,
                }),
                Frame::Chunk {
                    transfer_id: 1,
                    offset: 0,
                    data: vec![],
                },
            ] {
                let permitido = autorizar(&caps, &f);
                let rejeitado = matches!(decidir_acao(&caps, f, &aceitos), AcaoFrame::Rejeitar(_));
                assert_eq!(permitido, !rejeitado, "gating divergiu de autorizar");
            }
        }
    }
}
