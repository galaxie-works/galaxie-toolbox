//! Explorer de Arquivos local — backend read-only (#676, épico #675).
//!
//! Comandos de filesystem TIPADOS: o front distingue permissão-negada de
//! não-existe pelo `code` do [`FsError`] (nunca `String` solta). Leitura
//! pastas-primeiro, long-path no Windows (>260 chars), e stream de pasta
//! gigante via evento `fs-dir-batch` (single-shot congela em 100k itens).
//!
//! S0 é só leitura — `notify`/`trash`/mutações entram nas próximas stories.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

// ─────────────────────────────── Tipos ──────────────────────────────────────

/// Erro de FS tipado. `#[serde(tag="code", content="message")]` serializa como
/// `{ "code": "PermissionDenied", "message": "…" }` — o front trata cada caso.
#[derive(Debug, Clone, thiserror::Error, Serialize)]
#[serde(tag = "code", content = "message")]
pub enum FsError {
    #[error("não encontrado: {0}")]
    NotFound(String),
    #[error("permissão negada: {0}")]
    PermissionDenied(String),
    #[error("já existe: {0}")]
    AlreadyExists(String),
    #[error("não é um diretório: {0}")]
    NotADirectory(String),
    #[error("erro de I/O: {0}")]
    Io(String),
    #[error("caminho inválido: {0}")]
    InvalidPath(String),
    #[error("verificação falhou (cópia corrompida): {0}")]
    VerifyMismatch(String),
}

impl From<std::io::Error> for FsError {
    fn from(e: std::io::Error) -> Self {
        use std::io::ErrorKind;
        let msg = e.to_string();
        match e.kind() {
            ErrorKind::NotFound => FsError::NotFound(msg),
            ErrorKind::PermissionDenied => FsError::PermissionDenied(msg),
            ErrorKind::AlreadyExists => FsError::AlreadyExists(msg),
            _ => FsError::Io(msg),
        }
    }
}

/// Uma entrada do diretório. `camelCase` no serde — o front recebe `isDir`,
/// `modifiedMs`, etc. direto, sem tradução.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified_ms: Option<i64>,
    pub created_ms: Option<i64>,
    pub extension: Option<String>,
    pub is_hidden: bool,
    pub is_readonly: bool,
}

/// Um drive montado (letra no Windows) com espaço e tipo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub path: String,
    pub name: String,
    /// `fixed` | `removable` | `network` | `cdrom` | `ramdisk` | `unknown`.
    pub kind: String,
    // Contrato congelado com o S1 (#677/Vega): `totalSpace`/`freeSpace`.
    pub total_space: u64,
    pub free_space: u64,
}

/// Tamanho agregado de uma pasta (varredura recursiva com `jwalk`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirSize {
    pub path: String,
    pub total_bytes: u64,
    pub file_count: u64,
    pub dir_count: u64,
}

/// Lote emitido por [`fs_read_dir_streamed`] no evento `fs-dir-batch`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsDirBatch {
    path: String,
    entries: Vec<FsEntry>,
    done: bool,
}

// ─────────────────────────── Helpers de caminho ─────────────────────────────

/// Prefixa `\\?\` (path *verbatim*) num caminho absoluto do Windows pra vencer o
/// limite de 260 chars — sem isso `read_dir` falha em caminho que o Explorer
/// abre. Idempotente; converte UNC (`\\srv\share`) pra `\\?\UNC\srv\share`.
/// No-op fora do Windows e em caminho relativo.
#[cfg(windows)]
fn com_long_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if s.starts_with(r"\\?\") || s.starts_with(r"\\.\") {
        return path.to_path_buf();
    }
    if let Some(resto) = s.strip_prefix(r"\\") {
        return PathBuf::from(format!(r"\\?\UNC\{resto}"));
    }
    if path.is_absolute() {
        return PathBuf::from(format!(r"\\?\{s}"));
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
fn com_long_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// Remove o prefixo verbatim `\\?\` (e `\\?\UNC\` → `\\`) pra o front receber o
/// caminho "limpo" que ele mesmo pode re-consultar.
fn caminho_limpo(path: &Path) -> String {
    let s = path.to_string_lossy();
    if let Some(unc) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc}");
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    s.into_owned()
}

fn tempo_ms(t: Option<SystemTime>) -> Option<i64> {
    t.and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

/// Oculto = atributo HIDDEN/SYSTEM no Windows, ou nome começando com `.`.
#[cfg(windows)]
fn eh_oculto(path: &Path, meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    meta.file_attributes() & (HIDDEN | SYSTEM) != 0 || nome_comeca_com_ponto(path)
}

#[cfg(not(windows))]
fn eh_oculto(path: &Path, _meta: &std::fs::Metadata) -> bool {
    nome_comeca_com_ponto(path)
}

fn nome_comeca_com_ponto(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.'))
        .unwrap_or(false)
}

/// Monta um [`FsEntry`] a partir do caminho + metadata. `is_symlink` vem do
/// `file_type` da entrada (o metadata pode ser o do alvo).
fn entry_de(path: &Path, meta: &std::fs::Metadata, is_symlink: bool) -> FsEntry {
    let is_dir = meta.is_dir();
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| caminho_limpo(path));
    FsEntry {
        name,
        path: caminho_limpo(path),
        is_dir,
        is_symlink,
        size: if is_dir { 0 } else { meta.len() },
        modified_ms: tempo_ms(meta.modified().ok()),
        created_ms: tempo_ms(meta.created().ok()),
        extension: if is_dir {
            None
        } else {
            path.extension().map(|e| e.to_string_lossy().into_owned())
        },
        is_hidden: eh_oculto(path, meta),
        is_readonly: meta.permissions().readonly(),
    }
}

// ─────────────────────────────── Núcleo ─────────────────────────────────────

/// Rejeita caminho vazio antes de tocar o disco (distinto de NotFound).
fn validar(path: &str) -> Result<(), FsError> {
    if path.trim().is_empty() {
        return Err(FsError::InvalidPath("caminho vazio".into()));
    }
    Ok(())
}

/// Lê um diretório, pastas-primeiro. `filter_map` pula entrada com erro (uma
/// permissão negada num item não derruba a listagem inteira).
fn ler_dir(path: &str) -> Result<Vec<FsEntry>, FsError> {
    use rayon::prelude::*;

    validar(path)?;
    let base = Path::new(path);
    let meta = std::fs::metadata(com_long_path(base))?;
    if !meta.is_dir() {
        return Err(FsError::NotADirectory(path.to_string()));
    }

    let entradas: Vec<std::fs::DirEntry> = std::fs::read_dir(com_long_path(base))?
        .filter_map(Result::ok)
        .collect();

    let mut itens: Vec<FsEntry> = entradas
        .par_iter()
        .filter_map(|e| {
            let p = e.path();
            let ft = e.file_type().ok()?;
            let m = e.metadata().ok()?;
            Some(entry_de(&p, &m, ft.is_symlink()))
        })
        .collect();

    ordenar(&mut itens);
    Ok(itens)
}

