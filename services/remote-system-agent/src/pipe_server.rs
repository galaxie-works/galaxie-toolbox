//! Servidor do named pipe de sessão worker↔owner (S7 #690, **passo 2b-io**).
//!
//! O núcleo de handshake ([`crate::session_channel`]) é puro e já decide
//! aceitar/recusar a partir de OUTCOMES. Este módulo é o **I/O que produz esses
//! outcomes**: cria o pipe com a **DACL restrita** (§4.1), aceita o owner, lê o
//! `hello` (teto 64 KiB), e resolve a [`PresencaLocal`] (PID→sessão +
//! Authenticode). A conectividade real (owner assinado conectando) é runtime do
//! Wagner — aqui o que é testável é o **construtor da DACL** (SDDL), e o resto é
//! `cfg(windows)` compilado.

use crate::session_channel::PresencaLocal;

/// Logon SID recusado por não casar `^S-1-[0-9-]+$` (#1073 RB13).
#[derive(Debug, PartialEq, Eq)]
pub struct SidInvalido(pub String);

impl std::fmt::Display for SidInvalido {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "logon SID malformado (esperado ^S-1-[0-9-]+$): {:?}", self.0)
    }
}

impl std::error::Error for SidInvalido {}

/// #1073 (RB13): valida o formato do SID ANTES de interpolar no SDDL. Casa
/// `^S-1-[0-9-]+$` — só o prefixo `S-1-` seguido de dígitos e hífens. Barra qualquer
/// metacaractere de SDDL (`)`, `(`, `;`, espaço, …) que fecharia o nosso ACE e
/// injetaria outro (ex.: abrir pra `WD`/Everyone). Sem regex (crate sem essa dep).
fn sid_valido(sid: &str) -> bool {
    match sid.strip_prefix("S-1-") {
        Some(resto) => !resto.is_empty() && resto.bytes().all(|b| b.is_ascii_digit() || b == b'-'),
        None => false,
    }
}

/// SDDL da DACL do pipe (§4.1): **SYSTEM + o Logon SID da sessão ativa APENAS**,
/// protegida (`P` = sem herança). Sem ACE pra rede/outras sessões ⇒ negado por
/// omissão. `GA` = GENERIC_ALL (o worker é dono; o owner precisa ler/escrever).
///
/// #1073 (RB13): `Result` — `logon_sid` malformado é RECUSADO (anti-injeção de DACL),
/// nunca interpolado cru.
pub fn dacl_sddl(logon_sid: &str) -> Result<String, SidInvalido> {
    if !sid_valido(logon_sid) {
        return Err(SidInvalido(logon_sid.to_string()));
    }
    Ok(format!("D:P(A;;GA;;;SY)(A;;GA;;;{logon_sid})"))
}

// ───────────────────────── pin de publisher (§4, F1) ─────────────────────────
//
// O gate antigo (`WinVerifyTrust` só) confirmava que a cadeia fecha numa raiz
// confiável, mas NÃO quem assinou (F1): qualquer binário com um cert válido de
// QUALQUER CA pública passava. O `avaliar_signer` fecha isso fixando **Issuer ∧
// Subject O** do nosso cert. É puro (sem Win32) ⇒ testável sem assinar nada.

/// O que se extrai do estado do `WinVerifyTrust` sobre QUEM assinou o binário do
/// owner. `issuer`/`subject_o` são DNs do cert do signer; `cadeia_confiavel` é o
/// `status == 0` (a cadeia fecha numa raiz confiável).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignerObservado {
    pub issuer: String,
    pub subject_o: String,
    pub cadeia_confiavel: bool,
}

/// Publisher FIXADO (F1): o Issuer e o Subject O que o signer DEVE ter. Nasce dos
/// `option_env!` da esteira (VAZIO hoje — o cert EV ainda não existe, F5).
#[derive(Debug, Clone)]
pub struct PinPublisher {
    pub issuer: &'static str,
    pub subject_o: &'static str,
}

/// Pin efetivo em build-time. Preenchido pela esteira via env de compilação; VAZIO
/// até o cert EV existir (F5) ⇒ [`avaliar_signer`] recusa TUDO (fail-closed). NÃO
/// há bypass de dev: o S7 não fecha handshake em runtime até a esteira assinar.
pub const PIN: PinPublisher = PinPublisher {
    issuer: match option_env!("GALAXIE_SIGN_PIN_ISSUER") {
        Some(v) => v,
        None => "",
    },
    subject_o: match option_env!("GALAXIE_SIGN_PIN_SUBJECT_O") {
        Some(v) => v,
        None => "",
    },
};

