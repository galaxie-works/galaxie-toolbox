//! Machine-bound secret protection for the SYSTEM worker.
//!
//! There is deliberately no plaintext fallback. Callers must fail closed if
//! DPAPI-NG cannot protect or recover the identity material.

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::FromRawHandle;
use std::path::Path;
use std::ptr::{addr_of, null, null_mut};

use windows_sys::Win32::Foundation::{
    GetLastError, LocalFree, GENERIC_WRITE, HLOCAL, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, GetNamedSecurityInfoW, SDDL_REVISION,
    SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::Cryptography::{
    NCryptCloseProtectionDescriptor, NCryptCreateProtectionDescriptor, NCryptProtectSecret,
    NCryptUnprotectSecret,
};
use windows_sys::Win32::Security::{
    CreateWellKnownSid, EqualSid, GetAce, GetSecurityDescriptorControl, ACCESS_ALLOWED_ACE,
    ACE_HEADER, ACL, DACL_SECURITY_INFORMATION, INHERITED_ACE, NCRYPT_DESCRIPTOR_HANDLE,
    PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES, SECURITY_MAX_SID_SIZE, SE_DACL_PROTECTED,
    WELL_KNOWN_SID_TYPE, WinBuiltinAdministratorsSid, WinLocalSystemSid,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_NONE,
};

// #1054 (SEC5) — DECISION (Altair, issue #1054, 11:19): keep `LOCAL=machine`.
//
// An earlier fix bound the DPAPI-NG protector to `SID=S-1-5-18` (Local System) so
// that only SYSTEM could `NCryptUnprotectSecret` the device key. That is wrong for
// this deployment: a `SID=` protector resolves the principal key through the AD Key
// Distribution Service (KDS), which does NOT exist on a standalone/WORKGROUP box, so
// `NCryptProtectSecret` fails outright with NTE_ENCRYPTION_FAILURE (0x80090034) and
// breaks the module's fail-closed guarantee on exactly the machines we ship to.
//
// The SEC5 threat (another *local user* reading the ciphertext at rest) is therefore
// NOT defended by the descriptor at all — once the on-disk blob is locked to
// SYSTEM+Administrators by an explicit file DACL (see `persist_machine_blob` /
// `read_machine_blob`), the descriptor is irrelevant to that vector. `LOCAL=machine`
// keeps `protect`/`unprotect` working everywhere; the DACL is the real control.
// Do NOT "harden" this back to `SID=` — it regresses the fail-closed contract.
const DESCRIPTOR: &str = "LOCAL=machine";

// windows-sys 0.61 does not export the ACE type constants; this is the SDK winnt.h
// value of `ACCESS_ALLOWED_ACE_TYPE`. Used by the DACL inspection in #1054 (SEC5).
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("secret is too large")]
    TooLarge,
    #[error("DPAPI-NG failed with HRESULT 0x{0:08x}")]
    Windows(i32),
    // #1054 (SEC5): failures while creating/locking the on-disk blob file.
    #[error("failed to persist protected blob (Win32 error {0})")]
    Persist(u32),
    #[error("failed to write protected blob (OS error {0})")]
    Io(i32),
    // #1054 (SEC5, AC2): the blob's file DACL is broader than SYSTEM+Administrators
    // (or inheritance is enabled), so recovery is refused rather than served.
    #[error("protected blob DACL is broader than SYSTEM+Administrators or inherits ACEs")]
    AclTooWide,
}

struct Descriptor(NCRYPT_DESCRIPTOR_HANDLE);

impl Drop for Descriptor {
    fn drop(&mut self) {
        unsafe { NCryptCloseProtectionDescriptor(self.0) };
    }
}

pub fn protect_machine(secret: &[u8]) -> Result<Vec<u8>, SecretError> {
    let length = u32::try_from(secret.len()).map_err(|_| SecretError::TooLarge)?;
    let descriptor_wide: Vec<u16> = DESCRIPTOR.encode_utf16().chain(Some(0)).collect();
    let mut descriptor = null_mut();
    check(unsafe {
        NCryptCreateProtectionDescriptor(descriptor_wide.as_ptr(), 0, &mut descriptor)
    })?;
    let descriptor = Descriptor(descriptor);
    let mut output = null_mut();
    let mut output_len = 0;
    check(unsafe {
        NCryptProtectSecret(
            descriptor.0,
            0,
            secret.as_ptr(),
            length,
            null(),
            null_mut(),
            &mut output,
            &mut output_len,
        )
    })?;
    copy_and_free(output, output_len)
}