/// Pastas-primeiro; dentro de cada grupo, por nome (case-insensitive).
fn ordenar(itens: &mut [FsEntry]) {
    itens.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

/// Streaming pra pasta gigante: emite `fs-dir-batch` a cada `batch` entradas.
/// Não ordena (o front ordena ao receber) — o ponto é não segurar 100k itens
/// na memória nem travar o boot da listagem. Retorna o total emitido.
fn ler_dir_streamed(path: &str, batch: usize, app: &AppHandle) -> Result<u64, FsError> {
    validar(path)?;
    let base = Path::new(path);
    let meta = std::fs::metadata(com_long_path(base))?;
    if !meta.is_dir() {
        return Err(FsError::NotADirectory(path.to_string()));
    }

    let batch = batch.max(1);
    let mut buffer: Vec<FsEntry> = Vec::with_capacity(batch);
    let mut total = 0u64;

    for r in std::fs::read_dir(com_long_path(base))? {
        let Ok(e) = r else { continue };
        let p = e.path();
        let Ok(ft) = e.file_type() else { continue };
        let Ok(m) = e.metadata() else { continue };
        buffer.push(entry_de(&p, &m, ft.is_symlink()));
        total += 1;
        if buffer.len() >= batch {
            let lote = std::mem::take(&mut buffer);
            let _ = app.emit(
                "fs-dir-batch",
                FsDirBatch { path: path.to_string(), entries: lote, done: false },
            );
        }
    }

    // Lote final + sinal de fim (mesmo vazio, pra o front fechar o loading).
    let _ = app.emit(
        "fs-dir-batch",
        FsDirBatch { path: path.to_string(), entries: buffer, done: true },
    );
    Ok(total)
}

fn stat(path: &str) -> Result<FsEntry, FsError> {
    validar(path)?;
    let p = Path::new(path);
    let lp = com_long_path(p);
    let sm = std::fs::symlink_metadata(&lp)?;
    let is_symlink = sm.file_type().is_symlink();
    // Symlink → tenta o metadata do ALVO (is_dir/size corretos); se quebrado,
    // cai no do próprio link.
    let meta = if is_symlink {
        std::fs::metadata(&lp).unwrap_or(sm)
    } else {
        sm
    };
    Ok(entry_de(p, &meta, is_symlink))
}

fn tamanho_dir(path: &str) -> Result<DirSize, FsError> {
    validar(path)?;
    let base = Path::new(path);
    let meta = std::fs::metadata(com_long_path(base))?;
    if !meta.is_dir() {
        return Err(FsError::NotADirectory(path.to_string()));
    }

    let (mut total, mut files, mut dirs) = (0u64, 0u64, 0u64);
    // `jwalk` paraleliza a varredura; não segue symlink por padrão (sem loop).
    for entrada in jwalk::WalkDir::new(com_long_path(base)).skip_hidden(false) {
        let Ok(e) = entrada else { continue };
        let Ok(m) = std::fs::symlink_metadata(e.path()) else { continue };
        if m.is_dir() {
            dirs += 1;
        } else {
            files += 1;
            total += m.len();
        }
    }

    Ok(DirSize {
        path: caminho_limpo(base),
        total_bytes: total,
        file_count: files,
        // A raiz entra na contagem de dirs; desconto pra ficarem só os filhos.
        dir_count: dirs.saturating_sub(1),
    })
}

/// Pastas de acesso rápido (home/desktop/documentos/downloads) que existem.
fn dirs_conhecidos() -> Vec<FsEntry> {
    [
        dirs::home_dir(),
        dirs::desktop_dir(),
        dirs::document_dir(),
        dirs::download_dir(),
    ]
    .into_iter()
    .flatten()
    .filter_map(|p| std::fs::metadata(&p).ok().map(|m| entry_de(&p, &m, false)))
    .collect()
}

// ─────────────────────────────── Drives ─────────────────────────────────────

#[cfg(windows)]
fn listar_drives() -> Result<Vec<DriveInfo>, FsError> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
    };

    let mask = unsafe { GetLogicalDrives() };
    if mask == 0 {
        return Err(FsError::Io("GetLogicalDrives falhou".into()));
    }

    let mut drives = Vec::new();
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letra = (b'A' + i as u8) as char;
        let raiz = format!("{letra}:\\");
        let wide: Vec<u16> = raiz.encode_utf16().chain(std::iter::once(0)).collect();
        let pcw = PCWSTR(wide.as_ptr());

        let kind = match unsafe { GetDriveTypeW(pcw) } {
            2 => "removable",
            3 => "fixed",
            4 => "network",
            5 => "cdrom",
            6 => "ramdisk",
            _ => "unknown",
        };

        let (mut total, mut free) = (0u64, 0u64);
        let _ = unsafe {
            GetDiskFreeSpaceExW(pcw, None, Some(&mut total as *mut u64), Some(&mut free as *mut u64))
        };

        // Label do volume (best-effort — drive vazio/sem mídia fica sem nome).
        let mut label = [0u16; 261];
        let mut nome = String::new();
        if unsafe { GetVolumeInformationW(pcw, Some(&mut label), None, None, None, None) }.is_ok() {
            let fim = label.iter().position(|&c| c == 0).unwrap_or(label.len());
            nome = String::from_utf16_lossy(&label[..fim]);
        }

        drives.push(DriveInfo {
            path: raiz,
            name: nome,
            kind: kind.to_string(),
            total_space: total,
            free_space: free,
        });
    }
    Ok(drives)
}

#[cfg(not(windows))]
fn listar_drives() -> Result<Vec<DriveInfo>, FsError> {
    // Fora do Windows (dev/CI) devolve a raiz como um "drive" só.
    let meta = std::fs::metadata("/")?;
    let _ = meta;
    Ok(vec![DriveInfo {
        path: "/".into(),
        name: String::new(),
        kind: "fixed".into(),
        total_space: 0,
        free_space: 0,
    }])
}

// ────────────────────────── Mutações (S3, #679) ─────────────────────────────
// Delete → Lixeira é o PADRÃO (reversível); permanente só com token de
// confirmação (o front manda depois do Shift+confirmar). Tudo tipado em FsError.

/// Token que o front envia pra confirmar exclusão PERMANENTE. Sem ele,
/// `excluir_permanente` recusa — trava contra apagar sem querer.
pub const TOKEN_EXCLUSAO_PERMANENTE: &str = "galaxie-excluir-permanente";

fn criar_dir(path: &str) -> Result<(), FsError> {
    validar(path)?;
    // `create_dir` (não `_all`) → AlreadyExists se a pasta já existe.
    std::fs::create_dir(com_long_path(Path::new(path)))?;
    Ok(())
}

fn criar_arquivo(path: &str, contents: Option<String>) -> Result<(), FsError> {
    use std::io::Write;
    validar(path)?;
    // `create_new` é atômico: erra AlreadyExists sem sobrescrever.
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(com_long_path(Path::new(path)))?;
    if let Some(c) = contents {
        f.write_all(c.as_bytes())?;
    }
    Ok(())
}

fn renomear(from: &str, to: &str) -> Result<(), FsError> {
    validar(from)?;
    validar(to)?;
    let dest = com_long_path(Path::new(to));
    if dest.exists() {
        return Err(FsError::AlreadyExists(to.to_string()));
    }
    std::fs::rename(com_long_path(Path::new(from)), dest)?;
    Ok(())
}

/// Copia arquivo (std) ou pasta (recursiva + paralela via rayon). Conflito de
/// arquivo no destino → AlreadyExists.
fn copiar(from: &str, to: &str) -> Result<(), FsError> {
    validar(from)?;
    validar(to)?;
    let src = Path::new(from);
    let dst = Path::new(to);
    if std::fs::symlink_metadata(com_long_path(src))?.is_dir() {
        copiar_dir(src, dst)
    } else {
        if com_long_path(dst).exists() {
            return Err(FsError::AlreadyExists(to.to_string()));
        }
        std::fs::copy(com_long_path(src), com_long_path(dst))?;
        Ok(())
    }
}

fn copiar_dir(src: &Path, dst: &Path) -> Result<(), FsError> {
    use rayon::prelude::*;
    std::fs::create_dir_all(com_long_path(dst))?;
    let entradas: Vec<std::fs::DirEntry> = std::fs::read_dir(com_long_path(src))?
        .filter_map(Result::ok)
        .collect();
    entradas.par_iter().try_for_each(|e| -> Result<(), FsError> {
        let origem = e.path();
        let nome = origem
            .file_name()
            .ok_or_else(|| FsError::InvalidPath(caminho_limpo(&origem)))?;
        let alvo = dst.join(nome);
        if e.file_type()?.is_dir() {
            copiar_dir(&origem, &alvo)
        } else {
            std::fs::copy(com_long_path(&origem), com_long_path(&alvo))?;
            Ok(())
        }
    })
}

/// Move: rename rápido (mesmo volume); se falhar (cross-volume), copia+apaga.
fn mover(from: &str, to: &str) -> Result<(), FsError> {
    validar(from)?;
    validar(to)?;
    let dest = com_long_path(Path::new(to));
    if dest.exists() {
        return Err(FsError::AlreadyExists(to.to_string()));
    }
    if std::fs::rename(com_long_path(Path::new(from)), &dest).is_ok() {
        return Ok(());
    }
    // Fallback cross-volume: copia recursivo e apaga a origem.
    copiar(from, to)?;
    remover(from)
}

