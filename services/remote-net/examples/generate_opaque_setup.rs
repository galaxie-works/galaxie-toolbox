use std::{env, fs::OpenOptions, io::Write, path::PathBuf};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use galaxie_remote_net::opaque::ServerSecrets;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let destination = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: generate_opaque_setup <destination-secret-file>")?;
    let setup = ServerSecrets::generate();
    let encoded = STANDARD.encode(setup.serialize().as_slice());
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(destination)?;
    file.write_all(encoded.as_bytes())?;
    Ok(())
}