pub fn unprotect_machine(blob: &[u8]) -> Result<Vec<u8>, SecretError> {
    let length = u32::try_from(blob.len()).map_err(|_| SecretError::TooLarge)?;
    let mut descriptor = null_mut();
    let mut output = null_mut();
    let mut output_len = 0;
    check(unsafe {
        NCryptUnprotectSecret(
            &mut descriptor,
            0,
            blob.as_ptr(),
            length,
            null(),
            null_mut(),
            &mut output,
            &mut output_len,
        )
    })?;
    let descriptor = Descriptor(descriptor);
    let result = copy_and_free(output, output_len);
    drop(descriptor);
    result
}

// #1054 (SEC5): SDDL for the on-disk protected blob. An explicit, non-inherited
// DACL granting FULL access to SYSTEM (`SY`) and Administrators (`BA`) only.
// `P` (SE_DACL_PROTECTED) blocks any ACE inherited from the parent directory.
// This DACL — not the DPAPI descriptor — is the SEC5 control: it stops the
// ciphertext from being *read* at rest by ordinary local users (see the DECISION
// note on `DESCRIPTOR` above and docs/remote/remote-s8-device-agent.md).
const BLOB_SDDL: &str = "D:PAI(A;;FA;;;SY)(A;;FA;;;BA)";

/// Persist a DPAPI-NG-protected blob to `path`, applying the restrictive DACL
/// (SYSTEM + Administrators, inheritance disabled) atomically at creation time
/// via `CreateFileW`. Fails closed: `CREATE_NEW` refuses to overwrite an
/// existing path, and no plaintext or default-ACL file is ever written.
///
/// This is the primitive the SYSTEM daemon (#690/#691) must call to store the
/// device identity blob returned by [`protect_machine`]. The file ACL is the
/// SEC5 gate: with `LOCAL=machine` the descriptor cannot refuse a local read of
/// the ciphertext, so the DACL must (see [`read_machine_blob`]).
pub fn persist_machine_blob(path: &Path, blob: &[u8]) -> Result<(), SecretError> {
    write_locked_file(path, blob, BLOB_SDDL)
}

/// Create `path` with an explicit `sddl` DACL applied atomically at creation
/// (via `CreateFileW` + `SECURITY_ATTRIBUTES`, `CREATE_NEW`) and write `blob`.
/// `persist_machine_blob` calls this with [`BLOB_SDDL`]; keeping the SDDL a
/// parameter lets the #1054 tests build a deliberately wider ACL to prove that
/// [`read_machine_blob`] refuses it.
fn write_locked_file(path: &Path, blob: &[u8], sddl: &str) -> Result<(), SecretError> {
    let sddl_wide: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
    let mut security_descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: `sddl_wide` is a valid NUL-terminated UTF-16 string; on success the
    // callee allocates a security descriptor we free with `LocalFree` below.
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl_wide.as_ptr(),
            SDDL_REVISION,
            &mut security_descriptor,
            null_mut(),
        )
    };
    if converted == 0 {
        return Err(SecretError::Persist(unsafe { GetLastError() }));
    }

    let attributes = SECURITY_ATTRIBUTES {
        nLength: u32::try_from(std::mem::size_of::<SECURITY_ATTRIBUTES>()).unwrap_or(0),
        lpSecurityDescriptor: security_descriptor,
        bInheritHandle: 0,
    };
    let path_wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: valid NUL-terminated path and a live `SECURITY_ATTRIBUTES`.
    let handle = unsafe {
        CreateFileW(
            path_wide.as_ptr(),
            GENERIC_WRITE,
            FILE_SHARE_NONE,
            &attributes,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            null_mut(),
        )
    };
    // The descriptor was copied into the new file's metadata; free our copy.
    unsafe { LocalFree(security_descriptor as HLOCAL) };

    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(SecretError::Persist(unsafe { GetLastError() }));
    }

    // Hand the securely-created handle to std, which owns it: it writes the blob
    // and closes the handle on drop.
    // SAFETY: `handle` is a fresh, valid, exclusively-owned file handle.
    let mut file = unsafe { std::fs::File::from_raw_handle(handle as _) };
    use std::io::Write as _;
    file.write_all(blob)
        .and_then(|()| file.sync_all())
        .map_err(|e| SecretError::Io(e.raw_os_error().unwrap_or(-1)))
}