fn remover(path: &str) -> Result<(), FsError> {
    let p = Path::new(path);
    if std::fs::symlink_metadata(com_long_path(p))?.is_dir() {
        std::fs::remove_dir_all(com_long_path(p))?;
    } else {
        std::fs::remove_file(com_long_path(p))?;
    }
    Ok(())
}

/// Manda os itens pra Lixeira do SO (batch, reversível pelo usuário).
fn para_lixeira(paths: &[String]) -> Result<(), FsError> {
    if paths.is_empty() {
        return Ok(());
    }
    for p in paths {
        validar(p)?;
    }
    trash::delete_all(paths).map_err(|e| FsError::Io(format!("lixeira: {e}")))
}

/// Apaga PERMANENTEMENTE (sem Lixeira) — exige o token de confirmação.
fn excluir_permanente(paths: &[String], confirm_token: &str) -> Result<(), FsError> {
    if confirm_token != TOKEN_EXCLUSAO_PERMANENTE {
        return Err(FsError::InvalidPath(
            "exclusão permanente requer confirmação".into(),
        ));
    }
    for p in paths {
        validar(p)?;
        remover(p)?;
    }
    Ok(())
}

// ──────────────── Progresso + conflito + watcher (S4, #680) ─────────────────

/// Estado gerenciado: rastreia operações em andamento e seus flags de cancel.
#[derive(Default)]
pub struct ProgressManager {
    proximo_id: AtomicU64,
    cancelados: Mutex<HashMap<u64, Arc<AtomicBool>>>,
}

impl ProgressManager {
    fn nova_op(&self) -> (u64, Arc<AtomicBool>) {
        let id = self.proximo_id.fetch_add(1, Ordering::Relaxed);
        let flag = Arc::new(AtomicBool::new(false));
        self.cancelados.lock().unwrap().insert(id, flag.clone());
        (id, flag)
    }
    fn cancelar(&self, id: u64) {
        if let Some(f) = self.cancelados.lock().unwrap().get(&id) {
            f.store(true, Ordering::Relaxed);
        }
    }
    fn finalizar(&self, id: u64) {
        self.cancelados.lock().unwrap().remove(&id);
    }
}

/// Progresso de uma op copy/move — emitido no evento `fs-op-progress`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpProgress {
    op_id: u64,
    processed_bytes: u64,
    total_bytes: u64,
    percent: f64,
    eta_ms: Option<u64>,
    /// #680 turbo: total/feitos de ARQUIVOS (o mix pequeno+grande) e vazão viva.
    files_total: u64,
    files_done: u64,
    bytes_per_sec: u64,
    /// Verificação (hash) está ativa nesta op.
    verifying: bool,
    done: bool,
    canceled: bool,
    error: Option<FsError>,
}

/// Conflito de nome no destino (pro diálogo Substituir/Pular/Manter ambos).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    source: String,
    name: String,
    dest: String,
    is_dir: bool,
}

/// Mudança no disco detectada pelo watcher — evento `fs-change`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsChange {
    watcher_id: u64,
    /// `created` | `deleted` | `modified` | `renamed` | `renamedFrom` | `renamedTo` | `other`.
    kind: String,
    path: String,
    /// Destino no rename (kind `renamed`); None nos demais.
    to: Option<String>,
    timestamp_ms: i64,
}

// ─── Engine turbo de cópia (#680 rework) ─────────────────────────────────────
//
// Substitui a cópia sequencial `std::fs::copy` arquivo-a-arquivo por um pipeline
// estilo TeraCopy: (1) planeja a árvore (jwalk paralelo) e separa o mix em
// PEQUENOS vs GRANDES; (2) perfila os discos (mesmo-volume + seek-penalty SSD/HDD)
// pra escolher workers×buffer; (3) copia num pool rayon com verificação opcional
// (xxh3/blake3/sha256); (4) um ticker dedicado emite progresso real (%, ETA,
// bytes/s, arquivos) a cada 100 ms sem afogar a UI. Cancel é checado entre
// arquivos e entre chunks; no cancel/erro o parcial é limpo.

/// Arquivos menores que isto entram no bucket "pequenos" (paralelizar ajuda —
/// IOPS-bound); maiores viram streaming com buffer grande.
const LIMITE_PEQUENO: u64 = 1024 * 1024; // 1 MiB
const BUF_GRANDE: usize = 4 * 1024 * 1024; // 4 MiB (arquivo grande, sequencial)
const BUF_PEQUENO: usize = 128 * 1024; // 128 KiB

/// Algoritmo de verificação pós-cópia (opt-in). `None` = cópia normal, sem hash.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VerifyAlg {
    Xxh3,
    Blake3,
    Sha256,
}

/// Uma cópia de arquivo planejada. Caminhos LIMPOS — o long-path é aplicado na
/// hora de abrir.
struct CopyJob {
    src: PathBuf,
    dst: PathBuf,
    size: u64,
}

#[derive(Default)]
struct Plano {
    dirs: Vec<PathBuf>,
    pequenos: Vec<CopyJob>,
    grandes: Vec<CopyJob>,
    total_bytes: u64,
    total_arquivos: u64,
}

/// Enumera a origem (jwalk paralelo), cria a lista de dirs a criar (rasos
/// primeiro) e classifica os arquivos por tamanho.
fn planejar(from: &Path, to: &Path) -> Result<Plano, FsError> {
    let mut plano = Plano::default();
    let meta = std::fs::symlink_metadata(com_long_path(from))?;
    if meta.is_file() {
        let size = meta.len();
        plano.total_bytes = size;
        plano.total_arquivos = 1;
        let job = CopyJob { src: from.to_path_buf(), dst: to.to_path_buf(), size };
        if size < LIMITE_PEQUENO {
            plano.pequenos.push(job);
        } else {
            plano.grandes.push(job);
        }
        return Ok(plano);
    }
    plano.dirs.push(to.to_path_buf());
    let raiz = com_long_path(from);
    for entry in jwalk::WalkDir::new(&raiz).skip_hidden(false).sort(true) {
        let Ok(entry) = entry else { continue };
        let p = entry.path();
        let Ok(rel) = p.strip_prefix(&raiz) else { continue };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let dst = to.join(rel);
        let ft = entry.file_type();
        if ft.is_dir() {
            plano.dirs.push(dst);
        } else if ft.is_file() {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            plano.total_bytes += size;
            plano.total_arquivos += 1;
            let job = CopyJob { src: from.join(rel), dst, size };
            if size < LIMITE_PEQUENO {
                plano.pequenos.push(job);
            } else {
                plano.grandes.push(job);
            }
        }
        // symlink/outros: pulados (a cópia é de conteúdo real).
    }
    Ok(plano)
}

/// Prefixo de volume (letra no Windows, lowercased) pra decidir mesmo-disco.
fn raiz_volume(p: &Path) -> Option<String> {
    use std::path::Component;
    match p.components().next() {
        Some(Component::Prefix(pre)) => Some(pre.as_os_str().to_string_lossy().to_lowercase()),
        _ => None,
    }
}

fn mesmo_volume(a: &Path, b: &Path) -> bool {
    match (raiz_volume(a), raiz_volume(b)) {
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}

/// SSD/NVMe (sem penalidade de seek) tolera muito mais paralelismo que HDD.
/// `IOCTL_STORAGE_QUERY_PROPERTY` com `StorageDeviceSeekPenaltyProperty`. Qualquer
/// falha → `None` (tratado como HDD, conservador).
#[cfg(windows)]
fn tem_seek_penalty(vol: &Path) -> Option<bool> {
    use std::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows::Win32::System::Ioctl::{
        PropertyStandardQuery, StorageDeviceSeekPenaltyProperty, DEVICE_SEEK_PENALTY_DESCRIPTOR,
        IOCTL_STORAGE_QUERY_PROPERTY, STORAGE_PROPERTY_QUERY,
    };
    use windows::Win32::System::IO::DeviceIoControl;

    let raiz = raiz_volume(vol)?; // "c:"
    let dispositivo = format!(r"\\.\{}", raiz.to_uppercase());
    let wide: Vec<u16> = dispositivo.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let h = CreateFileW(
            PCWSTR(wide.as_ptr()),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAGS_AND_ATTRIBUTES(0),
            None,
        )
        .ok()?;
        let mut query = STORAGE_PROPERTY_QUERY {
            PropertyId: StorageDeviceSeekPenaltyProperty,
            QueryType: PropertyStandardQuery,
            AdditionalParameters: [0u8; 1],
        };
        let mut desc = DEVICE_SEEK_PENALTY_DESCRIPTOR::default();
        let mut retornados = 0u32;
        let r = DeviceIoControl(
            h,
            IOCTL_STORAGE_QUERY_PROPERTY,
            Some(&mut query as *mut _ as *const c_void),
            std::mem::size_of::<STORAGE_PROPERTY_QUERY>() as u32,
            Some(&mut desc as *mut _ as *mut c_void),
            std::mem::size_of::<DEVICE_SEEK_PENALTY_DESCRIPTOR>() as u32,
            Some(&mut retornados),
            None,
        );
        let _ = CloseHandle(h);
        r.ok()?;
        Some(desc.IncursSeekPenalty)
    }
}

