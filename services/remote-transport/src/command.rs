//! Via de comando S2→S1 (transporte → encoder). Dois comandos hoje:
//! - **PLI/keyframe** (o peer entrou agora / perdeu): força um IDR. Vários PLIs
//!   em rajada COALESCEM num pedido só — senão o encoder despejaria uma sequência
//!   de IDRs (caro) sem necessidade.
//! - **SetBitrate** (#1182): o BWE do str0m estimou nova banda e o `AplicadorBitrate`
//!   decidiu um novo alvo — o encoder muda a taxa em runtime. "Último vence": só
//!   importa o valor mais recente (coalesce natural).
//!
//! Cada comando tem seu próprio slot pra não competir: um PLI pendente não pode
//! descartar um SetBitrate nem vice-versa (era o risco de um canal único de
//! capacidade 1). Núcleo testável: não depende de str0m/OpenSSL.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::Arc;

/// Comando do transporte (S2) pro encoder (S1). Contrato congelado; cresce por
/// adição (o consumidor faz `match` exaustivo).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EncoderCommand {
    /// Força um keyframe (IDR) no próximo frame.
    RequestKeyframe,
    /// Novo bitrate-alvo em bps (do BWE via [`crate::AplicadorBitrate`]).
    SetBitrate(u32),
}

/// Lado do TRANSPORTE: pede keyframe (coalescido) e define bitrate (último vence),
/// ambos sem bloquear.
pub struct CommandChannel {
    /// Slot de keyframe: canal bounded de 1 → coalescência natural.
    keyframe_tx: SyncSender<()>,
    /// Slot de bitrate: último valor vence. `0` = nada pendente (0 nunca é alvo válido).
    bitrate: Arc<AtomicU32>,
}

/// Lado do ENCODER (S1): drena os comandos sem bloquear.
pub struct CommandReceiver {
    keyframe_rx: Receiver<()>,
    bitrate: Arc<AtomicU32>,
}

/// Cria o par transporte↔encoder. Keyframe em canal de capacidade 1 (coalesce);
/// bitrate num átomo compartilhado (latest-wins).
pub fn canal_de_comandos() -> (CommandChannel, CommandReceiver) {
    let (keyframe_tx, keyframe_rx) = sync_channel(1);
    let bitrate = Arc::new(AtomicU32::new(0));
    (
        CommandChannel {
            keyframe_tx,
            bitrate: Arc::clone(&bitrate),
        },
        CommandReceiver {
            keyframe_rx,
            bitrate,
        },
    )
}

impl CommandChannel {
    /// Pede um keyframe ao encoder. Nunca bloqueia; coalescido (pedido pendente →
    /// no-op) e tolerante ao encoder ter saído (`Full`/`Disconnected` → no-op).
    pub fn pedir_keyframe(&self) {
        let _ = self.keyframe_tx.try_send(());
    }

    /// Define o bitrate-alvo do encoder (bps). Latest-wins: só o último valor
    /// importa (coalesce natural). Nunca bloqueia.
    pub fn definir_bitrate(&self, bps: u32) {
        self.bitrate.store(bps, Ordering::Relaxed);
    }
}

impl CommandReceiver {
    /// (Encoder) próximo comando sem bloquear. `None` = nada agora. Keyframe é
    /// urgente → drena antes do bitrate.
    pub fn tentar_receber(&self) -> Option<EncoderCommand> {
        if self.keyframe_rx.try_recv().is_ok() {
            return Some(EncoderCommand::RequestKeyframe);
        }
        let bps = self.bitrate.swap(0, Ordering::Relaxed);
        if bps != 0 {
            return Some(EncoderCommand::SetBitrate(bps));
        }
        None
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
        canal.definir_bitrate(5_000_000); // idem
    }

    #[test]
    fn bitrate_ultimo_vence() {
        let (canal, receptor) = canal_de_comandos();
        canal.definir_bitrate(3_000_000);
        canal.definir_bitrate(4_000_000);
        canal.definir_bitrate(2_500_000);
        // Só o último importa (coalesce).
        assert_eq!(
            receptor.tentar_receber(),
            Some(EncoderCommand::SetBitrate(2_500_000))
        );
        assert_eq!(receptor.tentar_receber(), None);
    }

    #[test]
    fn keyframe_e_bitrate_nao_se_atropelam() {
        let (canal, receptor) = canal_de_comandos();
        // Os dois comandos coexistem (slots separados). Keyframe drena primeiro.
        canal.definir_bitrate(6_000_000);
        canal.pedir_keyframe();
        assert_eq!(
            receptor.tentar_receber(),
            Some(EncoderCommand::RequestKeyframe)
        );
        assert_eq!(
            receptor.tentar_receber(),
            Some(EncoderCommand::SetBitrate(6_000_000))
        );
        assert_eq!(receptor.tentar_receber(), None);
    }
}