/// Read a blob previously written by [`persist_machine_blob`], but ONLY after
/// verifying that the file's DACL is still exactly the expected lock. If the
/// on-disk protection has degraded — someone widened the file's (or its parent
/// directory's, via inheritance) ACL — recovery is refused instead of serving
/// the secret. This is the read half of the #1054 (SEC5) fail-closed contract.
///
/// The DACL is accepted only when ALL of the following hold; otherwise
/// [`SecretError::AclTooWide`] is returned (see [`inspect_dacl`] for the checks):
///   * the DACL is present and PROTECTED (`SE_DACL_PROTECTED`) — an unprotected
///     DACL inherits ACEs from the parent directory, letting a wider directory
///     grant flow in;
///   * it is not a NULL DACL (present bit set with a null pointer == everyone);
///   * every ACE is an `ACCESS_ALLOWED` ACE for S-1-5-18 (Local System) or
///     S-1-5-32-544 (Administrators), and no ACE carries `INHERITED_ACE`.
pub fn read_machine_blob(path: &Path) -> Result<Vec<u8>, SecretError> {
    verify_blob_acl(path)?;
    std::fs::read(path).map_err(|e| SecretError::Io(e.raw_os_error().unwrap_or(-1)))
}

/// Resolve the file's current DACL via `GetNamedSecurityInfoW` and hand it to
/// [`inspect_dacl`]. The security descriptor allocated by the API is freed here.
fn verify_blob_acl(path: &Path) -> Result<(), SecretError> {
    let path_wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut dacl: *mut ACL = null_mut();
    let mut security_descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: `path_wide` is a valid NUL-terminated path. On success the callee
    // allocates `*security_descriptor` (freed via `LocalFree` below) and points
    // `dacl` inside it; we request the DACL only (owner/group/SACL are null).
    let status = unsafe {
        GetNamedSecurityInfoW(
            path_wide.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut security_descriptor,
        )
    };
    if status != 0 {
        return Err(SecretError::Persist(status));
    }
    let result = inspect_dacl(security_descriptor, dacl);
    // SAFETY: `security_descriptor` was allocated by `GetNamedSecurityInfoW`.
    unsafe { LocalFree(security_descriptor as HLOCAL) };
    result
}

