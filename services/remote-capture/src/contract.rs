//! Fronteira congelada S1↔S2. Agora que o S2 (#685, `remote-transport`) está
//! integrado, este módulo **reexporta** os tipos canônicos do transporte em vez
//! de manter a cópia temporária 1:1 (era o que a README prometia: "quando o PR
//! do S2 estiver integrado, `contract.rs` deve reexportar os tipos de
//! `services/remote-transport`"). Um único `CodedFrame` no repo → some a conversão
//! manual capture↔transport e o risco dos dois lados divergirem.

pub use galaxie_remote_transport::{
    canal_de_comandos, canal_de_frames, CodedFrame, CodedFrameSource, CommandChannel,
    CommandReceiver, EncoderCommand, FrameSender,
};

use std::sync::mpsc::Receiver;

/// Alias em inglês de [`canal_de_frames`] — call sites do capture usam este nome.
#[must_use]
pub fn frame_channel(capacity: usize) -> (FrameSender, Receiver<CodedFrame>) {
    canal_de_frames(capacity)
}

/// Alias em inglês de [`canal_de_comandos`].
#[must_use]
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
        assert_eq!(receiver.try_receive(), Some(EncoderCommand::RequestKeyframe));
        assert_eq!(receiver.try_receive(), None);
    }
}
