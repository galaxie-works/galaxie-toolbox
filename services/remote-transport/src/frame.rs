//! Contrato de FRAME CODIFICADO — a fronteira entre o encoder (S1/#684) e o
//! transporte (S2/#685). O transporte só vê bytes + timing; nunca sabe do
//! encoder. Este é o CONTRATO CONGELADO entre as duas raias.

/// Um frame de vídeo já codificado (H.264). **CONTRATO CONGELADO** (#685 × S1):
/// o S1 (capture+encode) produz; o S2 (transporte WebRTC) consome e empacota em
/// RTP. Não mude os campos sem avisar o Polaris (ele sincroniza com o Orion).
#[derive(Debug, Clone)]
pub struct CodedFrame {
    /// NAL units H.264 em **Annex-B** (start codes `00 00 00 01`). O empacotador
    /// RTP fatia em pacotes; keyframes carregam SPS/PPS antes do IDR.
    pub data: Vec<u8>,
    /// Timestamp de captura em **microssegundos**, de um relógio MONOTÔNICO da
    /// fonte (não wall-clock). O transporte converte pro clock RTP de 90 kHz.
    pub timestamp_us: u64,
    /// `true` = IDR/keyframe. Ponto de sincronismo: resposta a PLI/keyframe
    /// request e primeiro frame decodificável de quem entra na sessão.
    pub keyframe: bool,
}

impl CodedFrame {
    pub fn new(data: Vec<u8>, timestamp_us: u64, keyframe: bool) -> Self {
        Self {
            data,
            timestamp_us,
            keyframe,
        }
    }
    pub fn len(&self) -> usize {
        self.data.len()
    }
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}

use std::sync::mpsc::{sync_channel, Receiver, SyncSender};

/// **Contrato de entrega APROVADO (Orion):** o encoder (S1) faz **PUSH** dos
/// frames num canal BOUNDED. Bounded = backpressure: se o transporte não drena
/// (rede lenta), o `send` bloqueia em vez de estourar memória. É este o `Sender`
/// que o encoder recebe.
pub type FrameSender = SyncSender<CodedFrame>;

/// Cria o par encoder→transporte. `capacidade` = quantos frames o canal segura
/// antes de aplicar backpressure (ex.: 8–16 frames).
pub fn canal_de_frames(capacidade: usize) -> (FrameSender, Receiver<CodedFrame>) {
    sync_channel(capacidade.max(1))
}

/// Fonte de frames por PULL — alternativa/legado ao PUSH. O S1 usa o `FrameSender`
/// (push); esta trait serve pra fontes que só sabem entregar por pull, adaptadas
/// pra push por uma [`crate::bridge::FrameBridge`]. `next_frame` BLOQUEIA até o
/// próximo frame e devolve `None` quando a fonte encerra.
pub trait CodedFrameSource: Send {
    fn next_frame(&mut self) -> Option<CodedFrame>;
}

/// Gera frames FALSOS pra exercitar o transporte SEM o encoder do S1: um keyframe
/// a cada `gop` frames, timestamp avançando a `fps`, payload de tamanho plausível
/// (keyframe maior, simulando SPS/PPS+IDR), sempre com start code Annex-B.
pub struct DummyFrameSource {
    contador: u64,
    gop: u64,
    fps: u64,
    max_frames: Option<u64>,
    tamanho: usize,
}

impl DummyFrameSource {
    pub fn new(fps: u64, gop: u64) -> Self {
        Self {
            contador: 0,
            gop: gop.max(1),
            fps: fps.max(1),
            max_frames: None,
            tamanho: 4096,
        }
    }
    /// Limita a quantidade de frames (encerra com `None`) — útil em teste.
    pub fn com_limite(mut self, n: u64) -> Self {
        self.max_frames = Some(n);
        self
    }
}

impl CodedFrameSource for DummyFrameSource {
    fn next_frame(&mut self) -> Option<CodedFrame> {
        if let Some(max) = self.max_frames {
            if self.contador >= max {
                return None;
            }
        }
        let keyframe = self.contador % self.gop == 0;
        let timestamp_us = self.contador * 1_000_000 / self.fps;
        let n = if keyframe {
            self.tamanho * 4
        } else {
            self.tamanho
        };
        let mut data = vec![0u8, 0, 0, 1]; // Annex-B start code
        data.extend(std::iter::repeat(0xAB).take(n));
        self.contador += 1;
        Some(CodedFrame {
            data,
            timestamp_us,
            keyframe,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dummy_source_cadencia_keyframe_e_timestamp() {
        let mut src = DummyFrameSource::new(30, 4).com_limite(9);
        let mut frames = Vec::new();
        while let Some(f) = src.next_frame() {
            frames.push(f);
        }
        assert_eq!(frames.len(), 9); // respeita o limite
                                     // keyframe a cada 4 (índices 0,4,8)
        let keys: Vec<usize> = frames
            .iter()
            .enumerate()
            .filter(|(_, f)| f.keyframe)
            .map(|(i, _)| i)
            .collect();
        assert_eq!(keys, vec![0, 4, 8]);
        // keyframe é maior que frame normal (SPS/PPS+IDR)
        assert!(frames[0].len() > frames[1].len());
        // Annex-B start code presente
        assert_eq!(&frames[0].data[..4], &[0, 0, 0, 1]);
        // timestamp avança 1/30s = ~33333us por frame
        assert_eq!(frames[0].timestamp_us, 0);
        assert_eq!(frames[1].timestamp_us, 33_333);
    }

    #[test]
    fn canal_push_entrega_frames_bounded() {
        let (tx, rx) = canal_de_frames(4);
        tx.send(CodedFrame::new(vec![0, 0, 0, 1, 9], 0, true))
            .unwrap();
        tx.send(CodedFrame::new(vec![0, 0, 0, 1, 8], 33_333, false))
            .unwrap();
        let a = rx.recv().unwrap();
        let b = rx.recv().unwrap();
        assert!(a.keyframe && !b.keyframe);
        assert_eq!(b.timestamp_us, 33_333);
    }
}