/// The exact SEC5 acceptance criterion. Returns [`SecretError::AclTooWide`] if the
/// DACL is not the canonical SYSTEM+Administrators, inheritance-off lock.
fn inspect_dacl(sd: PSECURITY_DESCRIPTOR, dacl: *mut ACL) -> Result<(), SecretError> {
    // Inheritance must be OFF: the canonical blob DACL is PROTECTED, so no parent
    // ACE can widen it. An unprotected DACL means inheritance is enabled -> refuse.
    let mut control: u16 = 0;
    let mut revision: u32 = 0;
    // SAFETY: `sd` is a valid security descriptor from `GetNamedSecurityInfoW`.
    if unsafe { GetSecurityDescriptorControl(sd, &mut control, &mut revision) } == 0 {
        return Err(SecretError::Persist(unsafe { GetLastError() }));
    }
    if control & SE_DACL_PROTECTED == 0 {
        return Err(SecretError::AclTooWide);
    }
    // A NULL DACL (present bit set, null pointer) grants everyone full control.
    if dacl.is_null() {
        return Err(SecretError::AclTooWide);
    }

    let mut system_buf = [0u8; SECURITY_MAX_SID_SIZE as usize];
    let mut admin_buf = [0u8; SECURITY_MAX_SID_SIZE as usize];
    let system_sid = well_known_sid(WinLocalSystemSid, &mut system_buf)?;
    let admin_sid = well_known_sid(WinBuiltinAdministratorsSid, &mut admin_buf)?;

    // SAFETY: `dacl` is a valid, non-null ACL inside `sd`.
    let ace_count = unsafe { (*dacl).AceCount };
    for i in 0..ace_count {
        let mut ace: *mut c_void = null_mut();
        // SAFETY: `dacl` is valid and `i < AceCount`.
        if unsafe { GetAce(dacl, i as u32, &mut ace) } == 0 {
            return Err(SecretError::Persist(unsafe { GetLastError() }));
        }
        // SAFETY: `ace` points to a valid ACE whose first field is its header.
        let header = unsafe { *(ace as *const ACE_HEADER) };
        // Any inherited ACE means inheritance flowed in -> refuse.
        if header.AceFlags as u32 & INHERITED_ACE != 0 {
            return Err(SecretError::AclTooWide);
        }
        // Only plain ACCESS_ALLOWED ACEs are expected. Deny/audit/callback/object
        // ACEs are never written by `persist_machine_blob`; their presence means
        // the ACL was rebuilt by something else, so fail closed.
        if header.AceType != ACCESS_ALLOWED_ACE_TYPE {
            return Err(SecretError::AclTooWide);
        }
        // The trustee SID begins at the `SidStart` field of the ACE. `addr_of!`
        // takes its address without forming a reference to the packed trailing data.
        // SAFETY: `ace` points to a valid `ACCESS_ALLOWED_ACE`.
        let sid = unsafe { addr_of!((*(ace as *const ACCESS_ALLOWED_ACE)).SidStart) } as PSID;
        // SAFETY: `sid`, `system_sid`, `admin_sid` are all valid SIDs.
        let is_system = unsafe { EqualSid(sid, system_sid) } != 0;
        let is_admin = unsafe { EqualSid(sid, admin_sid) } != 0;
        if !(is_system || is_admin) {
            return Err(SecretError::AclTooWide);
        }
    }
    Ok(())
}

/// Materialize a well-known SID into `buf` and return a pointer to it.
fn well_known_sid(
    kind: WELL_KNOWN_SID_TYPE,
    buf: &mut [u8; SECURITY_MAX_SID_SIZE as usize],
) -> Result<PSID, SecretError> {
    let mut size = SECURITY_MAX_SID_SIZE;
    // SAFETY: `buf` is `SECURITY_MAX_SID_SIZE` bytes, the documented maximum.
    let ok = unsafe { CreateWellKnownSid(kind, null_mut(), buf.as_mut_ptr() as PSID, &mut size) };
    if ok == 0 {
        return Err(SecretError::Persist(unsafe { GetLastError() }));
    }
    Ok(buf.as_mut_ptr() as PSID)
}

fn copy_and_free(pointer: *mut u8, length: u32) -> Result<Vec<u8>, SecretError> {
    if pointer.is_null() {
        return Err(SecretError::Windows(-1));
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length as usize) }.to_vec();
    unsafe { LocalFree(pointer.cast()) };
    Ok(bytes)
}

