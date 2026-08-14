//! Protocolo de CONTROLE sobre o DataChannel (S5, #688): clipboard sync + file
//! transfer bidirecional, com gating por capability (o host pode desligar).
//!
//! Formato de fio (o DataChannel do str0m carrega bytes crus):
//! - `0x01` + JSON  → mensagem de controle ([`ControlMessage`]).
//! - `0x02` + `[transfer_id u32 LE][offset u64 LE][bytes...]` → pedaço de arquivo
//!   (SEM base64: eficiente; offset permite resume).
//!
//! Núcleo testável — não depende de str0m/OpenSSL. A sessão (S2) só transporta os
//! bytes; a UI (S5-front, depois) lê/escreve o clipboard do SO e escolhe a pasta.

use serde::{Deserialize, Serialize};

use crate::input::InputEvent;

const OP_CONTROLE: u8 = 0x01;
const OP_CHUNK: u8 = 0x02;
const OP_INPUT: u8 = 0x03;

/// Mensagem de controle (tudo que não é pedaço de arquivo cru). `transfer_id`
/// correlaciona um envio de arquivo do começo ao fim.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum ControlMessage {
    /// O host anuncia o que a sessão permite (gating). Enviado no início.
    Capabilities {
        clipboard: bool,
        file_transfer: bool,
    },
    /// Clipboard de texto — cola no outro lado.
    ClipboardText {
        text: String,
    },
    /// Clipboard de imagem pequena (inline base64; grande vira file transfer).
    ClipboardImage {
        mime: String,
        bytes_base64: String,
    },
    /// Oferta de arquivo: o receptor responde Accept (com resume) ou Reject.
    FileOffer {
        transfer_id: u32,
        name: String,
        size: u64,
    },
    /// Aceita a oferta; `resume_from` > 0 retoma de um envio interrompido.
    FileAccept {
        transfer_id: u32,
        resume_from: u64,
    },
    FileReject {
        transfer_id: u32,
    },
    /// Fim do envio (todos os chunks foram mandados).
    FileComplete {
        transfer_id: u32,
    },
    FileCancel {
        transfer_id: u32,
    },
}

/// Um frame decodificado do DataChannel.
#[derive(Debug, Clone, PartialEq)]
pub enum Frame {
    Control(ControlMessage),
    Chunk {
        transfer_id: u32,
        offset: u64,
        data: Vec<u8>,
    },
    /// Evento de input (S3) — controlador→host (ou Screen host→controlador).
    Input(InputEvent),
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ControlError {
    #[error("frame vazio")]
    Vazio,
    #[error("opcode desconhecido: {0:#x}")]
    Opcode(u8),
    #[error("chunk truncado")]
    ChunkTruncado,
    #[error("JSON inválido: {0}")]
    Json(String),
    #[error("operação bloqueada pela capability da sessão")]
    Bloqueado,
}

/// Serializa uma mensagem de controle pro fio.
pub fn encode_control(msg: &ControlMessage) -> Vec<u8> {
    let json = serde_json::to_vec(msg).expect("ControlMessage serializa");
    let mut buf = Vec::with_capacity(1 + json.len());
    buf.push(OP_CONTROLE);
    buf.extend_from_slice(&json);
    buf
}

/// Serializa um evento de input pro fio (opcode 0x03 + JSON).
pub fn encode_input(ev: &InputEvent) -> Vec<u8> {
    let json = serde_json::to_vec(ev).expect("InputEvent serializa");
    let mut buf = Vec::with_capacity(1 + json.len());
    buf.push(OP_INPUT);
    buf.extend_from_slice(&json);
    buf
}

/// Serializa um pedaço de arquivo pro fio (header binário + bytes crus).
pub fn encode_chunk(transfer_id: u32, offset: u64, data: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(1 + 4 + 8 + data.len());
    buf.push(OP_CHUNK);
    buf.extend_from_slice(&transfer_id.to_le_bytes());
    buf.extend_from_slice(&offset.to_le_bytes());
    buf.extend_from_slice(data);
    buf
}

/// Decodifica um frame recebido do DataChannel.
pub fn decode(bytes: &[u8]) -> Result<Frame, ControlError> {
    let (&op, resto) = bytes.split_first().ok_or(ControlError::Vazio)?;
    match op {
        OP_CONTROLE => {
            let msg =
                serde_json::from_slice(resto).map_err(|e| ControlError::Json(e.to_string()))?;
            Ok(Frame::Control(msg))
        }
        OP_CHUNK => {
            if resto.len() < 12 {
                return Err(ControlError::ChunkTruncado);
            }
            let transfer_id = u32::from_le_bytes(resto[0..4].try_into().unwrap());
            let offset = u64::from_le_bytes(resto[4..12].try_into().unwrap());
            Ok(Frame::Chunk {
                transfer_id,
                offset,
                data: resto[12..].to_vec(),
            })
        }
        OP_INPUT => {
            let ev =
                serde_json::from_slice(resto).map_err(|e| ControlError::Json(e.to_string()))?;
            Ok(Frame::Input(ev))
        }
        outro => Err(ControlError::Opcode(outro)),
    }
}

/// Política de capability da sessão (o host decide). O gating é aplicado dos DOIS
/// lados: não envia nem aceita o que está desligado.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapabilityPolicy {
    pub clipboard: bool,
    pub file_transfer: bool,
}

