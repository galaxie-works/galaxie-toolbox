//! Codec TURN (RFC 5766) mínimo — só o que a alocação de um candidato relay
//! precisa: montar Allocate/CreatePermission/Refresh Requests (com autenticação
//! long-term credential) e ler o Allocate Success/Error do coturn. #1130 fatia 1
//! (Confucius).
//!
//! Este módulo é PURO, na mesma filosofia do `stun.rs`: sem str0m, sem OpenSSL,
//! sem rede. TURN é STUN por baixo (RFC 5766 usa o framing do RFC 5389), então
//! reusamos daqui o `MAGIC_COOKIE`, o `HEADER_LEN` e o decoder de XOR-address (o
//! XOR-RELAYED-ADDRESS usa o MESMO esquema XOR do XOR-MAPPED-ADDRESS). Só a
//! serialização/parse de bytes vive aqui, testável no build DEFAULT (sem a
//! feature `webrtc`), pra o `cargo test` do CI exercitar o codec sem toolchain
//! OpenSSL — o I/O no socket + o candidato relay no str0m são a fatia 2.

use std::net::SocketAddr;

use hmac::{Hmac, Mac};
use md5::{Digest, Md5};
use sha1::Sha1;

use crate::stun::{decode_xor_address, FAMILY_IPV4, FAMILY_IPV6, HEADER_LEN, MAGIC_COOKIE};

/// Tipos de mensagem TURN (RFC 5766). Request / Success Response / Error Response.
const MSG_ALLOCATE_REQUEST: u16 = 0x0003;
const MSG_ALLOCATE_SUCCESS: u16 = 0x0103;
const MSG_ALLOCATE_ERROR: u16 = 0x0113;
const MSG_CREATE_PERMISSION_REQUEST: u16 = 0x0008;
const MSG_CREATE_PERMISSION_SUCCESS: u16 = 0x0108;
const MSG_REFRESH_REQUEST: u16 = 0x0004;
const MSG_REFRESH_SUCCESS: u16 = 0x0104;
// Indications do data-path (RFC 5766 §10.1/§10.3). São `class = indication`, então
// NÃO levam MESSAGE-INTEGRITY (a permissão já autoriza o par; o relay dropa dados de
// peer sem permissão instalada).
const MSG_SEND_INDICATION: u16 = 0x0016; // método Send (0x006) + classe indication
const MSG_DATA_INDICATION: u16 = 0x0017; // método Data (0x007) + classe indication

/// Atributos TURN/STUN usados aqui (type u16).
const ATTR_MAPPED_XOR_PEER: u16 = 0x0012; // XOR-PEER-ADDRESS
const ATTR_DATA: u16 = 0x0013; // DATA (RFC 5766 §14.4) — carga do peer
const ATTR_XOR_RELAYED_ADDRESS: u16 = 0x0016;
const ATTR_LIFETIME: u16 = 0x000D;
const ATTR_REQUESTED_TRANSPORT: u16 = 0x0019;
const ATTR_USERNAME: u16 = 0x0006;
const ATTR_REALM: u16 = 0x0014;
const ATTR_NONCE: u16 = 0x0015;
const ATTR_MESSAGE_INTEGRITY: u16 = 0x0008;
const ATTR_ERROR_CODE: u16 = 0x0009;

/// REQUESTED-TRANSPORT: protocolo UDP = 17 (RFC 5766 §14.7). O valor tem 1 byte de
/// protocolo + 3 bytes RFFU zerados.
const PROTO_UDP: u8 = 17;

/// Tamanho do atributo MESSAGE-INTEGRITY já com header: 4 (type+len) + 20 (HMAC).
const MI_ATTR_LEN: usize = 24;

type HmacSha1 = Hmac<Sha1>;

// ---------------------------------------------------------------------------
// Credencial long-term (RFC 5389 §15.4)
// ---------------------------------------------------------------------------

/// Deriva a chave da credencial long-term: `MD5("{username}:{realm}:{password}")`
/// (RFC 5389 §15.4). É essa chave — não a senha — que entra no HMAC do
/// MESSAGE-INTEGRITY. A senha nunca é logada nem guardada aqui.
pub fn derive_key(username: &str, realm: &str, password: &str) -> [u8; 16] {
    let mut hasher = Md5::new();
    hasher.update(username.as_bytes());
    hasher.update(b":");
    hasher.update(realm.as_bytes());
    hasher.update(b":");
    hasher.update(password.as_bytes());
    let digest = hasher.finalize();
    let mut key = [0u8; 16];
    key.copy_from_slice(&digest);
    key
}

// ---------------------------------------------------------------------------
// Montagem de requests (PURA)
// ---------------------------------------------------------------------------

/// Cabeçalho STUN de 20 bytes com o Length ainda zerado (placeholder). O Length é
/// preenchido depois por [`set_length`] ou por [`append_message_integrity`].
fn new_header(msg_type: u16, txid: &[u8; 12]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(HEADER_LEN);
    buf.extend_from_slice(&msg_type.to_be_bytes());
    buf.extend_from_slice(&0u16.to_be_bytes()); // length placeholder
    buf.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
    buf.extend_from_slice(txid);
    buf
}