#[cfg(not(windows))]
fn tem_seek_penalty(_vol: &Path) -> Option<bool> {
    None
}

struct Perfil {
    workers: usize,
}

/// Escolhe o número de workers pela topologia dos discos: SSD ou cross-device
/// aguenta paralelismo alto; HDD no MESMO disco limita a 2 (evita thrash de seek).
fn perfilar(from: &Path, to: &Path) -> Perfil {
    let mesmo = mesmo_volume(from, to);
    let origem_ssd = tem_seek_penalty(from).map(|p| !p).unwrap_or(false);
    let destino_ssd = tem_seek_penalty(to).map(|p| !p).unwrap_or(false);
    let cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let workers = if (origem_ssd && destino_ssd) || !mesmo {
        cpus.clamp(2, 8)
    } else {
        2
    };
    Perfil { workers }
}

/// Hash incremental sobre o algoritmo escolhido.
enum Hasher {
    Xxh3(Box<xxhash_rust::xxh3::Xxh3>),
    Blake3(Box<blake3::Hasher>),
    Sha256(sha2::Sha256),
}

impl Hasher {
    fn novo(alg: VerifyAlg) -> Hasher {
        match alg {
            VerifyAlg::Xxh3 => Hasher::Xxh3(Box::new(xxhash_rust::xxh3::Xxh3::new())),
            VerifyAlg::Blake3 => Hasher::Blake3(Box::new(blake3::Hasher::new())),
            VerifyAlg::Sha256 => {
                use sha2::Digest;
                Hasher::Sha256(sha2::Sha256::new())
            }
        }
    }
    fn update(&mut self, b: &[u8]) {
        match self {
            Hasher::Xxh3(h) => h.update(b),
            Hasher::Blake3(h) => {
                h.update(b);
            }
            Hasher::Sha256(h) => {
                use sha2::Digest;
                h.update(b);
            }
        }
    }
    fn finalizar(self) -> Vec<u8> {
        match self {
            Hasher::Xxh3(h) => h.digest().to_le_bytes().to_vec(),
            Hasher::Blake3(h) => h.finalize().as_bytes().to_vec(),
            Hasher::Sha256(h) => {
                use sha2::Digest;
                h.finalize().to_vec()
            }
        }
    }
}

fn hash_arquivo(p: &Path, alg: VerifyAlg) -> Result<Vec<u8>, FsError> {
    use std::io::Read;
    let mut f = std::fs::File::open(com_long_path(p))?;
    let mut h = Hasher::novo(alg);
    let mut buf = vec![0u8; BUF_GRANDE];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalizar())
}

/// Contexto compartilhado entre os workers (atômicos de progresso + cancel).
struct Contexto {
    processados: Arc<AtomicU64>,
    arquivos_feitos: Arc<AtomicU64>,
    cancelar: Arc<AtomicBool>,
    verify: Option<VerifyAlg>,
}

/// Copia UM arquivo com buffer (grande streaming, pequeno menor), somando bytes no
/// atômico global. Se `verify`, hasheia a origem durante a leitura e re-hasheia o
/// destino ao final, comparando (detecta cópia corrompida).
fn copiar_arquivo(job: &CopyJob, ctx: &Contexto) -> Result<(), FsError> {
    use std::io::{Read, Write};
    if ctx.cancelar.load(Ordering::Relaxed) {
        return Ok(());
    }
    let src = com_long_path(&job.src);
    let dst = com_long_path(&job.dst);
    let mut ent = std::fs::File::open(&src)?;
    let mut sai = std::fs::File::create(&dst)?;
    let buf_sz = if job.size >= LIMITE_PEQUENO { BUF_GRANDE } else { BUF_PEQUENO };
    let mut buf = vec![0u8; buf_sz];
    let mut hasher = ctx.verify.map(Hasher::novo);
    loop {
        if ctx.cancelar.load(Ordering::Relaxed) {
            return Ok(());
        }
        let n = ent.read(&mut buf)?;
        if n == 0 {
            break;
        }
        sai.write_all(&buf[..n])?;
        if let Some(h) = hasher.as_mut() {
            h.update(&buf[..n]);
        }
        ctx.processados.fetch_add(n as u64, Ordering::Relaxed);
    }
    sai.flush()?;
    drop(sai);
    // Preserva atributos de permissão (readonly etc.).
    if let Ok(m) = std::fs::metadata(&src) {
        let _ = std::fs::set_permissions(&dst, m.permissions());
    }
    if let (Some(h), Some(alg)) = (hasher, ctx.verify) {
        let esperado = h.finalizar();
        let obtido = hash_arquivo(&job.dst, alg)?;
        if esperado != obtido {
            return Err(FsError::VerifyMismatch(caminho_limpo(&job.dst)));
        }
    }
    ctx.arquivos_feitos.fetch_add(1, Ordering::Relaxed);
    Ok(())
}

