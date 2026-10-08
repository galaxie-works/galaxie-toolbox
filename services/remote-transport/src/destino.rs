//! #1716 — resolução do DESTINO do datagrama recebido (fatia 0 da lentidão do Remote).
//!
//! **A causa-raiz (medida pelo @Altair na sonda do #1165):** o socket vincula em `0.0.0.0:porta`
//! (recebe em todas as interfaces), mas um candidato ICE host anunciado é `IP_real:porta` (#1108). No
//! `recv_from` de um socket `0.0.0.0` o SO NÃO diz em que interface o pacote chegou, então o app
//! entregava ao str0m `destino = local_addr = 0.0.0.0:porta`. O str0m procura o candidato local cujo
//! endereço seja o destino (`ice/agent.rs:1336-1358`); `0.0.0.0:porta` não bate nenhum `IP_real:porta`
//! anunciado ⇒ o STUN é descartado, o par DIRETO nunca valida, e a sessão cai sempre no relay TURN —
//! a lentidão que o PO sentiu.
//!
//! **O fix (std puro, sem código por plataforma):** para cada `source`, perguntar à ROTA do SO que IP
//! local ele usaria pra lá chegar, e entregar `esse_ip:porta` — mas SÓ se for um dos IPs anunciados
//! (`ips_locais`); senão cair no 1º candidato (fallback observável), pra NUNCA entregar um IP que o
//! peer não viu. Este módulo é PURO (no núcleo, sem `webrtc`/OpenSSL): a [`resolver_destino`] recebe a
//! `rota` injetada (testável), e a [`rota_local`] é o lado que toca a rede, usado em produção.

use std::net::{IpAddr, SocketAddr, UdpSocket};

/// O destino resolvido para um datagrama recebido. Variante distinta pro chamador LOGAR o fallback sem
/// este módulo (núcleo sans-I/O) ganhar dependência de logging — o app (`remote.rs`, que tem `log`)
/// decide; o harness só extrai o [`Destino::addr`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Destino {
    /// A rota do SO deu um IP que FOI anunciado (`ips_locais`) — o caminho feliz; o par direto valida.
    Rota(SocketAddr),
    /// A rota não deu um IP anunciado (`None`, ou interface fora da lista) ⇒ caiu no 1º candidato. O
    /// chamador loga em `debug` — melhor que um STUN descartado em silêncio.
    Fallback(SocketAddr),
}

impl Destino {
    /// O `SocketAddr` a entregar ao str0m, seja qual for a variante.
    #[must_use]
    pub fn addr(self) -> SocketAddr {
        match self {
            Destino::Rota(a) | Destino::Fallback(a) => a,
        }
    }
}

/// Resolve o destino a entregar ao str0m no `receber_udp` do caminho DIRETO.
///
/// `rota(source)` devolve o IP local que o SO usaria pra alcançar `source` (ou `None`). Devolve
/// `Rota(rota:porta)` **só** se `rota` estiver em `ips_locais` (um candidato REALMENTE anunciado); caso
/// contrário `Fallback(ips_locais[0]:porta)`. Assim o destino é SEMPRE um IP que o peer viu no SDP —
/// nunca `0.0.0.0` nem uma interface não-anunciada.
///
/// **Pré-condição:** `ips_locais` NÃO é vazio (em produção o chamador aborta a sessão sem candidato
/// host; o harness semeia ≥1). Vazio ⇒ `Fallback(source)` (no-op que o str0m descarta) em vez de
/// indexar fora — nunca acontece no caminho real, mas não faz panic.
#[must_use]
pub fn resolver_destino(
    source: SocketAddr,
    ips_locais: &[IpAddr],
    porta: u16,
    rota: impl FnOnce(SocketAddr) -> Option<IpAddr>,
) -> Destino {
    let Some(&primeiro) = ips_locais.first() else {
        return Destino::Fallback(source);
    };
    if let Some(ip) = rota(source) {
        if ips_locais.contains(&ip) {
            return Destino::Rota(SocketAddr::new(ip, porta));
        }
    }
    Destino::Fallback(SocketAddr::new(primeiro, porta))
}