/// Anexa um atributo TLV com padding a 4 bytes (RFC 5389 §15). Não mexe no Length
/// do header — quem fecha a mensagem chama [`set_length`] (ou o MI o faz).
fn push_attr(buf: &mut Vec<u8>, attr_type: u16, value: &[u8]) {
    buf.extend_from_slice(&attr_type.to_be_bytes());
    buf.extend_from_slice(&(value.len() as u16).to_be_bytes());
    buf.extend_from_slice(value);
    let pad = (4 - value.len() % 4) % 4;
    buf.resize(buf.len() + pad, 0);
}

/// Escreve no Length do header o número de bytes de atributos (tudo depois dos 20
/// bytes de cabeçalho).
fn set_length(buf: &mut [u8]) {
    let attrs_len = (buf.len() - HEADER_LEN) as u16;
    buf[2..4].copy_from_slice(&attrs_len.to_be_bytes());
}

/// Monta XOR-PEER-ADDRESS (RFC 5766 §14.3) — mesmo esquema XOR do XOR-MAPPED:
/// porta ^ 16 bits altos do cookie; IPv4 ^ cookie; IPv6 ^ (cookie ++ txid).
fn push_xor_peer_address(buf: &mut Vec<u8>, peer: SocketAddr, txid: &[u8; 12]) {
    let cookie = MAGIC_COOKIE.to_be_bytes();
    let xport = peer.port() ^ (MAGIC_COOKIE >> 16) as u16;
    let mut value = Vec::with_capacity(20);
    match peer {
        SocketAddr::V4(v4) => {
            value.push(0x00); // reserved
            value.push(FAMILY_IPV4);
            value.extend_from_slice(&xport.to_be_bytes());
            for (b, m) in v4.ip().octets().iter().zip(cookie.iter()) {
                value.push(b ^ m);
            }
        }
        SocketAddr::V6(v6) => {
            // Máscara = magic cookie (4) ++ transaction id (12).
            let mut mask = [0u8; 16];
            mask[0..4].copy_from_slice(&cookie);
            mask[4..16].copy_from_slice(txid);
            value.push(0x00);
            value.push(FAMILY_IPV6);
            value.extend_from_slice(&xport.to_be_bytes());
            for (b, m) in v6.ip().octets().iter().zip(mask.iter()) {
                value.push(b ^ m);
            }
        }
    }
    push_attr(buf, ATTR_MAPPED_XOR_PEER, &value);
}

/// Calcula e anexa o MESSAGE-INTEGRITY (RFC 5389 §15.4).
///
/// O pulo-do-gato: o HMAC-SHA1 cobre a mensagem ATÉ O ATRIBUTO ANTERIOR ao MI,
/// MAS o Length do header usado nesse cálculo tem que ser ajustado como SE o
/// atributo MESSAGE-INTEGRITY (24 bytes) JÁ estivesse presente. Por isso setamos
/// o Length pra `attrs_atuais + 24` ANTES de rodar o HMAC (é o erro clássico usar
/// o Length sem contar o MI). Depois anexamos o MI de 24 bytes — e aí o Length já
/// bate com o buffer real (attrs + 24), sem precisar de fixup extra.
fn append_message_integrity(buf: &mut Vec<u8>, key: &[u8; 16]) {
    let len_com_mi = (buf.len() - HEADER_LEN + MI_ATTR_LEN) as u16;
    buf[2..4].copy_from_slice(&len_com_mi.to_be_bytes());
    let mac = hmac_sha1(key, buf);
    push_attr(buf, ATTR_MESSAGE_INTEGRITY, &mac);
}

/// HMAC-SHA1 de `msg` com `key`. O construtor do HMAC aceita chave de qualquer
/// tamanho, então nunca falha aqui (a chave é sempre os 16 bytes do MD5).
fn hmac_sha1(key: &[u8], msg: &[u8]) -> [u8; 20] {
    let mut mac = HmacSha1::new_from_slice(key).expect("HMAC aceita chave de qualquer tamanho");
    mac.update(msg);
    let out = mac.finalize().into_bytes();
    let mut arr = [0u8; 20];
    arr.copy_from_slice(&out);
    arr
}

/// Allocate Request SEM autenticação (RFC 5766 §6.1): só REQUESTED-TRANSPORT UDP.
/// É o primeiro tiro — o coturn responde `401 Unauthorized` com REALM/NONCE, que
/// alimentam [`build_allocate_request_auth`].
pub fn build_allocate_request(txid: &[u8; 12]) -> Vec<u8> {
    let mut buf = new_header(MSG_ALLOCATE_REQUEST, txid);
    push_attr(&mut buf, ATTR_REQUESTED_TRANSPORT, &[PROTO_UDP, 0, 0, 0]);
    set_length(&mut buf);
    buf
}