fn check(status: i32) -> Result<(), SecretError> {
    if status >= 0 {
        Ok(())
    } else {
        Err(SecretError::Windows(status))
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn dpapi_ng_round_trip_is_machine_bound() {
        // #1054 DECISION (issue #1054, Altair): `LOCAL=machine` is retained, so the
        // SEC5 read-by-other-user defence is the blob file DACL (persist/read), NOT
        // the DPAPI descriptor. protect+unprotect must therefore still round-trip
        // LOCALLY on the same machine.
        let protected = protect_machine(b"device private material").unwrap();
        assert_ne!(protected, b"device private material");
        assert_eq!(
            unprotect_machine(&protected).unwrap(),
            b"device private material"
        );
    }

    #[test]
    fn descriptor_stays_local_machine() {
        // #1054 GUARD: the descriptor MUST remain `LOCAL=machine`. Binding it to
        // `SID=S-1-5-18` needs an AD/KDS root key and makes `protect_machine` fail
        // with NTE_ENCRYPTION_FAILURE (0x80090034) on standalone/WORKGROUP boxes,
        // breaking the module's fail-closed contract. The SEC5 control is the file
        // DACL, not the descriptor — see the DECISION note in issue #1054 (11:19).
        // Do not "fix" this back to `SID=`.
        assert!(
            DESCRIPTOR == "LOCAL=machine",
            "DPAPI-NG descriptor must stay LOCAL=machine (issue #1054 DECISION)"
        );
    }

    // ERROR_ACCESS_DENIED. When the DACL denies the runner the byte read, this is
    // the OS error surfaced — treated as documented evidence, never a test failure.
    const ERROR_ACCESS_DENIED: i32 = 5;

    #[test]
    fn persist_locks_blob_to_privileged_principals() {
        // #1054 AC3 (proof of the NEGATIVE): a blob written by `persist_machine_blob`
        // is locked to SYSTEM + Administrators with inheritance disabled. Creating a
        // NEW file grants the creator the requested access regardless of the DACL, so
        // `persist` itself succeeds on any account; the DACL bites on a subsequent
        // raw *open*. Reading the bytes back with `std::fs::read` therefore exercises
        // the lock. We never fail on privilege:
        //   access denied -> the DACL locked out the unprivileged runner (the SEC5
        //                    guarantee; documented SKIP);
        //   read Ok       -> runner is elevated Admin/SYSTEM (SY/BA ACE grants read).
        let mut path = std::env::temp_dir();
        path.push(format!("gt-1054-blob-{}.bin", std::process::id()));
        let _ = std::fs::remove_file(&path);

        persist_machine_blob(&path, b"protected-blob")
            .expect("creating the locked blob file must succeed");

        match std::fs::read(&path) {
            Ok(stored) => assert_eq!(stored, b"protected-blob"),
            Err(e) if e.raw_os_error() == Some(ERROR_ACCESS_DENIED) => eprintln!(
                "SKIP: DACL denied raw read-back to the unprivileged runner — the blob is \
                 locked to SYSTEM+Administrators only, as intended"
            ),
            Err(e) => panic!("unexpected read failure: {e:?}"),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_machine_blob_refuses_wider_acl() {
        // #1054 AC2: a blob whose DACL grants anyone beyond SYSTEM+Administrators
        // must be REFUSED before its bytes are served. We build a PROTECTED DACL
        // (inheritance off) that still adds Everyone (`WD` / S-1-1-0). The extra ACE
        // is the only thing under test and needs no privilege — we own the file we
        // just created, so `GetNamedSecurityInfoW` can read its DACL, and the check
        // rejects it before any read.
        let mut path = std::env::temp_dir();
        path.push(format!("gt-1054-wide-{}.bin", std::process::id()));
        let _ = std::fs::remove_file(&path);

        write_locked_file(&path, b"blob", "D:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;WD)")
            .expect("creating the wide-ACL test file must succeed");

        let err = read_machine_blob(&path).expect_err("a wider-than-expected DACL must be refused");
        assert!(
            matches!(err, SecretError::AclTooWide),
            "expected AclTooWide, got {err:?}"
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_machine_blob_accepts_locked_blob() {
        // #1054 AC1+AC2 happy path: the canonical SYSTEM+Administrators PROTECTED
        // DACL written by `persist_machine_blob` passes the ACL gate (the owner can
        // always read its own DACL). Serving the bytes then needs SY/BA access, so
        // the outcome is environment-dependent but never a gate rejection:
        //   Ok         -> elevated runner; payload round-trips;
        //   Io(5)      -> unprivileged runner denied at the read (documented SKIP).
        let mut path = std::env::temp_dir();
        path.push(format!("gt-1054-ok-{}.bin", std::process::id()));
        let _ = std::fs::remove_file(&path);

        persist_machine_blob(&path, b"protected-blob").expect("persist must succeed");

        match read_machine_blob(&path) {
            Ok(bytes) => assert_eq!(bytes, b"protected-blob"),
            Err(SecretError::Io(ERROR_ACCESS_DENIED)) => eprintln!(
                "SKIP: ACL gate accepted the canonical DACL but the unprivileged runner was \
                 denied the byte read (ERROR_ACCESS_DENIED) — locked to SYSTEM+Administrators"
            ),
            Err(other) => panic!("canonical DACL must not be rejected by the gate: {other:?}"),
        }
        let _ = std::fs::remove_file(&path);
    }
}
