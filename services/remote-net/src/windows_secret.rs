//! Machine-bound secret protection for the SYSTEM worker.
//!
//! There is deliberately no plaintext fallback. Callers must fail closed if
//! DPAPI-NG cannot protect or recover the identity material.

use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{
    NCryptCloseProtectionDescriptor, NCryptCreateProtectionDescriptor, NCryptProtectSecret,
    NCryptUnprotectSecret,
};
use windows_sys::Win32::Security::NCRYPT_DESCRIPTOR_HANDLE;

const DESCRIPTOR: &str = "LOCAL=machine";

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("secret is too large")]
    TooLarge,
    #[error("DPAPI-NG failed with HRESULT 0x{0:08x}")]
    Windows(i32),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dpapi_ng_round_trip_is_machine_bound() {
        let protected = protect_machine(b"device private material").unwrap();
        assert_ne!(protected, b"device private material");
        assert_eq!(
            unprotect_machine(&protected).unwrap(),
            b"device private material"
        );
    }
}