/// Allocate Request autenticado (RFC 5766 §6.1): REQUESTED-TRANSPORT +
/// USERNAME/REALM/NONCE + MESSAGE-INTEGRITY. O MI é sempre o último atributo.
pub fn build_allocate_request_auth(
    txid: &[u8; 12],
    username: &str,
    realm: &str,
    nonce: &str,
    key: &[u8; 16],
) -> Vec<u8> {
    let mut buf = new_header(MSG_ALLOCATE_REQUEST, txid);
    push_attr(&mut buf, ATTR_REQUESTED_TRANSPORT, &[PROTO_UDP, 0, 0, 0]);
    push_attr(&mut buf, ATTR_USERNAME, username.as_bytes());
    push_attr(&mut buf, ATTR_REALM, realm.as_bytes());
    push_attr(&mut buf, ATTR_NONCE, nonce.as_bytes());
    append_message_integrity(&mut buf, key);
    buf
}

/// CreatePermission Request (RFC 5766 §9.1): XOR-PEER-ADDRESS do par autorizado +
/// autenticação. Instala a permissão pra o relay aceitar tráfego daquele peer.
pub fn build_create_permission_request(
    txid: &[u8; 12],
    peer: SocketAddr,
    username: &str,
    realm: &str,
    nonce: &str,
    key: &[u8; 16],
) -> Vec<u8> {
    let mut buf = new_header(MSG_CREATE_PERMISSION_REQUEST, txid);
    push_xor_peer_address(&mut buf, peer, txid);
    push_attr(&mut buf, ATTR_USERNAME, username.as_bytes());
    push_attr(&mut buf, ATTR_REALM, realm.as_bytes());
    push_attr(&mut buf, ATTR_NONCE, nonce.as_bytes());
    append_message_integrity(&mut buf, key);
    buf
}

/// Refresh Request (RFC 5766 §7.1): LIFETIME desejado (segundos; 0 = liberar a
/// alocação) + autenticação. Mantém o relay vivo antes do lifetime expirar.
pub fn build_refresh_request(
    txid: &[u8; 12],
    lifetime_seconds: u32,
    username: &str,
    realm: &str,
    nonce: &str,
    key: &[u8; 16],
) -> Vec<u8> {
    let mut buf = new_header(MSG_REFRESH_REQUEST, txid);
    push_attr(&mut buf, ATTR_LIFETIME, &lifetime_seconds.to_be_bytes());
    push_attr(&mut buf, ATTR_USERNAME, username.as_bytes());
    push_attr(&mut buf, ATTR_REALM, realm.as_bytes());
    push_attr(&mut buf, ATTR_NONCE, nonce.as_bytes());
    append_message_integrity(&mut buf, key);
    buf
}

/// Send Indication (RFC 5766 §10.1): embrulha `dados` (o pacote que o str0m quer
/// mandar ao peer) num XOR-PEER-ADDRESS + DATA, endereçado ao relay. É o caminho de
/// ENVIO do data-path: quando o str0m emite `Transmit{source=relayed}`, o app manda
/// ISTO ao servidor TURN (não o pacote cru ao peer). Sem autenticação/MI — a
/// permissão instalada (CreatePermission) é o que autoriza; o `txid` é aleatório e
/// não precisa casar com nada (indication não tem resposta). A ORDEM importa:
/// XOR-PEER-ADDRESS antes de DATA, como o coturn espera.
pub fn build_send_indication(txid: &[u8; 12], peer: SocketAddr, dados: &[u8]) -> Vec<u8> {
    let mut buf = new_header(MSG_SEND_INDICATION, txid);
    push_xor_peer_address(&mut buf, peer, txid);
    push_attr(&mut buf, ATTR_DATA, dados);
    set_length(&mut buf);
    buf
}

// ---------------------------------------------------------------------------
// Parse de respostas (PURA)
// ---------------------------------------------------------------------------

/// Valida o cabeçalho (tipo esperado + cookie + txid) e devolve a fatia de
/// atributos. Qualquer inconsistência → `None`.
fn message_attrs<'a>(resp: &'a [u8], expected_type: u16, txid: &[u8; 12]) -> Option<&'a [u8]> {
    if resp.len() < HEADER_LEN {
        return None;
    }
    if u16::from_be_bytes([resp[0], resp[1]]) != expected_type {
        return None;
    }
    if resp[4..8] != MAGIC_COOKIE.to_be_bytes() {
        return None;
    }
    if resp[8..20] != txid[..] {
        return None;
    }
    let msg_len = u16::from_be_bytes([resp[2], resp[3]]) as usize;
    resp.get(HEADER_LEN..HEADER_LEN + msg_len)
}

