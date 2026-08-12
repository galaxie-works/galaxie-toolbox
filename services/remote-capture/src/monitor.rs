//! Contrato de controle multi-monitor congelado entre S1/S2/S3 na #732.
//!
//! O transporte serializa estas mensagens como variantes de `ControlMessage`
//! no opcode `0x01`. Este crate mantém a captura desacoplada do WebRTC e expõe
//! um canal in-process com o mesmo shape para o wiring da sessão.

use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, sync_channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Sentinela reservada para o desktop virtual completo.
pub const MONITOR_TODOS: &str = "*";

/// Geometria física da superfície capturada, no espaço do desktop virtual.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenInfo {
    pub origin_x: i32,
    pub origin_y: i32,
    pub width: u32,
    pub height: u32,
    pub device_pixel_ratio: f64,
}

impl ScreenInfo {
    /// Coordenada normalizada na superfície ativa para pixel absoluto.
    #[must_use]
    pub fn para_pixel(&self, x_norm: f64, y_norm: f64) -> (i32, i32) {
        let x = self.origin_x + (x_norm.clamp(0.0, 1.0) * f64::from(self.width)).round() as i32;
        let y = self.origin_y + (y_norm.clamp(0.0, 1.0) * f64::from(self.height)).round() as i32;
        (x, y)
    }
}

/// Um monitor do host. `id` e opaco e nunca deve ser interpretado pelo cliente.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub label: String,
    pub geometry: ScreenInfo,
    pub primary: bool,
}

/// Subconjunto do `ControlMessage` (opcode `0x01`) pertencente ao S1.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum MonitorControlMessage {
    /// Host para controlador: catalogo atual e superfície ativa.
    MonitorList {
        monitors: Vec<MonitorInfo>,
        active: String,
        virtual_desktop: bool,
    },
    /// Controlador para host: seleciona `id`; `*` pede o desktop virtual.
    MonitorSelect { id: String },
    /// Host para controlador: confirma a superfície realmente capturada.
    MonitorActive { id: String, info: ScreenInfo },
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MonitorSelectionError {
    #[error("monitor_id nao pode ser vazio")]
    EmptyId,
    #[error("canal de controle de monitor encerrado")]
    Disconnected,
    #[error("o host aceita apenas MonitorSelect vindo do controlador")]
    WrongDirection,
}

/// Lado do controlador: publica a seleção mais recente e recebe eventos do host.
pub struct MonitorController {
    pending_selection: Arc<Mutex<Option<String>>>,
    events: Receiver<MonitorControlMessage>,
}

/// Lado do host, consumido pelo pipeline de captura.
pub struct MonitorHostControl {
    pending_selection: Arc<Mutex<Option<String>>>,
    events: SyncSender<MonitorControlMessage>,
}

impl MonitorController {
    /// Coalesce: uma seleção nova substitui a anterior ainda não consumida.
    pub fn selecionar(&self, id: impl Into<String>) -> Result<(), MonitorSelectionError> {
        self.enviar(MonitorControlMessage::MonitorSelect { id: id.into() })
    }

    /// Entrega ao S1 a variante `MonitorSelect` decodificada pelo `0x01`.
    pub fn enviar(&self, message: MonitorControlMessage) -> Result<(), MonitorSelectionError> {
        let MonitorControlMessage::MonitorSelect { id } = message else {
            return Err(MonitorSelectionError::WrongDirection);
        };
        if id.is_empty() {
            return Err(MonitorSelectionError::EmptyId);
        }
        let mut pending = self
            .pending_selection
            .lock()
            .map_err(|_| MonitorSelectionError::Disconnected)?;
        *pending = Some(id);
        Ok(())
    }

    pub fn select(&self, id: impl Into<String>) -> Result<(), MonitorSelectionError> {
        self.selecionar(id)
    }

    #[must_use]
    pub fn tentar_receber(&self) -> Option<MonitorControlMessage> {
        self.events.try_recv().ok()
    }

    pub fn receber(&self) -> Result<MonitorControlMessage, MonitorSelectionError> {
        self.events
            .recv()
            .map_err(|_| MonitorSelectionError::Disconnected)
    }

    pub fn receber_timeout(
        &self,
        timeout: Duration,
    ) -> Result<Option<MonitorControlMessage>, MonitorSelectionError> {
        match self.events.recv_timeout(timeout) {
            Ok(event) => Ok(Some(event)),
            Err(RecvTimeoutError::Timeout) => Ok(None),
            Err(RecvTimeoutError::Disconnected) => Err(MonitorSelectionError::Disconnected),
        }
    }
}