impl Default for CapabilityPolicy {
    fn default() -> Self {
        Self {
            clipboard: true,
            file_transfer: true,
        }
    }
}

impl CapabilityPolicy {
    /// Rejeita uma mensagem que a política proíbe (clipboard/transfer desligado).
    /// `Capabilities`/cancel/complete passam sempre.
    pub fn permite(&self, msg: &ControlMessage) -> Result<(), ControlError> {
        let ok = match msg {
            ControlMessage::ClipboardText { .. } | ControlMessage::ClipboardImage { .. } => {
                self.clipboard
            }
            ControlMessage::FileOffer { .. } | ControlMessage::FileAccept { .. } => {
                self.file_transfer
            }
            _ => true,
        };
        if ok {
            Ok(())
        } else {
            Err(ControlError::Bloqueado)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_round_trip() {
        let msg = ControlMessage::FileOffer {
            transfer_id: 7,
            name: "a.txt".into(),
            size: 1234,
        };
        let bytes = encode_control(&msg);
        assert_eq!(bytes[0], OP_CONTROLE);
        assert_eq!(decode(&bytes).unwrap(), Frame::Control(msg));
    }

    #[test]
    fn chunk_round_trip_sem_base64() {
        let data = vec![9u8, 8, 7, 6, 5];
        let bytes = encode_chunk(42, 1024, &data);
        assert_eq!(bytes[0], OP_CHUNK);
        match decode(&bytes).unwrap() {
            Frame::Chunk {
                transfer_id,
                offset,
                data: d,
            } => {
                assert_eq!(transfer_id, 42);
                assert_eq!(offset, 1024);
                assert_eq!(d, data);
            }
            _ => panic!("esperava chunk"),
        }
    }

    #[test]
    fn input_round_trip_no_fio() {
        use crate::input::{BotaoMouse, InputEvent};
        let ev = InputEvent::MouseButton {
            botao: BotaoMouse::Left,
            pressed: true,
        };
        let bytes = encode_input(&ev);
        assert_eq!(bytes[0], OP_INPUT);
        assert_eq!(decode(&bytes).unwrap(), Frame::Input(ev));
    }

    #[test]
    fn decode_rejeita_lixo() {
        assert_eq!(decode(&[]).unwrap_err(), ControlError::Vazio);
        assert_eq!(decode(&[0xFF]).unwrap_err(), ControlError::Opcode(0xFF));
        assert_eq!(
            decode(&[OP_CHUNK, 1, 2]).unwrap_err(),
            ControlError::ChunkTruncado
        );
    }

    #[test]
    fn gating_bloqueia_o_desligado() {
        let pol = CapabilityPolicy {
            clipboard: false,
            file_transfer: true,
        };
        assert_eq!(
            pol.permite(&ControlMessage::ClipboardText { text: "x".into() }),
            Err(ControlError::Bloqueado)
        );
        assert!(pol
            .permite(&ControlMessage::FileOffer {
                transfer_id: 1,
                name: "a".into(),
                size: 1
            })
            .is_ok());
        // sinais de controle passam sempre
        assert!(pol
            .permite(&ControlMessage::FileCancel { transfer_id: 1 })
            .is_ok());
    }
}
