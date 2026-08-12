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

use serde::Serialize;
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

/// Emite progresso com throttle (100ms) — pasta grande não afoga a UI de eventos.
struct Emissor<'a> {
    app: &'a AppHandle,
    op_id: u64,
    total: u64,
    processados: u64,
    inicio: Instant,
    ultimo: Instant,
}

impl<'a> Emissor<'a> {
    fn novo(app: &'a AppHandle, op_id: u64, total: u64) -> Self {
        let agora = Instant::now();
        Self { app, op_id, total, processados: 0, inicio: agora, ultimo: agora }
    }
    fn avancar(&mut self, delta: u64, forcar: bool) {
        self.processados += delta;
        let agora = Instant::now();
        if !forcar && agora.duration_since(self.ultimo) < Duration::from_millis(100) {
            return;
        }
        self.ultimo = agora;
        let percent = if self.total > 0 {
            (self.processados as f64 / self.total as f64) * 100.0
        } else {
            100.0
        };
        let decorrido = agora.duration_since(self.inicio).as_millis() as f64;
        let eta_ms = if self.processados > 0 && self.processados < self.total {
            let restante = (self.total - self.processados) as f64;
            Some(((decorrido / self.processados as f64) * restante) as u64)
        } else {
            None
        };
        let _ = self.app.emit(
            "fs-op-progress",
            OpProgress {
                op_id: self.op_id,
                processed_bytes: self.processados,
                total_bytes: self.total,
                percent,
                eta_ms,
                done: false,
                canceled: false,
                error: None,
            },
        );
    }
}

/// Fim de uma varredura de cópia: completou ou foi cancelada no meio.
enum Fim {
    Completo,
    Cancelado,
}

fn total_bytes(path: &Path) -> u64 {
    let mut t = 0u64;
    for e in jwalk::WalkDir::new(com_long_path(path)).skip_hidden(false) {
        if let Ok(e) = e {
            if let Ok(m) = std::fs::symlink_metadata(e.path()) {
                if m.is_file() {
                    t += m.len();
                }
            }
        }
    }
    t
}

/// Copia recursivo, sequencial (pra checar cancel + acumular progresso). `from`/
/// `to` são caminhos LIMPOS (o long-path é aplicado em cada op).
fn copiar_arvore(
    from: &Path,
    to: &Path,
    flag: &AtomicBool,
    emissor: &mut Emissor,
) -> Result<Fim, FsError> {
    if flag.load(Ordering::Relaxed) {
        return Ok(Fim::Cancelado);
    }
    if std::fs::symlink_metadata(com_long_path(from))?.is_dir() {
        std::fs::create_dir_all(com_long_path(to))?;
        for entry in std::fs::read_dir(com_long_path(from))?.filter_map(Result::ok) {
            if flag.load(Ordering::Relaxed) {
                return Ok(Fim::Cancelado);
            }
            let nome = entry.file_name();
            match copiar_arvore(&from.join(&nome), &to.join(&nome), flag, emissor)? {
                Fim::Cancelado => return Ok(Fim::Cancelado),
                Fim::Completo => {}
            }
        }
        Ok(Fim::Completo)
    } else {
        let n = std::fs::copy(com_long_path(from), com_long_path(to))?;
        emissor.avancar(n, false);
        Ok(Fim::Completo)
    }
}

/// Executa copy (ou move) com progresso. Retorna `true` se foi cancelada.
fn executar_progresso(
    mover: bool,
    from: &str,
    to: &str,
    op_id: u64,
    flag: &AtomicBool,
    app: &AppHandle,
) -> Result<bool, FsError> {
    validar(from)?;
    validar(to)?;
    let src = Path::new(from);
    let dst = Path::new(to);
    if com_long_path(dst).exists() {
        return Err(FsError::AlreadyExists(to.to_string()));
    }
    // Move mesmo-volume: rename é instantâneo, sem varredura.
    if mover && std::fs::rename(com_long_path(src), com_long_path(dst)).is_ok() {
        return Ok(false);
    }
    let total = total_bytes(src);
    let mut emissor = Emissor::novo(app, op_id, total);
    match copiar_arvore(src, dst, flag, &mut emissor)? {
        Fim::Cancelado => {
            let _ = remover(to); // limpa o parcial (best-effort)
            Ok(true)
        }
        Fim::Completo => {
            emissor.avancar(0, true); // 100% final
            if mover {
                remover(from)?; // move = copiou → apaga origem
            }
            Ok(false)
        }
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
    app: AppHandle,
) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let resultado = executar_progresso(mover, &from, &to, op_id, &flag, &app);
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
    app: AppHandle,
    pm: State<'_, ProgressManager>,
) -> Result<u64, FsError> {
    let (op_id, flag) = pm.nova_op();
    spawn_progresso(false, from, to, op_id, flag, app);
    Ok(op_id)
}

#[tauri::command]
pub async fn fs_move_with_progress(
    from: String,
    to: String,
    app: AppHandle,
    pm: State<'_, ProgressManager>,
) -> Result<u64, FsError> {
    let (op_id, flag) = pm.nova_op();
    spawn_progresso(true, from, to, op_id, flag, app);
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