impl MonitorHostControl {
    pub(crate) fn take_selection(&self) -> Option<String> {
        self.pending_selection
            .lock()
            .ok()
            .and_then(|mut selection| selection.take())
    }

    pub(crate) fn publish(&self, event: MonitorControlMessage) {
        match self.events.try_send(event) {
            Ok(()) | Err(std::sync::mpsc::TrySendError::Disconnected(_)) => {}
            Err(std::sync::mpsc::TrySendError::Full(event)) => {
                tracing::warn!(
                    ?event,
                    "canal de eventos de monitor cheio; evento descartado"
                );
            }
        }
    }

    #[cfg(test)]
    fn has_pending_selection(&self) -> bool {
        match self.pending_selection.lock() {
            Ok(selection) => selection.is_some(),
            Err(_) => false,
        }
    }
}

/// Canal do control-plane. A seleção é coalescida e eventos são bounded.
pub fn canal_de_monitores(capacidade_eventos: usize) -> (MonitorController, MonitorHostControl) {
    let pending_selection = Arc::new(Mutex::new(None));
    let (events_tx, events_rx) = sync_channel(capacidade_eventos.max(2));
    (
        MonitorController {
            pending_selection: pending_selection.clone(),
            events: events_rx,
        },
        MonitorHostControl {
            pending_selection,
            events: events_tx,
        },
    )
}

pub fn monitor_control_channel(capacity: usize) -> (MonitorController, MonitorHostControl) {
    canal_de_monitores(capacity)
}

/// Drena os eventos disponíveis sem bloquear, útil para bridges sans-I/O.
pub fn drain_events(controller: &MonitorController) -> Vec<MonitorControlMessage> {
    let mut events = Vec::new();
    while let Ok(event) = controller.events.try_recv() {
        events.push(event);
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_info_mapeia_monitor_com_origin_negativo() {
        let info = ScreenInfo {
            origin_x: -1920,
            origin_y: -120,
            width: 1920,
            height: 1080,
            device_pixel_ratio: 1.0,
        };
        assert_eq!(info.para_pixel(0.0, 0.0), (-1920, -120));
        assert_eq!(info.para_pixel(1.0, 1.0), (0, 960));
    }

    #[test]
    fn selecao_coalesce_para_o_id_mais_recente() {
        let (controller, host) = canal_de_monitores(2);
        controller.selecionar("display-a").unwrap();
        controller.selecionar("display-b").unwrap();
        assert!(host.has_pending_selection());
        assert_eq!(host.take_selection().as_deref(), Some("display-b"));
        assert_eq!(host.take_selection(), None);
    }

    #[test]
    fn host_consume_apenas_monitor_select() {
        let (controller, host) = canal_de_monitores(2);
        controller
            .enviar(MonitorControlMessage::MonitorSelect {
                id: "display-a".into(),
            })
            .unwrap();
        assert_eq!(host.take_selection().as_deref(), Some("display-a"));
        assert_eq!(
            controller.enviar(MonitorControlMessage::MonitorActive {
                id: "display-a".into(),
                info: ScreenInfo {
                    origin_x: 0,
                    origin_y: 0,
                    width: 1,
                    height: 1,
                    device_pixel_ratio: 1.0,
                },
            }),
            Err(MonitorSelectionError::WrongDirection)
        );
    }

    #[test]
    fn host_publica_lista_e_confirmacao() {
        let (controller, host) = canal_de_monitores(2);
        let info = ScreenInfo {
            origin_x: 0,
            origin_y: 0,
            width: 1920,
            height: 1080,
            device_pixel_ratio: 1.0,
        };
        host.publish(MonitorControlMessage::MonitorList {
            monitors: vec![MonitorInfo {
                id: "display-a".into(),
                label: "Monitor A".into(),
                geometry: info,
                primary: true,
            }],
            active: "display-a".into(),
            virtual_desktop: false,
        });
        host.publish(MonitorControlMessage::MonitorActive {
            id: "display-a".into(),
            info,
        });
        assert!(matches!(
            controller.tentar_receber(),
            Some(MonitorControlMessage::MonitorList { .. })
        ));
        assert_eq!(
            controller.tentar_receber(),
            Some(MonitorControlMessage::MonitorActive {
                id: "display-a".into(),
                info,
            })
        );
    }

    #[test]
    fn wire_shape_reserva_monitor_todos() {
        let message = MonitorControlMessage::MonitorSelect {
            id: MONITOR_TODOS.into(),
        };
        let json = serde_json::to_string(&message).unwrap();
        assert_eq!(json, r#"{"t":"monitorSelect","id":"*"}"#);
    }
}
