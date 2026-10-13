//! Driver de I/O do transporte sans-I/O (S2, #685). O [`crate::session::Transport`]
//! diz **o quê** transmitir/quando (`Passo`); ninguém, sozinho, casa isso com um
//! socket real. O [`IoDriver`] faz essa cola: possui um `UdpSocket` + um
//! `Transport` e roda o loop `passo()` → `send_to` / `recv_from` → `receber_udp` /
//! `atender_timeout`.
//!
//! É a peça que transforma o transporte sans-I/O num **loop rodável** — usada
//! tanto pelo harness E2E (`examples/e2e_dummy.rs`, 2 papéis em loopback) quanto
//! pelo app (S4): o app pluga o socket real (com candidatos do coturn) e bombeia.
//!
//! Atrás da feature `webrtc` (puxa o `str0m` via [`Transport`]).

use std::io;
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::time::Instant;

use crate::destino::{resolver_destino, rota_local};
use crate::session::{EventoSessao, Passo, Transport, TransportError};

#[derive(Debug, thiserror::Error)]
pub enum DriverError {
    #[error("i/o do socket: {0}")]
    Io(#[from] io::Error),
    #[error("transporte: {0}")]
    Transporte(#[from] TransportError),
}

/// Casa um `UdpSocket` (não-bloqueante) com um [`Transport`]. O dono chama
/// [`IoDriver::bombear`] num loop, entregando o instante atual; o driver lê o que
/// chegou no socket, atende o timeout vencido e drena os passos do str0m
/// (transmitindo pela rede), devolvendo os [`EventoSessao`] de alto nível.
pub struct IoDriver {
    socket: UdpSocket,
    transport: Transport,
    local: SocketAddr,
    /// #1716: os IPs de interface anunciados como candidato host. Quando o socket vincula em
    /// `0.0.0.0` (produção), o `local_addr` é `0.0.0.0:porta` — que NÃO bate nenhum candidato, então
    /// o str0m descartaria o STUN do caminho direto. Com esta lista, o `drenar_socket` resolve o
    /// destino REAL por rota (ver [`crate::destino`]). VAZIO ⇒ comportamento antigo (destino =
    /// `local`): preserva os chamadores que vinculam num IP concreto (ex. `127.0.0.1`).
    ips_locais: Vec<IpAddr>,
    proximo_timeout: Option<Instant>,
    encerrado: bool,
    buf: [u8; 2048],
}

impl IoDriver {
    /// Cria o driver sobre um socket JÁ vinculado (o app escolhe a porta/binding;
    /// o teste usa `127.0.0.1:0`). Coloca o socket em modo não-bloqueante.
    pub fn novo(socket: UdpSocket, transport: Transport) -> io::Result<Self> {
        socket.set_nonblocking(true)?;
        let local = socket.local_addr()?;
        Ok(Self {
            socket,
            transport,
            local,
            ips_locais: Vec::new(),
            proximo_timeout: None,
            encerrado: false,
            buf: [0u8; 2048],
        })
    }

    /// #1716: declara os IPs de interface anunciados como candidato host (`candidato_local`). Quando o
    /// socket vincula em `0.0.0.0`, é isto que deixa o `drenar_socket` resolver o destino REAL por rota
    /// em vez de entregar `0.0.0.0:porta` (que o str0m descarta). Chamar com os MESMOS IPs que foram
    /// anunciados — a resolução só aceita um IP que o peer viu no SDP. Sem esta chamada (lista vazia),
    /// o destino continua sendo `local_addr` (chamadores que vinculam num IP concreto não mudam).
    #[must_use]
    pub fn com_ips_locais(mut self, ips: Vec<IpAddr>) -> Self {
        self.ips_locais = ips;
        self
    }

    /// Endereço local do socket — vira o candidato ICE host que o peer recebe via
    /// signaling.
    pub fn local_addr(&self) -> SocketAddr {
        self.local
    }

    /// Acesso ao transporte pra negociação SDP/ICE e escrita de mídia/controle.
    pub fn transport(&mut self) -> &mut Transport {
        &mut self.transport
    }

    /// `true` quando o str0m sinalizou fim de sessão (`Passo::Fim`).
    pub fn encerrado(&self) -> bool {
        self.encerrado
    }

    /// Instante do próximo timeout agendado pelo str0m (pra o loop dormir só até lá).
    pub fn proximo_timeout(&self) -> Option<Instant> {
        self.proximo_timeout
    }

    /// Um ciclo do loop, **não-bloqueante**:
    /// 1. drena todos os datagramas já chegados no socket → `receber_udp`;
    /// 2. se o timeout agendado venceu (`agora >= proximo_timeout`), `atender_timeout`;
    /// 3. drena os passos do str0m — transmite pela rede, coleta eventos, agenda o
    ///    próximo timeout.
    ///
    /// Devolve os [`EventoSessao`] produzidos neste ciclo.
    pub fn bombear(&mut self, agora: Instant) -> Result<Vec<EventoSessao>, DriverError> {
        // 1. Tudo que chegou no socket entra no str0m.
        self.drenar_socket()?;

        // 2. Timeout vencido → avança o relógio da sessão.
        if let Some(t) = self.proximo_timeout {
            if agora >= t {
                self.proximo_timeout = None;
                self.transport.atender_timeout(agora)?;
            }
        }

        // 3. Drena os passos: transmite / coleta evento / agenda timeout / fim.
        let mut eventos = Vec::new();
        loop {
            match self.transport.passo()? {
                // O harness de loopback não usa relay TURN: `origem` (o candidato de
                // saída) é irrelevante aqui — sempre manda direto ao `destino`.
                Passo::Transmitir {
                    origem: _,
                    destino,
                    dados,
                } => {
                    // best-effort: WouldBlock (buffer cheio) não é fatal no loopback.
                    match self.socket.send_to(&dados, destino) {
                        Ok(_) => {}
                        Err(e) if e.kind() == io::ErrorKind::WouldBlock => {}
                        Err(e) => return Err(DriverError::Io(e)),
                    }
                }
                Passo::Aguardar(t) => {
                    self.proximo_timeout = Some(t);
                    break;
                }
                Passo::Evento(ev) => eventos.push(ev),
                Passo::Fim => {
                    self.encerrado = true;
                    break;
                }
            }
        }
        Ok(eventos)
    }

    /// Lê (sem bloquear) todos os datagramas pendentes e entrega ao transporte. #1716: o DESTINO
    /// entregue ao str0m é resolvido por rota quando há `ips_locais` (bind `0.0.0.0`) — senão é o
    /// `local` (comportamento antigo p/ quem vincula num IP concreto).
    fn drenar_socket(&mut self) -> Result<(), DriverError> {
        loop {
            match self.socket.recv_from(&mut self.buf) {
                Ok((n, origem)) => {
                    let destino = self.destino_para(origem);
                    self.transport.receber_udp(origem, destino, &self.buf[..n])?;
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => return Ok(()),
                Err(e) => return Err(DriverError::Io(e)),
            }
        }
    }

    /// #1716: o destino a entregar ao str0m pra um `origem`. Sem `ips_locais` (vazio) ⇒ `local`
    /// (antigo). Com ⇒ resolve por rota (ver [`crate::destino`]); o fallback no 1º candidato é só
    /// `debug` (o harness não tem logger instalado — no-op inofensivo).
    fn destino_para(&self, origem: SocketAddr) -> SocketAddr {
        if self.ips_locais.is_empty() {
            return self.local;
        }
        resolver_destino(origem, &self.ips_locais, self.local.port(), rota_local).addr()
    }
}