/// Ticker que emite progresso real a cada 100 ms lendo os atômicos (não bloqueia
/// os workers). Para no `parar()`.
struct Ticker {
    parar: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl Ticker {
    fn parar(mut self) {
        self.parar.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn iniciar_ticker(
    app: &AppHandle,
    op_id: u64,
    total_bytes: u64,
    total_arquivos: u64,
    processados: Arc<AtomicU64>,
    arquivos_feitos: Arc<AtomicU64>,
    verifying: bool,
) -> Ticker {
    let parar = Arc::new(AtomicBool::new(false));
    let p2 = parar.clone();
    let app = app.clone();
    let handle = std::thread::spawn(move || {
        let mut ultimo_bytes = 0u64;
        let mut ultimo_t = Instant::now();
        while !p2.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(100));
            let proc = processados.load(Ordering::Relaxed);
            let agora = Instant::now();
            let dt = agora.duration_since(ultimo_t).as_secs_f64().max(0.001);
            let bps = ((proc.saturating_sub(ultimo_bytes)) as f64 / dt) as u64;
            ultimo_bytes = proc;
            ultimo_t = agora;
            let percent = if total_bytes > 0 {
                (proc as f64 / total_bytes as f64) * 100.0
            } else {
                0.0
            };
            let eta_ms = if bps > 0 && proc < total_bytes {
                Some((total_bytes - proc) / bps.max(1) * 1000)
            } else {
                None
            };
            let _ = app.emit(
                "fs-op-progress",
                OpProgress {
                    op_id,
                    processed_bytes: proc,
                    total_bytes,
                    percent,
                    eta_ms,
                    files_total: total_arquivos,
                    files_done: arquivos_feitos.load(Ordering::Relaxed),
                    bytes_per_sec: bps,
                    verifying,
                    done: false,
                    canceled: false,
                    error: None,
                },
            );
        }
    });
    Ticker { parar, handle: Some(handle) }
}

/// Executa copy (ou move) TURBO com progresso. Retorna `true` se foi cancelada.
fn executar_progresso(
    mover: bool,
    from: &str,
    to: &str,
    op_id: u64,
    flag: &Arc<AtomicBool>,
    verify: Option<VerifyAlg>,
    app: &AppHandle,
) -> Result<bool, FsError> {
    validar(from)?;
    validar(to)?;
    let src = Path::new(from);
    let dst = Path::new(to);
    if com_long_path(dst).exists() {
        return Err(FsError::AlreadyExists(to.to_string()));
    }
    // Move mesmo-volume: rename é instantâneo, sem varredura nem cópia.
    if mover && std::fs::rename(com_long_path(src), com_long_path(dst)).is_ok() {
        return Ok(false);
    }

    let plano = planejar(src, dst)?;
    for d in &plano.dirs {
        std::fs::create_dir_all(com_long_path(d))?;
    }
    let perfil = perfilar(src, dst);

    let ctx = Contexto {
        processados: Arc::new(AtomicU64::new(0)),
        arquivos_feitos: Arc::new(AtomicU64::new(0)),
        cancelar: flag.clone(),
        verify,
    };
    let ticker = iniciar_ticker(
        app,
        op_id,
        plano.total_bytes,
        plano.total_arquivos,
        ctx.processados.clone(),
        ctx.arquivos_feitos.clone(),
        verify.is_some(),
    );

    let resultado = copiar_plano(&plano, perfil.workers, &ctx);
    ticker.parar();

    if let Err(e) = resultado {
        let _ = remover(to); // limpa o parcial
        return Err(e);
    }
    if flag.load(Ordering::Relaxed) {
        let _ = remover(to);
        return Ok(true);
    }
    if mover {
        remover(from)?; // move = copiou tudo → apaga a origem
    }
    Ok(false)
}

/// Copia todos os jobs do plano num pool rayon dimensionado por `workers`.
/// Grandes primeiro (streaming), depois pequenos (par_iter). O primeiro erro
/// aborta os demais (seta o cancel) e é retornado. Sem `AppHandle` — testável.
fn copiar_plano(plano: &Plano, workers: usize, ctx: &Contexto) -> Result<(), FsError> {
    use rayon::prelude::*;

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(workers.max(1))
        .build()
        .map_err(|e| FsError::Io(e.to_string()))?;
    let erro: Mutex<Option<FsError>> = Mutex::new(None);
    pool.install(|| {
        plano
            .grandes
            .par_iter()
            .chain(plano.pequenos.par_iter())
            .for_each(|job| {
                if ctx.cancelar.load(Ordering::Relaxed) {
                    return;
                }
                if let Err(e) = copiar_arquivo(job, ctx) {
                    let mut g = erro.lock().unwrap();
                    if g.is_none() {
                        *g = Some(e);
                        ctx.cancelar.store(true, Ordering::Relaxed); // aborta os demais
                    }
                }
            });
    });
    match erro.into_inner().unwrap() {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

fn checar_conflitos(sources: &[String], dest_dir: &str) -> Result<Vec<Conflict>, FsError> {
    validar(dest_dir)?;
    let base = Path::new(dest_dir);
    let mut conflitos = Vec::new();
    for src in sources {
        let sp = Path::new(src);
        let Some(nome) = sp.file_name() else { continue };
        let alvo = base.join(nome);
        if com_long_path(&alvo).exists() {
            let is_dir = std::fs::symlink_metadata(com_long_path(&alvo))
                .map(|m| m.is_dir())
                .unwrap_or(false);
            conflitos.push(Conflict {
                source: src.clone(),
                name: nome.to_string_lossy().into_owned(),
                dest: caminho_limpo(&alvo),
                is_dir,
            });
        }
    }
    Ok(conflitos)
}

// ───────────────────── Thumbnails (#736, Explorer perf F1) ──────────────────
//
// `fs_thumbnail` gera um thumbnail PEQUENO (webp) sem NUNCA devolver o original
// pro DOM (hoje o WebView decodifica o arquivo full-res só pra pintar 48px — o
// gargalo). Roda num pool rayon dimensionado aos cores. Fast-path: se o JPEG tem
// thumbnail EXIF embutida (a maioria das fotos de celular/câmera tem), usa ela e
// pula o decode full-res. Cache em disco é a F2 — aqui só gera em memória.

/// Referência de thumbnail pro front: webp como data URI (o DOM pinta direto, sem
/// tocar o arquivo original) + dimensões + de onde veio.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbRef {
    pub data_uri: String,
    pub width: u32,
    pub height: u32,
    /// "exif" = thumb embutida (fast-path); "decode" = decode full-res + resize.
    pub source: String,
}

/// Pool rayon dedicado a thumbnails, criado uma vez. Dimensionado a ~3/4 dos
/// núcleos lógicos (headroom pra UI/OS; hyperthreading não ajuda decode SIMD),
/// mínimo 1. Bounda a paralelização mesmo com N chamadas simultâneas do front.
fn thumb_pool() -> &'static rayon::ThreadPool {
    static POOL: std::sync::OnceLock<rayon::ThreadPool> = std::sync::OnceLock::new();
    POOL.get_or_init(|| {
        let logical = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        let n = (logical * 3 / 4).max(1);
        rayon::ThreadPoolBuilder::new()
            .num_threads(n)
            .thread_name(|i| format!("thumb-{i}"))
            .build()
            .expect("pool de thumbnail")
    })
}

/// Gera o thumbnail de `path` com o maior lado <= `max_size` (16..=1024). Roda no
/// pool de thumbnails (bounda CPU). Erro tipado.
#[tauri::command]
pub fn fs_thumbnail(path: String, max_size: u32) -> Result<ThumbRef, FsError> {
    validar(&path)?;
    let max = max_size.clamp(16, 1024);
    thumb_pool().install(move || gerar_thumb(&path, max))
}

fn gerar_thumb(path: &str, max: u32) -> Result<ThumbRef, FsError> {
    let bytes = std::fs::read(com_long_path(Path::new(path)))?;
    // Fast-path: thumbnail EXIF embutida (só JPEG). Pula o decode full-res.
    if let Some(thumb) = exif_thumbnail(&bytes) {
        if let Ok(img) = image::load_from_memory(&thumb) {
            let (w, h, webp) = resize_encode(&img, max)?;
            return Ok(ThumbRef { data_uri: data_uri_webp(&webp), width: w, height: h, source: "exif".into() });
        }
    }
    // Caminho robusto: decodifica o formato (png/jpg/gif/bmp/webp/ico/tiff) e reduz.
    let img = image::load_from_memory(&bytes)
        .map_err(|e| FsError::Io(format!("decode de imagem falhou: {e}")))?;
    let (w, h, webp) = resize_encode(&img, max)?;
    Ok(ThumbRef { data_uri: data_uri_webp(&webp), width: w, height: h, source: "decode".into() })
}

/// Downscale SIMD (Lanczos3) pro maior lado = `max` (nunca faz upscale) + encode
/// webp q80. Devolve (w, h, bytes webp).
fn resize_encode(img: &image::DynamicImage, max: u32) -> Result<(u32, u32, Vec<u8>), FsError> {
    use fast_image_resize as fr;
    let src = img.to_rgba8();
    let (sw, sh) = (src.width(), src.height());
    let (dw, dh) = escala(sw, sh, max);
    let src_img = fr::images::Image::from_vec_u8(sw, sh, src.into_raw(), fr::PixelType::U8x4)
        .map_err(|e| FsError::Io(e.to_string()))?;
    let mut dst_img = fr::images::Image::new(dw, dh, fr::PixelType::U8x4);
    let opts = fr::ResizeOptions::new().resize_alg(fr::ResizeAlg::Convolution(fr::FilterType::Lanczos3));
    fr::Resizer::new()
        .resize(&src_img, &mut dst_img, &opts)
        .map_err(|e| FsError::Io(e.to_string()))?;
    let enc = webp::Encoder::from_rgba(dst_img.buffer(), dw, dh);
    let mem = enc.encode(80.0);
    Ok((dw, dh, mem.to_vec()))
}

/// Dimensão-alvo: maior lado = `max`, mantém aspecto, NUNCA faz upscale.
fn escala(w: u32, h: u32, max: u32) -> (u32, u32) {
    if w.max(h) <= max {
        return (w.max(1), h.max(1));
    }
    let s = max as f64 / w.max(h) as f64;
    (((w as f64 * s).round() as u32).max(1), ((h as f64 * s).round() as u32).max(1))
}

fn data_uri_webp(bytes: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:image/webp;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// Extrai a thumbnail JPEG embutida na EXIF (IFD1), se houver. O offset da EXIF é
/// relativo ao header TIFF, que começa logo após `Exif\0\0` no segmento APP1 —
/// achamos essa base no arquivo e fatiamos `[offset .. offset+len]`. Só JPEG.
fn exif_thumbnail(bytes: &[u8]) -> Option<Vec<u8>> {
    // JPEG começa com SOI (0xFFD8); sem isso nem tem APP1/EXIF.
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return None;
    }
    let exif = exif::Reader::new()
        .read_from_container(&mut std::io::Cursor::new(bytes))
        .ok()?;
    let off = exif
        .get_field(exif::Tag::JPEGInterchangeFormat, exif::In::THUMBNAIL)?
        .value
        .get_uint(0)? as usize;
    let len = exif
        .get_field(exif::Tag::JPEGInterchangeFormatLength, exif::In::THUMBNAIL)?
        .value
        .get_uint(0)? as usize;
    let marcador = b"Exif\x00\x00";
    let pos = bytes.windows(marcador.len()).position(|w| w == marcador)?;
    let tiff_base = pos + marcador.len();
    let inicio = tiff_base.checked_add(off)?;
    let fim = inicio.checked_add(len)?;
    let thumb = bytes.get(inicio..fim)?;
    // Confere que é mesmo um JPEG (SOI) antes de confiar.
    (thumb.len() >= 2 && thumb[0] == 0xFF && thumb[1] == 0xD8).then(|| thumb.to_vec())
}

// --- File watcher (notify v7 + debouncer-full) ---

type Watcher =
    notify_debouncer_full::Debouncer<notify::RecommendedWatcher, notify_debouncer_full::RecommendedCache>;

/// Estado gerenciado: watchers ativos por id (soltos no `fs_unwatch`).
#[derive(Default)]
pub struct WatcherRegistry {
    proximo_id: AtomicU64,
    watchers: Mutex<HashMap<u64, Watcher>>,
}

fn emitir_change(app: &AppHandle, watcher_id: u64, ev: &notify_debouncer_full::DebouncedEvent) {
    use notify::event::{ModifyKind, RenameMode};
    use notify::EventKind;

    let (kind, path, to): (&str, Option<&PathBuf>, Option<&PathBuf>) = match ev.kind {
        EventKind::Create(_) => ("created", ev.paths.first(), None),
        EventKind::Remove(_) => ("deleted", ev.paths.first(), None),
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
            ("renamed", ev.paths.first(), ev.paths.get(1))
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
            ("renamedFrom", ev.paths.first(), None)
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            ("renamedTo", ev.paths.first(), None)
        }
        EventKind::Modify(_) => ("modified", ev.paths.first(), None),
        _ => ("other", ev.paths.first(), None),
    };
    let Some(p) = path else { return };
    let _ = app.emit(
        "fs-change",
        FsChange {
            watcher_id,
            kind: kind.to_string(),
            path: caminho_limpo(p),
            to: to.map(|t| caminho_limpo(t)),
            timestamp_ms: tempo_ms(Some(SystemTime::now())).unwrap_or(0),
        },
    );
}