/// Percorre os atributos TLV (com padding de 4 bytes) procurando `want`. Devolve o
/// valor do primeiro que casar; `None` se ausente ou se um atributo apontar pra
/// fora do buffer (truncado).
fn find_attr(attrs: &[u8], want: u16) -> Option<&[u8]> {
    let mut i = 0;
    while i + 4 <= attrs.len() {
        let attr_type = u16::from_be_bytes([attrs[i], attrs[i + 1]]);
        let attr_len = u16::from_be_bytes([attrs[i + 2], attrs[i + 3]]) as usize;
        let val_start = i + 4;
        let val_end = val_start + attr_len;
        if val_end > attrs.len() {
            return None; // atributo truncado
        }
        if attr_type == want {
            return Some(&attrs[val_start..val_end]);
        }
        i = val_end + (4 - attr_len % 4) % 4;
    }
    None
}

/// Lê um `401 Unauthorized` de um Allocate Error Response (RFC 5766 §6.2). Valida
/// tipo `0x0113` + cookie + txid, exige ERROR-CODE == 401 e devolve `(realm,
/// nonce)` pra o retry autenticado. Qualquer inconsistência (tipo/cookie/txid
/// errado, code ≠ 401, REALM/NONCE ausente ou não-UTF8) → `None`.
pub fn parse_error_unauthorized(resp: &[u8], txid: &[u8; 12]) -> Option<(String, String)> {
    let attrs = message_attrs(resp, MSG_ALLOCATE_ERROR, txid)?;
    let err = find_attr(attrs, ATTR_ERROR_CODE)?;
    if err.len() < 4 {
        return None;
    }
    // ERROR-CODE: [reserved(2), class(3 bits em err[2]), number(err[3]), reason...].
    let class = (err[2] & 0x07) as u16;
    let number = err[3] as u16;
    if class * 100 + number != 401 {
        return None;
    }
    let realm = std::str::from_utf8(find_attr(attrs, ATTR_REALM)?).ok()?;
    let nonce = std::str::from_utf8(find_attr(attrs, ATTR_NONCE)?).ok()?;
    Some((realm.to_string(), nonce.to_string()))
}

/// Extrai o NONCE fresco de um `438 Stale Nonce` (RFC 5766 §5). O coturn rotaciona o
/// nonce; Refresh/CreatePermission com o nonce velho voltam 438 + NONCE novo. Não
/// fixamos o tipo da mensagem: o Error Response varia por método (Refresh=`0x0114`,
/// CreatePermission=`0x0118`), então validamos cookie + txid + ERROR-CODE == 438 e
/// devolvemos o nonce novo pra reemitir o request. `None` se não é o nosso 438 ou
/// falta o NONCE. O REALM não muda numa rotação de nonce (o chamador guarda o dele).
pub fn parse_stale_nonce(resp: &[u8], txid: &[u8; 12]) -> Option<String> {
    if resp.len() < HEADER_LEN {
        return None;
    }
    if resp[4..8] != MAGIC_COOKIE.to_be_bytes() {
        return None;
    }
    if resp[8..20] != txid[..] {
        return None;
    }
    let msg_len = u16::from_be_bytes([resp[2], resp[3]]) as usize;
    let attrs = resp.get(HEADER_LEN..HEADER_LEN + msg_len)?;
    let err = find_attr(attrs, ATTR_ERROR_CODE)?;
    if err.len() < 4 {
        return None;
    }
    let class = (err[2] & 0x07) as u16;
    let number = err[3] as u16;
    if class * 100 + number != 438 {
        return None;
    }
    let nonce = std::str::from_utf8(find_attr(attrs, ATTR_NONCE)?).ok()?;
    Some(nonce.to_owned())
}

/// Lê um Allocate Success Response (RFC 5766 §6.3). Valida tipo `0x0103`, o cookie
/// e o txid; lê XOR-RELAYED-ADDRESS (mesmo XOR do XOR-MAPPED — reusa o decoder do
/// stun.rs) e LIFETIME, devolvendo `(endereço relay, lifetime em segundos)`. Se a
/// resposta estiver truncada, com txid errado ou sem algum atributo, devolve `None`.
pub fn parse_allocate_success(resp: &[u8], txid: &[u8; 12]) -> Option<(SocketAddr, u32)> {
    let attrs = message_attrs(resp, MSG_ALLOCATE_SUCCESS, txid)?;
    let relayed = find_attr(attrs, ATTR_XOR_RELAYED_ADDRESS)?;
    let addr = decode_xor_address(relayed, txid)?;
    let lifetime = find_attr(attrs, ATTR_LIFETIME)?;
    if lifetime.len() < 4 {
        return None;
    }
    let secs = u32::from_be_bytes([lifetime[0], lifetime[1], lifetime[2], lifetime[3]]);
    Some((addr, secs))
}

/// Confirma um CreatePermission Success (RFC 5766 §9.3) pro `txid` enviado. Só há o
/// cabeçalho a validar (a resposta de sucesso não tem atributos obrigatórios).
pub fn parse_create_permission_success(resp: &[u8], txid: &[u8; 12]) -> bool {
    message_attrs(resp, MSG_CREATE_PERMISSION_SUCCESS, txid).is_some()
}

