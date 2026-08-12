//! Fronteira congelada S1↔S2. Estes tipos espelham `remote-transport` #685.

use std::sync::mpsc::{Receiver, SyncSender, sync_channel};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodedFrame {
    /// H.264 Annex-B. Um keyframe contém SPS + PPS + IDR.
    pub data: Vec<u8>,
    /// Timestamp monotônico da captura em microssegundos.
    pub timestamp_us: u64,
    /// `true` somente quando a access unit contém IDR.
    pub keyframe: bool,
}

impl CodedFrame {
    #[must_use]
    pub fn new(data: Vec<u8>, timestamp_us: u64, keyframe: bool) -> Self {
        Self {
            data,
            timestamp_us,
            keyframe,
        }
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.data.len()
    }
}

pub type FrameSender = SyncSender<CodedFrame>;

pub trait CodedFrameSource: Send {
    fn next_frame(&mut self) -> Option<CodedFrame>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderCommand {
    RequestKeyframe,
}

pub struct CommandChannel {
    tx: SyncSender<EncoderCommand>,
}

/// Lado do S1: drena pedidos sem bloquear; canal de capacidade um coalesce PLI.
pub struct CommandReceiver {
    rx: Receiver<EncoderCommand>,
}

impl CommandReceiver {
    #[must_use]
    pub fn tentar_receber(&self) -> Option<EncoderCommand> {
        self.rx.try_recv().ok()
    }

    #[must_use]
    pub fn try_receive(&self) -> Option<EncoderCommand> {
        self.tentar_receber()
    }
}

impl CommandChannel {
    pub fn pedir_keyframe(&self) {
        let _ = self.tx.try_send(EncoderCommand::RequestKeyframe);
    }
}

pub fn canal_de_frames(capacidade: usize) -> (FrameSender, Receiver<CodedFrame>) {
    sync_channel(capacidade.max(1))
}

pub fn frame_channel(capacity: usize) -> (FrameSender, Receiver<CodedFrame>) {
    canal_de_frames(capacity)
}

pub fn canal_de_comandos() -> (CommandChannel, CommandReceiver) {
    let (tx, rx) = sync_channel(1);
    (CommandChannel { tx }, CommandReceiver { rx })
}

pub fn command_channel() -> (CommandChannel, CommandReceiver) {
    canal_de_comandos()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_channel_is_bounded_and_never_zero_capacity() {
        let (sender, receiver) = frame_channel(0);
        sender
            .send(CodedFrame::new(vec![0, 0, 0, 1, 0x65], 42, true))
            .expect("receiver is alive");
        let frame = receiver.recv().expect("sender is alive");
        assert!(frame.keyframe);
        assert_eq!(frame.timestamp_us, 42);
    }

    #[test]
    fn command_channel_coalesces_pending_keyframe_requests() {
        let (sender, receiver) = command_channel();
        sender.pedir_keyframe();
        sender.pedir_keyframe();
        assert_eq!(
            receiver.try_receive(),
            Some(EncoderCommand::RequestKeyframe)
        );
        assert_eq!(receiver.try_receive(), None);
    }
}