fn iniciar_watch(
    path: &str,
    recursive: bool,
    id: u64,
    app: &AppHandle,
) -> Result<Watcher, FsError> {
    validar(path)?;
    let app2 = app.clone();
    let mut debouncer = notify_debouncer_full::new_debouncer(
        Duration::from_millis(200),
        None,
        move |res: notify_debouncer_full::DebounceEventResult| {
            if let Ok(eventos) = res {
                for ev in &eventos {
                    emitir_change(&app2, id, ev);
                }
            }
        },
    )
    .map_err(|e| FsError::Io(format!("watcher: {e}")))?;
    let modo = if recursive {
        notify::RecursiveMode::Recursive
    } else {
        notify::RecursiveMode::NonRecursive
    };
    debouncer
        .watch(Path::new(path), modo)
        .map_err(|e| FsError::Io(format!("watch: {e}")))?;
    Ok(debouncer)
}

// ────────────────────────────── Comandos ────────────────────────────────────

fn spawn_err(e: tauri::Error) -> FsError {
    FsError::Io(e.to_string())
}

#[tauri::command]
pub async fn fs_read_dir(path: String) -> Result<Vec<FsEntry>, FsError> {
    tauri::async_runtime::spawn_blocking(move || ler_dir(&path))
        .await
        .map_err(spawn_err)?
}

#[tauri::command]
pub async fn fs_read_dir_streamed(
    path: String,
    batch: usize,
    app: AppHandle,
) -> Result<u64, FsError> {
    tauri::async_runtime::spawn_blocking(move || ler_dir_streamed(&path, batch, &app))
        .await
        .map_err(spawn_err)?
}

#[tauri::command]
pub async fn fs_stat(path: String) -> Result<FsEntry, FsError> {
    tauri::async_runtime::spawn_blocking(move || stat(&path))
        .await
        .map_err(spawn_err)?
}

#[tauri::command]
pub async fn fs_dir_size(path: String) -> Result<DirSize, FsError> {
    tauri::async_runtime::spawn_blocking(move || tamanho_dir(&path))
        .await
        .map_err(spawn_err)?
}

#[tauri::command]
pub async fn fs_list_drives() -> Result<Vec<DriveInfo>, FsError> {
    tauri::async_runtime::spawn_blocking(listar_drives)
        .await
        .map_err(spawn_err)?
}

#[tauri::command]
pub async fn fs_known_dirs() -> Result<Vec<FsEntry>, FsError> {
    tauri::async_runtime::spawn_blocking(|| Ok(dirs_conhecidos()))
        .await
        .map_err(spawn_err)?
}

/// Revela o item no Explorer (reusa `system::revelar_no_explorer`).
#[tauri::command]
pub async fn fs_reveal(path: String) -> Result<(), FsError> {
    crate::system::revelar_no_explorer(&path).map_err(FsError::Io)
}

/// Abre o item com o app padrão do Windows (reusa `system::abrir_caminho`).
#[tauri::command]
pub async fn fs_open(path: String) -> Result<(), FsError> {
    crate::system::abrir_caminho(&path).map_err(FsError::Io)
}

// --- Mutações (#679 S3) ---

#[tauri::command]
pub async fn fs_create_dir(path: String) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || criar_dir(&path))
        .await
        .map_err(spawn_err)?
}

#[tauri::command]
pub async fn fs_create_file(path: String, contents: Option<String>) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || criar_arquivo(&path, contents))
        .await
        .map_err(spawn_err)?
}

#[tauri::command]
pub async fn fs_rename(from: String, to: String) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || renomear(&from, &to))
        .await
        .map_err(spawn_err)?
}

#[tauri::command]
pub async fn fs_copy(from: String, to: String) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || copiar(&from, &to))
        .await
        .map_err(spawn_err)?
}

#[tauri::command]
pub async fn fs_move(from: String, to: String) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || mover(&from, &to))
        .await
        .map_err(spawn_err)?
}

#[tauri::command]
pub async fn fs_trash(paths: Vec<String>) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || para_lixeira(&paths))
        .await
        .map_err(spawn_err)?
}

#[tauri::command]
pub async fn fs_delete_permanent(
    paths: Vec<String>,
    confirm_token: String,
) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || excluir_permanente(&paths, &confirm_token))
        .await
        .map_err(spawn_err)?
}

// --- Progresso + conflito + watcher (#680 S4) ---

/// Roda a op em background (spawn_blocking), finaliza a op no manager e emite o
/// `fs-op-progress` final (done/canceled/error). O comando devolve o `op_id` já.
fn spawn_progresso(
    mover: bool,
    from: String,
    to: String,
    op_id: u64,
    flag: Arc<AtomicBool>,
    verify: Option<VerifyAlg>,
    app: AppHandle,
) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let resultado = executar_progresso(mover, &from, &to, op_id, &flag, verify, &app);
        app.state::<ProgressManager>().finalizar(op_id);
        let (canceled, error) = match resultado {
            Ok(c) => (c, None),
            Err(e) => (false, Some(e)),
        };
        let _ = app.emit(
            "fs-op-progress",
            OpProgress {
                op_id,
                processed_bytes: 0,
                total_bytes: 0,
                percent: if error.is_some() { 0.0 } else { 100.0 },
                eta_ms: None,
                files_total: 0,
                files_done: 0,
                bytes_per_sec: 0,
                verifying: false,
                done: true,
                canceled,
                error,
            },
        );
    });
}

