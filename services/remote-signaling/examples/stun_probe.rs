use std::{net::IpAddr, time::Duration};

use rand::{rngs::OsRng, RngCore};
use tokio::net::{lookup_host, UdpSocket};

const MAGIC_COOKIE: [u8; 4] = [0x21, 0x12, 0xA4, 0x42];
const BINDING_REQUEST: u16 = 0x0001;
const BINDING_SUCCESS: u16 = 0x0101;
const MAPPED_ADDRESS: u16 = 0x0001;
const XOR_MAPPED_ADDRESS: u16 = 0x0020;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let target = std::env::var("GALAXIE_REMOTE_STUN_TARGET")
        .unwrap_or_else(|_| "telemetry.thegalaxie.cloud:3478".to_owned());
    let target = lookup_host(&target)
        .await?
        .find(|address| address.is_ipv4())
        .ok_or_else(|| invalid_data("host STUN sem endereco IPv4"))?;
    let socket = UdpSocket::bind("0.0.0.0:0").await?;
    let mut transaction_id = [0_u8; 12];
    OsRng.fill_bytes(&mut transaction_id);

    let mut request = [0_u8; 20];
    request[0..2].copy_from_slice(&BINDING_REQUEST.to_be_bytes());
    request[4..8].copy_from_slice(&MAGIC_COOKIE);
    request[8..20].copy_from_slice(&transaction_id);
    socket.send_to(&request, target).await?;

    let mut response = [0_u8; 1024];
    let (size, _) =
        tokio::time::timeout(Duration::from_secs(5), socket.recv_from(&mut response)).await??;
    let reflexive = parse_binding_response(&response[..size], &transaction_id)?;
    println!(
        "stun_ok family={} reflexive_ip={} reflexive_port={}",
        if reflexive.ip().is_ipv4() {
            "ipv4"
        } else {
            "ipv6"
        },
        mask_ip(reflexive.ip()),
        reflexive.port()
    );
    Ok(())
}

fn parse_binding_response(
    response: &[u8],
    transaction_id: &[u8; 12],
) -> Result<std::net::SocketAddr, Box<dyn std::error::Error>> {
    if response.len() < 20 {
        return Err(invalid_data("resposta STUN curta").into());
    }
    if u16::from_be_bytes([response[0], response[1]]) != BINDING_SUCCESS {
        return Err(invalid_data("STUN nao retornou Binding Success").into());
    }
    if response[4..8] != MAGIC_COOKIE || response[8..20] != transaction_id[..] {
        return Err(invalid_data("cookie ou transaction id STUN nao confere").into());
    }
    let declared = usize::from(u16::from_be_bytes([response[2], response[3]]));
    let end = 20_usize
        .checked_add(declared)
        .filter(|end| *end <= response.len())
        .ok_or_else(|| invalid_data("tamanho STUN invalido"))?;
    let mut offset = 20;
    while offset + 4 <= end {
        let attribute_type = u16::from_be_bytes([response[offset], response[offset + 1]]);
        let attribute_len = usize::from(u16::from_be_bytes([
            response[offset + 2],
            response[offset + 3],
        ]));
        let value_start = offset + 4;
        let value_end = value_start
            .checked_add(attribute_len)
            .filter(|value_end| *value_end <= end)
            .ok_or_else(|| invalid_data("atributo STUN truncado"))?;
        let value = &response[value_start..value_end];
        if matches!(attribute_type, XOR_MAPPED_ADDRESS | MAPPED_ADDRESS) {
            return decode_address(attribute_type == XOR_MAPPED_ADDRESS, value, transaction_id);
        }
        offset = value_end + ((4 - (attribute_len % 4)) % 4);
    }
    Err(invalid_data("resposta sem XOR-MAPPED-ADDRESS").into())
}

fn decode_address(
    xor: bool,
    value: &[u8],
    transaction_id: &[u8; 12],
) -> Result<std::net::SocketAddr, Box<dyn std::error::Error>> {
    if value.len() < 8 {
        return Err(invalid_data("endereco STUN truncado").into());
    }
    let mut port = u16::from_be_bytes([value[2], value[3]]);
    if xor {
        port ^= u16::from_be_bytes([MAGIC_COOKIE[0], MAGIC_COOKIE[1]]);
    }
    let ip = match value[1] {
        0x01 if value.len() >= 8 => {
            let mut octets = [value[4], value[5], value[6], value[7]];
            if xor {
                for (octet, cookie) in octets.iter_mut().zip(MAGIC_COOKIE) {
                    *octet ^= cookie;
                }
            }
            IpAddr::V4(octets.into())
        }
        0x02 if value.len() >= 20 => {
            let mut octets: [u8; 16] = value[4..20]
                .try_into()
                .map_err(|_| invalid_data("IPv6 STUN invalido"))?;
            if xor {
                let mut mask = [0_u8; 16];
                mask[..4].copy_from_slice(&MAGIC_COOKIE);
                mask[4..].copy_from_slice(transaction_id);
                for (octet, mask_byte) in octets.iter_mut().zip(mask) {
                    *octet ^= mask_byte;
                }
            }
            IpAddr::V6(octets.into())
        }
        _ => return Err(invalid_data("familia de endereco STUN desconhecida").into()),
    };
    Ok(std::net::SocketAddr::new(ip, port))
}

fn mask_ip(ip: IpAddr) -> String {
    match ip {
        IpAddr::V4(value) => {
            let octets = value.octets();
            format!("{}.{}.x.x", octets[0], octets[1])
        }
        IpAddr::V6(value) => {
            let segments = value.segments();
            format!("{:x}:{:x}:x::x", segments[0], segments[1])
        }
    }
}

fn invalid_data(message: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message)
}
