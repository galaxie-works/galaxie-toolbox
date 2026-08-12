//! Engine de file transfer sobre o DataChannel (S5, #688). `FileSender` fatia o
//! arquivo em pedaços; `FileReceiver` reassembla no destino — com progresso,
//! resume (por offset) e conflito de nome. Núcleo testável (I/O de disco puro,
//! sem str0m/rede).

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// Lê um arquivo em pedaços pra enviar pelo DataChannel. `resume_from` retoma um
/// envio interrompido (o receptor informa quanto já tem).
pub struct FileSender {
    file: File,
    chunk_size: usize,
    offset: u64,
    size: u64,
}

impl FileSender {
    pub fn abrir(path: &Path, chunk_size: usize, resume_from: u64) -> std::io::Result<Self> {
        let mut file = File::open(path)?;
        let size = file.metadata()?.len();
        if resume_from > 0 {
            file.seek(SeekFrom::Start(resume_from))?;
        }
        Ok(Self {
            file,
            chunk_size: chunk_size.max(1),
            offset: resume_from,
            size,
        })
    }

    pub fn size(&self) -> u64 {
        self.size
    }

    /// Próximo pedaço `(offset, bytes)`; `None` no fim do arquivo.
    pub fn proximo(&mut self) -> std::io::Result<Option<(u64, Vec<u8>)>> {
        let mut buf = vec![0u8; self.chunk_size];
        let n = self.file.read(&mut buf)?;
        if n == 0 {
            return Ok(None);
        }
        buf.truncate(n);
        let off = self.offset;
        self.offset += n as u64;
        Ok(Some((off, buf)))
    }
}

/// Recebe pedaços e escreve no destino. Resolve conflito de nome (a não ser em
/// resume) e acompanha o progresso.
pub struct FileReceiver {
    file: File,
    caminho: PathBuf,
    recebidos: u64,
    size: u64,
}

impl FileReceiver {
    /// Abre o destino em `dir`/`name` — resolvendo conflito, exceto em resume
    /// (`resume_from` > 0), que reabre o mesmo arquivo pra continuar.
    pub fn criar(dir: &Path, name: &str, size: u64, resume_from: u64) -> std::io::Result<Self> {
        let caminho = if resume_from > 0 {
            dir.join(name)
        } else {
            resolver_conflito(dir, name)
        };
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .read(true)
            .truncate(false)
            .open(&caminho)?;
        if resume_from > 0 {
            file.seek(SeekFrom::Start(resume_from))?;
        }
        Ok(Self {
            file,
            caminho,
            recebidos: resume_from,
            size,
        })
    }

    /// Escreve um pedaço na posição `offset` (idempotente por posição).
    pub fn escrever(&mut self, offset: u64, data: &[u8]) -> std::io::Result<()> {
        self.file.seek(SeekFrom::Start(offset))?;
        self.file.write_all(data)?;
        self.recebidos = self.recebidos.max(offset + data.len() as u64);
        Ok(())
    }

    pub fn recebidos(&self) -> u64 {
        self.recebidos
    }
    pub fn size(&self) -> u64 {
        self.size
    }
    pub fn completo(&self) -> bool {
        self.recebidos >= self.size
    }
    pub fn caminho(&self) -> &Path {
        &self.caminho
    }
    pub fn finalizar(&mut self) -> std::io::Result<()> {
        self.file.flush()
    }
}

/// `a.txt` existente → `a (1).txt`, `a (2).txt`… (preserva a extensão). Mesmo
/// esquema do Explorer.
pub fn resolver_conflito(dir: &Path, name: &str) -> PathBuf {
    let alvo = dir.join(name);
    if !alvo.exists() {
        return alvo;
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for n in 1..10_000 {
        let cand = dir.join(format!("{stem} ({n}){ext}"));
        if !cand.exists() {
            return cand;
        }
    }
    dir.join(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn temp_unico() -> PathBuf {
        static N: AtomicU32 = AtomicU32::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("gt-xfer-{}-{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn envia_e_reassembla_identico() {
        let dir = temp_unico();
        let origem = dir.join("origem.bin");
        let conteudo: Vec<u8> = (0..10_000u32).map(|i| (i % 251) as u8).collect();
        std::fs::write(&origem, &conteudo).unwrap();

        let mut sender = FileSender::abrir(&origem, 1024, 0).unwrap();
        let destino = temp_unico();
        let mut receiver = FileReceiver::criar(&destino, "origem.bin", sender.size(), 0).unwrap();

        while let Some((off, data)) = sender.proximo().unwrap() {
            receiver.escrever(off, &data).unwrap();
        }
        receiver.finalizar().unwrap();

        assert!(receiver.completo());
        assert_eq!(receiver.recebidos(), conteudo.len() as u64);
        assert_eq!(std::fs::read(receiver.caminho()).unwrap(), conteudo);

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&destino);
    }

    #[test]
    fn resume_continua_de_onde_parou() {
        let dir = temp_unico();
        let origem = dir.join("grande.bin");
        let conteudo: Vec<u8> = (0..5000u32).map(|i| (i % 97) as u8).collect();
        std::fs::write(&origem, &conteudo).unwrap();
        let destino = temp_unico();

        // 1ª rodada: manda só ~metade.
        let mut s1 = FileSender::abrir(&origem, 512, 0).unwrap();
        let mut r1 = FileReceiver::criar(&destino, "grande.bin", conteudo.len() as u64, 0).unwrap();
        for _ in 0..5 {
            if let Some((off, d)) = s1.proximo().unwrap() {
                r1.escrever(off, &d).unwrap();
            }
        }
        r1.finalizar().unwrap();
        let parcial = r1.recebidos();
        assert!(parcial > 0 && parcial < conteudo.len() as u64);

        // 2ª rodada: resume do offset parcial no MESMO arquivo.
        let mut s2 = FileSender::abrir(&origem, 512, parcial).unwrap();
        let mut r2 =
            FileReceiver::criar(&destino, "grande.bin", conteudo.len() as u64, parcial).unwrap();
        while let Some((off, d)) = s2.proximo().unwrap() {
            r2.escrever(off, &d).unwrap();
        }
        r2.finalizar().unwrap();
        assert!(r2.completo());
        assert_eq!(std::fs::read(r2.caminho()).unwrap(), conteudo);

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&destino);
    }

    #[test]
    fn conflito_de_nome_gera_sufixo() {
        let dir = temp_unico();
        std::fs::write(dir.join("doc.txt"), b"x").unwrap();
        let alvo = resolver_conflito(&dir, "doc.txt");
        assert_eq!(alvo.file_name().unwrap().to_string_lossy(), "doc (1).txt");
        // sem conflito, mantém o nome
        let alvo2 = resolver_conflito(&dir, "novo.txt");
        assert_eq!(alvo2.file_name().unwrap().to_string_lossy(), "novo.txt");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