/// Por que o signer foi recusado (fail-closed em todos os ramos).
#[derive(Debug, PartialEq, Eq)]
pub enum RejeicaoSigner {
    /// Pin vazio (F5 pendente): sem cert não dá pra verificar publisher ⇒ recusa.
    PinNaoConfigurado,
    /// A cadeia não fecha numa raiz confiável (`status != 0`).
    CadeiaNaoConfiavel,
    /// A cadeia é confiável, mas o Issuer não é o fixado (cert de OUTRA CA — F1).
    IssuerDivergente,
    /// Issuer bate, mas o Subject O (organização) diverge do fixado.
    OrganizacaoDivergente,
}

/// DN é case-insensitive ASCII: compara normalizando caixa e aparas de espaço.
fn dn_igual(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// Decide se o signer observado casa o pin (F1), **puro** e **fail-closed**. A
/// regra primária é: **Issuer fixado ∧ Subject O fixado ∧ cadeia confiável**.
// TODO(#1052): SPKI allowlist opcional como reforço (não implementada agora).
pub fn avaliar_signer(obs: &SignerObservado, pin: &PinPublisher) -> Result<(), RejeicaoSigner> {
    // fail-closed: sem pin não há como verificar publisher (F5) ⇒ recusa.
    if pin.issuer.is_empty() || pin.subject_o.is_empty() {
        return Err(RejeicaoSigner::PinNaoConfigurado);
    }
    if !obs.cadeia_confiavel {
        return Err(RejeicaoSigner::CadeiaNaoConfiavel);
    }
    if !dn_igual(&obs.issuer, pin.issuer) {
        return Err(RejeicaoSigner::IssuerDivergente);
    }
    if !dn_igual(&obs.subject_o, pin.subject_o) {
        return Err(RejeicaoSigner::OrganizacaoDivergente);
    }
    Ok(())
}

#[cfg(windows)]
pub use win::*;

#[cfg(windows)]
mod win {
    use super::{avaliar_signer, dacl_sddl, PresencaLocal, SignerObservado, PIN};
    use crate::session_channel::{parse_mensagem, Hello, MAX_MESSAGE_BYTES};
    use std::cell::Cell;
    use std::io;
    use windows::core::{PCSTR, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{
        CloseHandle, FILETIME, GENERIC_READ, HANDLE, HLOCAL, LocalFree,
    };
    use windows::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows::Win32::Security::Cryptography::{
        CertGetNameStringW, szOID_ORGANIZATION_NAME, CERT_CONTEXT, CERT_NAME_ATTR_TYPE,
        CERT_NAME_ISSUER_FLAG, CERT_NAME_SIMPLE_DISPLAY_TYPE,
    };
    use windows::Win32::Security::PSECURITY_DESCRIPTOR;
    use windows::Win32::Security::SECURITY_ATTRIBUTES;
    use windows::Win32::Security::WinTrust::{
        WinVerifyTrust, WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData,
        WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_FILE_INFO, WTD_CHOICE_FILE,
        WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE,
    };
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, ReadFile, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, OPEN_EXISTING,
        PIPE_ACCESS_DUPLEX,
    };
    use windows::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, GetNamedPipeClientProcessId, PIPE_READMODE_MESSAGE,
        PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_MESSAGE, PIPE_WAIT,
    };
    use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
    use windows::Win32::System::SystemInformation::GetSystemTimeAsFileTime;
    use windows::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn last_err(ctx: &str) -> io::Error {
        io::Error::new(io::ErrorKind::Other, format!("{ctx}: {}", io::Error::last_os_error()))
    }

    /// Descritor de segurança do SDDL, dono do buffer (LocalFree no Drop).
    struct SecDesc(PSECURITY_DESCRIPTOR);
    impl Drop for SecDesc {
        fn drop(&mut self) {
            if !self.0 .0.is_null() {
                // SAFETY: `self.0` é o PSECURITY_DESCRIPTOR não-nulo alocado por
                // `ConvertStringSecurityDescriptorToSecurityDescriptorW`; `LocalFree`
                // o libera exatamente uma vez (dono único, só aqui no Drop).
                unsafe {
                    let _ = LocalFree(Some(HLOCAL(self.0 .0)));
                }
            }
        }
    }

    /// HANDLE dono (fecha no Drop). Usado pros handles de processo/arquivo abertos
    /// durante a validação — segurar o de processo mantém o PID vivo (F2).
    struct OwnedHandle(HANDLE);
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            // SAFETY: `self.0` é um HANDLE válido de `OpenProcess`/`CreateFileW`,
            // fechado exatamente uma vez aqui (dono único).
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    /// FILETIME (100 ns desde 1601) como i64 monotônico-o-bastante pra comparar
    /// instantes. Cabe em i64 folgado (datas atuais ≈ 1.3e17 « i64::MAX).
    fn filetime_i64(ft: &FILETIME) -> i64 {
        (((ft.dwHighDateTime as u64) << 32) | (ft.dwLowDateTime as u64)) as i64
    }

    /// Instante atual em FILETIME-i64 (`GetSystemTimeAsFileTime`).
    fn agora_filetime_i64() -> i64 {
        // SAFETY: sem argumentos; retorna um FILETIME por valor.
        let ft = unsafe { GetSystemTimeAsFileTime() };
        filetime_i64(&ft)
    }

    /// Servidor do pipe de sessão: cria com a DACL da §4.1 e serve UMA conexão.
    pub struct PipeServer {
        handle: HANDLE,
        _sd: SecDesc,
        /// FILETIME-i64 do connect do owner, capturado no `aceitar` (cinto F2). 0
        /// = ainda não conectado / não registrado.
        conectado_em: Cell<i64>,
    }

    impl PipeServer {
        /// Cria o pipe `\\.\pipe\Galaxie.Remote.Worker.<sid>.<nonce>` com a DACL
        /// SYSTEM+LogonSID, message-mode, sem clientes remotos, teto 64 KiB.
        pub fn criar(nome_pipe: &str, logon_sid: &str) -> io::Result<Self> {
            // #1073 (RB13): SID validado ANTES do SDDL — malformado vira erro, não DACL.
            let sddl_str = dacl_sddl(logon_sid)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e.to_string()))?;
            let sddl = to_wide(&sddl_str);
            let mut psd = PSECURITY_DESCRIPTOR::default();
            // SAFETY: `sddl` é UTF-16 NUL-terminada válida (de `to_wide`); em sucesso
            // a API aloca o descritor em `psd`, que `SecDesc` passa a possuir e
            // libera com `LocalFree` no Drop.
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    PCWSTR(sddl.as_ptr()),
                    SDDL_REVISION_1,
                    &mut psd,
                    None,
                )
            }
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("SDDL: {e}")))?;
            let sd = SecDesc(psd);

            let sa = SECURITY_ATTRIBUTES {
                // #1076 (RB12): fail-CLOSED. `nLength` = 0 faz o Win32 IGNORAR o
                // `lpSecurityDescriptor` — o pipe nasceria com a DACL default (aberta),
                // furando a restrição SYSTEM+LogonSID da §4.1. `size_of` é const e cabe
                // trivialmente em u32; `expect` nunca dispara, mas jamais deixa virar 0.
                nLength: u32::try_from(std::mem::size_of::<SECURITY_ATTRIBUTES>())
                    .expect("size_of::<SECURITY_ATTRIBUTES>() cabe em u32"),
                lpSecurityDescriptor: psd.0,
                bInheritHandle: false.into(),
            };
            let nome = to_wide(nome_pipe);
            // SAFETY: `nome` é UTF-16 NUL-terminada válida; `sa` referencia um
            // descritor de segurança vivo (`sd`) que sobrevive a esta chamada.
            let handle = unsafe {
                CreateNamedPipeW(
                    PCWSTR(nome.as_ptr()),
                    PIPE_ACCESS_DUPLEX,
                    PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                    1, // uma instância: uma sessão, um owner
                    MAX_MESSAGE_BYTES as u32,
                    MAX_MESSAGE_BYTES as u32,
                    0,
                    Some(&sa),
                )
            };
            if handle.is_invalid() {
                return Err(last_err("CreateNamedPipeW"));
            }
            Ok(Self {
                handle,
                _sd: sd,
                conectado_em: Cell::new(0),
            })
        }

        /// Bloqueia até o owner conectar.
        pub fn aceitar(&self) -> io::Result<()> {
            // SAFETY: `self.handle` é o pipe válido criado em `criar` (não-fechado
            // até o Drop); `None` = conexão síncrona sem OVERLAPPED.
            unsafe { ConnectNamedPipe(self.handle, None) }
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("ConnectNamedPipe: {e}")))?;
            // Cinto F2: marca o instante do connect o MAIS CEDO possível — logo que
            // ele retorna, antes de qualquer `ler_hello` (que pode bloquear). A
            // criação do processo cliente terá que ser anterior a este instante.
            self.conectado_em.set(agora_filetime_i64());
            Ok(())
        }

        /// Lê UMA mensagem (teto 64 KiB) e desserializa o `hello` (estrito).
        pub fn ler_hello(&self) -> io::Result<Hello> {
            let mut buf = vec![0u8; MAX_MESSAGE_BYTES];
            let mut lidos = 0u32;
            // SAFETY: `self.handle` é válido; `buf`/`lidos` são buffers próprios e
            // vivos durante a chamada síncrona (sem OVERLAPPED).
            unsafe { ReadFile(self.handle, Some(&mut buf), Some(&mut lidos), None) }
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("ReadFile: {e}")))?;
            buf.truncate(lidos as usize);
            parse_mensagem::<Hello>(&buf)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))
        }

        /// PID do cliente conectado.
        pub fn client_pid(&self) -> io::Result<u32> {
            let mut pid = 0u32;
            // SAFETY: `self.handle` é o pipe válido; `pid` é uma out-var própria.
            unsafe { GetNamedPipeClientProcessId(self.handle, &mut pid) }
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("GetNamedPipeClientProcessId: {e}")))?;
            Ok(pid)
        }

        /// Resolve a [`PresencaLocal`] do owner conectado: sessão do PID +
        /// Authenticode da imagem. É o OUTCOME que o `validar_hello` consome.
        ///
        /// F2 (TOCTOU de PID): o handle do processo é aberto UMA vez, IMEDIATAMENTE
        /// após pegar o PID, e SEGURADO por toda a validação (sessão + imagem +
        /// Authenticode). Handle aberto mantém o objeto-processo vivo ⇒ o PID não
        /// recicla no meio. Tudo depois deriva DESSE handle — nada reabre por PID.
        pub fn presenca_local(&self) -> io::Result<PresencaLocal> {
            let pid = self.client_pid()?;
            // F2: abre e SEGURA o handle já — trava o PID contra reciclagem.
            // SAFETY: `pid` veio de `client_pid` (Win32); em sucesso devolve um
            // HANDLE que `OwnedHandle` fecha no Drop.
            let proc = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("OpenProcess: {e}")))?;
            let proc = OwnedHandle(proc);

            let mut session = 0u32;
            // A sessão sai do PID; com o handle segurando o processo vivo, o PID é
            // estável (não reciclou) ⇒ o mapeamento PID→sessão é o do cliente real.
            // SAFETY: `pid` é do cliente; `session` é out-var própria.
            unsafe { ProcessIdToSessionId(pid, &mut session) }
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("ProcessIdToSessionId: {e}")))?;

            // Authenticode + pin de publisher saem do handle segurado; o cinto de
            // timing (criação < connect) é a defesa em profundidade do F2 residual.
            // Ambos precisam valer — qualquer falha ⇒ recusa (fail-closed).
            let assinado = authenticode_ok(proc.0);
            let criacao_ok = criacao_antes_do_connect(proc.0, self.conectado_em.get());
            Ok(PresencaLocal {
                owner_session_id: session,
                authenticode_ok: assinado && criacao_ok,
            })
        }
    }

    impl Drop for PipeServer {
        fn drop(&mut self) {
            // SAFETY: `self.handle` é o HANDLE do pipe criado em `criar`, fechado
            // exatamente uma vez aqui (dono único).
            unsafe {
                let _ = CloseHandle(self.handle);
            }
        }
    }

    /// Caminho da imagem do processo a partir do HANDLE JÁ ABERTO (F2/F3): não
    /// reabre por PID — usa o mesmo objeto-processo segurado em `presenca_local`.
    fn caminho_imagem(proc: HANDLE) -> io::Result<Vec<u16>> {
        let mut buf = vec![0u16; 32_768];
        let mut tam = buf.len() as u32;
        // SAFETY: `proc` é um HANDLE de processo válido e vivo (segurado pelo
        // chamador); `buf` tem `tam` u16s e vive durante a chamada; a API escreve o
        // caminho NUL-terminado e ajusta `tam` (sem o NUL).
        let r = unsafe {
            QueryFullProcessImageNameW(proc, PROCESS_NAME_FORMAT(0), PWSTR(buf.as_mut_ptr()), &mut tam)
        };
        r.map_err(|e| io::Error::new(io::ErrorKind::Other, format!("QueryFullProcessImageNameW: {e}")))?;
        buf.truncate(tam as usize + 1); // inclui o NUL
        Ok(buf)
    }

    /// Um nome (Issuer/Subject-O) do cert do signer via `CertGetNameStringW`. `oid`
    /// = `Some(..)` só no `CERT_NAME_ATTR_TYPE` (o atributo pedido). String vazia se
    /// não houver nome — que o `avaliar_signer` trata como divergência (fail-closed).
    fn cert_name(pcert: *const CERT_CONTEXT, dwtype: u32, dwflags: u32, oid: Option<PCSTR>) -> String {
        let pv: Option<*const core::ffi::c_void> = oid.map(|o| o.0 as *const core::ffi::c_void);
        // 1ª passada mede (inclui o NUL); 0/1 ⇒ sem nome.
        // SAFETY: `pcert` é `*const CERT_CONTEXT` válido (do estado vivo do
        // WinVerifyTrust); `None` no buffer só devolve o tamanho necessário.
        let n = unsafe { CertGetNameStringW(pcert, dwtype, dwflags, pv, None) };
        if n <= 1 {
            return String::new();
        }
        let mut buf = vec![0u16; n as usize];
        // SAFETY: `buf` tem `n` u16s; a API escreve até `n` chars (com o NUL).
        let w = unsafe { CertGetNameStringW(pcert, dwtype, dwflags, pv, Some(&mut buf)) };
        if w <= 1 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..(w as usize) - 1]) // tira o NUL final
    }

    /// Extrai o [`SignerObservado`] do estado do `WinVerifyTrust` (F1): quem
    /// assinou. Cadeia de APIs de cert: `WTHelperProvDataFromStateData` →
    /// `CRYPT_PROVIDER_DATA` → `WTHelperGetProvSignerFromChain` (signer 0) →
    /// `CRYPT_PROVIDER_SGNR` → `pasCertChain[0]` (o cert do signer) →
    /// `CertGetNameStringW` p/ Issuer e Subject O. **Fail-closed:** qualquer ponteiro
    /// nulo/erro ⇒ DNs vazios (o `avaliar_signer` recusa). Deve rodar ANTES do CLOSE
    /// (o cert vive no estado até lá).
    fn extrair_signer(hstate: HANDLE, cadeia_confiavel: bool) -> SignerObservado {
        let vazio = || SignerObservado {
            issuer: String::new(),
            subject_o: String::new(),
            cadeia_confiavel,
        };
        if hstate.is_invalid() {
            return vazio();
        }
        // SAFETY: `hstate` é o `hWVTStateData` preenchido pelo VERIFY; a API devolve
        // o `CRYPT_PROVIDER_DATA` do estado (válido até o STATEACTION_CLOSE).
        let prov = unsafe { WTHelperProvDataFromStateData(hstate) };
        if prov.is_null() {
            return vazio();
        }
        // SAFETY: `prov` não-nulo; pega o 1º signer (0) sem countersigners.
        let sgnr = unsafe { WTHelperGetProvSignerFromChain(prov, 0, false, 0) };
        if sgnr.is_null() {
            return vazio();
        }
        // SAFETY: `sgnr` não-nulo aponta pro `CRYPT_PROVIDER_SGNR` do estado vivo.
        let sgnr = unsafe { &*sgnr };
        if sgnr.csCertChain == 0 || sgnr.pasCertChain.is_null() {
            return vazio();
        }
        // `pasCertChain[0]` = o cert do próprio signer (folha da cadeia).
        // SAFETY: `pasCertChain` aponta pra `csCertChain` (≥1) elementos vivos.
        let cert0 = unsafe { &*sgnr.pasCertChain };
        if cert0.pCert.is_null() {
            return vazio();
        }
        let issuer = cert_name(
            cert0.pCert,
            CERT_NAME_SIMPLE_DISPLAY_TYPE,
            CERT_NAME_ISSUER_FLAG,
            None,
        );
        let subject_o = cert_name(
            cert0.pCert,
            CERT_NAME_ATTR_TYPE,
            0,
            Some(szOID_ORGANIZATION_NAME),
        );
        SignerObservado {
            issuer,
            subject_o,
            cadeia_confiavel,
        }
    }

    /// Authenticode + **pin de publisher** do binário do owner, **fail-closed**. F3:
    /// abre o ARQUIVO da imagem (só `FILE_SHARE_READ` — sem WRITE/DELETE) e passa o
    /// `hFile` no `WINTRUST_FILE_INFO` — verifica-se o OBJETO segurado, não um caminho
    /// que pode trocar embaixo. Extrai o signer do estado e o confronta com o [`PIN`]
    /// via [`avaliar_signer`]. `proc` é o handle JÁ ABERTO e segurado (F2).
    pub fn authenticode_ok(proc: HANDLE) -> bool {
        let Ok(caminho) = caminho_imagem(proc) else {
            return false;
        };
        // F3: abre o .exe da imagem sem compartilhar escrita/delete.
        // SAFETY: `caminho` é UTF-16 NUL-terminado (de `caminho_imagem`); demais
        // args são constantes; em sucesso devolve um HANDLE de arquivo.
        let hfile = unsafe {
            CreateFileW(
                PCWSTR(caminho.as_ptr()),
                GENERIC_READ.0,
                FILE_SHARE_READ,
                None,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                None,
            )
        };
        let hfile = match hfile {
            Ok(h) if !h.is_invalid() => OwnedHandle(h),
            _ => return false, // fail-closed: sem abrir o objeto, não verifica
        };

        let mut file_info = WINTRUST_FILE_INFO {
            cbStruct: u32::try_from(std::mem::size_of::<WINTRUST_FILE_INFO>()).unwrap_or(0),
            pcwszFilePath: PCWSTR(caminho.as_ptr()),
            // F3: o `hFile` é o que fecha a janela — o WinVerifyTrust verifica ELE.
            hFile: hfile.0,
            pgKnownSubject: std::ptr::null_mut(),
        };
        let mut data = WINTRUST_DATA {
            cbStruct: u32::try_from(std::mem::size_of::<WINTRUST_DATA>()).unwrap_or(0),
            dwUIChoice: WTD_UI_NONE,
            fdwRevocationChecks: WTD_REVOKE_NONE,
            dwUnionChoice: WTD_CHOICE_FILE,
            dwStateAction: WTD_STATEACTION_VERIFY,
            ..Default::default()
        };
        data.Anonymous.pFile = &mut file_info;
        let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
        // SAFETY: `action`/`data` são structs próprias e vivas; `data.pFile` aponta
        // pra `file_info` (vivo), com `hFile`/`pcwszFilePath` válidos. O `c_void` é só
        // a passagem do `&mut data` que a API espera.
        let status = unsafe {
            WinVerifyTrust(
                Default::default(),
                &mut action,
                &mut data as *mut _ as *mut core::ffi::c_void,
            )
        };
        // Extrai o signer do estado ANTES de fechar (o cert vive no estado).
        let obs = extrair_signer(data.hWVTStateData, status == 0);
        // fecha o estado (obrigatório após VERIFY).
        data.dwStateAction = WTD_STATEACTION_CLOSE;
        // SAFETY: mesmos `action`/`data` da chamada VERIFY, ainda vivos; agora com
        // dwStateAction=CLOSE, a API libera o estado que alocou no VERIFY.
        unsafe {
            let _ = WinVerifyTrust(
                Default::default(),
                &mut action,
                &mut data as *mut _ as *mut core::ffi::c_void,
            );
        }
        // `hfile` fecha no Drop aqui. Decisão final: signer casa o pin? (F1)
        avaliar_signer(&obs, &PIN).is_ok()
    }

    /// Cinto do F2 (defesa em profundidade): a criação do processo cliente tem que
    /// ser ANTERIOR ao connect do pipe. `conectado_em` é o FILETIME-i64 capturado no
    /// `aceitar`. Criação POSTERIOR ⇒ é um PID reciclado pra um processo mais novo ⇒
    /// recusa (fail-closed em erro de `GetProcessTimes`).
    ///
    /// LIMITAÇÃO (honesta): cobre só a janela A PARTIR do instante que registramos no
    /// `aceitar` — que é logo APÓS o `ConnectNamedPipe` retornar, não o connect real
    /// no kernel. Se um PID reciclasse na fresta (sub-ms) entre o connect real e o
    /// nosso `GetSystemTimeAsFileTime`, um processo criado nessa fresta ainda passaria
    /// o cinto. O SEGURAR-O-HANDLE (F2 primário) é o que realmente fecha a reciclagem;
    /// este cinto é reforço. `conectado_em == 0` (aceitar não registrou, ex.: teste)
    /// não bloqueia.
    fn criacao_antes_do_connect(proc: HANDLE, conectado_em: i64) -> bool {
        if conectado_em == 0 {
            return true;
        }
        let (mut criacao, mut zero) = (FILETIME::default(), FILETIME::default());
        // SAFETY: `proc` é HANDLE de processo válido/vivo; as 4 out-vars são próprias.
        let r = unsafe { GetProcessTimes(proc, &mut criacao, &mut zero, &mut zero, &mut zero) };
        if r.is_err() {
            return false; // fail-closed
        }
        filetime_i64(&criacao) <= conectado_em
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sddl_tem_system_e_o_logon_sid_e_nega_o_resto() {
        let sid = "S-1-5-5-0-1234567";
        let s = dacl_sddl(sid).expect("SID bem-formado");
        assert_eq!(s, format!("D:P(A;;GA;;;SY)(A;;GA;;;{sid})"));
        assert!(s.contains(";;SY)"), "tem SYSTEM");
        assert!(s.contains(&format!(";;{sid})")), "tem o Logon SID da sessão");
        // protegida (sem herança) e SEM Everyone/World/Authenticated-Users.
        assert!(s.starts_with("D:P"), "DACL protegida (P)");
        for aberto in [";;WD)", ";;AU)", ";;BU)"] {
            assert!(!s.contains(aberto), "não pode ter ACE aberta {aberto}");
        }
    }

    /// #1073 (RB13, adversarial): SID com metacaractere de SDDL é RECUSADO — nunca
    /// gera DACL malformada/injetada. É a prova de que a validação fecha a injeção.
    #[test]
    fn sid_malformado_e_rejeitado_sem_gerar_sddl() {
        for ruim in [
            "S-1-5-21)(A;;GA;;;WD",       // fecha nosso ACE e injeta Everyone
            "S-1-5-21;;GA;;;WD",          // `;` quebra o campo do ACE
            "S-1-5-21 1177238915",        // espaço
            "S-1-5-(21)",                 // parênteses
            "S-1-5-21\t512",              // tab
            "WD",                          // não começa com S-1-
            "S-1-",                        // vazio após o prefixo
            "",                            // vazio
            "s-1-5-21",                    // minúsculo
            "X-1-5-21",                    // prefixo errado
            "S-1-5-21;",                   // termina com `;`
        ] {
            assert!(
                dacl_sddl(ruim).is_err(),
                "{ruim:?} devia ser recusado (anti-injeção de DACL)"
            );
        }

        // SID legítimo (com vários hífens) passa e gera a DACL protegida, sem ACE aberta.
        let ok = dacl_sddl("S-1-5-21-1004336348-1177238915-682003330-512")
            .expect("SID bem-formado deve passar");
        assert!(ok.starts_with("D:P("), "DACL protegida");
        assert!(!ok.contains(";;WD)"), "sem Everyone");
    }

    // ─────────────────── pin de publisher (F1), puro, sem cert ───────────────────

    fn pin(issuer: &'static str, subject_o: &'static str) -> PinPublisher {
        PinPublisher { issuer, subject_o }
    }
    fn obs(issuer: &str, subject_o: &str, cadeia_confiavel: bool) -> SignerObservado {
        SignerObservado {
            issuer: issuer.into(),
            subject_o: subject_o.into(),
            cadeia_confiavel,
        }
    }

    /// F5 (esperado HOJE): sem cert publicado o pin nasce vazio ⇒ recusa TUDO. É o
    /// fail-closed que mantém o S7 fechado em runtime até a esteira assinar.
    #[test]
    fn signer_pin_vazio_recusa_tudo() {
        assert_eq!(
            avaliar_signer(&obs("CN=Qualquer CA", "Qualquer Corp", true), &pin("", "")),
            Err(RejeicaoSigner::PinNaoConfigurado)
        );
        // metade vazio (issuer OU subject_o) ainda não configura.
        assert_eq!(
            avaliar_signer(&obs("i", "o", true), &pin("CN=X", "")),
            Err(RejeicaoSigner::PinNaoConfigurado)
        );
        assert_eq!(
            avaliar_signer(&obs("i", "o", true), &pin("", "Galaxie Works Ltd")),
            Err(RejeicaoSigner::PinNaoConfigurado)
        );
        // o PIN de build-time nasce vazio (F5) ⇒ também recusa.
        assert_eq!(
            avaliar_signer(&obs("i", "o", true), &PIN),
            Err(RejeicaoSigner::PinNaoConfigurado),
            "sem GALAXIE_SIGN_PIN_* o binário não é aceito (fail-closed)"
        );
    }

    #[test]
    fn signer_cadeia_nao_confiavel_recusa() {
        assert_eq!(
            avaliar_signer(
                &obs("CN=Galaxie CA", "Galaxie Works Ltd", false),
                &pin("CN=Galaxie CA", "Galaxie Works Ltd"),
            ),
            Err(RejeicaoSigner::CadeiaNaoConfiavel)
        );
    }

    #[test]
    fn signer_issuer_divergente_recusa() {
        assert_eq!(
            avaliar_signer(
                &obs("CN=Outra CA", "Galaxie Works Ltd", true),
                &pin("CN=Galaxie CA", "Galaxie Works Ltd"),
            ),
            Err(RejeicaoSigner::IssuerDivergente)
        );
    }

    #[test]
    fn signer_organizacao_divergente_recusa() {
        assert_eq!(
            avaliar_signer(
                &obs("CN=Galaxie CA", "Empresa Impostora LLC", true),
                &pin("CN=Galaxie CA", "Galaxie Works Ltd"),
            ),
            Err(RejeicaoSigner::OrganizacaoDivergente)
        );
    }

    /// Accept com pin sintético: Issuer ∧ Subject O certos (caixa/espacos diferentes,
    /// DN é case-insensitive ASCII) + cadeia confiável ⇒ Ok.
    #[test]
    fn signer_issuer_e_org_certos_case_insensitive_aceita() {
        assert_eq!(
            avaliar_signer(
                &obs("  cn=galaxie code signing ca ", "GALAXIE works LTD", true),
                &pin("CN=Galaxie Code Signing CA", "Galaxie Works Ltd"),
            ),
            Ok(())
        );
    }

    /// Reproduz o BYPASS F1 (o antes/depois): uma cadeia confiável de OUTRO issuer —
    /// que HOJE (gate antigo, só `status==0`) seria aceita — agora é RECUSADA pelo
    /// pin. Prova que o pin fecha a vuln, não só documenta.
    #[test]
    fn signer_reproduz_bypass_cadeia_de_outro_issuer_agora_recusa() {
        let pin_galaxie = pin("CN=Galaxie Code Signing CA", "Galaxie Works Ltd");
        // cert legítimo de OUTRA empresa, cadeia fecha numa raiz confiável.
        let atacante = obs("CN=DigiCert Trusted G4 CA", "Contoso LLC", true);
        // gate antigo (só cadeia confiável) ACEITARIA:
        assert!(atacante.cadeia_confiavel, "o antigo só olhava isto e aceitava");
        // gate novo (pin) RECUSA por issuer:
        assert_eq!(
            avaliar_signer(&atacante, &pin_galaxie),
            Err(RejeicaoSigner::IssuerDivergente)
        );
    }

    // NOTA: "aceita a imagem REAL da Galaxie" fica PENDENTE do F5 — hoje o binário não
    // é assinado (não há cert real p/ montar o SignerObservado via Win32). O accept é
    // provado acima com pin sintético; o E2E com cert real entra quando a esteira
    // assinar e preencher GALAXIE_SIGN_PIN_ISSUER / _SUBJECT_O.
}