/// Pergunta ao SO que IP LOCAL ele usaria pra alcançar `source`, **sem enviar nada**: um `connect()`
/// num `UdpSocket` só fixa o 5-tuple e resolve a rota por omissão (nenhum pacote sai). Vincula na
/// família do `source` (v4→`0.0.0.0:0`, v6→`[::]:0`). Qualquer falha ⇒ `None` (o chamador cai no
/// fallback de [`resolver_destino`]). É o lado que TOCA a rede — fora da fn pura, pra esta ser testável
/// com uma rota injetada.
#[must_use]
pub fn rota_local(source: SocketAddr) -> Option<IpAddr> {
    let bind = if source.is_ipv6() { "[::]:0" } else { "0.0.0.0:0" };
    let sock = UdpSocket::bind(bind).ok()?;
    sock.connect(source).ok()?;
    sock.local_addr().ok().map(|a| a.ip())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    const PORTA: u16 = 55_000;

    fn v4(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    #[test]
    fn rota_dentro_da_lista_vira_o_destino() {
        // A rota dá um IP que FOI anunciado ⇒ Rota(esse IP:porta) (o par direto valida).
        let ips = [v4(192, 168, 1, 10), v4(10, 0, 0, 5)];
        let source = SocketAddr::new(v4(192, 168, 1, 20), 40_000);
        let destino = resolver_destino(source, &ips, PORTA, |_| Some(v4(10, 0, 0, 5)));
        assert_eq!(destino, Destino::Rota(SocketAddr::new(v4(10, 0, 0, 5), PORTA)));
    }

    #[test]
    fn rota_fora_da_lista_cai_no_primeiro_candidato() {
        // A rota dá um IP de interface NÃO-anunciada (ou None) ⇒ Fallback no 1º candidato — nunca um
        // IP que o peer não viu no SDP.
        let ips = [v4(192, 168, 1, 10), v4(10, 0, 0, 5)];
        let source = SocketAddr::new(v4(203, 0, 113, 7), 40_000);
        let esperado = Destino::Fallback(SocketAddr::new(v4(192, 168, 1, 10), PORTA));
        // IP fora da lista:
        assert_eq!(resolver_destino(source, &ips, PORTA, |_| Some(v4(172, 16, 0, 1))), esperado);
        // Rota indisponível (None):
        assert_eq!(resolver_destino(source, &ips, PORTA, |_| None), esperado);
    }

    #[test]
    fn ipv6_resolve_na_mesma_familia() {
        // IPv6: a rota dá um IPv6 anunciado ⇒ Rota(IPv6:porta) (a resolução não é só IPv4).
        let v6 = IpAddr::V6(Ipv6Addr::new(0xfd00, 0, 0, 0, 0, 0, 0, 1));
        let ips = [v6];
        let source = SocketAddr::new(IpAddr::V6(Ipv6Addr::new(0xfd00, 0, 0, 0, 0, 0, 0, 2)), 40_000);
        let destino = resolver_destino(source, &ips, PORTA, |_| Some(v6));
        assert_eq!(destino, Destino::Rota(SocketAddr::new(v6, PORTA)));
    }

    #[test]
    fn lista_vazia_e_fail_safe_devolve_source() {
        // Invariante do chamador: nunca vazio. Mas se for, Fallback(source) (no-op que o str0m
        // descarta) em vez de indexar fora — nunca faz panic.
        let source = SocketAddr::new(v4(192, 168, 1, 20), 40_000);
        assert_eq!(resolver_destino(source, &[], PORTA, |_| None), Destino::Fallback(source));
    }

    #[test]
    fn rota_local_loopback_devolve_loopback() {
        // Exercita a rota REAL (toca a stack de rede, mas não envia): a rota pra 127.0.0.1 é 127.0.0.1.
        // Reproduz o caminho do harness (bind 0.0.0.0, source loopback).
        let ip = rota_local(SocketAddr::new(v4(127, 0, 0, 1), 9)).expect("rota p/ loopback");
        assert!(ip.is_loopback(), "a rota pra 127.0.0.1 é um IP de loopback, veio {ip}");
    }
}
