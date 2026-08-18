//! DPAPI (Data Protection API) do usuário — wrapper ÚNICO de `CryptProtectData`/
//! `CryptUnprotectData`. #1073 (RB10): antes estava DUPLICADO idêntico em `auth.rs`
//! (sessão {tenant, refresh}) e `lock_screen.rs` (hash do PIN); telemetry consumia
//! o de `auth`. Uma cópia só, um lugar pra auditar o `unsafe`.
//!
//! DPAPI cifra com a credencial do usuário logado do Windows: outro usuário da mesma
//! máquina não decifra, e o arquivo sozinho não serve pra nada. Sem limite de tamanho
//! (ao contrário do Credential Manager) — cobre refresh tokens da Microsoft (>3 KiB).

#[cfg(windows)]
mod imp {
    use std::ptr;
    use winapi::um::dpapi::{CryptProtectData, CryptUnprotectData};
    use winapi::um::winbase::LocalFree;
    use winapi::um::wincrypt::DATA_BLOB;

    /// Copia o `DATA_BLOB` de saída da API pra um `Vec` e LIBERA o buffer do SO.
    fn saida_para_vec(out: &DATA_BLOB) -> Vec<u8> {
        // SAFETY: a API garante `pbData` válido por `cbData` bytes quando a chamada
        // retornou sucesso (o único caminho que chega aqui). Copiamos e liberamos.
        let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
        // SAFETY: `pbData` foi alocado pelo DPAPI com LocalAlloc; LocalFree é o par
        // correto de liberação. Chamado exatamente uma vez por blob de saída.
        unsafe { LocalFree(out.pbData as *mut _) };
        bytes
    }

    /// Cifra `dados` com DPAPI (escopo do usuário). `None` = a API falhou.
    pub fn cifrar(dados: &[u8]) -> Option<Vec<u8>> {
        let mut entrada = dados.to_vec();
        let mut inb = DATA_BLOB {
            cbData: entrada.len() as u32,
            pbData: entrada.as_mut_ptr(),
        };
        let mut outb = DATA_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        // SAFETY: `inb` aponta pra `entrada` (viva até o fim da fn); `outb` é
        // preenchido pela API (buffer do SO, liberado em `saida_para_vec`). Todos os
        // ponteiros opcionais são NULL, como manda a doc. Só lemos `outb` se `ok != 0`.
        let ok = unsafe {
            CryptProtectData(
                &mut inb,
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
                &mut outb,
            )
        };
        (ok != 0).then(|| saida_para_vec(&outb))
    }

    /// Decifra um blob produzido por [`cifrar`] no MESMO usuário. `None` = falhou
    /// (blob corrompido, ou de outro usuário/máquina).
    pub fn decifrar(dados: &[u8]) -> Option<Vec<u8>> {
        let mut entrada = dados.to_vec();
        let mut inb = DATA_BLOB {
            cbData: entrada.len() as u32,
            pbData: entrada.as_mut_ptr(),
        };
        let mut outb = DATA_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        // SAFETY: mesmas invariantes de `cifrar` — `inb` vivo, `outb` é do SO e só
        // lido/liberado quando `ok != 0`, demais ponteiros NULL conforme a doc.
        let ok = unsafe {
            CryptUnprotectData(
                &mut inb,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
                &mut outb,
            )
        };
        (ok != 0).then(|| saida_para_vec(&outb))
    }
}

// #1073 (RB10): stub SÓ pra dev/CI fora do Windows — o app é Windows-only em produção;
// nenhum build de release passa por aqui. DPAPI não existe fora do Windows.
//
// #1057 (SEC12): FAIL-CLOSED. Antes era passthrough (identidade), então qualquer
// segredo passado era gravado EM CLARO — enquanto comentários afirmam que a sessão
// está "protegida por DPAPI". Um build de portabilidade/dev/CI vazaria o refresh_token
// OAuth legível. Agora, sem backend de cifra real, `cifrar` devolve `None` (não cifra)
// e `decifrar` devolve `None` (não há blob válido). Os chamadores JÁ tratam `None` como
// "não persiste / indisponível" — é o MESMO caminho de quando a `CryptProtectData` do
// Windows falha (telemetry `match`, auth `match`/`?`, lock_screen `ok_or_else`/`?`),
// então nada persiste segredo sem cifra de verdade.
#[cfg(not(windows))]
mod imp {
    /// Fail-closed dev-only: sem DPAPI fora do Windows, NÃO cifra → `None` (nunca
    /// devolve o segredo em claro). #1057 SEC12.
    pub fn cifrar(_dados: &[u8]) -> Option<Vec<u8>> {
        None
    }
    /// Fail-closed dev-only: sem backend de cifra, não há blob válido a decifrar →
    /// `None`. #1057 SEC12.
    pub fn decifrar(_dados: &[u8]) -> Option<Vec<u8>> {
        None
    }
}

pub(crate) use imp::{cifrar, decifrar};

// SEC12 (#1057): fora do Windows o stub é FAIL-CLOSED — nunca devolve segredo em claro.
// Roda em qualquer build/CI não-Windows; se alguém reintroduzir o passthrough
// (`Some(dados.to_vec())`), estes testes falham. (No Windows o `imp` real é coberto
// pelo teste de round-trip em `lock_screen.rs`.)
#[cfg(all(test, not(windows)))]
mod testes_fail_closed {
    #[test]
    fn cifrar_fora_do_windows_nunca_devolve_claro() {
        let segredo = b"refresh_token_super_secreto";
        assert_eq!(super::cifrar(segredo), None);
        // Explícito: NUNCA o segredo (embrulhado ou não) — o bug antigo era exatamente
        // `Some(segredo.to_vec())`.
        assert_ne!(super::cifrar(segredo), Some(segredo.to_vec()));
    }

    #[test]
    fn decifrar_fora_do_windows_e_none() {
        assert_eq!(super::decifrar(b"qualquer-bytes"), None);
    }
}
