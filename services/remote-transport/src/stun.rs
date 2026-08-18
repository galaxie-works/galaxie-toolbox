//! Codec STUN Binding mínimo (RFC 5389) — só o que o gathering de candidato
//! srflx (server-reflexive) precisa: montar um Binding Request e ler o
//! XOR-MAPPED-ADDRESS do Binding Success Response pra descobrir o IP:porta
//! público visto pelo STUN server. #1108 Parte 2 (Confucius).
//!
//! Este módulo é PURO: sem str0m, sem OpenSSL, sem rede. O str0m é sans-I/O e NÃO
//! faz gathering de srflx — quem envia o Binding no socket e alimenta o candidato
//! (via `Candidate::server_reflexive` + `add_local_candidate`) é o APP. Aqui fica
//! só a serialização/parse dos bytes, testável no build DEFAULT (sem a feature
//! `webrtc`), pra o `cargo test` do CI exercitar o codec sem toolchain OpenSSL.

use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};

/// Magic cookie do STUN (RFC 5389 §6). Fixa em toda mensagem; também é a máscara
/// de XOR do endereço IPv4 e o prefixo da máscara IPv6. `pub(crate)` pra o codec
/// TURN (turn.rs) reusar — TURN é STUN por baixo (RFC 5766).
pub(crate) const MAGIC_COOKIE: u32 = 0x2112_A442;

/// Tipos de mensagem STUN usados aqui.
const MSG_BINDING_REQUEST: u16 = 0x0001;
const MSG_BINDING_SUCCESS: u16 = 0x0101;

/// Atributos STUN.
const ATTR_MAPPED_ADDRESS: u16 = 0x0001;
const ATTR_XOR_MAPPED_ADDRESS: u16 = 0x0020;

/// Famílias de endereço (RFC 5389 §15.1). `pub(crate)` pra o turn.rs reusar ao
/// montar XOR-PEER-ADDRESS.
pub(crate) const FAMILY_IPV4: u8 = 0x01;
pub(crate) const FAMILY_IPV6: u8 = 0x02;

/// Cabeçalho fixo de toda mensagem STUN: 2 (tipo) + 2 (length) + 4 (cookie) + 12
/// (transaction id) = 20 bytes.
pub const HEADER_LEN: usize = 20;

/// Monta um STUN Binding Request de 20 bytes (só cabeçalho, sem atributos):
/// tipo `0x0001`, length `0x0000`, magic cookie e o `txid` de 12 bytes nos
/// offsets certos. O chamador gera o `txid` aleatório e o reusa pra casar a
/// resposta em [`parse_xor_mapped_address`].
pub fn build_binding_request(txid: &[u8; 12]) -> [u8; HEADER_LEN] {
    let mut buf = [0u8; HEADER_LEN];
    buf[0..2].copy_from_slice(&MSG_BINDING_REQUEST.to_be_bytes());
    buf[2..4].copy_from_slice(&0u16.to_be_bytes()); // length = 0 (sem atributos)
    buf[4..8].copy_from_slice(&MAGIC_COOKIE.to_be_bytes());
    buf[8..20].copy_from_slice(txid);
    buf
}

/// Lê o `SocketAddr` público (server-reflexive) de um STUN Binding Success
/// Response. Valida: é `0x0101`, magic cookie confere e o `txid` bate; depois
/// percorre os atributos TLV procurando XOR-MAPPED-ADDRESS (`0x0020`) e
/// XOR-decodifica. Se não houver XOR mas houver um MAPPED-ADDRESS (`0x0001`, sem
/// XOR — servidores antigos), usa esse como fallback. Qualquer inconsistência
/// (resposta curta, tipo/cookie/txid errado, atributo ausente ou truncado) →
/// `None`, e o gathering trata como srflx indisponível (não-fatal).
pub fn parse_xor_mapped_address(resp: &[u8], txid: &[u8; 12]) -> Option<SocketAddr> {
    if resp.len() < HEADER_LEN {
        return None;
    }
    if u16::from_be_bytes([resp[0], resp[1]]) != MSG_BINDING_SUCCESS {
        return None;
    }
    if resp[4..8] != MAGIC_COOKIE.to_be_bytes() {
        return None;
    }
    if resp[8..20] != txid[..] {
        return None;
    }
    let msg_len = u16::from_be_bytes([resp[2], resp[3]]) as usize;
    // A região de atributos tem que caber no buffer (resposta truncada → None).
    let attrs = resp.get(HEADER_LEN..HEADER_LEN + msg_len)?;

    let mut fallback: Option<SocketAddr> = None;
    let mut i = 0;
    while i + 4 <= attrs.len() {
        let attr_type = u16::from_be_bytes([attrs[i], attrs[i + 1]]);
        let attr_len = u16::from_be_bytes([attrs[i + 2], attrs[i + 3]]) as usize;
        let val_start = i + 4;
        let val_end = val_start + attr_len;
        if val_end > attrs.len() {
            return None; // atributo aponta pra fora do buffer (truncado)
        }
        let value = &attrs[val_start..val_end];
        match attr_type {
            ATTR_XOR_MAPPED_ADDRESS => {
                // XOR-MAPPED-ADDRESS é o preferido — retorna direto.
                if let Some(addr) = decode_xor_address(value, txid) {
                    return Some(addr);
                }
            }
            // Guarda como fallback se nenhum XOR aparecer. Se já temos um
            // fallback, o guard falha e cai no `_` (nada a fazer) — mesmo efeito.
            ATTR_MAPPED_ADDRESS if fallback.is_none() => {
                fallback = decode_plain_address(value);
            }
            _ => {}
        }
        // Avança pro próximo TLV com padding de 4 bytes (RFC 5389 §15).
        i = val_end + (4 - (attr_len % 4)) % 4;
    }
    fallback
}