/// Lê o LIFETIME concedido de um Refresh Success (RFC 5766 §7.3). O servidor pode
/// conceder MENOS do que pedimos — quem renova reagenda pelo valor devolvido, não
/// pelo pedido. `None` se o tipo/txid/cookie não casam ou falta o LIFETIME.
pub fn parse_refresh_success(resp: &[u8], txid: &[u8; 12]) -> Option<u32> {
    let attrs = message_attrs(resp, MSG_REFRESH_SUCCESS, txid)?;
    let lifetime = find_attr(attrs, ATTR_LIFETIME)?;
    if lifetime.len() < 4 {
        return None;
    }
    Some(u32::from_be_bytes([
        lifetime[0],
        lifetime[1],
        lifetime[2],
        lifetime[3],
    ]))
}

/// Desembrulha uma Data Indication (RFC 5766 §10.3): é o caminho de RECEBIMENTO do
/// data-path — o relay entrega o pacote de um peer embrulhado em XOR-PEER-ADDRESS +
/// DATA. O `txid` é ESCOLHIDO PELO SERVIDOR (não casa com nenhum request nosso), então
/// lemos do próprio cabeçalho e usamos ele pra de-XOR do endereço. Devolve
/// `(peer, dados)` — os `dados` são o pacote cru (STUN/DTLS/RTP) que alimenta o str0m
/// como se viesse do peer. `None` se não é Data Indication, cookie errado, ou falta
/// algum atributo (não entrega lixo pro str0m).
pub fn parse_data_indication(msg: &[u8]) -> Option<(SocketAddr, Vec<u8>)> {
    if msg.len() < HEADER_LEN {
        return None;
    }
    if u16::from_be_bytes([msg[0], msg[1]]) != MSG_DATA_INDICATION {
        return None;
    }
    if msg[4..8] != MAGIC_COOKIE.to_be_bytes() {
        return None;
    }
    let mut txid = [0u8; 12];
    txid.copy_from_slice(&msg[8..20]);
    let msg_len = u16::from_be_bytes([msg[2], msg[3]]) as usize;
    let attrs = msg.get(HEADER_LEN..HEADER_LEN + msg_len)?;
    let peer = decode_xor_address(find_attr(attrs, ATTR_MAPPED_XOR_PEER)?, &txid)?;
    let dados = find_attr(attrs, ATTR_DATA)?.to_vec();
    Some((peer, dados))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TXID: [u8; 12] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    /// Vetor MD5 conhecido (calculado FORA, com .NET/openssl): MD5("user:realm:pass").
    const KEY_USER_REALM_PASS: [u8; 16] = [
        0x84, 0x93, 0xfb, 0xc5, 0x3b, 0xa5, 0x82, 0xfb, 0x4c, 0x04, 0x4c, 0x45, 0x6b, 0xdc, 0x40,
        0xeb,
    ];

    #[test]
    fn derive_key_bate_vetor_md5() {
        assert_eq!(derive_key("user", "realm", "pass"), KEY_USER_REALM_PASS);
    }

    /// Vetor de MESSAGE-INTEGRITY verificado FORA do parser: HMAC-SHA1 computado
    /// com HMACSHA1(.NET) sobre os 28 bytes "cobertos" — header (com o Length JÁ
    /// AJUSTADO pra 0x0020 = 8 attrs + 24 do MI) + REQUESTED-TRANSPORT UDP.
    ///
    /// Se o Length ajustado estivesse errado (ex.: 0x0008 sem contar o MI), o HMAC
    /// mudaria e este teste falharia — é exatamente o erro clássico que ele pega.
    const EXPECTED_MI: [u8; 20] = [
        0x71, 0x9c, 0xc0, 0x79, 0x2a, 0xe2, 0xff, 0x1c, 0xb6, 0x3f, 0x98, 0xfd, 0x2e, 0xc2, 0xd1,
        0xa6, 0xbd, 0x50, 0x09, 0x1f,
    ];

    #[test]
    fn message_integrity_bate_vetor_externo_e_ajusta_length() {
        // Monta à mão a MESMA mensagem coberta do vetor: header + RT UDP, depois MI.
        let mut buf = new_header(MSG_ALLOCATE_REQUEST, &TXID);
        push_attr(&mut buf, ATTR_REQUESTED_TRANSPORT, &[PROTO_UDP, 0, 0, 0]);
        append_message_integrity(&mut buf, &KEY_USER_REALM_PASS);

        // header(20) + RT(8) + MI(24) = 52
        assert_eq!(buf.len(), 52);
        // Length do header = 8 (attrs) + 24 (MI) = 32 = 0x0020. Prova o ajuste.
        assert_eq!(u16::from_be_bytes([buf[2], buf[3]]), 32);
        // Os 20 bytes finais são o HMAC — batem o vetor externo.
        assert_eq!(&buf[buf.len() - 20..], &EXPECTED_MI);
        // E o MI foi anexado como TLV 0x0008 / len 0x0014.
        let mi_hdr = buf.len() - MI_ATTR_LEN;
        assert_eq!(u16::from_be_bytes([buf[mi_hdr], buf[mi_hdr + 1]]), ATTR_MESSAGE_INTEGRITY);
        assert_eq!(u16::from_be_bytes([buf[mi_hdr + 2], buf[mi_hdr + 3]]), 20);
    }

    #[test]
    fn build_allocate_request_tem_offsets_certos() {
        let req = build_allocate_request(&TXID);
        assert_eq!(u16::from_be_bytes([req[0], req[1]]), MSG_ALLOCATE_REQUEST);
        assert_eq!(req[4..8], MAGIC_COOKIE.to_be_bytes());
        assert_eq!(req[8..20], TXID);
        // length = 1 atributo REQUESTED-TRANSPORT de 8 bytes (4 header + 4 valor).
        assert_eq!(u16::from_be_bytes([req[2], req[3]]), 8);
        // REQUESTED-TRANSPORT presente com protocolo UDP.
        let attrs = &req[HEADER_LEN..];
        assert_eq!(u16::from_be_bytes([attrs[0], attrs[1]]), ATTR_REQUESTED_TRANSPORT);
        assert_eq!(u16::from_be_bytes([attrs[2], attrs[3]]), 4);
        assert_eq!(attrs[4], PROTO_UDP);
        assert_eq!(&attrs[5..8], &[0, 0, 0]); // RFFU zerado
    }

    #[test]
    fn allocate_auth_tem_todos_os_atributos_e_mi_por_ultimo() {
        let key = derive_key("user", "realm", "pass");
        let req = build_allocate_request_auth(&TXID, "user", "realm", "nonce-xyz", &key);
        let attrs = &req[HEADER_LEN..];
        assert!(find_attr(attrs, ATTR_REQUESTED_TRANSPORT).is_some());
        assert_eq!(find_attr(attrs, ATTR_USERNAME), Some(&b"user"[..]));
        assert_eq!(find_attr(attrs, ATTR_REALM), Some(&b"realm"[..]));
        assert_eq!(find_attr(attrs, ATTR_NONCE), Some(&b"nonce-xyz"[..]));
        // MESSAGE-INTEGRITY presente e como último atributo (últimos 24 bytes).
        assert!(find_attr(attrs, ATTR_MESSAGE_INTEGRITY).is_some());
        let mi_hdr = req.len() - MI_ATTR_LEN;
        assert_eq!(u16::from_be_bytes([req[mi_hdr], req[mi_hdr + 1]]), ATTR_MESSAGE_INTEGRITY);
        // Length do header cobre exatamente o buffer.
        assert_eq!(u16::from_be_bytes([req[2], req[3]]) as usize, req.len() - HEADER_LEN);
    }

    #[test]
    fn create_permission_carrega_xor_peer_address() {
        let key = derive_key("user", "realm", "pass");
        let peer: SocketAddr = "198.51.100.7:4660".parse().unwrap();
        let req =
            build_create_permission_request(&TXID, peer, "user", "realm", "nonce", &key);
        assert_eq!(u16::from_be_bytes([req[0], req[1]]), MSG_CREATE_PERMISSION_REQUEST);
        // O XOR-PEER-ADDRESS decodifica de volta pro peer (reusa o decoder XOR).
        let attrs = &req[HEADER_LEN..];
        let peer_val = find_attr(attrs, ATTR_MAPPED_XOR_PEER).expect("XOR-PEER-ADDRESS");
        assert_eq!(decode_xor_address(peer_val, &TXID), Some(peer));
        assert!(find_attr(attrs, ATTR_MESSAGE_INTEGRITY).is_some());
    }

    #[test]
    fn refresh_carrega_lifetime() {
        let key = derive_key("user", "realm", "pass");
        let req = build_refresh_request(&TXID, 600, "user", "realm", "nonce", &key);
        assert_eq!(u16::from_be_bytes([req[0], req[1]]), MSG_REFRESH_REQUEST);
        let attrs = &req[HEADER_LEN..];
        let lt = find_attr(attrs, ATTR_LIFETIME).expect("LIFETIME");
        assert_eq!(u32::from_be_bytes([lt[0], lt[1], lt[2], lt[3]]), 600);
    }

    /// Monta um Allocate Error `401` sintético com ERROR-CODE + REALM + NONCE.
    fn erro_401(realm: &str, nonce: &str) -> Vec<u8> {
        let mut buf = new_header(MSG_ALLOCATE_ERROR, &TXID);
        // ERROR-CODE: reserved(2)=0, class=4, number=01, reason "Unauthorized".
        let mut err = vec![0x00, 0x00, 0x04, 0x01];
        err.extend_from_slice(b"Unauthorized");
        push_attr(&mut buf, ATTR_ERROR_CODE, &err);
        push_attr(&mut buf, ATTR_REALM, realm.as_bytes());
        push_attr(&mut buf, ATTR_NONCE, nonce.as_bytes());
        set_length(&mut buf);
        buf
    }

    #[test]
    fn parse_error_unauthorized_devolve_realm_e_nonce() {
        let msg = erro_401("example.org", "nonce-abc-123");
        let got = parse_error_unauthorized(&msg, &TXID).expect("401 válido");
        assert_eq!(got, ("example.org".to_string(), "nonce-abc-123".to_string()));
    }

    #[test]
    fn parse_error_tipo_errado_rejeita() {
        let mut msg = erro_401("r", "n");
        msg[0..2].copy_from_slice(&MSG_ALLOCATE_SUCCESS.to_be_bytes()); // não é Error
        assert_eq!(parse_error_unauthorized(&msg, &TXID), None);
    }

    #[test]
    fn parse_error_cookie_errado_rejeita() {
        let mut msg = erro_401("r", "n");
        msg[4] ^= 0xFF;
        assert_eq!(parse_error_unauthorized(&msg, &TXID), None);
    }

    #[test]
    fn parse_error_txid_errado_rejeita() {
        let msg = erro_401("r", "n");
        assert_eq!(parse_error_unauthorized(&msg, &[0u8; 12]), None);
    }

    #[test]
    fn parse_error_code_diferente_de_401_rejeita() {
        // Monta um 438 (Stale Nonce) — mesmo formato, code errado → None.
        let mut buf = new_header(MSG_ALLOCATE_ERROR, &TXID);
        let mut err = vec![0x00, 0x00, 0x04, 0x38]; // class 4, number 38 = 438
        err.extend_from_slice(b"Stale Nonce");
        push_attr(&mut buf, ATTR_ERROR_CODE, &err);
        push_attr(&mut buf, ATTR_REALM, b"r");
        push_attr(&mut buf, ATTR_NONCE, b"n");
        set_length(&mut buf);
        assert_eq!(parse_error_unauthorized(&buf, &TXID), None);
    }

    /// Monta um Allocate Success com XOR-RELAYED-ADDRESS IPv4 + LIFETIME. Os bytes
    /// XOR (x-port/x-address) são de `192.0.2.15:32853`, calculados FORA:
    ///   32853 = 0x8055; 0x8055 ^ 0x2112 = 0xA147.
    ///   192.0.2.15 = C0 00 02 0F; ^ cookie (21 12 A4 42) = E1 12 A6 4D.
    fn sucesso_relay() -> Vec<u8> {
        let mut buf = new_header(MSG_ALLOCATE_SUCCESS, &TXID);
        let relayed = [0x00, FAMILY_IPV4, 0xA1, 0x47, 0xE1, 0x12, 0xA6, 0x4D];
        push_attr(&mut buf, ATTR_XOR_RELAYED_ADDRESS, &relayed);
        push_attr(&mut buf, ATTR_LIFETIME, &600u32.to_be_bytes());
        set_length(&mut buf);
        buf
    }

    #[test]
    fn parse_allocate_success_devolve_relay_e_lifetime() {
        let msg = sucesso_relay();
        let (addr, lifetime) = parse_allocate_success(&msg, &TXID).expect("Success válido");
        assert_eq!(addr, "192.0.2.15:32853".parse().unwrap());
        assert_eq!(lifetime, 600);
    }

    #[test]
    fn parse_allocate_success_txid_errado_rejeita() {
        let msg = sucesso_relay();
        assert_eq!(parse_allocate_success(&msg, &[0u8; 12]), None);
    }

    #[test]
    fn parse_allocate_success_truncado_rejeita() {
        let msg = sucesso_relay();
        // Anuncia o length cheio mas corta o buffer no meio dos atributos.
        let curta = &msg[..HEADER_LEN + 4];
        assert_eq!(parse_allocate_success(curta, &TXID), None);
    }

    // ── data-path (fatia 3a): Send/Data indication + acks ──────────────────

    #[test]
    fn send_indication_embrulha_peer_e_data_sem_mi() {
        let peer: SocketAddr = "192.0.2.15:32853".parse().unwrap();
        // 15 bytes: NÃO múltiplo de 4 — exercita o padding do DATA.
        let carga = b"pacote-str0m-cr";
        let ind = build_send_indication(&TXID, peer, carga);

        assert_eq!(u16::from_be_bytes([ind[0], ind[1]]), MSG_SEND_INDICATION);
        let attrs = &ind[HEADER_LEN..];
        // XOR-PEER-ADDRESS de-XORa de volta pro peer exato.
        let pe = find_attr(attrs, ATTR_MAPPED_XOR_PEER).expect("XOR-PEER-ADDRESS");
        assert_eq!(decode_xor_address(pe, &TXID), Some(peer));
        // DATA volta intacta (15 bytes, sem o padding vazar).
        assert_eq!(find_attr(attrs, ATTR_DATA), Some(&carga[..]));
        // Indication NÃO leva MESSAGE-INTEGRITY (é a diferença do request).
        assert_eq!(find_attr(attrs, ATTR_MESSAGE_INTEGRITY), None);
        // Length do header bate com os atributos reais (com padding).
        let msg_len = u16::from_be_bytes([ind[2], ind[3]]) as usize;
        assert_eq!(msg_len, ind.len() - HEADER_LEN);
    }

    /// Monta uma Data Indication com `txid` ESCOLHIDO PELO SERVIDOR (não o nosso).
    fn data_indication(peer: SocketAddr, dados: &[u8], txid: &[u8; 12]) -> Vec<u8> {
        let mut buf = new_header(MSG_DATA_INDICATION, txid);
        push_xor_peer_address(&mut buf, peer, txid);
        push_attr(&mut buf, ATTR_DATA, dados);
        set_length(&mut buf);
        buf
    }

    #[test]
    fn parse_data_indication_desembrulha_peer_e_data() {
        let peer: SocketAddr = "203.0.113.7:5004".parse().unwrap();
        let carga = b"rtp-ou-dtls-vindo-do-peer";
        // txid do servidor, diferente do TXID dos nossos requests.
        let srv_txid = [9u8, 9, 9, 9, 8, 8, 8, 8, 7, 7, 7, 7];
        let ind = data_indication(peer, carga, &srv_txid);

        let (p, d) = parse_data_indication(&ind).expect("Data Indication válida");
        assert_eq!(p, peer); // de-XOR com o txid DO SERVIDOR, lido do header
        assert_eq!(d, carga);
    }

    #[test]
    fn parse_data_indication_rejeita_tipo_e_cookie_errados() {
        let peer: SocketAddr = "203.0.113.7:5004".parse().unwrap();
        let ind = data_indication(peer, b"x", &[1u8; 12]);
        // Tipo errado (Send em vez de Data) → None.
        let mut tipo_errado = ind.clone();
        tipo_errado[0..2].copy_from_slice(&MSG_SEND_INDICATION.to_be_bytes());
        assert_eq!(parse_data_indication(&tipo_errado), None);
        // Cookie corrompido → None (não entrega lixo pro str0m).
        let mut cookie_errado = ind;
        cookie_errado[4] ^= 0xFF;
        assert_eq!(parse_data_indication(&cookie_errado), None);
    }

    #[test]
    fn parse_permission_e_refresh_success() {
        // CreatePermission Success: só o cabeçalho, casa pelo txid.
        let mut perm = new_header(MSG_CREATE_PERMISSION_SUCCESS, &TXID);
        set_length(&mut perm);
        assert!(parse_create_permission_success(&perm, &TXID));
        assert!(!parse_create_permission_success(&perm, &[0u8; 12])); // txid errado

        // Refresh Success: o LIFETIME concedido pode ser MENOR que o pedido.
        let mut rf = new_header(MSG_REFRESH_SUCCESS, &TXID);
        push_attr(&mut rf, ATTR_LIFETIME, &300u32.to_be_bytes());
        set_length(&mut rf);
        assert_eq!(parse_refresh_success(&rf, &TXID), Some(300));
        assert_eq!(parse_refresh_success(&rf, &[0u8; 12]), None); // txid errado
    }

    /// Monta um Error Response `438 Stale Nonce` com ERROR-CODE + NONCE (novo). O
    /// `tipo` varia por método — passamos o Refresh Error (0x0114) pra provar que o
    /// parser NÃO fixa o tipo.
    fn erro_438(tipo: u16, nonce: &str) -> Vec<u8> {
        let mut buf = new_header(tipo, &TXID);
        let mut err = vec![0x00, 0x00, 0x04, 0x26]; // class 4, number 38 = 438
        err.extend_from_slice(b"Stale Nonce");
        push_attr(&mut buf, ATTR_ERROR_CODE, &err);
        push_attr(&mut buf, ATTR_NONCE, nonce.as_bytes());
        set_length(&mut buf);
        buf
    }

    #[test]
    fn parse_stale_nonce_devolve_nonce_novo_qualquer_metodo() {
        // Refresh Error (0x0114) e CreatePermission Error (0x0118): mesmo parser.
        for tipo in [0x0114u16, 0x0118u16] {
            let msg = erro_438(tipo, "nonce-rotacionado-42");
            assert_eq!(
                parse_stale_nonce(&msg, &TXID),
                Some("nonce-rotacionado-42".to_string())
            );
        }
    }

    #[test]
    fn parse_stale_nonce_rejeita_txid_code_e_cookie() {
        let msg = erro_438(0x0114, "n");
        assert_eq!(parse_stale_nonce(&msg, &[0u8; 12]), None); // txid errado
        // Cookie corrompido → None.
        let mut ck = erro_438(0x0114, "n");
        ck[4] ^= 0xFF;
        assert_eq!(parse_stale_nonce(&ck, &TXID), None);
        // 401 (não 438) → None: só o Stale Nonce renova; outro erro é fatal.
        assert_eq!(parse_stale_nonce(&erro_401("r", "n"), &TXID), None);
    }
}
