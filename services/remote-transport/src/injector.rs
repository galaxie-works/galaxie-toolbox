//! Injeção de input no HOST (S3, #686), via `enigo` (SendInput no Windows). Aplica
//! os [`InputEvent`] que chegam do controlador pelo DataChannel.
//!
//! Atrás da feature `input` (puxa o enigo). Injeta em DESKTOP NORMAL — janela
//! elevada/secure-desktop é da Fase 3 (S7, serviço SYSTEM). down/up de botão e
//! tecla são SEPARADOS (o `pressed` do evento manda), nunca inferidos — guarda
//! contra o bug do PoC de right-up virar down.

use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};

use crate::input::{BotaoMouse, InputEvent, ScreenInfo, Tecla};

#[derive(Debug, thiserror::Error)]
pub enum InjectError {
    #[error("falha ao iniciar o injetor: {0}")]
    Init(String),
    #[error("falha ao injetar: {0}")]
    Inject(String),
}

/// Injeta eventos de input no host. Guarda a geometria da tela pra mapear coord
/// normalizada → pixel absoluto (multi-monitor/DPI).
pub struct Injector {
    enigo: Enigo,
    tela: ScreenInfo,
}

impl Injector {
    pub fn novo(tela: ScreenInfo) -> Result<Self, InjectError> {
        let enigo =
            Enigo::new(&Settings::default()).map_err(|e| InjectError::Init(e.to_string()))?;
        Ok(Self { enigo, tela })
    }

    /// Atualiza a geometria (troca de monitor/resolução).
    pub fn set_tela(&mut self, tela: ScreenInfo) {
        self.tela = tela;
    }

    pub fn aplicar(&mut self, ev: &InputEvent) -> Result<(), InjectError> {
        match ev {
            InputEvent::MouseMove { x, y } => {
                let (px, py) = self.tela.para_pixel(*x, *y);
                self.enigo
                    .move_mouse(px, py, Coordinate::Abs)
                    .map_err(inj)?;
            }
            InputEvent::MouseButton { botao, pressed } => {
                let dir = if *pressed {
                    Direction::Press
                } else {
                    Direction::Release
                };
                self.enigo.button(botao_enigo(*botao), dir).map_err(inj)?;
            }
            InputEvent::MouseScroll { dx, dy } => {
                if *dx != 0 {
                    self.enigo.scroll(*dx, Axis::Horizontal).map_err(inj)?;
                }
                if *dy != 0 {
                    self.enigo.scroll(*dy, Axis::Vertical).map_err(inj)?;
                }
            }
            InputEvent::Key { tecla, pressed } => {
                let dir = if *pressed {
                    Direction::Press
                } else {
                    Direction::Release
                };
                self.enigo.key(tecla_enigo(tecla), dir).map_err(inj)?;
            }
            InputEvent::Screen { info } => {
                self.tela = *info;
            }
        }
        Ok(())
    }
}

fn inj(e: enigo::InputError) -> InjectError {
    InjectError::Inject(e.to_string())
}

fn botao_enigo(b: BotaoMouse) -> Button {
    match b {
        BotaoMouse::Left => Button::Left,
        BotaoMouse::Right => Button::Right,
        BotaoMouse::Middle => Button::Middle,
    }
}

fn tecla_enigo(t: &Tecla) -> Key {
    match t {
        Tecla::Char { c } => Key::Unicode(*c),
        Tecla::Enter => Key::Return,
        Tecla::Backspace => Key::Backspace,
        Tecla::Tab => Key::Tab,
        Tecla::Escape => Key::Escape,
        Tecla::Space => Key::Space,
        Tecla::Delete => Key::Delete,
        Tecla::Left => Key::LeftArrow,
        Tecla::Right => Key::RightArrow,
        Tecla::Up => Key::UpArrow,
        Tecla::Down => Key::DownArrow,
        Tecla::Home => Key::Home,
        Tecla::End => Key::End,
        Tecla::PageUp => Key::PageUp,
        Tecla::PageDown => Key::PageDown,
        Tecla::Shift => Key::Shift,
        Tecla::Control => Key::Control,
        Tecla::Alt => Key::Alt,
        Tecla::Meta => Key::Meta,
        Tecla::F { n } => tecla_funcao(*n),
    }
}

fn tecla_funcao(n: u8) -> Key {
    match n {
        1 => Key::F1,
        2 => Key::F2,
        3 => Key::F3,
        4 => Key::F4,
        5 => Key::F5,
        6 => Key::F6,
        7 => Key::F7,
        8 => Key::F8,
        9 => Key::F9,
        10 => Key::F10,
        11 => Key::F11,
        _ => Key::F12,
    }
}