#[tauri::command]
pub async fn fs_copy_with_progress(
    from: String,
    to: String,
    verify: Option<VerifyAlg>,
    app: AppHandle,
    pm: State<'_, ProgressManager>,
) -> Result<u64, FsError> {
    let (op_id, flag) = pm.nova_op();
    spawn_progresso(false, from, to, op_id, flag, verify, app);
    Ok(op_id)
}

#[tauri::command]
pub async fn fs_move_with_progress(
    from: String,
    to: String,
    verify: Option<VerifyAlg>,
    app: AppHandle,
    pm: State<'_, ProgressManager>,
) -> Result<u64, FsError> {
    let (op_id, flag) = pm.nova_op();
    spawn_progresso(true, from, to, op_id, flag, verify, app);
    Ok(op_id)
}

#[tauri::command]
pub async fn fs_cancel(op_id: u64, pm: State<'_, ProgressManager>) -> Result<(), FsError> {
    pm.cancelar(op_id);
    Ok(())
}

#[tauri::command]
pub async fn fs_check_conflicts(
    sources: Vec<String>,
    dest_dir: String,
) -> Result<Vec<Conflict>, FsError> {
    tauri::async_runtime::spawn_blocking(move || checar_conflitos(&sources, &dest_dir))
        .await
        .map_err(spawn_err)?
}

#[tauri::command]
pub async fn fs_watch(
    path: String,
    recursive: bool,
    app: AppHandle,
    wr: State<'_, WatcherRegistry>,
) -> Result<u64, FsError> {
    let id = wr.proximo_id.fetch_add(1, Ordering::Relaxed);
    let w = iniciar_watch(&path, recursive, id, &app)?;
    wr.watchers.lock().unwrap().insert(id, w);
    Ok(id)
}

#[tauri::command]
pub async fn fs_unwatch(watcher_id: u64, wr: State<'_, WatcherRegistry>) -> Result<(), FsError> {
    // Dropar o Debouncer solta o watch do SO (sem vazar).
    wr.watchers.lock().unwrap().remove(&watcher_id);
    Ok(())
}