/// XOR-decodifica o valor de um XOR-MAPPED-ADDRESS: `[reserved, family, x-port(2),
/// x-address(4|16)]`. Porta ^ 16 bits altos do cookie; IPv4 ^ cookie; IPv6 ^
/// (cookie ++ txid). `pub(crate)` porque o XOR-RELAYED-ADDRESS do TURN (RFC 5766
/// §14.5) usa exatamente o mesmo esquema XOR — turn.rs reusa este decoder.
pub(crate) fn decode_xor_address(value: &[u8], txid: &[u8; 12]) -> Option<SocketAddr> {
    if value.len() < 4 {
        return None;
    }
    let family = value[1];
    let port = u16::from_be_bytes([value[2], value[3]]) ^ (MAGIC_COOKIE >> 16) as u16;
    let cookie = MAGIC_COOKIE.to_be_bytes();
    match family {
        FAMILY_IPV4 => {
            let raw: [u8; 4] = value.get(4..8)?.try_into().ok()?;
            let addr = [
                raw[0] ^ cookie[0],
                raw[1] ^ cookie[1],
                raw[2] ^ cookie[2],
                raw[3] ^ cookie[3],
            ];
            Some(SocketAddr::from((Ipv4Addr::from(addr), port)))
        }
        FAMILY_IPV6 => {
            let raw: [u8; 16] = value.get(4..20)?.try_into().ok()?;
            // Máscara = magic cookie (4) ++ transaction id (12).
            let mut mask = [0u8; 16];
            mask[0..4].copy_from_slice(&cookie);
            mask[4..16].copy_from_slice(txid);
            let mut addr = [0u8; 16];
            for j in 0..16 {
                addr[j] = raw[j] ^ mask[j];
            }
            Some(SocketAddr::from((Ipv6Addr::from(addr), port)))
        }
        _ => None,
    }
}

