//! Eventos de INPUT (S3, #686) — capturados no controlador, injetados no host,
//! trafegando pelo DataChannel (o teu, do S2/S5). Este módulo é o FORMATO da
//! mensagem + o mapeamento de coordenada; a injeção real fica no `injector`
//! (feature `input`, enigo). Núcleo testável, sem OS.
//!
//! Coordenadas são **NORMALIZADAS** (0.0..1.0 no desktop virtual do host) —
//! resolução/DPI-independentes. O controlador escala `hostDim/videoClientDim` e
//! manda 0..1; o host mapeia pra pixel físico via [`ScreenInfo`]. Assim
//! multi-monitor e DPI "just work" sem o controlador saber a geometria do host.

use serde::{Deserialize, Serialize};

/// Geometria do desktop virtual do HOST (pixels físicos). O host anuncia (evento
/// [`InputEvent::Screen`]); o controlador usa pra escalar o vídeo, e o host usa
/// pra mapear coord normalizada → pixel absoluto.
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
    /// Normalizado (0..1 no desktop virtual) → pixel absoluto (clampado na tela).
    pub fn para_pixel(&self, x_norm: f64, y_norm: f64) -> (i32, i32) {
        let x = self.origin_x + (x_norm.clamp(0.0, 1.0) * self.width as f64).round() as i32;
        let y = self.origin_y + (y_norm.clamp(0.0, 1.0) * self.height as f64).round() as i32;
        (x, y)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BotaoMouse {
    Left,
    Right,
    Middle,
}

/// Tecla: caractere Unicode OU tecla nomeada (subconjunto comum + modificadores).
/// O injetor mapeia pro `enigo::Key`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "k", rename_all = "camelCase")]
pub enum Tecla {
    Char { c: char },
    Enter,
    Backspace,
    Tab,
    Escape,
    Space,
    Delete,
    Left,
    Right,
    Up,
    Down,
    Home,
    End,
    PageUp,
    PageDown,
    Shift,
    Control,
    Alt,
    Meta,
    F { n: u8 },
}

/// Evento de input. Serializa no DataChannel (opcode `0x03`, ver `control`). Os
/// down/up de botão e tecla são SEPARADOS de propósito — o PoC tinha um bug de
/// right-mouse-up chamando down; aqui `pressed` é explícito e nunca inferido.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "e", rename_all = "camelCase")]
pub enum InputEvent {
    /// Move o mouse pra coord NORMALIZADA (0..1 no desktop virtual do host).
    MouseMove { x: f64, y: f64 },
    /// Botão pressionado (`true`) ou solto (`false`) — nunca inferido.
    MouseButton { botao: BotaoMouse, pressed: bool },
    /// Scroll em "cliques"/linhas (sinal = direção).
    MouseScroll { dx: i32, dy: i32 },
    /// Tecla pressionada/solta (modificadores vêm como `Tecla` próprios).
    Key { tecla: Tecla, pressed: bool },
    /// (host→controlador) anúncio da geometria da tela do host.
    Screen { info: ScreenInfo },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapeia_normalizado_pra_pixel_multimonitor() {
        // Desktop virtual começando em -1920 (monitor à esquerda do primário).
        let tela = ScreenInfo {
            origin_x: -1920,
            origin_y: 0,
            width: 3840,
            height: 1080,
            device_pixel_ratio: 1.0,
        };
        // centro do desktop virtual
        assert_eq!(tela.para_pixel(0.5, 0.5), (-1920 + 1920, 540));
        // cantos, com clamp
        assert_eq!(tela.para_pixel(0.0, 0.0), (-1920, 0));
        assert_eq!(tela.para_pixel(1.0, 1.0), (1920, 1080));
        assert_eq!(tela.para_pixel(2.0, -1.0), (1920, 0)); // clampado
    }

    #[test]
    fn down_e_up_sao_eventos_distintos() {
        let down = InputEvent::MouseButton {
            botao: BotaoMouse::Right,
            pressed: true,
        };
        let up = InputEvent::MouseButton {
            botao: BotaoMouse::Right,
            pressed: false,
        };
        assert_ne!(down, up); // nunca o mesmo (guarda contra o bug do PoC)
    }

    #[test]
    fn input_event_round_trip_json() {
        for ev in [
            InputEvent::MouseMove { x: 0.25, y: 0.75 },
            InputEvent::MouseButton {
                botao: BotaoMouse::Middle,
                pressed: true,
            },
            InputEvent::Key {
                tecla: Tecla::Char { c: 'x' },
                pressed: false,
            },
            InputEvent::Key {
                tecla: Tecla::F { n: 5 },
                pressed: true,
            },
        ] {
            let j = serde_json::to_vec(&ev).unwrap();
            let back: InputEvent = serde_json::from_slice(&j).unwrap();
            assert_eq!(ev, back);
        }
    }
}
