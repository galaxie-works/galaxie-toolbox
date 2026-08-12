//! Ponte pull→push entre o encoder (S1) e o loop sans-I/O do transporte (S2).
//!
//! A [`CodedFrameSource`] entrega frames por PULL bloqueante (`next_frame`), mas o
//! loop do str0m não pode bloquear esperando o encoder. A `FrameBridge` roda a
//! fonte numa thread própria e repassa os frames por um canal que o loop de rede
//! DRENA sem bloquear — desacoplando o ritmo do encoder do ritmo da rede.
//!
//! Não depende de str0m/OpenSSL: faz parte do NÚCLEO testável.

use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};
use std::thread::{self, JoinHandle};

use crate::frame::{CodedFrame, CodedFrameSource};

/// A fonte encerrou (devolveu `None`) — não virão mais frames.
#[derive(Debug, PartialEq, Eq)]
pub struct FrameFim;

pub struct FrameBridge {
    rx: Receiver<CodedFrame>,
    _handle: JoinHandle<()>,
}

impl FrameBridge {
    /// Inicia a thread que puxa da `fonte` e enfileira no canal. A thread encerra
    /// quando a fonte devolve `None` OU quando o receptor (esta `FrameBridge`) é
    /// dropado (o `send` falha → sai do laço), então não vaza.
    pub fn iniciar(mut fonte: Box<dyn CodedFrameSource>) -> Self {
        let (tx, rx): (Sender<CodedFrame>, Receiver<CodedFrame>) = channel();
        let handle = thread::spawn(move || {
            while let Some(frame) = fonte.next_frame() {
                if tx.send(frame).is_err() {
                    break; // receptor caiu → para de puxar
                }
            }
        });
        Self {
            rx,
            _handle: handle,
        }
    }

    /// Próximo frame SEM bloquear (pro loop de rede). `Ok(None)` = nada agora;
    /// `Err(FrameFim)` = a fonte encerrou.
    pub fn tentar_receber(&self) -> Result<Option<CodedFrame>, FrameFim> {
        match self.rx.try_recv() {
            Ok(f) => Ok(Some(f)),
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => Err(FrameFim),
        }
    }

    /// Bloqueia até o próximo frame; `Err(FrameFim)` quando a fonte encerra.
    pub fn receber(&self) -> Result<CodedFrame, FrameFim> {
        self.rx.recv().map_err(|_| FrameFim)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::DummyFrameSource;

    #[test]
    fn ponte_entrega_frames_em_ordem_e_encerra() {
        let fonte = Box::new(DummyFrameSource::new(30, 4).com_limite(5));
        let bridge = FrameBridge::iniciar(fonte);

        let mut recebidos = Vec::new();
        loop {
            match bridge.receber() {
                Ok(f) => recebidos.push(f),
                Err(FrameFim) => break,
            }
        }
        assert_eq!(recebidos.len(), 5);
        // ordem preservada (timestamp monotônico crescente)
        for par in recebidos.windows(2) {
            assert!(par[1].timestamp_us > par[0].timestamp_us);
        }
        // primeiro é keyframe (GOP)
        assert!(recebidos[0].keyframe);
    }

    #[test]
    fn tentar_receber_nao_bloqueia() {
        // Fonte que não emite nada (limite 0): `tentar_receber` NÃO pode bloquear —
        // retorna Ok(None) (vazio) ou Err(FrameFim) (thread já encerrou), na hora.
        let fonte = Box::new(DummyFrameSource::new(30, 4).com_limite(0));
        let bridge = FrameBridge::iniciar(fonte);
        let r = bridge.tentar_receber();
        assert!(matches!(r, Ok(None) | Err(FrameFim)));

        // E com frames, drena todos por try_recv (bloqueando só via yield entre
        // tentativas), até a fonte encerrar — todos chegam.
        let bridge2 = FrameBridge::iniciar(Box::new(DummyFrameSource::new(30, 4).com_limite(3)));
        let mut vistos = 0;
        loop {
            match bridge2.tentar_receber() {
                Ok(Some(_)) => vistos += 1,
                Ok(None) => std::thread::yield_now(),
                Err(FrameFim) => break,
            }
        }
        assert_eq!(vistos, 3);
    }
}