/// Decodifica um MAPPED-ADDRESS clássico (sem XOR): `[reserved, family, port(2),
/// address(4|16)]`. Fallback pra STUN servers que não mandam o XOR.
fn decode_plain_address(value: &[u8]) -> Option<SocketAddr> {
    if value.len() < 4 {
        return None;
    }
    let family = value[1];
    let port = u16::from_be_bytes([value[2], value[3]]);
    match family {
        FAMILY_IPV4 => {
            let raw: [u8; 4] = value.get(4..8)?.try_into().ok()?;
            Some(SocketAddr::from((Ipv4Addr::from(raw), port)))
        }
        FAMILY_IPV6 => {
            let raw: [u8; 16] = value.get(4..20)?.try_into().ok()?;
            Some(SocketAddr::from((Ipv6Addr::from(raw), port)))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TXID: [u8; 12] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    /// Monta à mão um Binding Success Response com um XOR-MAPPED-ADDRESS IPv4. Os
    /// bytes X-Port/X-Address são os valores JÁ XOR-encodados de `203.0.113.5:51234`
    /// (calculados fora do parser), então o teste é independente da implementação.
    fn resposta_xor_ipv4() -> Vec<u8> {
        // 51234 = 0xC822; 0xC822 ^ 0x2112 = 0xE930.
        // 203.0.113.5 = CB 00 71 05; ^ magic cookie (21 12 A4 42) = EA 12 D5 47.
        let mut msg = Vec::new();
        msg.extend_from_slice(&MSG_BINDING_SUCCESS.to_be_bytes()); // 0x0101
        msg.extend_from_slice(&12u16.to_be_bytes()); // length = 1 atributo de 12 bytes
        msg.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
        msg.extend_from_slice(&TXID);
        // Atributo XOR-MAPPED-ADDRESS
        msg.extend_from_slice(&ATTR_XOR_MAPPED_ADDRESS.to_be_bytes()); // 0x0020
        msg.extend_from_slice(&8u16.to_be_bytes()); // length do valor = 8
        msg.extend_from_slice(&[0x00, FAMILY_IPV4, 0xE9, 0x30, 0xEA, 0x12, 0xD5, 0x47]);
        msg
    }

    #[test]
    fn round_trip_xor_mapped_address_ipv4() {
        let msg = resposta_xor_ipv4();
        let addr = parse_xor_mapped_address(&msg, &TXID).expect("XOR-MAPPED-ADDRESS válido");
        assert_eq!(addr, "203.0.113.5:51234".parse().unwrap());
    }

    #[test]
    fn txid_errado_rejeita() {
        let msg = resposta_xor_ipv4();
        let outro = [9u8; 12];
        assert_eq!(parse_xor_mapped_address(&msg, &outro), None);
    }

    #[test]
    fn tipo_nao_success_rejeita() {
        let mut msg = resposta_xor_ipv4();
        // Troca o tipo pra Binding Request (0x0001) — não é Success Response.
        msg[0..2].copy_from_slice(&MSG_BINDING_REQUEST.to_be_bytes());
        assert_eq!(parse_xor_mapped_address(&msg, &TXID), None);
    }

    #[test]
    fn cookie_errado_rejeita() {
        let mut msg = resposta_xor_ipv4();
        msg[4] ^= 0xFF; // corrompe o magic cookie
        assert_eq!(parse_xor_mapped_address(&msg, &TXID), None);
    }

    #[test]
    fn resposta_truncada_rejeita() {
        let msg = resposta_xor_ipv4();
        // Anuncia 12 bytes de atributo mas corta o buffer no meio.
        let curta = &msg[..HEADER_LEN + 6];
        assert_eq!(parse_xor_mapped_address(curta, &TXID), None);
        // Menor que o cabeçalho também.
        assert_eq!(parse_xor_mapped_address(&msg[..10], &TXID), None);
    }

    #[test]
    fn atributo_ausente_devolve_none() {
        // Success Response sem nenhum atributo (length 0).
        let mut msg = Vec::new();
        msg.extend_from_slice(&MSG_BINDING_SUCCESS.to_be_bytes());
        msg.extend_from_slice(&0u16.to_be_bytes());
        msg.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
        msg.extend_from_slice(&TXID);
        assert_eq!(parse_xor_mapped_address(&msg, &TXID), None);
    }

    #[test]
    fn build_binding_request_tem_offsets_certos() {
        let req = build_binding_request(&TXID);
        assert_eq!(req.len(), HEADER_LEN);
        assert_eq!(u16::from_be_bytes([req[0], req[1]]), MSG_BINDING_REQUEST);
        assert_eq!(u16::from_be_bytes([req[2], req[3]]), 0); // sem atributos
        assert_eq!(req[4..8], MAGIC_COOKIE.to_be_bytes());
        assert_eq!(req[8..20], TXID);
    }

    #[test]
    fn fallback_mapped_address_sem_xor() {
        // Servidor antigo: só MAPPED-ADDRESS (0x0001), porta/endereço em claro.
        let mut msg = Vec::new();
        msg.extend_from_slice(&MSG_BINDING_SUCCESS.to_be_bytes());
        msg.extend_from_slice(&12u16.to_be_bytes());
        msg.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
        msg.extend_from_slice(&TXID);
        msg.extend_from_slice(&ATTR_MAPPED_ADDRESS.to_be_bytes()); // 0x0001
        msg.extend_from_slice(&8u16.to_be_bytes());
        // 198.51.100.7:4660 (0x1234) em claro.
        msg.extend_from_slice(&[0x00, FAMILY_IPV4, 0x12, 0x34, 198, 51, 100, 7]);
        let addr = parse_xor_mapped_address(&msg, &TXID).expect("MAPPED-ADDRESS fallback");
        assert_eq!(addr, "198.51.100.7:4660".parse().unwrap());
    }
}
