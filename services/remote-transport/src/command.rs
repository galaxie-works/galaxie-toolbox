//! Via de comando S2→S1 (transporte → encoder). O peer manda PLI (perda/entrou
//! agora); o transporte (str0m) traduz isso num pedido de keyframe pro encoder,
//! que força um IDR. Vários PLIs em rajada COALESCEM num pedido só — senão o
//! encoder despejaria uma sequência de IDRs (caro) sem necessidade.
//!
//! Núcleo testável: não depende de str0m/OpenSSL.

use std::sync::mpsc::{sync_channel, Receiver, SyncSender};

/// Comando do transporte (S2) pro encoder (S1). Contrato congelado (adição do
/// Orion): por ora só o pedido de keyframe; dá pra crescer (bitrate, etc.).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EncoderCommand {
    RequestKeyframe,
}

/// Lado do TRANSPORTE: pede keyframe sem bloquear e com COALESCÊNCIA (canal
/// bounded de 1 — se já há um pedido pendente, o novo é descartado).
pub struct CommandChannel {
    tx: SyncSender<EncoderCommand>,
}

/// Lado do ENCODER (S1): drena os comandos sem bloquear.
pub struct CommandReceiver {
    rx: Receiver<EncoderCommand>,
}

/// Cria o par transporte↔encoder. Capacidade 1 = coalescência natural: enquanto
/// o encoder não drena o pedido pendente, novos pedidos viram no-op.
pub fn canal_de_comandos() -> (CommandChannel, CommandReceiver) {
    let (tx, rx) = sync_channel(1);
    (CommandChannel { tx }, CommandReceiver { rx })
}

impl CommandChannel {
    /// Pede um keyframe ao encoder. Nunca bloqueia; coalescido (pedido pendente →
    /// no-op) e tolerante ao encoder ter saído (`Disconnected` → no-op).
    pub fn pedir_keyframe(&self) {
        let _ = self.tx.try_send(EncoderCommand::RequestKeyframe);
    }
}

impl CommandReceiver {
    /// (Encoder) próximo comando sem bloquear. `None` = nada agora.
    pub fn tentar_receber(&self) -> Option<EncoderCommand> {
        self.rx.try_recv().ok()
    }

    /// Alias em inglês de [`Self::tentar_receber`] — o pipeline de captura (#684)
    /// consome por este nome quando reexporta este tipo (fim da cópia 1:1).
    pub fn try_receive(&self) -> Option<EncoderCommand> {
        self.tentar_receber()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pedidos_de_keyframe_coalescem() {
        let (canal, receptor) = canal_de_comandos();
        // 5 PLIs em rajada, sem o encoder drenar → 1 pedido só (coalesceu).
        for _ in 0..5 {
            canal.pedir_keyframe();
        }
        assert_eq!(
            receptor.tentar_receber(),
            Some(EncoderCommand::RequestKeyframe)
        );
        assert_eq!(receptor.tentar_receber(), None); // os outros 4 sumiram

        // Depois de drenado, um novo PLI vira um novo pedido.
        canal.pedir_keyframe();
        assert_eq!(
            receptor.tentar_receber(),
            Some(EncoderCommand::RequestKeyframe)
        );
    }

    #[test]
    fn encoder_desconectado_nao_estoura() {
        let (canal, receptor) = canal_de_comandos();
        drop(receptor); // encoder saiu
        canal.pedir_keyframe(); // não pode panicar — só no-op
    }
}
