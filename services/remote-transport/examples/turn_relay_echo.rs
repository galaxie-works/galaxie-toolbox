//! Echo UDP externo — a OUTRA ponta da travessia de NAT (#1130-b).
//!
//! O `turn_relay_probe --peer <ip:porta>` documenta-se como "um echo externo
//! real", mas o artefacto que O SERIA não existia (só `e2e_dummy` +
//! `turn_relay_probe` em `examples/`). Este é ele: o peer que o coturn alcança e
//! que devolve os bytes, fechando o E2E da travessia real.
//!
//! ## O que o coturn entrega aqui (e o que devolvemos)
//! No modo `--peer`, o probe faz `Allocate` + `CreatePermission` e manda uma
//! `Send Indication`. O coturn DES-encapsula isso e entrega ao peer um datagrama
//! **UDP puro** (sem STUN à volta), cuja origem é o RELAYED-ADDRESS do probe.
//! Basta devolver **os mesmos bytes à mesma origem**: o coturn re-encapsula a
//! resposta numa `Data Indication` que o probe lê. Portanto este binário é um
//! echo UDP puro — zero framing STUN, zero dependências além da `std`, e NÃO
//! toca no `turn_secret` (não há segredo desta ponta).
//!
//! ## ⚠️ Requisito de ALCANCE (a falha que se disfarça de "relay não atravessa")
//! O coturn manda o datagrama para o `--peer` = **IP público : porta**. Se esta
//! máquina está atrás de NAT doméstico, o router **descarta** esse pacote de
//! entrada a menos que haja uma **porta UDP encaminhada** para cá. Sem ela, o
//! `envia_e_espera` do probe estoura no timeout e LÊ como "o relay não atravessa"
//! — quando o que falhou foi o ALCANCE, não o relay. É o terceiro desfecho
//! disfarçado de segundo. Encaminhe a porta de `--bind` (default 48200) no router
//! ANTES de correr, e use o MESMO número no `--peer` do probe.
//!
//! ## Uso (na ponta pública, depois de encaminhar a porta)
//! ```text
//!   turn_relay_echo --bind 0.0.0.0:48200          # fica à escuta e ecoa
//!   # noutro host, o probe:
//!   turn_relay_probe --server telemetry...:3478 --username <u> --credential <c> \
//!                    --peer <IP_PUBLICO_DESTA_MAQUINA>:48200
//! ```

use std::io;
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};

/// Recebe UM datagrama e devolve os MESMOS bytes à origem (o RELAYED-ADDRESS do
/// coturn). Devolve `(n_bytes, origem)` para o chamador logar/contar.
fn echo_once(sock: &UdpSocket) -> io::Result<(usize, SocketAddr)> {
    let mut buf = [0u8; 2048];
    let (n, origem) = sock.recv_from(&mut buf)?;
    sock.send_to(&buf[..n], origem)?;
    Ok((n, origem))
}

struct Args {
    bind: String,
    once: bool,
    max: u64,
}

fn parse_args() -> Result<Args, String> {
    let mut bind = "0.0.0.0:48200".to_string();
    let mut once = false;
    let mut max = 0u64;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        let val =
            |it: &mut dyn Iterator<Item = String>| it.next().ok_or(format!("falta valor pra {a}"));
        match a.as_str() {
            "--bind" => bind = val(&mut it)?,
            "--once" => once = true,
            "--max" => {
                max = val(&mut it)?
                    .parse()
                    .map_err(|_| "--max inválido".to_string())?
            }
            "-h" | "--help" => return Err(USAGE.to_string()),
            outro => return Err(format!("arg desconhecido: {outro}\n\n{USAGE}")),
        }
    }
    Ok(Args { bind, once, max })
}

const USAGE: &str = "\
turn_relay_echo — echo UDP externo, a outra ponta da travessia (#1130-b)

  --bind <ip:porta>   endereço de escuta (default 0.0.0.0:48200)   [opc.]
  --once              ecoa UM datagrama e sai (prova de tiro único) [opc.]
  --max <n>           ecoa n datagramas e sai (0 = sem limite)      [opc.]

⚠️ Requer porta UDP de --bind ENCAMINHADA no router para esta máquina; o
   mesmo número tem de ir no --peer do probe. Sem o forward, o probe lê o
   timeout de ALCANCE como se o relay não atravessasse.";

fn resolve(addr: &str) -> io::Result<SocketAddr> {
    addr.to_socket_addrs()?
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, format!("não resolveu {addr}")))
}

fn run() -> io::Result<()> {
    let args = match parse_args() {
        Ok(a) => a,
        Err(msg) => {
            eprintln!("{msg}");
            std::process::exit(2);
        }
    };
    let bind = resolve(&args.bind)?;
    let sock = UdpSocket::bind(bind)?;
    println!(
        "[echo] à escuta em {} — encaminhe esta porta UDP no router e passe-a no --peer do probe",
        sock.local_addr()?
    );

    let mut n_ecos: u64 = 0;
    loop {
        let (bytes, origem) = echo_once(&sock)?;
        n_ecos += 1;
        println!(
            "[echo] {bytes} bytes de {origem} — devolvidos (origem = RELAYED-ADDRESS do coturn)"
        );
        if args.once || (args.max != 0 && n_ecos >= args.max) {
            println!("[echo] {n_ecos} datagrama(s) ecoado(s) — a sair.");
            return Ok(());
        }
    }
}

fn main() {
    if let Err(e) = run() {
        eprintln!("[echo] erro: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn ecoa_os_mesmos_bytes_de_volta_ao_remetente() {
        // Hermético (loopback, sem coturn): prova que o echo devolve os MESMOS
        // bytes à origem — o contrato que o coturn precisa pra fechar a Data
        // Indication de volta ao probe.
        let echo = UdpSocket::bind("127.0.0.1:0").unwrap();
        let echo_addr = echo.local_addr().unwrap();

        let cliente = UdpSocket::bind("127.0.0.1:0").unwrap();
        cliente
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let payload = b"galaxie-echo-1130b";
        cliente.send_to(payload, echo_addr).unwrap();

        let (n, origem) = echo_once(&echo).unwrap();
        assert_eq!(n, payload.len());
        assert_eq!(origem, cliente.local_addr().unwrap());

        let mut buf = [0u8; 64];
        let (m, de) = cliente.recv_from(&mut buf).unwrap();
        assert_eq!(&buf[..m], payload, "os bytes de volta têm de ser idênticos");
        assert_eq!(de, echo_addr, "a resposta tem de vir do echo");
    }
}