// ─────────────────────────────── Testes ─────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Engine turbo (#680 rework) ──────────────────────────────────────────

    fn dir_temp(tag: &str) -> PathBuf {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let base = std::env::temp_dir().join(format!("gtb680_{tag}_{pid}_{n}"));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    fn ctx_teste(verify: Option<VerifyAlg>) -> Contexto {
        Contexto {
            processados: Arc::new(AtomicU64::new(0)),
            arquivos_feitos: Arc::new(AtomicU64::new(0)),
            cancelar: Arc::new(AtomicBool::new(false)),
            verify,
        }
    }

    #[test]
    fn planejar_classifica_pequeno_e_grande() {
        let base = dir_temp("plan");
        let origem = base.join("src");
        std::fs::create_dir_all(origem.join("sub")).unwrap();
        std::fs::write(origem.join("pequeno.txt"), vec![7u8; 10]).unwrap();
        std::fs::write(origem.join("sub").join("grande.bin"), vec![9u8; (LIMITE_PEQUENO + 5) as usize]).unwrap();

        let plano = planejar(&origem, &base.join("dst")).unwrap();
        assert_eq!(plano.total_arquivos, 2);
        assert_eq!(plano.total_bytes, 10 + LIMITE_PEQUENO + 5);
        assert_eq!(plano.pequenos.len(), 1);
        assert_eq!(plano.grandes.len(), 1);
        // A raiz + subdir viram dirs a criar.
        assert!(plano.dirs.len() >= 2);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn copia_plano_replica_arvore_e_conteudo() {
        let base = dir_temp("tree");
        let origem = base.join("src");
        std::fs::create_dir_all(origem.join("a").join("b")).unwrap();
        std::fs::write(origem.join("raiz.txt"), b"raiz").unwrap();
        std::fs::write(origem.join("a").join("x.txt"), b"conteudo-x").unwrap();
        let grande = vec![42u8; (LIMITE_PEQUENO * 2) as usize];
        std::fs::write(origem.join("a").join("b").join("grande.bin"), &grande).unwrap();

        let destino = base.join("dst");
        let plano = planejar(&origem, &destino).unwrap();
        for d in &plano.dirs {
            std::fs::create_dir_all(com_long_path(d)).unwrap();
        }
        let ctx = ctx_teste(None);
        copiar_plano(&plano, 4, &ctx).unwrap();

        assert_eq!(std::fs::read(destino.join("raiz.txt")).unwrap(), b"raiz");
        assert_eq!(std::fs::read(destino.join("a").join("x.txt")).unwrap(), b"conteudo-x");
        assert_eq!(std::fs::read(destino.join("a").join("b").join("grande.bin")).unwrap(), grande);
        // Progresso somou todos os bytes e contou os 3 arquivos.
        assert_eq!(ctx.processados.load(Ordering::Relaxed), plano.total_bytes);
        assert_eq!(ctx.arquivos_feitos.load(Ordering::Relaxed), 3);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn verificacao_hash_bate_nos_tres_algoritmos() {
        for alg in [VerifyAlg::Xxh3, VerifyAlg::Blake3, VerifyAlg::Sha256] {
            let base = dir_temp("verify");
            let origem = base.join("src");
            std::fs::create_dir_all(&origem).unwrap();
            std::fs::write(origem.join("f.bin"), vec![3u8; 5000]).unwrap();
            let destino = base.join("dst");
            let plano = planejar(&origem, &destino).unwrap();
            for d in &plano.dirs {
                std::fs::create_dir_all(com_long_path(d)).unwrap();
            }
            let ctx = ctx_teste(Some(alg));
            // Verify ON: copia + re-hasheia o destino e confere (sem erro = íntegro).
            copiar_plano(&plano, 2, &ctx).unwrap();
            assert_eq!(ctx.arquivos_feitos.load(Ordering::Relaxed), 1);
            // hash_arquivo da origem == do destino.
            let h_src = hash_arquivo(&origem.join("f.bin"), alg).unwrap();
            let h_dst = hash_arquivo(&destino.join("f.bin"), alg).unwrap();
            assert_eq!(h_src, h_dst);
            std::fs::remove_dir_all(&base).ok();
        }
    }

    #[test]
    fn cancel_interrompe_e_nao_conta_tudo() {
        let base = dir_temp("cancel");
        let origem = base.join("src");
        std::fs::create_dir_all(&origem).unwrap();
        for i in 0..5 {
            std::fs::write(origem.join(format!("f{i}.txt")), vec![1u8; 100]).unwrap();
        }
        let destino = base.join("dst");
        let plano = planejar(&origem, &destino).unwrap();
        for d in &plano.dirs {
            std::fs::create_dir_all(com_long_path(d)).unwrap();
        }
        let ctx = ctx_teste(None);
        ctx.cancelar.store(true, Ordering::Relaxed); // já cancelado antes de começar
        copiar_plano(&plano, 2, &ctx).unwrap();
        // Nenhum arquivo copiado (cada job vê o cancel e retorna cedo).
        assert_eq!(ctx.arquivos_feitos.load(Ordering::Relaxed), 0);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn raiz_volume_e_mesmo_volume() {
        assert_eq!(raiz_volume(Path::new(r"C:\a\b")).as_deref(), Some("c:"));
        assert!(mesmo_volume(Path::new(r"C:\a"), Path::new(r"c:\z\y")));
        assert!(!mesmo_volume(Path::new(r"C:\a"), Path::new(r"D:\a")));
    }

    #[test]
    fn perfilar_da_pelo_menos_dois_workers() {
        let p = perfilar(Path::new(r"C:\a"), Path::new(r"C:\b"));
        assert!(p.workers >= 2);
    }

    #[test]
    fn io_error_vira_variante_certa() {
        let np = std::io::Error::from(std::io::ErrorKind::NotFound);
        assert!(matches!(FsError::from(np), FsError::NotFound(_)));
        let pd = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert!(matches!(FsError::from(pd), FsError::PermissionDenied(_)));
        let ae = std::io::Error::from(std::io::ErrorKind::AlreadyExists);
        assert!(matches!(FsError::from(ae), FsError::AlreadyExists(_)));
        let outro = std::io::Error::from(std::io::ErrorKind::UnexpectedEof);
        assert!(matches!(FsError::from(outro), FsError::Io(_)));
    }

    #[test]
    fn erro_serializa_com_code_e_message() {
        let j = serde_json::to_value(FsError::PermissionDenied("x".into())).unwrap();
        assert_eq!(j["code"], "PermissionDenied");
        assert_eq!(j["message"], "x");
    }

    #[test]
    fn caminho_vazio_e_invalido() {
        assert!(matches!(ler_dir("").unwrap_err(), FsError::InvalidPath(_)));
        assert!(matches!(stat("   ").unwrap_err(), FsError::InvalidPath(_)));
        assert!(matches!(tamanho_dir("").unwrap_err(), FsError::InvalidPath(_)));
    }

    #[test]
    fn caminho_limpo_tira_verbatim() {
        assert_eq!(caminho_limpo(Path::new(r"\\?\C:\x\y")), r"C:\x\y");
        assert_eq!(caminho_limpo(Path::new(r"\\?\UNC\srv\share")), r"\\srv\share");
        assert_eq!(caminho_limpo(Path::new(r"C:\normal")), r"C:\normal");
    }

    #[cfg(windows)]
    #[test]
    fn long_path_prefixa_absoluto_e_unc() {
        assert_eq!(
            com_long_path(Path::new(r"C:\a\b")).to_string_lossy(),
            r"\\?\C:\a\b"
        );
        assert_eq!(
            com_long_path(Path::new(r"\\srv\share")).to_string_lossy(),
            r"\\?\UNC\srv\share"
        );
        // Idempotente + não mexe em relativo.
        assert_eq!(
            com_long_path(Path::new(r"\\?\C:\x")).to_string_lossy(),
            r"\\?\C:\x"
        );
        assert_eq!(com_long_path(Path::new(r"a\b")).to_string_lossy(), r"a\b");
    }

    #[test]
    fn ordena_pastas_primeiro() {
        let mk = |name: &str, is_dir: bool| FsEntry {
            name: name.into(),
            path: name.into(),
            is_dir,
            is_symlink: false,
            size: 0,
            modified_ms: None,
            created_ms: None,
            extension: None,
            is_hidden: false,
            is_readonly: false,
        };
        let mut v = vec![
            mk("banana.txt", false),
            mk("Zebra", true),
            mk("abacaxi", true),
            mk("Ana.doc", false),
        ];
        ordenar(&mut v);
        let ordem: Vec<&str> = v.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(ordem, ["abacaxi", "Zebra", "Ana.doc", "banana.txt"]);
    }

    // --- Thumbnails (#736 F1) ---

    #[test]
    fn escala_downscale_mantem_aspecto_e_nao_faz_upscale() {
        // 4000×3000 → maior lado 256 → 256×192.
        assert_eq!(escala(4000, 3000, 256), (256, 192));
        // paisagem
        assert_eq!(escala(1000, 500, 100), (100, 50));
        // menor que o alvo: NUNCA faz upscale.
        assert_eq!(escala(120, 80, 256), (120, 80));
        // nunca zera.
        assert_eq!(escala(1, 1, 256), (1, 1));
    }

    #[test]
    fn resize_encode_produz_webp_valido_e_reduzido() {
        // imagem sintética 800×600 → thumb 256 → 256×192, bytes webp (RIFF…WEBP).
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            800,
            600,
            image::Rgba([10, 120, 200, 255]),
        ));
        let (w, h, webp) = resize_encode(&img, 256).unwrap();
        assert_eq!((w, h), (256, 192));
        assert!(webp.len() > 12);
        assert_eq!(&webp[0..4], b"RIFF");
        assert_eq!(&webp[8..12], b"WEBP");
    }

    #[test]
    fn data_uri_webp_prefixa_certo() {
        let u = data_uri_webp(&[1, 2, 3]);
        assert!(u.starts_with("data:image/webp;base64,"));
    }

    #[test]
    fn exif_thumbnail_ignora_nao_jpeg() {
        // PNG (não começa com FFD8) → sem fast-path.
        assert!(exif_thumbnail(&[0x89, b'P', b'N', b'G', 0, 0, 0, 0]).is_none());
        assert!(exif_thumbnail(&[]).is_none());
    }

    // --- Mutações (#679 S3) — em tmpdir real, sem tocar a Lixeira do SO ---

    fn temp_unico() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("gt-fsx-{}-{}", std::process::id(), n))
    }

    fn s(p: &std::path::Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn mutacoes_criam_renomeiam_copiam_movem_e_apagam() {
        let base = temp_unico();
        std::fs::create_dir_all(&base).unwrap();

        // create_dir + conflito
        let d = base.join("pasta");
        criar_dir(&s(&d)).unwrap();
        assert!(d.is_dir());
        assert!(matches!(criar_dir(&s(&d)).unwrap_err(), FsError::AlreadyExists(_)));

        // create_file com conteúdo + conflito (não sobrescreve)
        let f = base.join("a.txt");
        criar_arquivo(&s(&f), Some("oi".into())).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "oi");
        assert!(matches!(
            criar_arquivo(&s(&f), Some("outro".into())).unwrap_err(),
            FsError::AlreadyExists(_)
        ));

        // rename + conflito
        let f2 = base.join("b.txt");
        renomear(&s(&f), &s(&f2)).unwrap();
        assert!(!f.exists() && f2.exists());
        let c = base.join("c.txt");
        criar_arquivo(&s(&c), None).unwrap();
        assert!(matches!(renomear(&s(&f2), &s(&c)).unwrap_err(), FsError::AlreadyExists(_)));

        // copy de arquivo e de pasta (recursivo)
        std::fs::write(d.join("dentro.txt"), "x").unwrap();
        let d2 = base.join("pasta-copia");
        copiar(&s(&d), &s(&d2)).unwrap();
        assert!(d2.join("dentro.txt").exists() && d.exists());

        // move: rename mesmo volume
        let d3 = base.join("pasta-movida");
        mover(&s(&d2), &s(&d3)).unwrap();
        assert!(!d2.exists() && d3.join("dentro.txt").exists());

        // delete permanente: recusa sem token, apaga com token
        assert!(matches!(
            excluir_permanente(&[s(&f2)], "errado").unwrap_err(),
            FsError::InvalidPath(_)
        ));
        assert!(f2.exists());
        excluir_permanente(&[s(&f2), s(&d3)], TOKEN_EXCLUSAO_PERMANENTE).unwrap();
        assert!(!f2.exists() && !d3.exists());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn caminho_vazio_barra_mutacoes() {
        assert!(matches!(criar_dir("").unwrap_err(), FsError::InvalidPath(_)));
        assert!(matches!(renomear("", "x").unwrap_err(), FsError::InvalidPath(_)));
        assert!(matches!(copiar("a", "").unwrap_err(), FsError::InvalidPath(_)));
    }

    #[test]
    fn conflitos_detectam_so_os_nomes_ja_existentes() {
        let base = temp_unico();
        let origem = base.join("origem");
        let destino = base.join("destino");
        std::fs::create_dir_all(&origem).unwrap();
        std::fs::create_dir_all(&destino).unwrap();

        // 3 fontes; 2 já existem no destino, 1 não.
        for nome in ["a.txt", "b.txt", "novo.txt"] {
            std::fs::write(origem.join(nome), "x").unwrap();
        }
        std::fs::write(destino.join("a.txt"), "y").unwrap();
        std::fs::create_dir(destino.join("b.txt")).unwrap(); // colide como pasta

        let fontes: Vec<String> = ["a.txt", "b.txt", "novo.txt"]
            .iter()
            .map(|n| s(&origem.join(n)))
            .collect();
        let confl = checar_conflitos(&fontes, &s(&destino)).unwrap();
        let nomes: Vec<&str> = confl.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(nomes.len(), 2);
        assert!(nomes.contains(&"a.txt") && nomes.contains(&"b.txt"));
        assert!(!nomes.contains(&"novo.txt"));
        // o tipo (pasta vs arquivo) do destino é reportado
        assert!(confl.iter().any(|c| c.name == "b.txt" && c.is_dir));

        let _ = std::fs::remove_dir_all(&base);
    }
}
