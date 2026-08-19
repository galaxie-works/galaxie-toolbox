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
    /// #820 (P0): o arquivo não é raster thumbnailável (vetor/svg, tipo não
    /// suportado, ou grande demais). Não é falha — o front usa ícone de TIPO.
    #[error("sem thumbnail raster: {0}")]
    NaoRasterizavel(String),
    /// #873: arquivo grande demais pro preview (acima do teto de bytes). O front
    /// mostra fallback com metadados (não é erro fatal).
    #[error("arquivo grande demais: {0}")]
    ArquivoGrande(String),
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
    /// #869: `fixed` | `removable` | `network` | `cdrom` | `ramdisk` | `cloud` |
    /// `unknown`. `network` (DRIVE_REMOTE) já dava as Network locations (W:); `cloud`
    /// é a heurística nova por filesystem name (Google DriveFS etc.) → ícone de nuvem
    /// no sidebar do #869.
    pub kind: String,
    /// #869: nome do filesystem (NTFS/FAT32/exFAT/DriveFS…) — sinal cru pro front
    /// classificar/refinar (a detecção de cloud parte daqui).
    pub fs_name: String,
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

/// #871: lote de resultados de busca emitido no evento `fs-search-result`.
/// O front filtra pelo `search_id` (várias buscas podem coexistir).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsSearchBatch {
    search_id: u64,
    entries: Vec<FsEntry>,
    /// Último lote da busca (mesmo vazio → fecha o loading do front).
    done: bool,
    /// Atingiu o teto de resultados (a busca parou antes de varrer tudo).
    truncated: bool,
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

/// Rejeita caminho inválido antes de tocar o disco (distinto de NotFound).
///
/// #1046 (SEC2): defesa-em-profundidade LÉXICA (sem `fs::canonicalize`, que
/// falharia num caminho de DESTINO ainda inexistente — create/copy/rename — e
/// quebraria a criação/cópia). Barra: vazio; caractere de controle
/// (`\0`..`\x1f`, via `is_control`); aspas dupla `"` (o vetor que furava a
/// concatenação do antigo `revelar_no_explorer`); e caminho não-absoluto
/// (`is_absolute` cobre `C:\...` e UNC `\\server\share` no Windows). Caminhos
/// legítimos do Explorer são sempre absolutos, então nenhum caller regride.
fn validar(path: &str) -> Result<(), FsError> {
    if path.trim().is_empty() {
        return Err(FsError::InvalidPath("caminho vazio".into()));
    }
    if path.chars().any(|c| c.is_control()) {
        return Err(FsError::InvalidPath(
            "caminho com caractere de controle".into(),
        ));
    }
    if path.contains('"') {
        return Err(FsError::InvalidPath("caminho com aspas duplas".into()));
    }
    if !Path::new(path).is_absolute() {
        return Err(FsError::InvalidPath("caminho precisa ser absoluto".into()));
    }
    // #1047 (SEC7): rejeita traversal léxico. Nenhum caminho legítimo do front usa
    // `..` (o front sempre manda absoluto já resolvido). Barra em TODOS os callers
    // (leitura+escrita) — é seguro. `Component::ParentDir` pega `..` em qualquer
    // posição, independente do separador (`/` ou `\`).
    if Path::new(path)
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(FsError::InvalidPath("caminho com '..'".into()));
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

// ─── #871: busca recursiva ("Search This PC"/"Search <pasta>") ───────────────
//
// Backend do Search context-aware do ribbon (#871, UI = Sirius). Varredura
// paralela (jwalk) sob a(s) raiz(es); casa por substring no NOME (case-insensitive).
// Streaming por lotes (evento `fs-search-result`) + cancelável (reusa o
// `ProgressManager`/`fs_cancel`) + teto de resultados — "Search This PC" pode
// varrer milhões de arquivos, então NUNCA segura tudo na memória nem trava.

/// Resolve as raízes da busca: `root` vazio = "This PC" (todos os drives LOCAIS
/// montados); senão a pasta dada.
///
/// #1073 (RB30): drives de REDE (`network`/DRIVE_REMOTE) ficam FORA do "This PC" —
/// varrê-los recursivamente numa share lenta/offline faz a busca parecer travada,
/// e o escopo documentado sempre foi "drives locais". `cloud` (OneDrive/Drive
/// montado) permanece: é um mount local com cache em disco.
fn raizes_de_busca(root: &str) -> Vec<PathBuf> {
    let t = root.trim();
    if t.is_empty() {
        listar_drives()
            .unwrap_or_default()
            .into_iter()
            .filter(|d| kind_no_escopo_this_pc(&d.kind))
            .map(|d| PathBuf::from(d.path))
            .collect()
    } else {
        vec![PathBuf::from(t)]
    }
}

/// #1073 (RB30): predicado puro do escopo "This PC" — inclui só drives LOCAIS.
/// `network` (DRIVE_REMOTE) fica de fora; `cdrom`/`ramdisk`/`unknown` também.
fn kind_no_escopo_this_pc(kind: &str) -> bool {
    matches!(kind, "fixed" | "removable" | "cloud")
}

/// Varre as raízes chamando `on_match` a cada arquivo/pasta cujo nome contém
/// `termo_lower`. `on_match` devolve `false` pra PARAR (teto atingido). Respeita
/// `cancel` entre entradas. Núcleo puro (sem `AppHandle`) → testável.
fn caminhar_busca<F: FnMut(FsEntry) -> bool>(
    raizes: &[PathBuf],
    termo_lower: &str,
    cancel: &AtomicBool,
    mut on_match: F,
) {
    for raiz in raizes {
        let base = com_long_path(raiz);
        for entry in jwalk::WalkDir::new(&base).skip_hidden(false) {
            if cancel.load(Ordering::Relaxed) {
                return;
            }
            let Ok(entry) = entry else { continue };
            if entry.depth() == 0 {
                continue; // a própria raiz não é resultado
            }
            let nome = entry.file_name().to_string_lossy().to_lowercase();
            if !nome.contains(termo_lower) {
                continue;
            }
            let p = entry.path();
            let Ok(m) = std::fs::symlink_metadata(com_long_path(&p)) else { continue };
            if !on_match(entry_de(&p, &m, entry.file_type().is_symlink())) {
                return;
            }
        }
    }
}

/// Coleta (sem streaming) até `max` matches — usado nos testes; a produção usa
/// [`executar_busca`] (streaming).
#[cfg(test)]
fn coletar_busca(raizes: &[PathBuf], termo: &str, max: usize) -> Vec<FsEntry> {
    let termo_lower = termo.trim().to_lowercase();
    let cancel = AtomicBool::new(false);
    let mut out = Vec::new();
    if termo_lower.is_empty() {
        return out;
    }
    caminhar_busca(raizes, &termo_lower, &cancel, |e| {
        out.push(e);
        out.len() < max
    });
    out
}

/// Busca streaming: emite `fs-search-result` a cada `batch` matches + um lote
/// terminal (`done`). Para no teto (`truncated=true`) ou no cancel.
fn executar_busca(
    root: &str,
    termo: &str,
    max_results: usize,
    batch: usize,
    search_id: u64,
    cancel: &Arc<AtomicBool>,
    app: &AppHandle,
) {
    let termo_lower = termo.trim().to_lowercase();
    let batch = batch.max(1);
    let teto = if max_results == 0 { usize::MAX } else { max_results };

    // Termo vazio não busca (evita casar tudo) — fecha o loading na hora.
    if termo_lower.is_empty() {
        let _ = app.emit(
            "fs-search-result",
            FsSearchBatch { search_id, entries: Vec::new(), done: true, truncated: false },
        );
        return;
    }

    let raizes = raizes_de_busca(root);
    let mut buffer: Vec<FsEntry> = Vec::with_capacity(batch);
    let mut achados = 0usize;
    let mut truncated = false;
    log::info!("fs_search START id={search_id}: termo={termo_lower:?}, {} raiz(es)", raizes.len());

    caminhar_busca(&raizes, &termo_lower, cancel, |e| {
        buffer.push(e);
        achados += 1;
        if buffer.len() >= batch {
            let lote = std::mem::take(&mut buffer);
            let _ = app.emit(
                "fs-search-result",
                FsSearchBatch { search_id, entries: lote, done: false, truncated: false },
            );
        }
        if achados >= teto {
            truncated = true;
            return false; // para a varredura
        }
        true
    });

    let _ = app.emit(
        "fs-search-result",
        FsSearchBatch { search_id, entries: buffer, done: true, truncated },
    );
    log::info!("fs_search END id={search_id}: {achados} match(es), truncated={truncated}");
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

/// #873: teto pra leitura de bytes de arquivo local pro preview (Wagner: 25MB).
const MAX_PREVIEW_BYTES: u64 = 25 * 1024 * 1024;

/// #873: MIME por extensão pro preview escolher o renderer (imagem/áudio/vídeo/
/// texto). Cobre os tipos que o `preview-arquivo.tsx` trata; o resto cai em
/// `application/octet-stream` (o front usa a extensão + fallback).
fn mime_de_ext(path: &str) -> &'static str {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "tif" | "tiff" => "image/tiff",
        "pdf" => "application/pdf",
        "txt" | "log" | "md" | "csv" => "text/plain",
        "html" | "htm" => "text/html",
        "json" => "application/json",
        "m4a" | "aac" => "audio/mp4",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "flac" => "audio/flac",
        "webm" => "video/webm",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "application/octet-stream",
    }
}

/// #873: lê os bytes de um arquivo local e devolve `AnexoConteudo`
/// (`{ bytesB64, contentType, nome }`) — o preview do Files consome IGUAL ao
/// anexo do Graph, SEM asset-protocol (o `convertFileSrc→fetch` falhava com
/// "failed to fetch" porque o `assetProtocol` não está habilitado no tauri.conf).
/// Guards: caminho válido, é ARQUIVO (não dir), ≤ `max_bytes` limitado a 25MB.
/// `metadata` (segue symlink) pra o teto valer sobre o conteúdo real.
/// #1044 SEC6: guards compartilhados de leitura de arquivo local — caminho válido
/// (absoluto), é ARQUIVO (não dir), tamanho ≤ teto (limitado ao hard cap de 25MB).
/// Devolve os bytes CRUS. É o funil único de leitura de disco a mando do front:
/// tanto o preview do Explorer quanto o anexo/compartilhamento do compositor
/// passam por aqui, então o front nunca precisa da capability `fs:allow-read-file`
/// aberta em `**` (leitura de disco arbitrária).
pub(crate) fn ler_bytes_cru(path: &str, max_bytes: Option<u64>) -> Result<Vec<u8>, FsError> {
    validar(path)?;
    let p = com_long_path(Path::new(path));
    let meta = std::fs::metadata(&p)?; // NotFound se não existe/broken symlink
    if meta.is_dir() {
        return Err(FsError::NotADirectory(format!("{path} é um diretório")));
    }
    // Teto = o pedido do front, mas nunca acima do hard cap de 25MB.
    let teto = max_bytes.unwrap_or(MAX_PREVIEW_BYTES).min(MAX_PREVIEW_BYTES);
    let size = meta.len();
    if size > teto {
        return Err(FsError::ArquivoGrande(format!("{path} ({size} bytes > {teto})")));
    }
    Ok(std::fs::read(&p)?)
}

fn ler_bytes_arquivo(path: &str, max_bytes: Option<u64>) -> Result<crate::graph::AnexoConteudo, FsError> {
    use base64::Engine;
    let bytes = ler_bytes_cru(path, max_bytes)?;
    let nome = Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(crate::graph::AnexoConteudo {
        bytes_b64: base64::engine::general_purpose::STANDARD.encode(bytes),
        content_type: mime_de_ext(path).to_string(),
        nome,
    })
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

        // Label do volume + filesystem name (#869) — best-effort (drive vazio fica sem).
        let mut label = [0u16; 261];
        let mut fsbuf = [0u16; 261];
        let mut nome = String::new();
        let mut fs_name = String::new();
        if unsafe {
            GetVolumeInformationW(pcw, Some(&mut label), None, None, None, Some(&mut fsbuf))
        }
        .is_ok()
        {
            let fim = label.iter().position(|&c| c == 0).unwrap_or(label.len());
            nome = String::from_utf16_lossy(&label[..fim]);
            let ff = fsbuf.iter().position(|&c| c == 0).unwrap_or(fsbuf.len());
            fs_name = String::from_utf16_lossy(&fsbuf[..ff]);
        }

        // #869: mount de nuvem vira `cloud` (ícone dedicado no sidebar). Heurística
        // CONSERVADORA pelo filesystem name — só marca provedores conhecidos; qualquer
        // dúvida cai no tipo do `GetDriveTypeW`, nunca rotula um NTFS real como cloud.
        let kind_final = if eh_cloud_fs(&fs_name) { "cloud" } else { kind };

        drives.push(DriveInfo {
            path: raiz,
            name: nome,
            kind: kind_final.to_string(),
            fs_name,
            total_space: total,
            free_space: free,
        });
    }
    Ok(drives)
}

/// #869: o filesystem name é de um provedor de nuvem montado como drive? Conservador
/// — só nomes documentados (Google Drive File Stream = `DriveFS`); o resto NÃO é
/// cloud (evita mislabel de NTFS/exFAT reais). O front refina com o `fs_name` cru.
#[cfg(windows)]
fn eh_cloud_fs(fs_name: &str) -> bool {
    let f = fs_name.trim().to_ascii_lowercase();
    matches!(f.as_str(), "drivefs")
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
        fs_name: String::new(),
        total_space: 0,
        free_space: 0,
    }])
}

// ─── #869: detecção de Cloud drives (opção A do Wagner) ──────────────────────
//
// OneDrive sincroniza pra uma PASTA (não uma letra) sob o perfil — exposta pelas
// env vars do cliente (`%OneDriveConsumer%` pessoal, `%OneDriveCommercial%`
// tenant, `%OneDrive%` primário). Google Drive Desktop monta uma LETRA (fs
// `DriveFS`), que o `listar_drives` já marca kind=`cloud`. Este comando junta os
// dois num "Cloud drives" só pro sidebar (#869 do Vega). Multi-org OneDrive
// (Business2+ via registro) fica pra follow-up — env cobre o primário de cada.

/// Um mount de nuvem — pasta (OneDrive) ou letra (Google Drive Desktop).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CloudLocation {
    pub path: String,
    pub name: String,
    /// `onedrive` | `onedriveCommercial` | `googledrive` — o front escolhe o logo.
    pub provider: String,
    /// `folder` (OneDrive) | `drive` (letra montada).
    pub kind: String,
}

/// Nome de exibição de uma pasta de nuvem = o último componente do caminho
/// (ex.: "OneDrive - Contoso"); cai pro caminho cru se não houver leaf.
fn nome_cloud_folder(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| path.to_string())
}

/// Monta a `CloudLocation` de um mount de PASTA se o caminho existe de fato
/// (env var setada mas pasta ausente = conta desconectada → fora).
fn cloud_pasta(valor: Option<String>, provider: &str) -> Option<CloudLocation> {
    let p = valor?.trim().to_string();
    if p.is_empty() || !caminho_existe(&p) {
        return None;
    }
    Some(CloudLocation {
        name: nome_cloud_folder(&p),
        path: p,
        provider: provider.to_string(),
        kind: "folder".into(),
    })
}

/// #1286 — uma conta OneDrive lida do registro
/// (`HKCU\Software\Microsoft\OneDrive\Accounts\<Personal|BusinessN>`).
///
/// As env vars cobrem **um** pessoal + **um** comercial; quem sincroniza vários
/// tenants (o caso do PO: 8 contas) via só 2. O registro tem todas.
#[derive(Debug, Clone, PartialEq)]
pub struct ContaOneDrive {
    /// Nome da chave: `Personal`, `Business1`, `Business2`… Decide o provider.
    pub chave: String,
    /// `DisplayName` (ou `UserEmail`) — rótulo legível.
    pub display_name: String,
    /// `UserFolder` — a pasta de sync da conta.
    pub user_folder: String,
    /// Bibliotecas SharePoint sincronizadas (`Tenants\<org>`): (org, caminho).
    pub bibliotecas: Vec<(String, String)>,
}

impl ContaOneDrive {
    fn comercial(&self) -> bool {
        !self.chave.eq_ignore_ascii_case("Personal")
    }

    fn provider(&self) -> &'static str {
        if self.comercial() {
            "onedriveCommercial"
        } else {
            "onedrive"
        }
    }

    /// Rótulo da conta: `DisplayName` quando existe; senão o leaf da pasta (que
    /// o próprio cliente do OneDrive já nomeia "OneDrive - <org>").
    fn rotulo(&self) -> String {
        let d = self.display_name.trim();
        if d.is_empty() {
            nome_cloud_folder(&self.user_folder)
        } else {
            d.to_string()
        }
    }
}

/// Chave de dedupe: caminho sem separador final, minúsculo. O Windows não
/// distingue caixa, e registro e env divergem na barra final.
/// Onde o cliente do OneDrive registra as contas do usuario.
#[cfg(windows)]
const CAMINHO_CONTAS_ONEDRIVE: &str = r"Software\Microsoft\OneDrive\Accounts";

fn chave_caminho(p: &str) -> String {
    p.trim().trim_end_matches(['\\', '/']).to_ascii_lowercase()
}

/// #1286 — monta os mounts a partir das contas do registro.
///
/// **Puro de propósito**: recebe a lista E o verificador de existência, então o
/// teste injeta os dois e não toca registro nem disco (é o DoD do card).
///
/// Ordem: conta por conta na ordem recebida (Personal primeiro), a raiz e logo
/// abaixo as bibliotecas daquela conta — é o que agrupa cada biblioteca sob a
/// org a que ela pertence.
fn montar_clouds_onedrive(
    contas: &[ContaOneDrive],
    existe: impl Fn(&str) -> bool,
) -> Vec<CloudLocation> {
    let mut out: Vec<CloudLocation> = Vec::new();
    let mut vistos: Vec<String> = Vec::new();

    for conta in contas {
        let provider = conta.provider();
        let mut empurrar = |path: &str, name: String| {
            let p = path.trim();
            // Conta cuja pasta sumiu do disco NÃO vira mount morto (AC).
            if p.is_empty() || !existe(p) {
                return;
            }
            let chave = chave_caminho(p);
            if vistos.contains(&chave) {
                return;
            }
            vistos.push(chave);
            out.push(CloudLocation {
                path: p.to_string(),
                name,
                provider: provider.to_string(),
                kind: "folder".into(),
            });
        };

        empurrar(&conta.user_folder, conta.rotulo());
        for (org, caminho) in &conta.bibliotecas {
            let leaf = nome_cloud_folder(caminho);
            let org = org.trim();
            let nome = if org.is_empty() || leaf.contains(org) {
                leaf
            } else {
                format!("{org} — {leaf}")
            };
            empurrar(caminho, nome);
        }
    }
    out
}

/// Junta as pastas de nuvem (dedup por caminho, 1º provider ganha) com os drives
/// kind=`cloud` (Google Drive por letra). Puro → testável sem env/FS real.
fn montar_clouds(
    do_registro: Vec<CloudLocation>,
    pastas: &[(Option<String>, &str)],
    drives: Vec<DriveInfo>,
) -> Vec<CloudLocation> {
    // #1286: o registro e a fonte completa; o env vira COMPLEMENTO (maquina sem
    // a chave -- edge do AC), nunca substituto. Entra depois, e o dedup por
    // caminho o descarta quando o registro ja trouxe a mesma pasta.
    let mut out: Vec<CloudLocation> = do_registro;
    for (valor, provider) in pastas {
        if let Some(c) = cloud_pasta(valor.clone(), provider) {
            let chave = chave_caminho(&c.path);
            if !out.iter().any(|x| chave_caminho(&x.path) == chave) {
                out.push(c);
            }
        }
    }
    for d in drives.into_iter().filter(|d| d.kind == "cloud") {
        let letra = d.path.trim_end_matches('\\');
        let nome = if d.name.trim().is_empty() {
            format!("Google Drive ({letra})")
        } else {
            format!("{} ({letra})", d.name.trim())
        };
        out.push(CloudLocation {
            path: d.path,
            name: nome,
            provider: "googledrive".into(),
            kind: "drive".into(),
        });
    }
    out
}

/// Detecta os mounts de nuvem locais: OneDrive (env) + Google Drive (letra).
fn detectar_clouds() -> Vec<CloudLocation> {
    let pastas = [
        (std::env::var("OneDriveConsumer").ok(), "onedrive"),
        (std::env::var("OneDriveCommercial").ok(), "onedriveCommercial"),
        // primário (dedup evita repetir se == a um dos acima).
        (std::env::var("OneDrive").ok(), "onedrive"),
    ];
    // #1286: registro primeiro (todas as contas + bibliotecas), env de reserva.
    let do_registro = montar_clouds_onedrive(&ler_contas_onedrive(), caminho_existe);
    let drives = listar_drives().unwrap_or_default();
    montar_clouds(do_registro, &pastas, drives)
}

/// #1286 — lê TODAS as contas OneDrive do registro do usuário. Camada impura,
/// isolada de propósito: quem tem teste é a `montar_clouds_onedrive`.
///
/// Best-effort em cada passo — máquina sem a chave (ou uma conta corrompida)
/// devolve o que deu, e o `detectar_clouds` completa pelo env. O comando nunca
/// falha inteiro por causa do registro.
#[cfg(windows)]
fn ler_contas_onedrive() -> Vec<ContaOneDrive> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(contas) = hkcu.open_subkey(CAMINHO_CONTAS_ONEDRIVE) else {
        return Vec::new();
    };

    // `Personal` antes de `Business*` — é a ordem que o usuário espera ver.
    let mut chaves: Vec<String> = contas.enum_keys().flatten().collect();
    chaves.sort_by_key(|k| (!k.eq_ignore_ascii_case("Personal"), k.to_ascii_lowercase()));

    let mut out = Vec::new();
    for chave in chaves {
        let Ok(k) = contas.open_subkey(&chave) else {
            continue;
        };
        let Ok(user_folder) = k.get_value::<String, _>("UserFolder") else {
            continue;
        };
        let display_name = k
            .get_value::<String, _>("DisplayName")
            .or_else(|_| k.get_value::<String, _>("UserEmail"))
            .unwrap_or_default();

        // `Tenants\<org>`: cada VALOR é uma biblioteca sincronizada. O nome do
        // valor costuma ser o caminho local; em outras versões o caminho está no
        // dado. Aceito os dois e fico com o que existe no disco — fixar um
        // formato só deixaria bibliotecas de fora em silêncio.
        let mut bibliotecas = Vec::new();
        if let Ok(tenants) = k.open_subkey("Tenants") {
            for org in tenants.enum_keys().flatten() {
                let Ok(t) = tenants.open_subkey(&org) else {
                    continue;
                };
                for (nome_valor, dado) in t.enum_values().flatten() {
                    let do_dado = dado.to_string();
                    let candidato = if caminho_existe(&nome_valor) {
                        Some(nome_valor.clone())
                    } else if caminho_existe(&do_dado) {
                        Some(do_dado)
                    } else {
                        None
                    };
                    if let Some(c) = candidato {
                        bibliotecas.push((org.clone(), c));
                    }
                }
            }
        }

        out.push(ContaOneDrive {
            chave,
            display_name,
            user_folder,
            bibliotecas,
        });
    }
    out
}

/// Fora do Windows não há registro — o `detectar_clouds` cai no env.
#[cfg(not(windows))]
fn ler_contas_onedrive() -> Vec<ContaOneDrive> {
    Vec::new()
}


// ─── #871: mapear/desconectar network drive (menu "New → Network drive") ─────
//
// Backend do item "Network drive" do `New ▾` do ribbon (#871, UI = Sirius). Usa
// WNet (WNetAddConnection2W/WNetCancelConnection2W) — sem credenciais explícitas
// (usa a sessão atual; prompt de credencial fica pra follow-up). "Add network
// location" (atalho nethood sem letra) é mecanismo de shell diferente → outra fatia.

/// Normaliza uma letra de drive pra "Z:" (aceita "z", "Z", "Z:", "Z:\").
/// #1076 (RB32): só usada pelo mapeamento de network drive (Win32) — `#[cfg(windows)]`
/// pra não virar dead_code fora do Windows.
#[cfg(windows)]
fn normalizar_letra_drive(s: &str) -> Result<String, FsError> {
    let t = s.trim().trim_end_matches(['\\', '/']).trim_end_matches(':');
    let mut chars = t.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) if c.is_ascii_alphabetic() => Ok(format!("{}:", c.to_ascii_uppercase())),
        _ => Err(FsError::InvalidPath(format!("letra de drive inválida: {s}"))),
    }
}

/// Valida um caminho UNC de rede (`\\server\share`): 2 barras iniciais + server
/// + separador + share.
/// #1076 (RB32): só usada pelo mapeamento de network drive (Win32) — `#[cfg(windows)]`
/// pra não virar dead_code fora do Windows.
#[cfg(windows)]
fn validar_unc(p: &str) -> Result<(), FsError> {
    let t = p.trim();
    let dupla = t.starts_with("\\\\") || t.starts_with("//");
    let tem_share = t.len() > 2 && t[2..].contains(['\\', '/']);
    if dupla && tem_share {
        Ok(())
    } else {
        Err(FsError::InvalidPath(format!(
            "caminho de rede inválido (esperado \\\\server\\share): {p}"
        )))
    }
}

#[cfg(windows)]
fn mapear_network_drive(letra: &str, remoto: &str, persistente: bool) -> Result<(), FsError> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::NetworkManagement::WNet::{
        WNetAddConnection2W, CONNECT_TEMPORARY, CONNECT_UPDATE_PROFILE, NETRESOURCEW,
        RESOURCETYPE_DISK,
    };

    let letra = normalizar_letra_drive(letra)?;
    validar_unc(remoto)?;
    let mut local: Vec<u16> = letra.encode_utf16().chain(std::iter::once(0)).collect();
    let mut rem: Vec<u16> = remoto.encode_utf16().chain(std::iter::once(0)).collect();

    let nr = NETRESOURCEW {
        dwType: RESOURCETYPE_DISK,
        lpLocalName: PWSTR(local.as_mut_ptr()),
        lpRemoteName: PWSTR(rem.as_mut_ptr()),
        ..Default::default()
    };
    let flags = if persistente { CONNECT_UPDATE_PROFILE } else { CONNECT_TEMPORARY };
    // Sem password/username → usa as credenciais da sessão atual.
    let rc = unsafe { WNetAddConnection2W(&nr, PCWSTR::null(), PCWSTR::null(), flags) };
    if rc.is_ok() {
        log::info!("fs_map_network_drive: {letra} → {remoto} (persistente={persistente}) OK");
        Ok(())
    } else {
        log::error!("fs_map_network_drive: {letra} → {remoto} falhou (WNet {})", rc.0);
        Err(FsError::Io(format!("mapear network drive falhou (código WNet {})", rc.0)))
    }
}

#[cfg(windows)]
fn desconectar_network_drive(letra: &str, forcar: bool) -> Result<(), FsError> {
    use windows::core::PCWSTR;
    use windows::Win32::NetworkManagement::WNet::{WNetCancelConnection2W, CONNECT_UPDATE_PROFILE};

    let letra = normalizar_letra_drive(letra)?;
    let nome: Vec<u16> = letra.encode_utf16().chain(std::iter::once(0)).collect();
    let rc = unsafe { WNetCancelConnection2W(PCWSTR(nome.as_ptr()), CONNECT_UPDATE_PROFILE, forcar) };
    if rc.is_ok() {
        log::info!("fs_disconnect_network_drive: {letra} desconectado (forçado={forcar})");
        Ok(())
    } else {
        log::error!("fs_disconnect_network_drive: {letra} falhou (WNet {})", rc.0);
        Err(FsError::Io(format!("desconectar network drive falhou (código WNet {})", rc.0)))
    }
}

#[cfg(not(windows))]
fn mapear_network_drive(_letra: &str, _remoto: &str, _persistente: bool) -> Result<(), FsError> {
    Err(FsError::Io("network drive só é suportado no Windows".into()))
}

#[cfg(not(windows))]
fn desconectar_network_drive(_letra: &str, _forcar: bool) -> Result<(), FsError> {
    Err(FsError::Io("network drive só é suportado no Windows".into()))
}

// ────────────────────────── Mutações (S3, #679) ─────────────────────────────
// Delete → Lixeira é o PADRÃO (reversível); permanente só com token de
// confirmação (o front manda depois do Shift+confirmar). Tudo tipado em FsError.

// ───────────────── #1047 (SEC7): funil de segurança das mutações ─────────────

/// Normaliza a caixa pra comparação de caminho no Windows (case-insensitive).
/// Baixa a string inteira; a comparação depois é POR COMPONENTE (`starts_with`
/// do `Path`), então o limite de pasta é respeitado (`C:\Foo` não casa `C:\Foobar`).
#[cfg(windows)]
fn normalizar_caixa(p: &Path) -> PathBuf {
    PathBuf::from(p.to_string_lossy().to_lowercase())
}
#[cfg(not(windows))]
fn normalizar_caixa(p: &Path) -> PathBuf {
    p.to_path_buf()
}

/// Absolutiza SEM tocar o disco (fallback quando a canonicalização falha). O
/// caller (`validar`) já exige caminho absoluto, então o ramo do `cwd` é defensivo.
fn absolutizar_lexical(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else if let Ok(cwd) = std::env::current_dir() {
        cwd.join(path)
    } else {
        path.to_path_buf()
    }
}

/// Resolve um caminho pra checagem de diretório sensível: canonicaliza o ANCESTRAL
/// EXISTENTE mais profundo (sobe com `.parent()` até um existir) e re-anexa a cauda
/// inexistente. Assim um caminho A-SER-criado (create/copy/rename) ainda resolve.
/// `dunce::canonicalize` evita o prefixo verbatim `\\?\` (que quebraria o
/// `starts_with` contra as raízes). NUNCA panica: qualquer falha cai no lexical.
fn resolver_para_checagem(path: &Path) -> PathBuf {
    let mut cauda: Vec<std::ffi::OsString> = Vec::new();
    let mut atual = path;
    loop {
        if let Ok(canon) = dunce::canonicalize(atual) {
            let mut resolvido = canon;
            // `cauda` acumulou folha→raiz; re-anexa raiz→folha (rev).
            for parte in cauda.iter().rev() {
                resolvido.push(parte);
            }
            return resolvido;
        }
        match atual.parent() {
            Some(pai) => {
                if let Some(nome) = atual.file_name() {
                    cauda.push(nome.to_os_string());
                }
                atual = pai;
            }
            None => break,
        }
    }
    absolutizar_lexical(path)
}

/// PURO (raízes por parâmetro → testável): `resolvido` está dentro de alguma raiz?
/// Compara por componente após normalizar a caixa (Windows case-insensitive).
fn dentro_de_dir_sensivel(resolvido: &Path, raizes: &[PathBuf]) -> bool {
    let alvo = normalizar_caixa(resolvido);
    raizes
        .iter()
        .any(|r| alvo.starts_with(normalizar_caixa(r)))
}

/// Canonicaliza `p` e empurra pra lista SÓ se existir (raiz que não resolve é
/// ignorada — não trava mutação por causa de pasta ausente).
fn push_se_existe(raizes: &mut Vec<PathBuf>, p: PathBuf) {
    if let Ok(canon) = dunce::canonicalize(&p) {
        raizes.push(canon);
    }
}

/// Diretórios cuja MUTAÇÃO é sempre recusada: System32, a pasta do próprio app
/// (não sobrescrever binário/DLLs) e a Startup do usuário (vetor de persistência).
/// Cada uma canonicalizada se existir; as que não resolvem são ignoradas.
fn raizes_sensiveis() -> Vec<PathBuf> {
    let mut raizes: Vec<PathBuf> = Vec::new();
    // %SystemRoot%\System32 (Windows).
    if let Some(sysroot) = std::env::var_os("SystemRoot") {
        push_se_existe(&mut raizes, Path::new(&sysroot).join("System32"));
    }
    // Diretório do próprio executável.
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
    {
        push_se_existe(&mut raizes, dir);
    }
    // Startup do usuário (%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup).
    if let Some(appdata) = std::env::var_os("APPDATA") {
        push_se_existe(
            &mut raizes,
            Path::new(&appdata).join(r"Microsoft\Windows\Start Menu\Programs\Startup"),
        );
    }
    raizes
}

/// Guarda das ESCRITAS: `validar` (léxico) + hard-block de diretório sensível.
/// Sempre-recusado (não há UI de bypass) — mais rígido que a AC, que só pede
/// "sem confirmação → recusado". Não usado nas LEITURAS (listar System32 é ok).
fn validar_mutacao(path: &str) -> Result<(), FsError> {
    validar(path)?;
    let resolvido = resolver_para_checagem(Path::new(path));
    if dentro_de_dir_sensivel(&resolvido, &raizes_sensiveis()) {
        return Err(FsError::InvalidPath(
            "mutação em diretório protegido do sistema recusada".into(),
        ));
    }
    Ok(())
}

/// O caminho é um reparse point (symlink/junction)? Testa a PRÓPRIA entrada
/// (`symlink_metadata` não segue). Windows: atributo `FILE_ATTRIBUTE_REPARSE_POINT`;
/// não-Windows: `file_type().is_symlink()`. Erro → `false`.
#[cfg(windows)]
fn eh_reparse_point(p: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    std::fs::symlink_metadata(com_long_path(p))
        .map(|m| m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
        .unwrap_or(false)
}
#[cfg(not(windows))]
fn eh_reparse_point(p: &Path) -> bool {
    std::fs::symlink_metadata(p)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

/// Directory-ness BRUTA (nível do link). No Windows um dir-symlink/junction tem
/// o bit `FILE_ATTRIBUTE_DIRECTORY` no `symlink_metadata`, embora `Metadata::is_dir`
/// o mascare por ser reparse point — por isso lemos o atributo cru. Não-Windows: `is_dir`.
#[cfg(windows)]
fn eh_dir_bruto(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
    meta.file_attributes() & FILE_ATTRIBUTE_DIRECTORY != 0
}
#[cfg(not(windows))]
fn eh_dir_bruto(meta: &std::fs::Metadata) -> bool {
    meta.is_dir()
}

/// Decisão PURA (testável sem privilégio): um dir que é reparse point é removido
/// como LINK (`remove_dir` no ponto), NUNCA `remove_dir_all` (que atravessaria pro
/// alvo real = data-loss). Só `is_dir && is_reparse`.
fn deve_remover_como_link(is_dir: bool, is_reparse: bool) -> bool {
    is_dir && is_reparse
}

/// Ancestral EXISTENTE mais próximo de `p` (o dir onde a escrita realmente cairia).
fn parent_existente(p: &Path) -> Option<PathBuf> {
    let mut atual = p.parent();
    while let Some(dir) = atual {
        if std::fs::symlink_metadata(com_long_path(dir)).is_ok() {
            return Some(dir.to_path_buf());
        }
        atual = dir.parent();
    }
    None
}

/// #1047 (SEC7): recusa escrever num destino que é reparse point OU cujo pai
/// existente é reparse point — não segue o symlink/junction pra fora da pasta
/// esperada sem confirmação (não há UI de bypass → hard-block).
fn destino_seguro(dst: &Path) -> Result<(), FsError> {
    let alvo = eh_reparse_point(dst);
    let pai = parent_existente(dst)
        .map(|pai| eh_reparse_point(&pai))
        .unwrap_or(false);
    if alvo || pai {
        return Err(FsError::InvalidPath(
            "destino é symlink/junction — não seguido sem confirmação".into(),
        ));
    }
    Ok(())
}

/// #1047 (SEC7): guarda de ENTRADA do pipeline turbo de cópia. A UI copia/move
/// pelos comandos `fs_*_with_progress` (não pelas `copiar`/`mover` internas), que
/// disparam a op em background — então a validação tem que acontecer AQUI, antes
/// do spawn, senão o hard-block de dir sensível/reparse não cobre o caminho real
/// (o buraco do SEC7). Origem = LEITURA (`validar`); destino = ESCRITA
/// (`validar_mutacao` + `destino_seguro`).
fn checar_entrada_copia(from: &str, to: &str) -> Result<(), FsError> {
    validar(from)?;
    validar_mutacao(to)?;
    destino_seguro(Path::new(to))
}

/// Idem, mas MOVE: a origem também é mutada (o move apaga `from` no fim) → a
/// origem passa por `validar_mutacao` (não pode mover pra fora de dir protegido).
fn checar_entrada_move(from: &str, to: &str) -> Result<(), FsError> {
    validar_mutacao(from)?;
    validar_mutacao(to)?;
    destino_seguro(Path::new(to))
}

/// Entrada dos comandos "muitas": valida o `dest_dir` (escrita) e cada origem.
/// `eh_move` decide se a origem é leitura (copy) ou mutação (move).
fn checar_entrada_muitas(sources: &[String], dest_dir: &str, eh_move: bool) -> Result<(), FsError> {
    validar_mutacao(dest_dir)?;
    destino_seguro(Path::new(dest_dir))?;
    for s in sources {
        if eh_move {
            validar_mutacao(s)?;
        } else {
            validar(s)?;
        }
    }
    Ok(())
}

/// #1047 (SEC7): nonce de sessão que autoriza a exclusão PERMANENTE — substitui o
/// token hardcoded (`galaxie-excluir-permanente`), que qualquer um podia forjar.
/// Single-use (zera ao consumir) + deadline (TTL). Estado gerenciado pelo Tauri;
/// `Arc<Mutex<…>>` interno pra ser `Clone`/`Send` e cruzar o `spawn_blocking`.
#[derive(Clone, Default)]
pub struct TokenExclusao(Arc<Mutex<Option<(String, Instant)>>>);

impl TokenExclusao {
    /// Emite um nonce com TTL padrão (30s) — janela suficiente pro round-trip da UI.
    fn emitir(&self) -> String {
        self.emitir_com_ttl(Duration::from_secs(30))
    }
    /// Emite um nonce 128-bit (hex) válido por `ttl`; sobrescreve o anterior.
    fn emitir_com_ttl(&self, ttl: Duration) -> String {
        let nonce = format!("{:032x}", rand::random::<u128>());
        let deadline = Instant::now() + ttl;
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = Some((nonce.clone(), deadline));
        nonce
    }
    /// Confere o nonce apresentado (igual + dentro do prazo). Em sucesso ZERA o
    /// estado (single-use): o mesmo nonce não vale duas vezes.
    fn consumir(&self, apresentado: &str) -> bool {
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let ok = matches!(&*guard, Some((n, dl)) if n == apresentado && Instant::now() < *dl);
        if ok {
            *guard = None;
        }
        ok
    }
}

fn criar_dir(path: &str) -> Result<(), FsError> {
    validar_mutacao(path)?;
    // `create_dir` (não `_all`) → AlreadyExists se a pasta já existe.
    std::fs::create_dir(com_long_path(Path::new(path)))?;
    Ok(())
}

fn criar_arquivo(path: &str, contents: Option<String>) -> Result<(), FsError> {
    use std::io::Write;
    validar_mutacao(path)?;
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
    validar_mutacao(from)?;
    validar_mutacao(to)?;
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
    // #1047 (SEC7): a ORIGEM da cópia é LEITURA (não muta `from`) → só `validar`
    // (absoluto/sem `..`/sem control-char). O bloqueio de dir sensível vale pro
    // DESTINO (escrita). O `mover` cross-volume que chama `copiar` já validou o
    // `from` como mutação no topo dele, então o delete pós-cópia segue protegido.
    validar(from)?;
    validar_mutacao(to)?;
    let src = Path::new(from);
    let dst = Path::new(to);
    // #1047 (SEC7): não seguir symlink/junction no destino (nem no pai existente).
    destino_seguro(dst)?;
    if std::fs::symlink_metadata(com_long_path(src))?.is_dir() {
        copiar_dir(src, dst)
    } else {
        // #680: a UI já detecta conflito (`fs_check_conflicts`) e o usuário decide.
        // "Substituir" chega como o MESMO destino — o backend HONRA a decisão e
        // sobrescreve (std::fs::copy trunca). "Manter ambos" chega com nome livre;
        // "Pular" nem chama. (Casa com `copiar_arquivo` do pipeline, que já trunca.)
        std::fs::copy(com_long_path(src), com_long_path(dst))?;
        Ok(())
    }
}

fn copiar_dir(src: &Path, dst: &Path) -> Result<(), FsError> {
    use rayon::prelude::*;
    std::fs::create_dir_all(com_long_path(dst))?;
    // #1066: NÃO engolir `DirEntry` com erro. O `filter_map(Result::ok)` antigo
    // descartava entradas em silêncio → a cópia terminava Ok sem elas e o `mover`
    // apagava a origem = perda de dado. Agora um erro de enumeração ABORTA a cópia.
    let mut entradas: Vec<std::fs::DirEntry> = Vec::new();
    for e in std::fs::read_dir(com_long_path(src))? {
        entradas.push(e?);
    }
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
/// #1066: hoje é caminho INTERNO (undo em `executar_undo`) — não há mais comando
/// Tauri paralelo (`fs_copy`/`fs_move` foram removidos); a UI só usa o pipeline
/// turbo. Mantido pro undo e testes.
fn mover(from: &str, to: &str) -> Result<(), FsError> {
    validar_mutacao(from)?;
    validar_mutacao(to)?;
    // #1047 (SEC7): destino não pode ser symlink/junction (nem o pai existente).
    destino_seguro(Path::new(to))?;
    let dest = com_long_path(Path::new(to));
    // #680: paridade com o copy — "Substituir" honra a decisão da UI e sobrescreve.
    // std::fs::rename troca um arquivo existente (REPLACE_EXISTING no Windows;
    // rename atômico no Unix). "Manter ambos" chega com nome livre; "Pular" não chama.
    if std::fs::rename(com_long_path(Path::new(from)), &dest).is_ok() {
        return Ok(());
    }
    // Fallback cross-volume: copia recursivo e SÓ apaga a origem se a cópia foi
    // completa. #1066: `copiar` agora propaga erro de enumeração/I/O (nunca Ok
    // parcial), então `remover` só roda quando tudo copiou — sem perda de dado.
    copiar(from, to)?;
    remover(from)
}

fn remover(path: &str) -> Result<(), FsError> {
    let p = Path::new(path);
    let meta = std::fs::symlink_metadata(com_long_path(p))?;
    let is_dir = eh_dir_bruto(&meta);
    if deve_remover_como_link(is_dir, eh_reparse_point(p)) {
        // #1047 (SEC7) DATA-LOSS-crítico: dir que é reparse point (symlink/junction)
        // é removido como LINK (`remove_dir` apaga só o ponto). JAMAIS `remove_dir_all`,
        // que atravessaria pro alvo real e apagaria o conteúdo apontado (perda de dado).
        std::fs::remove_dir(com_long_path(p))?;
    } else if is_dir {
        std::fs::remove_dir_all(com_long_path(p))?;
    } else {
        // Arquivo ou symlink-de-arquivo: remove a própria entrada (não segue).
        std::fs::remove_file(com_long_path(p))?;
    }
    Ok(())
}

/// #849: o caminho ainda existe no disco? `symlink_metadata` não segue link, então
/// testa a PRÓPRIA entrada (não o alvo). Usado pra tornar o delete IDEMPOTENTE — um
/// caminho que já sumiu (2º/3º clique concorrente) não vira erro barulhento.
fn caminho_existe(p: &str) -> bool {
    std::fs::symlink_metadata(com_long_path(Path::new(p))).is_ok()
}

/// Comprimento clássico do MAX_PATH do Windows (260, inclui o NUL). A Lixeira do
/// shell (IFileOperation) não alcança caminhos a partir daqui.
const MAX_PATH: usize = 260;

/// #1073 (RB29): o caminho estoura o MAX_PATH clássico? A Lixeira do shell
/// (`IFileOperation`/`SHCreateItemFromParsingName`, usada pelo crate `trash`) NÃO
/// alcança caminhos a partir de 260 nem aceita o prefixo verbatim `\\?\`. Caminhos
/// longos (comuns em SharePoint/OneDrive) NÃO podem ir pra Lixeira — ver `para_lixeira`.
fn excede_max_path(p: &str) -> bool {
    p.chars().count() >= MAX_PATH
}

/// Manda os itens pra Lixeira do SO (batch, reversível pelo usuário). #849: loga
/// (START/END/ERRO, "como o Delphero" no GALAXIE.log) e é IDEMPOTENTE — filtra os
/// caminhos que já sumiram (delete concorrente do 3x-clique); todos já idos = no-op.
///
/// #1073 (RB29 — decisão do PO): caminhos curtos vão pra Lixeira (reversível). Caminho
/// >= MAX_PATH a Lixeira do shell NÃO alcança → **FALHA EXPLÍCITA preservando o
/// arquivo**, JAMAIS delete permanente silencioso. O usuário pediu "Lixeira"
/// (reversível), não "apagar": entregar irreversível seria fazer coisa diferente da que
/// ele mandou, e caminho profundo é o DIA A DIA de quem migra OneDrive/SharePoint (dado
/// de cliente real), não borda. Os longos ficam INTACTOS e o erro nomeia o porquê (a UI
/// mostra). Delete permanente de caminho longo, se desejado, é ação ESCOLHIDA com
/// confirmação na UI — US-filha de front, nunca consequência de clicar "Lixeira".
fn para_lixeira(paths: &[String]) -> Result<(), FsError> {
    if paths.is_empty() {
        return Ok(());
    }
    for p in paths {
        validar(p)?;
    }
    let (longos, curtos): (Vec<&str>, Vec<&str>) = paths
        .iter()
        .filter(|p| caminho_existe(p))
        .map(String::as_str)
        .partition(|p| excede_max_path(p));
    let ja_idos = paths.len() - longos.len() - curtos.len();
    log::info!(
        "fs_trash START: {} para a Lixeira, {} longo(s) intocado(s) (>= MAX_PATH), {ja_idos} já removido(s)/ignorado(s)",
        curtos.len(),
        longos.len()
    );

    // Curtos vão pra Lixeira (reversível) — independentemente dos longos.
    if !curtos.is_empty() {
        let total = curtos.len();
        if let Err(e) = trash::delete_all(&curtos) {
            log::error!("fs_trash ERRO: {e} ({total} alvo(s))");
            return Err(FsError::Io(format!("lixeira: {e}")));
        }
        log::info!("fs_trash END: {total} item(ns) na Lixeira OK");
    }

    // #1073 RB29 (decisão do PO): caminho >= MAX_PATH → falha EXPLÍCITA, arquivo
    // INTACTO. Falha (recuperável) > delete permanente (irrecuperável). Nunca apaga
    // pra sempre um item que o usuário mandou pra Lixeira.
    if !longos.is_empty() {
        let nomes = longos.join(", ");
        log::warn!(
            "fs_trash: {} caminho(s) excedem o MAX_PATH ({MAX_PATH}) — a Lixeira não os alcança; NÃO excluídos (intactos): {nomes}",
            longos.len()
        );
        return Err(FsError::Io(format!(
            "{} caminho(s) excedem o limite de {MAX_PATH} caracteres do Windows e a Lixeira não os alcança — não foram excluídos e permanecem intactos.",
            longos.len()
        )));
    }
    Ok(())
}

/// Apaga PERMANENTEMENTE (sem Lixeira) — exige o nonce de sessão (#1047). #849: loga
/// (Delphero) e é IDEMPOTENTE (caminho já sumido não vira erro; conta e segue).
fn excluir_permanente(
    paths: &[String],
    confirm_token: &str,
    token: &TokenExclusao,
) -> Result<(), FsError> {
    // #1047 (SEC7): nonce de sessão single-use no lugar do token hardcoded.
    if !token.consumir(confirm_token) {
        return Err(FsError::InvalidPath(
            "exclusão permanente requer confirmação válida (nonce)".into(),
        ));
    }
    log::info!("fs_delete_permanent START: {} alvo(s)", paths.len());
    let mut removidos = 0usize;
    let mut ja_idos = 0usize;
    for p in paths {
        validar_mutacao(p)?;
        if !caminho_existe(p) {
            ja_idos += 1;
            continue;
        }
        if let Err(e) = remover(p) {
            log::error!("fs_delete_permanent ERRO em {p}: {e}");
            return Err(e);
        }
        removidos += 1;
    }
    log::info!("fs_delete_permanent END: {removidos} removido(s), {ja_idos} já idos");
    Ok(())
}

// ──────────────── Progresso + conflito + watcher (S4, #680) ─────────────────

/// Estado gerenciado: rastreia operações em andamento e seus flags de cancel/pause.
/// #898: cada op tem DOIS flags atômicos — `cancelar` (encerra e limpa o parcial) e
/// `pausar` (o loop de cópia BLOQUEIA entre arquivos/chunks até resumir). Cancel vence
/// pause: cancelar durante uma pausa sai na hora (o helper `esperar_se_pausado`).
#[derive(Default)]
pub struct ProgressManager {
    proximo_id: AtomicU64,
    cancelados: Mutex<HashMap<u64, Arc<AtomicBool>>>,
    pausados: Mutex<HashMap<u64, Arc<AtomicBool>>>,
}

impl ProgressManager {
    /// Cria uma op nova e devolve `(id, cancelar, pausar)` — os dois flags começam
    /// em `false` e são compartilhados com os workers via [`Contexto`].
    fn nova_op(&self) -> (u64, Arc<AtomicBool>, Arc<AtomicBool>) {
        let id = self.proximo_id.fetch_add(1, Ordering::Relaxed);
        let cancelar = Arc::new(AtomicBool::new(false));
        let pausar = Arc::new(AtomicBool::new(false));
        self.cancelados.lock().unwrap_or_else(|e| e.into_inner()).insert(id, cancelar.clone());
        self.pausados.lock().unwrap_or_else(|e| e.into_inner()).insert(id, pausar.clone());
        (id, cancelar, pausar)
    }
    fn cancelar(&self, id: u64) {
        if let Some(f) = self.cancelados.lock().unwrap_or_else(|e| e.into_inner()).get(&id) {
            f.store(true, Ordering::Relaxed);
        }
        // Um op pausado precisa ser destravado pra ver o cancel e encerrar.
        if let Some(p) = self.pausados.lock().unwrap_or_else(|e| e.into_inner()).get(&id) {
            p.store(false, Ordering::Relaxed);
        }
    }
    /// #898: sinaliza pause — os workers bloqueiam no próximo check (entre arquivos ou
    /// entre chunks). No-op se a op não existe (já terminou).
    fn pausar(&self, id: u64) {
        if let Some(p) = self.pausados.lock().unwrap_or_else(|e| e.into_inner()).get(&id) {
            p.store(true, Ordering::Relaxed);
        }
    }
    /// #898: destrava a op pausada — os workers retomam do ponto exato.
    fn resumir(&self, id: u64) {
        if let Some(p) = self.pausados.lock().unwrap_or_else(|e| e.into_inner()).get(&id) {
            p.store(false, Ordering::Relaxed);
        }
    }
    fn finalizar(&self, id: u64) {
        self.cancelados.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        self.pausados.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
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
    // #875 (Status Center): payload rico pra fila persistente + card + badge.
    /// Tipo da op — ícone por tipo no painel. `copy` | `move`.
    op_kind: &'static str,
    /// Fase — `discovering` (varredura, indeterminada) | `processing` | `done`.
    phase: &'static str,
    /// Estado agregado (1 enum, não 3 flags): `inProgress` | `success` | `error`
    /// | `canceled` | `partial`. O front retém as terminais na fila por isto.
    status: &'static str,
    /// Nome do arquivo sendo processado agora (via `Mutex` lido pelo ticker).
    current_file: Option<String>,
    /// Epoch ms do início/fim da op (duração no card; `None` até terminar).
    started_at_ms: u64,
    completed_at_ms: Option<u64>,
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

// ─── #899 U0: journal de operações (pro undo) ────────────────────────────────
//
// Registra UM manifesto por op mutante (copy/move) no END, num arquivo
// append-only `explorer-journal.jsonl` no appDataDir. Alimenta o `fs_undo_op`
// (U1) + o "Desfazer" do Status Center (#898). Estado EFÊMERO — poda pras
// últimas N ops; FS local, fora do seam de nuvem (#555/#560). Sobrescrita fica
// FORA do v1 (o motor recusa `AlreadyExists` no fluxo normal → nenhum item
// sobrescrito aqui; decisão do spike #899). `hashAtEnd` é opcional — size+mtime
// é o fallback documentado pra detectar modificação externa no undo.

/// Um item do manifesto — um caminho que a op criou (ou moveu).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct JournalItem {
    /// Origem (só `move`; vazio em `copy` puro).
    from: String,
    /// O caminho que a op criou no destino — chave do undo.
    to: String,
    is_dir: bool,
    /// A op criou este caminho → candidato a reverter no undo.
    created_by_op: bool,
    /// Substituiu algo pré-existente? (⛔ pro undo). Sempre `false` no fluxo
    /// normal, que recusa `AlreadyExists` antes de copiar.
    overwritten: bool,
    size_at_end: u64,
    /// mtime no fim da op (epoch ms) → detecta modificação externa no undo.
    mtime_at_end: u64,
    hash_at_end: Option<String>,
    hash_alg: Option<String>,
    /// #1067 RB25: o `stat` do `to` FALHOU no fim da op → `size_at_end`/`mtime_at_end`
    /// caíram no fallback 0 e NÃO são confiáveis. Sem esta marca, o undo compararia
    /// `len()=0` com o disco e classificaria o item como "modificado" (motivo errado);
    /// com ela, o undo pula por "stat_indisponivel" (fail-closed, não confunde os dois).
    /// `serde(default)=false` → retrocompatível com journals já gravados em disco.
    #[serde(default)]
    stat_indisponivel: bool,
}

/// Um registro por operação mutante — serializado como 1 linha JSON no journal.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct OperationJournalEntry {
    op_id: u64,
    /// `copy` | `move` (rename/trash/delete: fatias futuras do #899).
    kind: String,
    started_at_ms: u64,
    ended_at_ms: u64,
    /// `success` | `partial` (nunca `error` puro).
    status: String,
    resolucao: Option<String>,
    items: Vec<JournalItem>,
    /// Handles do SO pra restaurar da Lixeira (kind=trash; vazio aqui).
    trash_record_ids: Vec<String>,
    /// #1067 RB27: granularidade do undo. `""`/`"item"` (default) = manifesto completo,
    /// um item por caminho criado. `"raiz"` = manifesto REDUZIDO por teto (op gigante,
    /// `items.len()` estourou `JOURNAL_ITENS_MAX`) → o undo é mais grosso e NÃO cobre
    /// todos os caminhos; o front deve avisar que o desfazer é parcial. Nunca reduzido
    /// em silêncio (há `log::warn!` no ponto do corte). `serde(default)` = retrocompat.
    #[serde(default)]
    undo_granularidade: String,
}

/// Máximo de ops retidas (§7 do spike: journal efêmero, poda o excesso).
const JOURNAL_MAX: usize = 50;
/// #1067 RB27: teto de itens por manifesto. Uma op de árvore com centenas de milhares
/// de arquivos geraria UMA linha JSON de centenas de MB — a escrita trava e o journal
/// inteiro fica refém dela. Acima deste teto o manifesto é REDUZIDO (ver
/// `reduzir_para_teto`) e marcado `undo_granularidade="raiz"`, nunca gravado gigante.
const JOURNAL_ITENS_MAX: usize = 5000;
/// Serializa as escritas concorrentes no arquivo do journal.
static JOURNAL_LOCK: Mutex<()> = Mutex::new(());

fn caminho_journal(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("explorer-journal.jsonl"))
}

/// mtime de uma `Metadata` em epoch ms (0 se indisponível).
fn mtime_ms(m: &std::fs::Metadata) -> u64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Monta um item statando o `to` (já existe no END) pra size/mtime. `from`
/// vazio = copy puro; preenchido = move (undo faz `to`→`from`).
fn journal_item(from: &Path, to: &Path, mover: bool) -> JournalItem {
    let meta = std::fs::symlink_metadata(com_long_path(to)).ok();
    JournalItem {
        from: if mover { caminho_limpo(from) } else { String::new() },
        to: caminho_limpo(to),
        is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
        created_by_op: true,
        overwritten: false,
        size_at_end: meta.as_ref().map(|m| m.len()).unwrap_or(0),
        mtime_at_end: meta.as_ref().map(mtime_ms).unwrap_or(0),
        hash_at_end: None,
        hash_alg: None,
        // #1067 RB25: stat falhou → size/mtime acima são 0 não-confiáveis. Marca pro
        // undo pular por motivo próprio em vez de acusar "modificado" (len 0 ≠ disco).
        stat_indisponivel: meta.is_none(),
    }
}

/// Constrói o manifesto de uma op copy/move a partir do Plano executado: os dirs
/// criados + todos os arquivos (pequenos+grandes). Pura (só stat) → testável.
fn montar_entrada(
    op_id: u64,
    mover: bool,
    started_at_ms: u64,
    ended_at_ms: u64,
    plano: &Plano,
) -> OperationJournalEntry {
    let mut items = Vec::with_capacity(plano.dirs.len() + plano.total_arquivos as usize);
    // #1067: o stat em massa (um `journal_item`/arquivo) roda AQUI, FORA do ticker de
    // progresso — não bloqueia a UI. Numa op gigante isto é serial e pode custar; mover
    // o stat pro worker do ticker (statando durante a cópia) é follow-up, não deste US.
    for d in &plano.dirs {
        // dir: o undo remove o vazio (copy) ou é recriado pelos moves (move).
        items.push(journal_item(d, d, false));
    }
    for job in plano.pequenos.iter().chain(plano.grandes.iter()) {
        items.push(journal_item(&job.src, &job.dst, mover));
    }
    OperationJournalEntry {
        op_id,
        kind: if mover { "move".into() } else { "copy".into() },
        started_at_ms,
        ended_at_ms,
        status: "success".into(),
        resolucao: None,
        items,
        trash_record_ids: Vec::new(),
        undo_granularidade: String::new(),
    }
}

/// Poda a lista pras últimas `max` linhas (o fim = ops mais recentes).
fn podar_journal(mut linhas: Vec<String>, max: usize) -> Vec<String> {
    if linhas.len() > max {
        linhas.drain(0..linhas.len() - max);
    }
    linhas
}

/// #1067 RB27: precisa reescrever o journal inteiro (pra podar), ou dá pra fazer append
/// barato da nova linha? Reescrever é o que trava com manifestos gigantes; só cai nele
/// quando o push passaria de `max` linhas (raro: 1×/op só depois de 50 ops acumuladas).
/// Pura → testável sem I/O.
fn precisa_reescrever(n_linhas_atual: usize, max: usize) -> bool {
    n_linhas_atual + 1 > max
}

/// #1067 RB27: se o manifesto estoura o teto de itens, devolve uma versão REDUZIDA
/// (senão `None` = grava como está). A redução aqui é TRUNCAR pros primeiros `max`
/// itens + marcar `undo_granularidade="raiz"`. Escolha deliberada sobre "raízes por
/// ancestralidade": no código atual os itens de DIRETÓRIO carregam `from=""` (o undo
/// os ignora — `executar_undo` filtra `!is_dir`), então reduzir uma árvore profunda às
/// suas raízes-dir deixaria o move SEM nenhum item reversível (undo faria nada). Truncar
/// preserva `max` itens de ARQUIVO realmente reversíveis; o resto não some do disco —
/// segue no destino (recuperável à mão), só não é desfeito pelo botão. O corte é sempre
/// BARULHENTO (marca + `log::warn!` no chamador), nunca silencioso. Pura → testável.
fn reduzir_para_teto(entry: &OperationJournalEntry, max: usize) -> Option<OperationJournalEntry> {
    if entry.items.len() <= max {
        return None;
    }
    let mut reduzido = entry.clone();
    reduzido.items.truncate(max);
    reduzido.undo_granularidade = "raiz".into();
    Some(reduzido)
}

/// Grava (append + poda) o manifesto no journal. **Best-effort**: falha de I/O
/// do journal NUNCA quebra a op de arquivo — só loga.
fn registrar_journal(app: &AppHandle, entry: &OperationJournalEntry) {
    let Some(path) = caminho_journal(app) else {
        log::warn!("journal: appDataDir indisponível, op {} não registrada", entry.op_id);
        return;
    };
    // #1067 RB27 (teto): op gigante vira manifesto reduzido ANTES de serializar — nunca
    // gravamos uma linha de centenas de MB. O corte é logado (warn), não silencioso.
    let reduzido = reduzir_para_teto(entry, JOURNAL_ITENS_MAX);
    let entry = reduzido.as_ref().unwrap_or(entry);
    if reduzido.is_some() {
        log::warn!(
            "journal: op {} com muitos itens — manifesto TRUNCADO pra {} de origem (undo=raiz, parcial)",
            entry.op_id, JOURNAL_ITENS_MAX
        );
    }
    let json = match serde_json::to_string(entry) {
        Ok(j) => j,
        Err(e) => {
            log::error!("journal: serialização falhou (op {}): {e}", entry.op_id);
            return;
        }
    };
    let _g = JOURNAL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // #1067 RB27 (append): a reescrita do arquivo inteiro é o que trava com manifestos
    // grandes. Enquanto não precisa PODAR (< JOURNAL_MAX linhas após o push), fazemos
    // append real da nova linha — sem tocar no que já está lá. Só caímos no read-all +
    // rewrite quando o journal atingiu o teto de ops e precisa dropar as mais velhas.
    // Invariante mantida pelos dois caminhos: cada linha termina em "\n" (o append
    // depende disso pra não colar duas ops na mesma linha).
    let n_atual = contar_linhas_journal(&path);
    if precisa_reescrever(n_atual, JOURNAL_MAX) {
        let mut linhas: Vec<String> = std::fs::read_to_string(&path)
            .map(|s| s.lines().filter(|l| !l.trim().is_empty()).map(str::to_string).collect())
            .unwrap_or_default();
        linhas.push(json);
        let linhas = podar_journal(linhas, JOURNAL_MAX);
        let conteudo = linhas.join("\n") + "\n";
        if let Err(e) = std::fs::write(&path, conteudo) {
            log::error!("journal: gravação (poda) falhou ({}): {e}", path.display());
        }
    } else {
        match std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            Ok(mut f) => {
                use std::io::Write;
                if let Err(e) = writeln!(f, "{json}") {
                    log::error!("journal: append falhou ({}): {e}", path.display());
                }
            }
            Err(e) => log::error!("journal: abertura p/ append falhou ({}): {e}", path.display()),
        }
    }
    log::info!("journal: op {} registrada ({} item(s))", entry.op_id, entry.items.len());
}

/// #1067 RB27: conta as linhas não-vazias do journal SEM materializar todas de uma vez
/// (BufReader linha-a-linha). Decide append-vs-rewrite; barato mesmo com o arquivo
/// grande (só o custo de leitura — a economia real é não RE-ESCREVER o gigante).
fn contar_linhas_journal(path: &Path) -> usize {
    use std::io::BufRead;
    let Ok(f) = std::fs::File::open(path) else {
        return 0;
    };
    std::io::BufReader::new(f)
        .lines()
        .filter(|l| l.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false))
        .count()
}

// ─── #899 U1: undo verificado (lê o journal, classifica, executa) ────────────
//
// `fs_undo_preview(opId)` classifica cada item (§5 do spike) em 3 baldes SEM
// efeito colateral — alimenta o diálogo de resumo (U2, raia Vega). `fs_undo_op`
// RE-classifica imediatamente antes de agir (anti-TOCTOU) e executa só os
// seguros: cópia → Lixeira dos criados; move → volta `to`→`from`. Best-effort
// por item (erro num item não aborta os outros). Motivos são CÓDIGOS estáveis
// (o front resolve i18n — regra `i18n-copy-na-task`), não texto pt-BR.

/// Plano de undo de um item (o `path` é o `to` que a op criou).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UndoItemPlan {
    path: String,
    /// `seguro` | `pulado` | `naoReversivel`.
    estado: String,
    /// Código do motivo (só pulado/naoReversível): `sumiu` | `modificado` |
    /// `origemReocupada` | `sobrescrita` | `stat_indisponivel`. O front mapeia pra copy i18n.
    motivo: Option<String>,
}

/// Resumo do undo ANTES de executar — os 3 baldes do §5 (pro preview da U2).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UndoPlan {
    op_id: u64,
    kind: String,
    itens: Vec<UndoItemPlan>,
    seguros: usize,
    pulados: usize,
    nao_reversiveis: usize,
}

/// Relatório do undo DEPOIS de executar (best-effort por item).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UndoReport {
    op_id: u64,
    kind: String,
    executados: usize,
    pulados: usize,
    nao_reversiveis: usize,
    /// Caminhos que falharam na execução (não abortam os demais).
    erros: Vec<String>,
}

/// Lê todos os manifestos do journal (linhas inválidas são ignoradas).
fn ler_journal(app: &AppHandle) -> Vec<OperationJournalEntry> {
    let Some(path) = caminho_journal(app) else {
        return Vec::new();
    };
    let _g = JOURNAL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let Ok(conteudo) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    conteudo
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<OperationJournalEntry>(l).ok())
        .collect()
}

/// A entrada mais recente de uma op (o journal pode ter mais de uma? não — 1/op).
fn entrada_por_op(app: &AppHandle, op_id: u64) -> Option<OperationJournalEntry> {
    ler_journal(app).into_iter().rev().find(|e| e.op_id == op_id)
}

/// Remove a entrada de uma op do journal (pós-undo: não desfaz duas vezes; redo
/// é backlog U4).
fn remover_entrada_journal(app: &AppHandle, op_id: u64) {
    let Some(path) = caminho_journal(app) else {
        return;
    };
    let _g = JOURNAL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let Ok(conteudo) = std::fs::read_to_string(&path) else {
        return;
    };
    let restantes: Vec<&str> = conteudo
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter(|l| {
            serde_json::from_str::<OperationJournalEntry>(l)
                .map(|e| e.op_id != op_id)
                .unwrap_or(true) // linha ilegível: preserva (não é a nossa op)
        })
        .collect();
    let conteudo = if restantes.is_empty() {
        String::new()
    } else {
        restantes.join("\n") + "\n"
    };
    // #1067 RB25: NÃO engolir a falha. Se a reescrita falha, a entrada da op desfeita
    // PERMANECE no journal e pode ser desfeita de novo (undo em dobro = data-loss).
    // A fn é `()` (pós-undo, best-effort), então logar em erro satisfaz o AC.
    if let Err(e) = std::fs::write(&path, conteudo) {
        log::error!("journal: remoção da entrada da op {op_id} falhou ({}): {e} — RISCO de undo duplicado", path.display());
    }
}

/// Um arquivo do manifesto mudou desde a op? v1: size+mtime (hash é fallback
/// forte quando gravado — hoje None). `to` sumido/erro conta como modificado
/// (por precaução: não mexer).
fn item_modificado(item: &JournalItem) -> bool {
    let Ok(m) = std::fs::symlink_metadata(com_long_path(Path::new(&item.to))) else {
        return true;
    };
    m.len() != item.size_at_end || mtime_ms(&m) != item.mtime_at_end
}

/// Classifica um item (§5) → (estado, código-de-motivo). Puro em relação ao
/// journal; stata o disco pro estado atual.
fn classificar_item(item: &JournalItem, mover: bool) -> (String, Option<String>) {
    if !caminho_existe(&item.to) {
        return ("pulado".into(), Some("sumiu".into()));
    }
    if item.overwritten {
        // sobrescrita: o original não volta (§3) → fora do plano.
        return ("naoReversivel".into(), Some("sobrescrita".into()));
    }
    // #1067 RB25: stat indisponível no fim da op → size/mtime gravados são 0 não-confiáveis.
    // Precede `item_modificado` de propósito: sem isto, `len()=0 != disco` marcaria o item
    // como "modificado" (motivo enganoso). Motivo próprio, item pulado (fail-closed).
    if item.stat_indisponivel {
        return ("pulado".into(), Some("stat_indisponivel".into()));
    }
    if item_modificado(item) {
        return ("pulado".into(), Some("modificado".into()));
    }
    if mover && caminho_existe(&item.from) {
        // undo de move precisa do caminho de retorno livre.
        return ("pulado".into(), Some("origemReocupada".into()));
    }
    ("seguro".into(), None)
}

/// Monta o plano de undo (só arquivos; dirs são detalhe da execução).
fn montar_plano_undo(entry: &OperationJournalEntry) -> UndoPlan {
    let mover = entry.kind == "move";
    let mut itens = Vec::new();
    let (mut seguros, mut pulados, mut nao_reversiveis) = (0usize, 0usize, 0usize);
    for it in entry.items.iter().filter(|i| !i.is_dir) {
        let (estado, motivo) = classificar_item(it, mover);
        match estado.as_str() {
            "seguro" => seguros += 1,
            "naoReversivel" => nao_reversiveis += 1,
            _ => pulados += 1,
        }
        itens.push(UndoItemPlan { path: it.to.clone(), estado, motivo });
    }
    UndoPlan { op_id: entry.op_id, kind: entry.kind.clone(), itens, seguros, pulados, nao_reversiveis }
}

/// Executa o undo (re-classificando cada item na hora = anti-TOCTOU). Cópia:
/// junta os seguros e manda em batch pra Lixeira. Move: volta `to`→`from`
/// (recria o pai do retorno se sumiu). Depois limpa dirs vazios criados.
fn executar_undo(entry: &OperationJournalEntry) -> UndoReport {
    let eh_move = entry.kind == "move";
    let (mut executados, mut pulados, mut nao_reversiveis) = (0usize, 0usize, 0usize);
    let mut erros = Vec::new();
    let mut trash_alvos: Vec<String> = Vec::new();

    for it in entry.items.iter().filter(|i| !i.is_dir) {
        // re-verifica IMEDIATAMENTE antes de agir (§8 anti-TOCTOU).
        let (estado, _motivo) = classificar_item(it, eh_move);
        match estado.as_str() {
            "naoReversivel" => {
                nao_reversiveis += 1;
                continue;
            }
            "pulado" => {
                pulados += 1;
                continue;
            }
            _ => {}
        }
        if eh_move {
            // recria o diretório-pai do retorno (a op removeu a origem).
            if let Some(pai) = Path::new(&it.from).parent() {
                let _ = std::fs::create_dir_all(com_long_path(pai));
            }
            match mover(&it.to, &it.from) {
                Ok(()) => executados += 1,
                Err(e) => {
                    log::error!("undo move {} → {}: {e}", it.to, it.from);
                    erros.push(it.to.clone());
                }
            }
        } else {
            trash_alvos.push(it.to.clone());
        }
    }

    // Cópia: os criados vão pra Lixeira em batch (undo revogável — §8).
    if !eh_move && !trash_alvos.is_empty() {
        let n = trash_alvos.len();
        match para_lixeira(&trash_alvos) {
            Ok(()) => executados += n,
            Err(e) => {
                log::error!("undo trash ({n} alvo(s)): {e}");
                erros.push(format!("lixeira: {e}"));
            }
        }
    }

    // Limpa os diretórios criados que ficaram VAZIOS (mais fundos primeiro).
    let mut dirs: Vec<&String> = entry.items.iter().filter(|i| i.is_dir).map(|i| &i.to).collect();
    dirs.sort_by_key(|d| std::cmp::Reverse(d.len()));
    for d in dirs {
        let p = com_long_path(Path::new(d));
        let vazio = std::fs::read_dir(&p).map(|mut r| r.next().is_none()).unwrap_or(false);
        if vazio {
            let _ = std::fs::remove_dir(&p);
        }
    }

    UndoReport {
        op_id: entry.op_id,
        kind: entry.kind.clone(),
        executados,
        pulados,
        nao_reversiveis,
        erros,
    }
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
    /// #1066: entradas que a enumeração NÃO conseguiu planejar (erro de I/O do
    /// jwalk, metadata ilegível, symlink não replicável). Nunca descartadas em
    /// silêncio: os executores abortam a op se isto vier não-vazio (a origem de um
    /// move NÃO é removida com o plano incompleto).
    erros: Vec<String>,
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
        // #1066: entrada com erro de enumeração NÃO é mais pulada em silêncio —
        // vira um erro acumulado (o move não apagaria a origem sem tê-la copiado).
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                plano.erros.push(format!("enumeração falhou: {e}"));
                continue;
            }
        };
        // #1066: o jwalk NÃO propaga erro de LEITURA de subpasta como item `Err` —
        // ele anexa em `read_children_error` na entrada do próprio diretório e segue.
        // Sem checar isto, uma subpasta ilegível (permissão negada etc.) sumia calada:
        // a cópia terminava "Ok" sem o conteúdo dela e o move apagava a origem = perda
        // de dado. Agora vira erro acumulado (op abortada / origem preservada).
        if let Some(err) = &entry.read_children_error {
            plano
                .erros
                .push(format!("{}: leitura da subpasta falhou: {err}", caminho_limpo(&entry.path())));
        }
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
            // #1066: metadata ilegível = não sabemos o tamanho → NÃO planeja como
            // job (copiaria conteúdo errado/parcial). Registra como erro pra op ficar
            // incompleta, em vez do `.unwrap_or(0)` antigo que mascarava a falha.
            let size = match entry.metadata() {
                Ok(m) => m.len(),
                Err(e) => {
                    plano.erros.push(format!("{}: metadata ilegível: {e}", caminho_limpo(&p)));
                    continue;
                }
            };
            plano.total_bytes += size;
            plano.total_arquivos += 1;
            let job = CopyJob { src: from.join(rel), dst, size };
            if size < LIMITE_PEQUENO {
                plano.pequenos.push(job);
            } else {
                plano.grandes.push(job);
            }
        } else if ft.is_symlink() {
            // #1066: symlink/junction não é replicado (a cópia é de conteúdo real).
            // Antes sumia calado; agora conta como erro pra não fingir cópia completa.
            plano.erros.push(format!("{}: symlink/reparse não replicado", caminho_limpo(&p)));
        }
    }
    Ok(plano)
}

/// #850 (fatia B): enumeração GLOBAL — varre TODAS as origens e funde num único
/// Plano (um total de bytes/arquivos, uma classificação pequenos/grandes, uma lista
/// de dirs). Vira UMA fase de cópia (modelo TeraCopy), matando o "2 pastas
/// sequenciais". Reusa o `planejar` por-origem, então herda a mesma varredura.
fn planejar_muitas(pares: &[(PathBuf, PathBuf)]) -> Result<Plano, FsError> {
    let mut global = Plano::default();
    for (src, dst) in pares {
        let p = planejar(src, dst)?;
        global.dirs.extend(p.dirs);
        global.pequenos.extend(p.pequenos);
        global.grandes.extend(p.grandes);
        global.total_bytes += p.total_bytes;
        global.total_arquivos += p.total_arquivos;
        global.erros.extend(p.erros); // #1066: acumula os pulos de cada origem
    }
    Ok(global)
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
        // #1076 (RB31): só confia no descritor se o IOCTL preencheu ao menos a struct
        // inteira. Sem checar `retornados`, um retorno de 0 bytes (sucesso vazio)
        // deixaria `desc` no default — `IncursSeekPenalty=false` — e um HDD viraria
        // "SSD", disparando paralelismo alto que causa THRASH de seek no disco
        // mecânico. Bytes insuficientes ⇒ assume HDD (conservador: com seek penalty).
        if (retornados as usize) < std::mem::size_of::<DEVICE_SEEK_PENALTY_DESCRIPTOR>() {
            return Some(true);
        }
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

/// #875: epoch em ms (pro started/completed do Status Center).
fn agora_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Contexto compartilhado entre os workers (atômicos de progresso + cancel/pause).
struct Contexto {
    processados: Arc<AtomicU64>,
    arquivos_feitos: Arc<AtomicU64>,
    cancelar: Arc<AtomicBool>,
    /// #898: pause por op — quando `true`, os workers BLOQUEIAM no próximo check (entre
    /// arquivos e entre chunks) até resumir. Cancel vence pause.
    pausar: Arc<AtomicBool>,
    verify: Option<VerifyAlg>,
    /// #875: nome do arquivo em processamento agora — os workers escrevem, o ticker
    /// lê pro `current_file` do evento (o card mostra "copiando X").
    atual: Arc<Mutex<String>>,
}

/// #898: bloqueia enquanto a op estiver pausada; retorna `true` se ela foi CANCELADA
/// (o worker deve abortar). Cancel vence pause — cancelar durante a pausa sai na hora.
/// Poll de 50 ms: barato (só quando pausado) e responde rápido ao resume/cancel.
fn esperar_se_pausado(ctx: &Contexto) -> bool {
    if ctx.cancelar.load(Ordering::Relaxed) {
        return true;
    }
    while ctx.pausar.load(Ordering::Relaxed) {
        if ctx.cancelar.load(Ordering::Relaxed) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    false
}

/// Copia UM arquivo com buffer (grande streaming, pequeno menor), somando bytes no
/// atômico global. Se `verify`, hasheia a origem durante a leitura e re-hasheia o
/// destino ao final, comparando (detecta cópia corrompida).
/// #850 throughput: abre a origem com `FILE_FLAG_SEQUENTIAL_SCAN` (Windows) — dica
/// ao cache manager pra readahead agressivo + evict-behind numa leitura sequencial
/// (o padrão da cópia). Fora do Windows, open normal.
#[cfg(windows)]
fn abrir_leitura_seq(p: &Path) -> std::io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_SEQUENTIAL_SCAN: u32 = 0x0800_0000;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_SEQUENTIAL_SCAN)
        .open(p)
}
#[cfg(not(windows))]
fn abrir_leitura_seq(p: &Path) -> std::io::Result<std::fs::File> {
    std::fs::File::open(p)
}

fn copiar_arquivo(job: &CopyJob, ctx: &Contexto) -> Result<(), FsError> {
    use std::io::{Read, Write};
    // #898: pausa/cancel ANTES de abrir o arquivo — pausado bloqueia aqui; cancelado
    // (ou cancel durante a pausa) retorna sem tocar o destino.
    if esperar_se_pausado(ctx) {
        return Ok(());
    }
    // #875: publica o arquivo atual pro ticker (o card do Status Center mostra o nome).
    if let Ok(mut a) = ctx.atual.lock() {
        *a = job
            .dst
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
    }
    let src = com_long_path(&job.src);
    let dst = com_long_path(&job.dst);
    let mut ent = abrir_leitura_seq(&src)?;
    let mut sai = std::fs::File::create(&dst)?;
    // #850 throughput: pré-aloca o destino do tamanho planejado em arquivo GRANDE —
    // reserva extents contíguos no NTFS (menos fragmentação + menos churn de metadata
    // durante o write). Corrigido no fim se o arquivo mudou de tamanho entre planejar
    // e copiar. Cancel remove o destino parcial (executar_progresso), sem sobra.
    let prealoc = job.size >= LIMITE_PEQUENO;
    if prealoc {
        let _ = sai.set_len(job.size);
    }
    let buf_sz = if job.size >= LIMITE_PEQUENO { BUF_GRANDE } else { BUF_PEQUENO };
    let mut buf = vec![0u8; buf_sz];
    let mut hasher = ctx.verify.map(Hasher::novo);
    let mut escritos = 0u64;
    loop {
        // #898: entre chunks — pausa BLOQUEIA (arquivo grande pausa no meio); cancel sai.
        if esperar_se_pausado(ctx) {
            return Ok(());
        }
        let n = ent.read(&mut buf)?;
        if n == 0 {
            break;
        }
        sai.write_all(&buf[..n])?;
        escritos += n as u64;
        if let Some(h) = hasher.as_mut() {
            h.update(&buf[..n]);
        }
        ctx.processados.fetch_add(n as u64, Ordering::Relaxed);
    }
    sai.flush()?;
    // #850: arquivo encolheu entre planejar e copiar → corta o excesso pré-alocado.
    // #1066 (RB23): NÃO engolir o erro do corte — `set_len` que falha deixaria o
    // destino com padding de zeros (arquivo corrompido). Propaga com `?`.
    if prealoc && escritos != job.size {
        sai.set_len(escritos)?;
    }
    // #1066 (RB22): com verify, o hash tem que sair do DISCO, não da page cache.
    // `sync_all` força os dados+metadata a persistirem ANTES de reabrir pra hashear —
    // senão a verificação compara cache com cache e não pega corrupção de gravação.
    if ctx.verify.is_some() {
        sai.sync_all()?;
    }
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

/// #875: um evento único de fase `discovering` (varredura), fora do throttle do
/// ticker — o card mostra "Descobrindo itens…" enquanto o `planejar` roda.
fn emitir_descobrindo(app: &AppHandle, op_id: u64, op_kind: &'static str, started_at_ms: u64) {
    let _ = app.emit(
        "fs-op-progress",
        OpProgress {
            op_id,
            processed_bytes: 0,
            total_bytes: 0,
            percent: 0.0,
            eta_ms: None,
            files_total: 0,
            files_done: 0,
            bytes_per_sec: 0,
            verifying: false,
            done: false,
            canceled: false,
            error: None,
            op_kind,
            phase: "discovering",
            status: "inProgress",
            current_file: None,
            started_at_ms,
            completed_at_ms: None,
        },
    );
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
    op_kind: &'static str,
    started_at_ms: u64,
    atual: Arc<Mutex<String>>,
    pausar: Arc<AtomicBool>,
) -> Ticker {
    let parar = Arc::new(AtomicBool::new(false));
    let p2 = parar.clone();
    let app = app.clone();
    let handle = std::thread::spawn(move || {
        let mut ultimo_bytes = 0u64;
        let mut ultimo_t = Instant::now();
        let mut ticks = 0u32;
        while !p2.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(100));
            let proc = processados.load(Ordering::Relaxed);
            let agora = Instant::now();
            let dt = agora.duration_since(ultimo_t).as_secs_f64().max(0.001);
            let bps = ((proc.saturating_sub(ultimo_bytes)) as f64 / dt) as u64;
            ultimo_bytes = proc;
            ultimo_t = agora;
            // #850: PROGRESS no log a cada ~1s (10 ticks) — MB/s pro benchmark, sem
            // spammar (o evento pro front segue a 100ms).
            ticks += 1;
            if ticks % 10 == 0 {
                let pct = if total_bytes > 0 {
                    (proc as f64 / total_bytes as f64) * 100.0
                } else {
                    0.0
                };
                log::info!(
                    "fs_op PROGRESS op={op_id}: {pct:.0}%, {:.1} MiB/s",
                    bps as f64 / 1_048_576.0
                );
            }
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
            let atual_nome = atual.lock().ok().and_then(|a| {
                if a.is_empty() {
                    None
                } else {
                    Some(a.clone())
                }
            });
            // #898: reflete o estado de pausa no evento (o card mostra "Pausado" +
            // habilita Retomar). Pausado zera a vazão/ETA (nada avança).
            let pausado = pausar.load(Ordering::Relaxed);
            let (status, bps, eta_ms) =
                if pausado { ("paused", 0, None) } else { ("inProgress", bps, eta_ms) };
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
                    op_kind,
                    phase: "processing",
                    status,
                    current_file: atual_nome,
                    started_at_ms,
                    completed_at_ms: None,
                },
            );
        }
    });
    Ticker { parar, handle: Some(handle) }
}

/// Executa copy (ou move) TURBO com progresso. Retorna `true` se foi cancelada.
#[allow(clippy::too_many_arguments)]
fn executar_progresso(
    mover: bool,
    from: &str,
    to: &str,
    op_id: u64,
    flag: &Arc<AtomicBool>,
    pausar: &Arc<AtomicBool>,
    verify: Option<VerifyAlg>,
    app: &AppHandle,
    started_at_ms: u64,
) -> Result<ResumoOp, FsError> {
    validar(from)?;
    validar(to)?;
    let src = Path::new(from);
    let dst = Path::new(to);
    // #850: log métrico "Delphero" da op de FS — START/PROGRESS/END com MB/s pro
    // benchmark vs TeraCopy (formato estável pra grep/planilha). `t0` cobre o
    // wall-clock inteiro (varredura + cópia).
    let rotulo = if mover { "move" } else { "copy" };
    let t0 = Instant::now();
    if com_long_path(dst).exists() {
        return Err(FsError::AlreadyExists(to.to_string()));
    }
    // Move mesmo-volume: rename é instantâneo, sem varredura nem cópia.
    if mover && std::fs::rename(com_long_path(src), com_long_path(dst)).is_ok() {
        log::info!("fs_move END op={op_id}: rename mesmo-volume instantâneo");
        // #899 U0: manifesto de 1 item (undo = rename inverso to→from).
        let item = journal_item(src, dst, true);
        registrar_journal(
            app,
            &OperationJournalEntry {
                op_id,
                kind: "move".into(),
                started_at_ms,
                ended_at_ms: agora_ms(),
                status: "success".into(),
                resolucao: None,
                items: vec![item],
                trash_record_ids: Vec::new(),
                undo_granularidade: String::new(),
            },
        );
        // rename mesmo-volume: 1 item movido (não varre pra contar os arquivos internos).
        return Ok(ResumoOp { canceled: false, files_total: 1, files_done: 1 });
    }

    // #875: fase Discovering — a varredura (jwalk) pode demorar; o front mostra
    // "Descobrindo itens…" (indeterminado) antes do ticker de bytes ligar.
    emitir_descobrindo(app, op_id, rotulo, started_at_ms);
    let plano = planejar(src, dst)?;
    // #1066: enumeração pulou entrada(s) → o plano é incompleto. Aborta ANTES de
    // copiar 1 byte (nada criado no destino, origem intocada). Melhor erro barulhento
    // que um move que apaga a origem depois de uma cópia furada.
    if !plano.erros.is_empty() {
        log::error!(
            "fs_{rotulo} ERRO op={op_id}: enumeração pulou {} entrada(s) — abortando (ex.: {})",
            plano.erros.len(),
            plano.erros.first().map(String::as_str).unwrap_or("")
        );
        return Err(FsError::Io(format!(
            "enumeração incompleta: {} entrada(s) inacessível(is) — op abortada (ex.: {})",
            plano.erros.len(),
            plano.erros.first().map(String::as_str).unwrap_or("")
        )));
    }
    for d in &plano.dirs {
        std::fs::create_dir_all(com_long_path(d))?;
    }
    let perfil = perfilar(src, dst);
    log::info!(
        "fs_{rotulo} START op={op_id}: {} arquivo(s), {:.1} MiB, {} dir(s), {} worker(s)",
        plano.total_arquivos,
        plano.total_bytes as f64 / 1_048_576.0,
        plano.dirs.len(),
        perfil.workers
    );

    let ctx = Contexto {
        processados: Arc::new(AtomicU64::new(0)),
        arquivos_feitos: Arc::new(AtomicU64::new(0)),
        cancelar: flag.clone(),
        pausar: pausar.clone(),
        verify,
        atual: Arc::new(Mutex::new(String::new())),
    };
    let ticker = iniciar_ticker(
        app,
        op_id,
        plano.total_bytes,
        plano.total_arquivos,
        ctx.processados.clone(),
        ctx.arquivos_feitos.clone(),
        verify.is_some(),
        rotulo,
        started_at_ms,
        ctx.atual.clone(),
        pausar.clone(),
    );

    let resultado = copiar_plano(&plano, perfil.workers, &ctx);
    ticker.parar();

    if let Err(e) = resultado {
        log::error!("fs_{rotulo} ERRO op={op_id}: {e}");
        // #1067 RB24: a limpeza do parcial não pode ser engolida. Se `remover` falha E o
        // caminho ainda existe, é resíduo (árvore parcial no destino) — loga e reflete no
        // erro terminal (o front vê o path). `remover` falhar por NotFound (nada criado)
        // não é resíduo: `caminho_existe` filtra isso.
        if let Err(re) = remover(to) {
            if caminho_existe(to) {
                log::error!("fs_{rotulo} op={op_id}: resíduo em {to} (limpeza falhou): {re}");
                return Err(FsError::Io(format!("{e} — resíduo NÃO removido em: {to}")));
            }
        }
        return Err(e);
    }
    if flag.load(Ordering::Relaxed) {
        log::info!("fs_{rotulo} END op={op_id}: CANCELADO ({:.2}s)", t0.elapsed().as_secs_f64());
        // #1067 RB24: mesmo no cancel a limpeza é verificada; resíduo vai pro log (o
        // resultado terminal é `canceled`, sem campo de erro — não reclassifico cancel
        // como erro; o log estruturado é o canal, conforme o AC).
        if let Err(re) = remover(to) {
            if caminho_existe(to) {
                log::error!("fs_{rotulo} op={op_id}: CANCELADO com resíduo em {to} (limpeza falhou): {re}");
            }
        }
        return Ok(ResumoOp {
            canceled: true,
            files_total: plano.total_arquivos,
            files_done: ctx.arquivos_feitos.load(Ordering::Relaxed),
        });
    }
    if mover {
        // #1066: só apaga a origem se a cópia BATER com o planejado (contagem E bytes).
        // Cópia incompleta = origem preservada + erro barulhento (nunca Ok mentiroso).
        let feitos = ctx.arquivos_feitos.load(Ordering::Relaxed);
        let bytes = ctx.processados.load(Ordering::Relaxed);
        if !copia_completa(&plano, feitos, bytes) {
            log::error!(
                "fs_{rotulo} ERRO op={op_id}: cópia incompleta ({feitos}/{} arq, {bytes}/{} bytes) — origem PRESERVADA",
                plano.total_arquivos, plano.total_bytes
            );
            return Err(FsError::Io(format!(
                "cópia incompleta: {feitos}/{} arquivo(s), {bytes}/{} byte(s) copiado(s) — origem NÃO removida",
                plano.total_arquivos, plano.total_bytes
            )));
        }
        remover(from)?; // move = copiou tudo (confirmado) → apaga a origem
    }
    // #850: END com MB/s médio + arquivos/s — a linha de benchmark comparável.
    let elapsed = t0.elapsed().as_secs_f64().max(0.001);
    let mib = plano.total_bytes as f64 / 1_048_576.0;
    log::info!(
        "fs_{rotulo} END op={op_id}: {elapsed:.2}s, {:.1} MiB/s medio, {:.0} arquivo(s)/s, {} arquivo(s), {mib:.1} MiB",
        mib / elapsed,
        plano.total_arquivos as f64 / elapsed,
        plano.total_arquivos
    );
    // #899 U0: manifesto da op (dirs+arquivos criados) pro undo.
    registrar_journal(app, &montar_entrada(op_id, mover, started_at_ms, agora_ms(), &plano));
    Ok(ResumoOp {
        canceled: false,
        files_total: plano.total_arquivos,
        files_done: ctx.arquivos_feitos.load(Ordering::Relaxed),
    })
}

/// #1067 RB24: remove os destinos do plano (parciais da cópia abortada/cancelada) SEM
/// engolir falha. Devolve a lista de resíduos — caminhos que a limpeza não conseguiu
/// remover E que ainda existem no disco (uma remoção que falha por NotFound, ou seja,
/// nada foi criado, não é resíduo). Cada resíduo é logado; o chamador reflete no terminal.
fn limpar_destinos_a_planejar(
    a_planejar: &[(String, String)],
    rotulo: &str,
    op_id: u64,
) -> Vec<String> {
    let mut residuos = Vec::new();
    for (_, dst) in a_planejar {
        if let Err(re) = remover(dst) {
            if caminho_existe(dst) {
                log::error!("fs_{rotulo} op={op_id}: resíduo em {dst} (limpeza falhou): {re}");
                residuos.push(dst.clone());
            }
        }
    }
    residuos
}

/// #1067 RB20: monta o manifesto PARCIAL dos renames mesmo-volume já efetivados
/// (`status="partial"`, `kind="move"`). `None` sse não houve rename (no-op). Pura (sem
/// I/O nem `AppHandle`) → é o núcleo testável do que o funil grava em TODA saída de
/// erro/cancel da fase pós-rename; um teste prova que a rota de erro produz um manifesto
/// que `executar_undo` reverte, sem depender do runtime pra escrever o journal.
fn entrada_parcial_renomes(
    op_id: u64,
    started_at_ms: u64,
    itens_renome: &[JournalItem],
) -> Option<OperationJournalEntry> {
    if itens_renome.is_empty() {
        return None;
    }
    Some(OperationJournalEntry {
        op_id,
        kind: "move".into(),
        started_at_ms,
        ended_at_ms: agora_ms(),
        status: "partial".into(),
        resolucao: None,
        items: itens_renome.to_vec(),
        trash_record_ids: Vec::new(),
        undo_granularidade: String::new(),
    })
}

/// #1067 RB20: registra o manifesto PARCIAL dos renames mesmo-volume já efetivados, pros
/// caminhos de erro/cancel do multi-move — sem isto, arquivos já movidos ficam no destino
/// sem manifesto = undo indisponível. No-op se não houve rename. Recebe os itens por
/// referência e clona (o caminho feliz ainda os usa).
fn journalar_renomes_parciais(
    app: &AppHandle,
    op_id: u64,
    started_at_ms: u64,
    itens_renome: &[JournalItem],
) {
    if let Some(entry) = entrada_parcial_renomes(op_id, started_at_ms, itens_renome) {
        registrar_journal(app, &entry);
    }
}

/// #1067 RB20: desfecho da fase pós-rename (`planejar_e_copiar_muitas`) — só o que o
/// chamador precisa pra montar o `ResumoOp` e o manifesto de SUCESSO. `canceled == false`
/// e sem `Err` = sucesso; qualquer `Err` ou `canceled == true` obriga o chamador a
/// journalar o manifesto PARCIAL dos renames.
struct FaseMuitas {
    plano: Plano,
    canceled: bool,
    arquivos_feitos: u64,
}

/// #1067 RB20 (funil): a fase pós-rename do multi-move/copy — planeja (`planejar_muitas`),
/// cria os dirs, copia (`copiar_plano`) e, no move, aplica o gate anti-perda (#1066) e
/// remove as origens. Extraída de `executar_progresso_muitas` pra que TODAS as saídas de
/// erro/cancel DEPOIS dos renames mesmo-volume passem por um ÚNICO ponto de junção no
/// chamador — que é quem journala. INVARIANTE: este helper **não journala nada**; só
/// devolve o desfecho. Preserva RB24 (limpeza de resíduo via `limpar_destinos_a_planejar`
/// embutida no `Err`/cancel do `copiar_plano`), o gate `copia_completa` e todos os logs.
/// As cinco saídas de erro (plano ilegível `?`, enumeração incompleta `plano.erros`,
/// `create_dir_all?`, cópia falha, `copia_completa` falso + `remover?` da origem) viram
/// `Err`; o cancel vira `Ok(FaseMuitas{canceled:true,..})`; o sucesso, `canceled:false`.
#[allow(clippy::too_many_arguments)]
fn planejar_e_copiar_muitas(
    mover: bool,
    a_planejar: &[(String, String)],
    op_id: u64,
    flag: &Arc<AtomicBool>,
    pausar: &Arc<AtomicBool>,
    verify: Option<VerifyAlg>,
    app: &AppHandle,
    rotulo: &'static str,
    started_at_ms: u64,
    t0: Instant,
    renomeados: usize,
) -> Result<FaseMuitas, FsError> {
    emitir_descobrindo(app, op_id, rotulo, started_at_ms); // #875: fase Discovering
    let pares_path: Vec<(PathBuf, PathBuf)> = a_planejar
        .iter()
        .map(|(s, d)| (PathBuf::from(s), PathBuf::from(d)))
        .collect();
    let plano = planejar_muitas(&pares_path)?;
    // #1066: alguma origem teve entrada não-enumerável → plano incompleto. Aborta
    // antes de copiar (as origens de `a_planejar` ficam intactas). Os renames
    // mesmo-volume já efetivados acima seguem no destino — não são perda de dado.
    if !plano.erros.is_empty() {
        log::error!(
            "fs_{rotulo} ERRO op={op_id}: enumeração pulou {} entrada(s) — abortando (ex.: {})",
            plano.erros.len(),
            plano.erros.first().map(String::as_str).unwrap_or("")
        );
        return Err(FsError::Io(format!(
            "enumeração incompleta: {} entrada(s) inacessível(is) — op abortada (ex.: {})",
            plano.erros.len(),
            plano.erros.first().map(String::as_str).unwrap_or("")
        )));
    }
    for d in &plano.dirs {
        std::fs::create_dir_all(com_long_path(d))?;
    }
    let perfil = perfilar(&pares_path[0].0, &pares_path[0].1);
    log::info!(
        "fs_{rotulo} START op={op_id}: {} origem(ns) ({renomeados} rename), {} arquivo(s), {:.1} MiB, {} dir(s), {} worker(s)",
        a_planejar.len() + renomeados,
        plano.total_arquivos,
        plano.total_bytes as f64 / 1_048_576.0,
        plano.dirs.len(),
        perfil.workers
    );
    let ctx = Contexto {
        processados: Arc::new(AtomicU64::new(0)),
        arquivos_feitos: Arc::new(AtomicU64::new(0)),
        cancelar: flag.clone(),
        pausar: pausar.clone(),
        verify,
        atual: Arc::new(Mutex::new(String::new())),
    };
    let ticker = iniciar_ticker(
        app,
        op_id,
        plano.total_bytes,
        plano.total_arquivos,
        ctx.processados.clone(),
        ctx.arquivos_feitos.clone(),
        verify.is_some(),
        rotulo,
        started_at_ms,
        ctx.atual.clone(),
        pausar.clone(),
    );
    let resultado = copiar_plano(&plano, perfil.workers, &ctx);
    ticker.parar();
    if let Err(e) = resultado {
        log::error!("fs_{rotulo} ERRO op={op_id}: {e}");
        // #1067 RB24: limpa os destinos do plano capturando resíduo (não engole falha).
        let residuos = limpar_destinos_a_planejar(a_planejar, rotulo, op_id);
        // #1067 RB20: NÃO journala aqui — o chamador é o ÚNICO ponto que grava o manifesto
        // parcial dos renames (pra este `Err` e pros outros quatro). A limpeza acima já
        // desfez o que a cópia deixou pela metade.
        if !residuos.is_empty() {
            return Err(FsError::Io(format!("{e} — resíduo NÃO removido em: {}", residuos.join(", "))));
        }
        return Err(e);
    }
    if flag.load(Ordering::Relaxed) {
        // #1067 RB24: mesma captura de resíduo no cancel.
        let residuos = limpar_destinos_a_planejar(a_planejar, rotulo, op_id);
        if !residuos.is_empty() {
            log::error!(
                "fs_{rotulo} op={op_id}: CANCELADO com {} resíduo(s) não removido(s): {}",
                residuos.len(), residuos.join(", ")
            );
        }
        // #1067 RB20: cancel volta como `Ok(canceled=true)` — o chamador journala o parcial
        // e monta o `ResumoOp` terminal (sem reclassificar cancel→erro).
        return Ok(FaseMuitas {
            plano,
            canceled: true,
            arquivos_feitos: ctx.arquivos_feitos.load(Ordering::Relaxed),
        });
    }
    if mover {
        // #1066: gate anti-perda — só remove as origens se a cópia bateu com o plano.
        let feitos = ctx.arquivos_feitos.load(Ordering::Relaxed);
        let bytes = ctx.processados.load(Ordering::Relaxed);
        if !copia_completa(&plano, feitos, bytes) {
            log::error!(
                "fs_{rotulo} ERRO op={op_id}: cópia incompleta ({feitos}/{} arq, {bytes}/{} bytes) — origens PRESERVADAS",
                plano.total_arquivos, plano.total_bytes
            );
            return Err(FsError::Io(format!(
                "cópia incompleta: {feitos}/{} arquivo(s), {bytes}/{} byte(s) copiado(s) — origens NÃO removidas",
                plano.total_arquivos, plano.total_bytes
            )));
        }
        for (src, _) in a_planejar {
            remover(src)?;
        }
    }
    let elapsed = t0.elapsed().as_secs_f64().max(0.001);
    let mib = plano.total_bytes as f64 / 1_048_576.0;
    log::info!(
        "fs_{rotulo} END op={op_id}: {elapsed:.2}s, {:.1} MiB/s medio, {:.0} arquivo(s)/s, {} arquivo(s), {mib:.1} MiB",
        mib / elapsed,
        plano.total_arquivos as f64 / elapsed,
        plano.total_arquivos
    );
    let arquivos_feitos = ctx.arquivos_feitos.load(Ordering::Relaxed);
    Ok(FaseMuitas { plano, canceled: false, arquivos_feitos })
}

/// #850 (fatia B): copy/move de MÚLTIPLAS origens pra um destino, em UMA fase só.
/// Move mesmo-volume tenta rename por-origem (instantâneo); o resto entra num Plano
/// GLOBAL (`planejar_muitas`) → uma varredura + uma cópia (modelo TeraCopy), matando
/// o "2 pastas sequenciais". Loga START/END com MB/s médio (#850). `true` = cancelada.
#[allow(clippy::too_many_arguments)]
fn executar_progresso_muitas(
    mover: bool,
    pares: Vec<(String, String)>,
    op_id: u64,
    flag: &Arc<AtomicBool>,
    pausar: &Arc<AtomicBool>,
    verify: Option<VerifyAlg>,
    app: &AppHandle,
    started_at_ms: u64,
) -> Result<ResumoOp, FsError> {
    for (from, to) in &pares {
        validar(from)?;
        validar(to)?;
        if com_long_path(Path::new(to)).exists() {
            return Err(FsError::AlreadyExists(to.clone()));
        }
    }
    let rotulo = if mover { "move" } else { "copy" };
    let t0 = Instant::now();
    // Move mesmo-volume: rename por-origem (instantâneo); o resto vai pro Plano.
    let mut a_planejar: Vec<(String, String)> = Vec::new();
    // #899 U0: pares renomeados (undo = rename inverso to→from), pro manifesto.
    let mut renomeados_pares: Vec<(String, String)> = Vec::new();
    for (from, to) in &pares {
        if mover
            && std::fs::rename(com_long_path(Path::new(from)), com_long_path(Path::new(to))).is_ok()
        {
            renomeados_pares.push((from.clone(), to.clone()));
            continue;
        }
        a_planejar.push((from.clone(), to.clone()));
    }
    let renomeados = renomeados_pares.len();
    // #899 U0: itens dos renames (comuns aos dois caminhos de saída).
    let itens_renome: Vec<JournalItem> = renomeados_pares
        .iter()
        .map(|(f, t)| journal_item(Path::new(f), Path::new(t), true))
        .collect();
    if a_planejar.is_empty() {
        log::info!("fs_{rotulo} END op={op_id}: {renomeados} rename(s) mesmo-volume instantâneo(s)");
        // #899 U0: só renames — manifesto move com os itens invertíveis.
        if !itens_renome.is_empty() {
            registrar_journal(
                app,
                &OperationJournalEntry {
                    op_id,
                    kind: "move".into(),
                    started_at_ms,
                    ended_at_ms: agora_ms(),
                    status: "success".into(),
                    resolucao: None,
                    items: itens_renome,
                    trash_record_ids: Vec::new(),
                    undo_granularidade: String::new(),
                },
            );
        }
        // só renames mesmo-volume: conta os itens renomeados.
        let n = renomeados as u64;
        return Ok(ResumoOp { canceled: false, files_total: n, files_done: n });
    }
    // #1067 RB20 (invariante ESTRUTURAL): daqui pra baixo, TODA saída de erro/cancel da
    // fase pós-rename precisa journalar o manifesto PARCIAL dos renames mesmo-volume já
    // efetivados — senão eles ficam no destino sem manifesto → undo indisponível = estado
    // irreversível (o data-loss que o #1067 fecha). Em vez de tapar cada `return` da fase
    // (frágil: a próxima rota nova reabriria o buraco), a fase inteira vive em
    // `planejar_e_copiar_muitas` (que NÃO journala). AQUI, no ÚNICO ponto de junção, os
    // braços `Err`/cancel journalam o parcial e o braço de sucesso grava o manifesto
    // completo. Qualquer rota nova DENTRO da fase sai por `Err`/`Ok(canceled)` e cai num
    // destes três braços — a lacuna vira estruturalmente impossível.
    match planejar_e_copiar_muitas(
        mover, &a_planejar, op_id, flag, pausar, verify, app, rotulo, started_at_ms, t0, renomeados,
    ) {
        Err(e) => {
            journalar_renomes_parciais(app, op_id, started_at_ms, &itens_renome);
            Err(e)
        }
        Ok(f) if f.canceled => {
            journalar_renomes_parciais(app, op_id, started_at_ms, &itens_renome);
            Ok(ResumoOp {
                canceled: true,
                files_total: renomeados as u64 + f.plano.total_arquivos,
                files_done: renomeados as u64 + f.arquivos_feitos,
            })
        }
        Ok(f) => {
            // #899 U0: manifesto do plano global + os renames por-origem (mesmo op_id).
            let mut entrada = montar_entrada(op_id, mover, started_at_ms, agora_ms(), &f.plano);
            entrada.items.extend(itens_renome);
            registrar_journal(app, &entrada);
            Ok(ResumoOp {
                canceled: false,
                files_total: renomeados as u64 + f.plano.total_arquivos,
                files_done: renomeados as u64 + f.arquivos_feitos,
            })
        }
    }
}

/// #1066: a cópia bateu EXATAMENTE com o planejado? Gate anti-perda-de-dado que
/// decide se um MOVE pode remover a origem: exige contagem de arquivos E bytes
/// iguais ao plano E nenhum pulo de enumeração. Pura (só compara números) →
/// testável sem `AppHandle`. `false` = cópia incompleta → NUNCA apagar a origem.
fn copia_completa(plano: &Plano, arquivos_feitos: u64, bytes_feitos: u64) -> bool {
    plano.erros.is_empty()
        && arquivos_feitos == plano.total_arquivos
        && bytes_feitos == plano.total_bytes
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
                    let mut g = erro.lock().unwrap_or_else(|e| e.into_inner());
                    if g.is_none() {
                        *g = Some(e);
                        ctx.cancelar.store(true, Ordering::Relaxed); // aborta os demais
                    }
                }
            });
    });
    // #1073 (RB26): um `copiar_arquivo` que PANICAR envenena este Mutex; recupera o
    // interior em vez de propagar o panic (into_inner de Mutex poisonado = Err).
    match erro.into_inner().unwrap_or_else(|e| e.into_inner()) {
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
    /// De onde veio: "exif"/"decode" = gerado agora; "cacheMem"/"cacheDisk" = hit
    /// do cache (#737, sem re-decode).
    pub source: String,
}

/// Pool rayon dedicado a thumbnails, criado uma vez. Dimensionado a ~3/4 dos
/// núcleos lógicos (headroom pra UI/OS; hyperthreading não ajuda decode SIMD),
/// mínimo 1. Bounda a paralelização mesmo com N chamadas simultâneas do front.
fn thumb_pool() -> Option<&'static rayon::ThreadPool> {
    static POOL: std::sync::OnceLock<Option<rayon::ThreadPool>> = std::sync::OnceLock::new();
    POOL.get_or_init(|| {
        let logical = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        let n = (logical * 3 / 4).max(1);
        // #1073 (RB26): a falha ao montar o pool (raro: limite de threads do SO)
        // NÃO pode derrubar o app via `expect`. Sem pool dedicado, o chamador
        // gera o thumbnail direto (pool global do rayon), só sem o cap de threads.
        match rayon::ThreadPoolBuilder::new()
            .num_threads(n)
            .thread_name(|i| format!("thumb-{i}"))
            .build()
        {
            Ok(pool) => Some(pool),
            Err(e) => {
                log::error!("[thumb] pool dedicado indisponível ({e}); gerando sem cap de threads");
                None
            }
        }
    })
    .as_ref()
}

/// Gera o thumbnail de `path` com o maior lado <= `max_size` (16..=1024).
///
/// #737 — cache transparente (a assinatura NÃO muda; o F3/front só ganha hits):
///   1. memória (LRU) → 2. disco (`appdata/thumbnails/<hash>.webp`) → 3. gera no
/// pool. Chave = `blake3(path | mtime | size | maxSize)`: mexer no arquivo (mtime
/// novo) invalida a chave; o órfão é coletado pelo GC de disco.
/// Teto de bytes para gerar thumbnail: acima disso o decode/rasterização custa
/// caro e trava a UI (#820). 48 MiB cobre fotos legítimas e barra pixel-bombs.
const MAX_THUMB_BYTES: u64 = 48 * 1024 * 1024;

/// Extensões RASTER que o decoder aceita (espelha o `EXT_IMAGEM` do front + os
/// formatos que o `image` decodifica). Vetor (svg) e o resto NUNCA entram (#820).
fn ext_raster_suportada(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some(
            "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "ico" | "tif" | "tiff"
        )
    )
}

/// #834 (P0): comando ASSÍNCRONO — roda no pool blocking do `async_runtime`, NUNCA
/// na main thread. Como `pub fn` SÍNCRONO (o bug), o Tauri o executava na MAIN: cada
/// thumbnail bloqueava a UI, os invokes concorrentes serializavam na main e o
/// `thumb_pool` engolia 1 imagem por vez esperando ali (o pool de N threads era
/// inútil). Agora cada thumbnail é off-main; o `thumb_pool` (rayon) interno segue
/// boundando a CPU do decode a ~3/4 dos cores, e os invokes rodam de fato em paralelo.
#[tauri::command]
pub async fn fs_thumbnail(path: String, max_size: u32) -> Result<ThumbRef, FsError> {
    tauri::async_runtime::spawn_blocking(move || fs_thumbnail_sync(path, max_size))
        .await
        .map_err(spawn_err)?
}

fn fs_thumbnail_sync(path: String, max_size: u32) -> Result<ThumbRef, FsError> {
    validar(&path)?;
    let max = max_size.clamp(16, 1024);
    // #820 (P0): guard O(1) ANTES de ler/decodificar. Vetor (svg) e tipos não-raster
    // recebem ícone de TIPO — rasterizar um SVG grande (repro do Wagner: 23 MB) trava
    // a UI. Defesa autoritativa do backend (o front já filtra por EXT_IMAGEM).
    if !ext_raster_suportada(&path) {
        return Err(FsError::NaoRasterizavel(path));
    }
    let (mtime, size) = arquivo_mtime_size(&path)?;
    // #820: arquivo raster gigante também trava no decode — barra pelo tamanho.
    if size > MAX_THUMB_BYTES {
        return Err(FsError::NaoRasterizavel(format!(
            "{path} ({size} bytes > {MAX_THUMB_BYTES})"
        )));
    }
    let key = cache_key(&path, mtime, size, max);

    // 1) memória — thumb quente, hit instantâneo.
    if let Some((bytes, w, h)) = mem_get(&key) {
        MET_HIT_MEM.fetch_add(1, Ordering::Relaxed); // #740
        return Ok(ThumbRef { data_uri: data_uri_webp(&bytes), width: w, height: h, source: "cacheMem".into() });
    }
    // 2) disco — sobrevive a re-scroll/reabrir o app; re-popula a memória.
    if let Some(bytes) = disco_get(&key) {
        MET_HIT_DISCO.fetch_add(1, Ordering::Relaxed); // #740
        let (w, h) = webp_dims(&bytes);
        let arc = std::sync::Arc::new(bytes);
        mem_put(&key, arc.clone(), w, h);
        return Ok(ThumbRef { data_uri: data_uri_webp(&arc), width: w, height: h, source: "cacheDisk".into() });
    }
    // 3) miss — gera no pool (bounda CPU) e persiste nos dois níveis. #740: mede o
    // tempo de geração (pro avg/throughput do relatório de perf).
    let t0 = Instant::now();
    // #1073 (RB26): com pool → roda dentro dele (cap de threads); sem pool (build
    // falhou) → gera direto no pool global do rayon, sem panicar.
    let (webp, w, h, source) = match thumb_pool() {
        Some(pool) => pool.install(|| gerar_webp(&path, max)),
        None => gerar_webp(&path, max),
    }?;
    MET_GEN_NS.fetch_add(t0.elapsed().as_nanos() as u64, Ordering::Relaxed);
    MET_GERADAS.fetch_add(1, Ordering::Relaxed);
    disco_put(&key, &webp);
    let arc = std::sync::Arc::new(webp);
    mem_put(&key, arc.clone(), w, h);
    Ok(ThumbRef { data_uri: data_uri_webp(&arc), width: w, height: h, source: source.into() })
}

/// Gera os bytes webp do thumbnail (sem cache). Fast-path EXIF → senão decode+resize.
fn gerar_webp(path: &str, max: u32) -> Result<(Vec<u8>, u32, u32, &'static str), FsError> {
    let bytes = std::fs::read(com_long_path(Path::new(path)))?;
    // Fast-path: thumbnail EXIF embutida (só JPEG). Pula o decode full-res.
    if let Some(thumb) = exif_thumbnail(&bytes) {
        if let Ok(img) = image::load_from_memory(&thumb) {
            let (w, h, webp) = resize_encode(&img, max)?;
            return Ok((webp, w, h, "exif"));
        }
    }
    // Caminho robusto: decodifica o formato (png/jpg/gif/bmp/webp/ico/tiff) e reduz.
    let img = image::load_from_memory(&bytes)
        .map_err(|e| FsError::Io(format!("decode de imagem falhou: {e}")))?;
    let (w, h, webp) = resize_encode(&img, max)?;
    Ok((webp, w, h, "decode"))
}

// ── Cache de thumbnail (#737 F2): memória (LRU byte-limitada) + disco (GC) ────

/// Tetos configuráveis (via `fs_thumb_cache_limits`). Disco default 1 GB, memória 96 MB.
static DISK_CAP_MB: AtomicU64 = AtomicU64::new(1024);
static MEM_CAP_MB: AtomicU64 = AtomicU64::new(96);

/// Ajusta os tetos do cache (MB). Disco mín. 16, memória mín. 8.
/// #1073 (RB28): `async` + `spawn_blocking` — não bloqueia a main thread (padrão da
/// casa). Contrato de retorno inalterado (`()`).
#[tauri::command]
pub async fn fs_thumb_cache_limits(disk_mb: u64, mem_mb: u64) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        DISK_CAP_MB.store(disk_mb.max(16), Ordering::Relaxed);
        MEM_CAP_MB.store(mem_mb.max(8), Ordering::Relaxed);
    })
    .await;
}

// ── Métricas de perf do gerador de thumbnail (#740 F5) ───────────────────────
// Contadores globais pro relatório baseline vs pós-F1-F3 (hit-rate + geração).
// A validação real (5000 imgs no 5900X, TTF/throughput sob carga) é do Wagner.

static MET_HIT_MEM: AtomicU64 = AtomicU64::new(0);
static MET_HIT_DISCO: AtomicU64 = AtomicU64::new(0);
static MET_GERADAS: AtomicU64 = AtomicU64::new(0);
static MET_GEN_NS: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbMetrics {
    pub hit_mem: u64,
    pub hit_disco: u64,
    pub geradas: u64,
    pub total: u64,
    /// Fração de hits (mem+disco) sobre o total de pedidos, 0..1.
    pub hit_rate: f64,
    /// Tempo médio de geração de UM thumb (só miss), em ms.
    pub gen_medio_ms: f64,
    /// Threads do pool + tetos atuais (MB) + uso de memória do cache (bytes).
    pub pool_threads: usize,
    pub disk_cap_mb: u64,
    pub mem_cap_mb: u64,
    pub mem_bytes: u64,
}

/// Monta as métricas derivadas dos contadores crus. Pura → testável sem estado.
fn montar_metrics(
    hit_mem: u64,
    hit_disco: u64,
    geradas: u64,
    gen_ns: u64,
    pool_threads: usize,
    disk_cap_mb: u64,
    mem_cap_mb: u64,
    mem_bytes: u64,
) -> ThumbMetrics {
    let total = hit_mem + hit_disco + geradas;
    let hit_rate = if total == 0 {
        0.0
    } else {
        (hit_mem + hit_disco) as f64 / total as f64
    };
    let gen_medio_ms = if geradas == 0 {
        0.0
    } else {
        (gen_ns as f64 / geradas as f64) / 1_000_000.0
    };
    ThumbMetrics {
        hit_mem,
        hit_disco,
        geradas,
        total,
        hit_rate,
        gen_medio_ms,
        pool_threads,
        disk_cap_mb,
        mem_cap_mb,
        mem_bytes,
    }
}

/// Snapshot das métricas do gerador de thumbnail (pro painel/relatório de perf).
/// #1073 (RB28): `async` + `spawn_blocking` — não bloqueia a main thread. Retorno
/// `ThumbMetrics` inalterado (JoinError impossível aqui → `unwrap_or_default`).
#[tauri::command]
pub async fn fs_thumb_metrics() -> ThumbMetrics {
    tauri::async_runtime::spawn_blocking(|| {
        let mem_bytes = cache_mem().lock().map(|c| c.bytes as u64).unwrap_or(0);
        montar_metrics(
            MET_HIT_MEM.load(Ordering::Relaxed),
            MET_HIT_DISCO.load(Ordering::Relaxed),
            MET_GERADAS.load(Ordering::Relaxed),
            MET_GEN_NS.load(Ordering::Relaxed),
            thumb_pool().map(|p| p.current_num_threads()).unwrap_or(0),
            DISK_CAP_MB.load(Ordering::Relaxed),
            MEM_CAP_MB.load(Ordering::Relaxed),
            mem_bytes,
        )
    })
    .await
    .unwrap_or_default()
}

/// Zera os contadores (pra rodar um baseline limpo antes de medir).
/// #1073 (RB28): `async` + `spawn_blocking` — não bloqueia a main thread.
#[tauri::command]
pub async fn fs_thumb_metrics_reset() {
    let _ = tauri::async_runtime::spawn_blocking(|| {
        MET_HIT_MEM.store(0, Ordering::Relaxed);
        MET_HIT_DISCO.store(0, Ordering::Relaxed);
        MET_GERADAS.store(0, Ordering::Relaxed);
        MET_GEN_NS.store(0, Ordering::Relaxed);
    })
    .await;
}

/// Chave do cache: blake3(path | mtime_nanos | size | maxSize). `maxSize` entra
/// pra não colidir thumbs de tamanhos diferentes; `mtime`/`size` = invalidação.
fn cache_key(path: &str, mtime_nanos: u128, size: u64, max: u32) -> String {
    let mut h = blake3::Hasher::new();
    h.update(path.as_bytes());
    h.update(&[0]);
    h.update(&mtime_nanos.to_le_bytes());
    h.update(&size.to_le_bytes());
    h.update(&max.to_le_bytes());
    h.finalize().to_hex().to_string()
}

fn arquivo_mtime_size(path: &str) -> Result<(u128, u64), FsError> {
    let m = std::fs::metadata(com_long_path(Path::new(path)))?;
    let mtime = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    Ok((mtime, m.len()))
}

/// Dimensões de um webp sem decodificar os pixels (lê só o header).
fn webp_dims(bytes: &[u8]) -> (u32, u32) {
    image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()
        .and_then(|r| r.into_dimensions().ok())
        .unwrap_or((0, 0))
}

// -- disco --

fn thumb_dir() -> Option<PathBuf> {
    let d = dirs::cache_dir()?.join("GALAXIE").join("thumbnails");
    std::fs::create_dir_all(&d).ok()?;
    Some(d)
}

fn disco_get(key: &str) -> Option<Vec<u8>> {
    std::fs::read(thumb_dir()?.join(format!("{key}.webp"))).ok()
}

fn disco_put(key: &str, bytes: &[u8]) {
    let Some(dir) = thumb_dir() else { return };
    if std::fs::write(dir.join(format!("{key}.webp")), bytes).is_ok() {
        // GC amortizado: confere o teto a cada 128 escritas (não a cada thumb).
        static N: AtomicU64 = AtomicU64::new(0);
        if N.fetch_add(1, Ordering::Relaxed) % 128 == 0 {
            gc_disco(&dir);
        }
    }
}

/// Coleta o cache de disco se passar do teto: remove os mais ANTIGOS por atime
/// (fallback modified) até voltar pra baixo do cap.
fn gc_disco(dir: &Path) {
    let cap = DISK_CAP_MB.load(Ordering::Relaxed).saturating_mul(1024 * 1024);
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut arquivos: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
    let mut total = 0u64;
    for e in rd.flatten() {
        let Ok(m) = e.metadata() else { continue };
        if !m.is_file() {
            continue;
        }
        total += m.len();
        let at = m.accessed().or_else(|_| m.modified()).unwrap_or(UNIX_EPOCH);
        arquivos.push((e.path(), m.len(), at));
    }
    if total <= cap {
        return;
    }
    arquivos.sort_by_key(|(_, _, at)| *at); // mais antigo primeiro
    for (p, sz, _) in arquivos {
        if total <= cap {
            break;
        }
        if std::fs::remove_file(&p).is_ok() {
            total = total.saturating_sub(sz);
        }
    }
}

// -- memória (LRU byte-limitada) --

type EntradaMem = (std::sync::Arc<Vec<u8>>, u32, u32);

struct CacheMem {
    lru: lru::LruCache<String, EntradaMem>,
    bytes: usize,
}

impl CacheMem {
    fn novo(teto_itens: usize) -> Self {
        // Cap por BYTES é o limitador real; o teto de itens é só uma trava alta.
        CacheMem {
            lru: lru::LruCache::new(std::num::NonZeroUsize::new(teto_itens.max(1)).unwrap()),
            bytes: 0,
        }
    }

    fn obter(&mut self, key: &str) -> Option<EntradaMem> {
        self.lru.get(key).cloned()
    }

    /// Insere e faz eviction LRU até caber em `cap_bytes`.
    fn inserir(&mut self, key: &str, bytes: std::sync::Arc<Vec<u8>>, w: u32, h: u32, cap_bytes: usize) {
        let novo = bytes.len();
        if let Some((old, _, _)) = self.lru.put(key.to_string(), (bytes, w, h)) {
            self.bytes = self.bytes.saturating_sub(old.len());
        }
        self.bytes += novo;
        while self.bytes > cap_bytes {
            match self.lru.pop_lru() {
                Some((_, (v, _, _))) => self.bytes = self.bytes.saturating_sub(v.len()),
                None => break,
            }
        }
    }
}

fn cache_mem() -> &'static Mutex<CacheMem> {
    static C: std::sync::OnceLock<Mutex<CacheMem>> = std::sync::OnceLock::new();
    C.get_or_init(|| Mutex::new(CacheMem::novo(100_000)))
}

fn mem_get(key: &str) -> Option<EntradaMem> {
    cache_mem().lock().ok()?.obter(key)
}

fn mem_put(key: &str, bytes: std::sync::Arc<Vec<u8>>, w: u32, h: u32) {
    let cap = (MEM_CAP_MB.load(Ordering::Relaxed) as usize).saturating_mul(1024 * 1024);
    if let Ok(mut c) = cache_mem().lock() {
        c.inserir(key, bytes, w, h, cap);
    }
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

/// #871: busca recursiva streaming. `root` vazio = "This PC" (todos os drives);
/// `query` = substring no nome. Devolve o `searchId` na hora; os resultados
/// chegam por lotes no evento `fs-search-result`. Cancela com `fs_cancel(searchId)`.
#[tauri::command]
pub async fn fs_search(
    root: String,
    query: String,
    max_results: usize,
    batch: usize,
    app: AppHandle,
    pm: State<'_, ProgressManager>,
) -> Result<u64, FsError> {
    let (search_id, cancel, _pause) = pm.nova_op();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        executar_busca(&root, &query, max_results, batch, search_id, &cancel, &app);
        app.state::<ProgressManager>().finalizar(search_id);
    });
    Ok(search_id)
}

#[tauri::command]
pub async fn fs_stat(path: String) -> Result<FsEntry, FsError> {
    tauri::async_runtime::spawn_blocking(move || stat(&path))
        .await
        .map_err(spawn_err)?
}

/// #873: bytes de um arquivo local como `AnexoConteudo` ({ bytesB64, contentType,
/// nome }) pro preview (sem asset-protocol) — mesmo shape do anexo do Graph.
/// `maxBytes` opcional (limitado a 25MB); `ArquivoGrande`/`NotADirectory` = fallback.
#[tauri::command]
pub async fn fs_read_file_bytes(
    path: String,
    max_bytes: Option<u64>,
) -> Result<crate::graph::AnexoConteudo, FsError> {
    tauri::async_runtime::spawn_blocking(move || ler_bytes_arquivo(&path, max_bytes))
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

/// #869: mounts de nuvem locais (OneDrive pasta + Google Drive letra) pra seção
/// "Cloud drives" do sidebar. Vazio se nenhum cliente de nuvem está instalado.
#[tauri::command]
pub async fn fs_cloud_locations() -> Result<Vec<CloudLocation>, FsError> {
    tauri::async_runtime::spawn_blocking(|| Ok(detectar_clouds()))
        .await
        .map_err(spawn_err)?
}

/// #871: mapeia um network drive (menu "New → Network drive" do ribbon).
/// `letter` = letra livre ("Z:"), `remote` = UNC (`\\server\share`),
/// `persistent` = reconecta no login.
#[tauri::command]
pub async fn fs_map_network_drive(
    letter: String,
    remote: String,
    persistent: bool,
) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || mapear_network_drive(&letter, &remote, persistent))
        .await
        .map_err(spawn_err)?
}

/// #871: desconecta um network drive mapeado. `force` derruba mesmo com arquivos
/// abertos.
#[tauri::command]
pub async fn fs_disconnect_network_drive(letter: String, force: bool) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || desconectar_network_drive(&letter, force))
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
/// #1073 (RB28): a chamada ao shell é bloqueante → `spawn_blocking` (não trava a
/// main thread). Contrato de retorno inalterado.
#[tauri::command]
pub async fn fs_reveal(path: String) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::system::revelar_no_explorer(&path).map_err(FsError::Io)
    })
    .await
    .map_err(spawn_err)?
}

/// Abre o item com o app padrão do Windows (reusa `system::abrir_caminho`).
/// #1073 (RB28): idem `fs_reveal` — shell bloqueante em `spawn_blocking`.
#[tauri::command]
pub async fn fs_open(path: String) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::system::abrir_caminho(&path).map_err(FsError::Io)
    })
    .await
    .map_err(spawn_err)?
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

// #1066 (RB21): os comandos `fs_copy`/`fs_move` legados foram REMOVIDOS. Tinham
// política de conflito OPOSTA ao pipeline turbo (sobrescreviam em silêncio vs. o
// turbo que recusa com `AlreadyExists`) e nenhum chamador de UI — o Explorer usa
// só `copiarComProgresso`/`moverComProgresso` (turbo). Sobra UMA política de
// conflito. As funções internas `copiar`/`mover` continuam (undo + testes).

#[tauri::command]
pub async fn fs_trash(paths: Vec<String>) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || para_lixeira(&paths))
        .await
        .map_err(spawn_err)?
}

/// #1047 (SEC7): emite o nonce de sessão que autoriza UMA exclusão permanente.
/// O front chama isto imediatamente antes de `fs_delete_permanent`. Read-only
/// (não escreve dado do Bridge) — só gera e guarda o nonce no estado.
#[tauri::command]
pub fn fs_delete_permanent_token(state: State<'_, TokenExclusao>) -> String {
    state.emitir()
}

#[tauri::command]
pub async fn fs_delete_permanent(
    paths: Vec<String>,
    confirm_token: String,
    token: State<'_, TokenExclusao>,
) -> Result<(), FsError> {
    // `TokenExclusao` é `Clone` (Arc interno) → cruza o `spawn_blocking` (Send + 'static).
    let token = token.inner().clone();
    tauri::async_runtime::spawn_blocking(move || excluir_permanente(&paths, &confirm_token, &token))
        .await
        .map_err(spawn_err)?
}

// --- Progresso + conflito + watcher (#680 S4) ---

/// Roda a op em background (spawn_blocking), finaliza a op no manager e emite o
/// `fs-op-progress` final (done/canceled/error). O comando devolve o `op_id` já.
#[allow(clippy::too_many_arguments)]
fn spawn_progresso(
    mover: bool,
    from: String,
    to: String,
    op_id: u64,
    flag: Arc<AtomicBool>,
    pausar: Arc<AtomicBool>,
    verify: Option<VerifyAlg>,
    app: AppHandle,
) {
    let op_kind = if mover { "move" } else { "copy" };
    let started_at_ms = agora_ms();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let resultado =
            executar_progresso(mover, &from, &to, op_id, &flag, &pausar, verify, &app, started_at_ms);
        app.state::<ProgressManager>().finalizar(op_id);
        let (canceled, files_total, files_done, error) = match resultado {
            Ok(r) => (r.canceled, r.files_total, r.files_done, None),
            Err(e) => (false, 0, 0, Some(e)),
        };
        emitir_final(
            &app,
            op_id,
            op_kind,
            started_at_ms,
            canceled,
            files_total,
            files_done,
            error,
        );
    });
}

/// Resumo do fim de uma op de cópia/move: cancelamento + contagem REAL de arquivos
/// (#989: o terminal hardcodava 0 → o front mostrava "Moved 0 files"). No sucesso,
/// `files_done == files_total`. Renames instantâneos contam os ITENS renomeados.
struct ResumoOp {
    canceled: bool,
    files_total: u64,
    files_done: u64,
}

/// #875: evento terminal (`phase=done`) — status agregado (success/canceled/error),
/// `completed_at_ms`. O front RETÉM a op na fila por isto (não descarta no terminal).
/// #989: emite a contagem REAL de arquivos (não mais 0 hardcoded).
fn emitir_final(
    app: &AppHandle,
    op_id: u64,
    op_kind: &'static str,
    started_at_ms: u64,
    canceled: bool,
    files_total: u64,
    files_done: u64,
    error: Option<FsError>,
) {
    let status = if error.is_some() {
        "error"
    } else if canceled {
        "canceled"
    } else {
        "success"
    };
    let _ = app.emit(
        "fs-op-progress",
        OpProgress {
            op_id,
            processed_bytes: 0,
            total_bytes: 0,
            percent: if error.is_some() { 0.0 } else { 100.0 },
            eta_ms: None,
            files_total,
            files_done,
            bytes_per_sec: 0,
            verifying: false,
            done: true,
            canceled,
            error,
            op_kind,
            phase: "done",
            status,
            current_file: None,
            started_at_ms,
            completed_at_ms: Some(agora_ms()),
        },
    );
}

/// #850 (fatia B): versão multi-origem do [`spawn_progresso`] — UMA op/op_id pro
/// batch inteiro (não uma por origem), então o front acompanha um progresso só.
#[allow(clippy::too_many_arguments)]
fn spawn_progresso_muitas(
    mover: bool,
    pares: Vec<(String, String)>,
    op_id: u64,
    flag: Arc<AtomicBool>,
    pausar: Arc<AtomicBool>,
    verify: Option<VerifyAlg>,
    app: AppHandle,
) {
    let op_kind = if mover { "move" } else { "copy" };
    let started_at_ms = agora_ms();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let resultado =
            executar_progresso_muitas(mover, pares, op_id, &flag, &pausar, verify, &app, started_at_ms);
        app.state::<ProgressManager>().finalizar(op_id);
        let (canceled, files_total, files_done, error) = match resultado {
            Ok(r) => (r.canceled, r.files_total, r.files_done, None),
            Err(e) => (false, 0, 0, Some(e)),
        };
        emitir_final(
            &app,
            op_id,
            op_kind,
            started_at_ms,
            canceled,
            files_total,
            files_done,
            error,
        );
    });
}

/// #850 (fatia B): monta os pares (origem, destino) resolvendo o nome de cada
/// origem contra o diretório destino. Origem sem nome de arquivo é ignorada.
fn pares_para_destino(sources: Vec<String>, dest_dir: &str) -> Vec<(String, String)> {
    let base = Path::new(dest_dir);
    sources
        .into_iter()
        .filter_map(|s| {
            let nome = Path::new(&s).file_name()?;
            let dst = base.join(nome).to_string_lossy().into_owned();
            Some((s, dst))
        })
        .collect()
}

#[tauri::command]
pub async fn fs_copy_with_progress(
    from: String,
    to: String,
    verify: Option<VerifyAlg>,
    app: AppHandle,
    pm: State<'_, ProgressManager>,
) -> Result<u64, FsError> {
    // #1047 (SEC7): valida antes de spawnar — rejeita dir sensível/reparse no destino.
    checar_entrada_copia(&from, &to)?;
    let (op_id, flag, pausar) = pm.nova_op();
    spawn_progresso(false, from, to, op_id, flag, pausar, verify, app);
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
    // #1047 (SEC7): move valida a origem como mutação (o move apaga `from`).
    checar_entrada_move(&from, &to)?;
    let (op_id, flag, pausar) = pm.nova_op();
    spawn_progresso(true, from, to, op_id, flag, pausar, verify, app);
    Ok(op_id)
}

/// #850 (fatia B): copia VÁRIAS origens pra `dest_dir` numa op/plano só (modelo
/// TeraCopy). O front chama este no lugar de N `fs_copy_with_progress` — mata o
/// "2 pastas sequenciais" e dá um progresso/benchmark global.
#[tauri::command]
pub async fn fs_copy_many_with_progress(
    sources: Vec<String>,
    dest_dir: String,
    verify: Option<VerifyAlg>,
    app: AppHandle,
    pm: State<'_, ProgressManager>,
) -> Result<u64, FsError> {
    // #1047 (SEC7): valida dest_dir (escrita) + cada origem (leitura) antes do spawn.
    checar_entrada_muitas(&sources, &dest_dir, false)?;
    let pares = pares_para_destino(sources, &dest_dir);
    let (op_id, flag, pausar) = pm.nova_op();
    spawn_progresso_muitas(false, pares, op_id, flag, pausar, verify, app);
    Ok(op_id)
}

/// #850 (fatia B): move VÁRIAS origens pra `dest_dir` numa op só (rename por-origem
/// no mesmo-volume; o resto num plano global).
#[tauri::command]
pub async fn fs_move_many_with_progress(
    sources: Vec<String>,
    dest_dir: String,
    verify: Option<VerifyAlg>,
    app: AppHandle,
    pm: State<'_, ProgressManager>,
) -> Result<u64, FsError> {
    // #1047 (SEC7): move valida dest_dir + cada origem como mutação (apaga a origem).
    checar_entrada_muitas(&sources, &dest_dir, true)?;
    let pares = pares_para_destino(sources, &dest_dir);
    let (op_id, flag, pausar) = pm.nova_op();
    spawn_progresso_muitas(true, pares, op_id, flag, pausar, verify, app);
    Ok(op_id)
}

#[tauri::command]
pub async fn fs_cancel(op_id: u64, pm: State<'_, ProgressManager>) -> Result<(), FsError> {
    pm.cancelar(op_id);
    Ok(())
}

/// #898: pausa uma op de copy/move em andamento — os workers bloqueiam no próximo
/// arquivo/chunk e o card mostra "Pausado". No-op se a op já terminou.
#[tauri::command]
pub async fn fs_op_pause(op_id: u64, pm: State<'_, ProgressManager>) -> Result<(), FsError> {
    pm.pausar(op_id);
    Ok(())
}

/// #898: retoma uma op pausada — os workers continuam do ponto exato.
#[tauri::command]
pub async fn fs_op_resume(op_id: u64, pm: State<'_, ProgressManager>) -> Result<(), FsError> {
    pm.resumir(op_id);
    Ok(())
}

/// #899 U1: PRÉ-visualiza o undo de uma op (§5) — classifica os itens em
/// seguros/pulados/não-reversíveis SEM efeito colateral (pro diálogo de resumo
/// da U2). `None` = a op não está mais no journal.
#[tauri::command]
pub async fn fs_undo_preview(op_id: u64, app: AppHandle) -> Result<Option<UndoPlan>, FsError> {
    tauri::async_runtime::spawn_blocking(move || Ok(entrada_por_op(&app, op_id).map(|e| montar_plano_undo(&e))))
        .await
        .map_err(spawn_err)?
}

/// #899 U1: EXECUTA o undo de uma op — re-verifica cada item na hora
/// (anti-TOCTOU) e reverte só os seguros (cópia → Lixeira; move → `to`→`from`).
/// Best-effort por item; remove a entrada do journal ao fim (sem redo — U4).
#[tauri::command]
pub async fn fs_undo_op(op_id: u64, app: AppHandle) -> Result<UndoReport, FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(entry) = entrada_por_op(&app, op_id) else {
            return Err(FsError::InvalidPath(format!("op {op_id} não está no journal")));
        };
        let report = executar_undo(&entry);
        remover_entrada_journal(&app, op_id);
        log::info!(
            "fs_undo_op op={op_id}: {} revertido(s), {} pulado(s), {} não-reversível(is), {} erro(s)",
            report.executados,
            report.pulados,
            report.nao_reversiveis,
            report.erros.len()
        );
        Ok(report)
    })
    .await
    .map_err(spawn_err)?
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
    wr.watchers.lock().unwrap_or_else(|e| e.into_inner()).insert(id, w);
    Ok(id)
}

#[tauri::command]
pub async fn fs_unwatch(watcher_id: u64, wr: State<'_, WatcherRegistry>) -> Result<(), FsError> {
    // Dropar o Debouncer solta o watch do SO (sem vazar).
    wr.watchers.lock().unwrap_or_else(|e| e.into_inner()).remove(&watcher_id);
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
            pausar: Arc::new(AtomicBool::new(false)),
            verify,
            atual: Arc::new(Mutex::new(String::new())),
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
    fn planejar_muitas_funde_origens_num_plano_global() {
        // #850 fatia B: 2 origens → UM plano (totais somados, um só pequenos/grandes/dirs).
        let base = dir_temp("muitas");
        let o1 = base.join("o1");
        std::fs::create_dir_all(&o1).unwrap();
        std::fs::write(o1.join("a.txt"), vec![1u8; 20]).unwrap();
        let o2 = base.join("o2");
        std::fs::create_dir_all(o2.join("sub")).unwrap();
        std::fs::write(o2.join("b.txt"), vec![2u8; 5]).unwrap();
        std::fs::write(o2.join("sub").join("g.bin"), vec![3u8; (LIMITE_PEQUENO + 1) as usize]).unwrap();

        let pares = vec![
            (o1.clone(), base.join("dst").join("o1")),
            (o2.clone(), base.join("dst").join("o2")),
        ];
        let plano = planejar_muitas(&pares).unwrap();
        assert_eq!(plano.total_arquivos, 3, "3 arquivos somando as 2 origens");
        assert_eq!(plano.total_bytes, 20 + 5 + LIMITE_PEQUENO + 1);
        assert_eq!(plano.grandes.len(), 1);
        assert_eq!(plano.pequenos.len(), 2);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn pares_para_destino_resolve_nome_no_destino() {
        let pares = pares_para_destino(
            vec!["C:/x/a.txt".to_string(), "C:/y/pasta".to_string()],
            "D:/dest",
        );
        assert_eq!(pares.len(), 2);
        assert_eq!(pares[0].0, "C:/x/a.txt");
        assert!(pares[0].1.ends_with("a.txt"), "destino resolve o nome da origem");
        assert!(pares[1].1.ends_with("pasta"));
    }

    #[cfg(windows)]
    #[test]
    fn eh_cloud_fs_so_marca_provedor_conhecido() {
        // #869: conservador — só provedor de nuvem documentado vira cloud.
        assert!(eh_cloud_fs("DriveFS"));
        assert!(eh_cloud_fs("drivefs")); // case-insensitive
        // Filesystems reais NUNCA são cloud (sem mislabel).
        for fs in ["NTFS", "FAT32", "exFAT", "ReFS", ""] {
            assert!(!eh_cloud_fs(fs), "{fs} não é cloud");
        }
    }

    #[test]
    fn nome_cloud_folder_pega_o_leaf() {
        assert_eq!(nome_cloud_folder("C:\\Users\\x\\OneDrive - Contoso"), "OneDrive - Contoso");
        assert_eq!(nome_cloud_folder("C:\\Users\\x\\OneDrive"), "OneDrive");
    }

    #[test]
    fn cloud_pasta_ignora_vazio_e_inexistente() {
        assert_eq!(cloud_pasta(None, "onedrive"), None);
        assert_eq!(cloud_pasta(Some("   ".into()), "onedrive"), None);
        assert_eq!(cloud_pasta(Some("Z:\\naoexiste-869-zzz".into()), "onedrive"), None);
        // Pasta real → CloudLocation folder.
        let base = dir_temp("cloud-pasta");
        let p = base.to_string_lossy().into_owned();
        let c = cloud_pasta(Some(p.clone()), "onedriveCommercial").unwrap();
        assert_eq!(c.kind, "folder");
        assert_eq!(c.provider, "onedriveCommercial");
        assert_eq!(c.path, p);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn busca_casa_por_substring_recursivo_e_case_insensitive() {
        let base = dir_temp("busca");
        std::fs::create_dir_all(base.join("sub").join("mais")).unwrap();
        std::fs::write(base.join("Relatorio-2026.pdf"), b"x").unwrap();
        std::fs::write(base.join("sub").join("relatorio-old.txt"), b"x").unwrap();
        std::fs::write(base.join("sub").join("mais").join("foto.png"), b"x").unwrap();
        std::fs::create_dir_all(base.join("RELATORIOS")).unwrap(); // pasta também casa

        let raizes = vec![base.clone()];
        // "relatorio" casa os 2 arquivos + a pasta RELATORIOS (case-insensitive, recursivo).
        let achados = coletar_busca(&raizes, "relatorio", 100);
        let nomes: Vec<String> = achados.iter().map(|e| e.name.clone()).collect();
        assert_eq!(achados.len(), 3, "2 arquivos + 1 pasta: {nomes:?}");
        assert!(nomes.iter().any(|n| n == "Relatorio-2026.pdf"));
        assert!(nomes.iter().any(|n| n == "relatorio-old.txt"));
        assert!(nomes.iter().any(|n| n == "RELATORIOS"));
        // "foto" só o png.
        assert_eq!(coletar_busca(&raizes, "FOTO", 100).len(), 1);
        // termo que não existe = vazio; teto respeitado.
        assert!(coletar_busca(&raizes, "inexistente-zzz", 100).is_empty());
        assert_eq!(coletar_busca(&raizes, "relatorio", 1).len(), 1, "teto de 1");
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn montar_clouds_dedup_pastas_e_junta_google() {
        let base = dir_temp("clouds");
        let od = base.join("OneDrive - Contoso");
        std::fs::create_dir_all(&od).unwrap();
        let odp = od.to_string_lossy().into_owned();
        let pastas = [
            (Some(odp.clone()), "onedriveCommercial"), // entra 1º → ganha o provider
            (Some(odp.clone()), "onedrive"),           // mesmo path → dedup
            (Some("Z:\\naoexiste-xyz".to_string()), "onedrive"), // inexistente → fora
            (None, "onedrive"),                        // vazio → fora
        ];
        let drives = vec![
            DriveInfo {
                path: "G:\\".into(),
                name: "Google Drive".into(),
                kind: "cloud".into(),
                fs_name: "DriveFS".into(),
                total_space: 0,
                free_space: 0,
            },
            DriveInfo {
                path: "C:\\".into(),
                name: String::new(),
                kind: "fixed".into(), // NTFS real → NÃO entra
                fs_name: "NTFS".into(),
                total_space: 0,
                free_space: 0,
            },
        ];
        let cl = montar_clouds(Vec::new(), &pastas, drives);
        assert_eq!(cl.len(), 2, "1 pasta (dedup) + 1 google");
        let folder = cl.iter().find(|c| c.kind == "folder").unwrap();
        assert_eq!(folder.name, "OneDrive - Contoso");
        assert_eq!(folder.provider, "onedriveCommercial"); // 1º a entrar ganha
        let g = cl.iter().find(|c| c.kind == "drive").unwrap();
        assert_eq!(g.provider, "googledrive");
        assert_eq!(g.name, "Google Drive (G:)");
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn ler_bytes_arquivo_base64_e_guards() {
        use base64::Engine;
        let base = dir_temp("read-bytes");
        std::fs::create_dir_all(&base).unwrap();
        let f = base.join("foto.png");
        let conteudo = vec![1u8, 2, 3, 4, 250, 0, 255];
        std::fs::write(&f, &conteudo).unwrap();

        // Arquivo → AnexoConteudo: base64 exato + content-type por ext + nome.
        let ac = ler_bytes_arquivo(&f.to_string_lossy(), None).unwrap();
        let dec = base64::engine::general_purpose::STANDARD.decode(ac.bytes_b64.as_bytes()).unwrap();
        assert_eq!(dec, conteudo);
        assert_eq!(ac.content_type, "image/png");
        assert_eq!(ac.nome, "foto.png");

        // Diretório → NotADirectory (não é arquivo).
        assert!(matches!(
            ler_bytes_arquivo(&base.to_string_lossy(), None),
            Err(FsError::NotADirectory(_))
        ));
        // Inexistente → NotFound.
        assert!(matches!(
            ler_bytes_arquivo(&base.join("naoexiste").to_string_lossy(), None),
            Err(FsError::NotFound(_))
        ));
        // Vazio → InvalidPath.
        assert!(matches!(ler_bytes_arquivo("", None), Err(FsError::InvalidPath(_))));

        // maxBytes menor que o arquivo → ArquivoGrande (o front pede o teto dele).
        assert!(matches!(
            ler_bytes_arquivo(&f.to_string_lossy(), Some(3)),
            Err(FsError::ArquivoGrande(_))
        ));

        // > 25MB → ArquivoGrande, SEM ler (arquivo esparso via set_len).
        let grande = base.join("grande.bin");
        std::fs::File::create(&grande).unwrap().set_len(MAX_PREVIEW_BYTES + 1).unwrap();
        assert!(matches!(
            ler_bytes_arquivo(&grande.to_string_lossy(), None),
            Err(FsError::ArquivoGrande(_))
        ));
        std::fs::remove_dir_all(&base).ok();
    }

    // #1044 SEC6: o funil de bytes crus que o compartilhamento via OneDrive usa —
    // devolve os bytes EXATOS (sem base64) e aplica os mesmos guards (path válido,
    // é arquivo, teto). Prova que o front nunca precisa da capability `fs` aberta.
    #[test]
    fn ler_bytes_cru_exato_e_guards() {
        let base = dir_temp("read-cru");
        std::fs::create_dir_all(&base).unwrap();
        let f = base.join("anexo.bin");
        let conteudo = vec![0u8, 1, 2, 253, 254, 255, 42];
        std::fs::write(&f, &conteudo).unwrap();

        // Arquivo → bytes crus idênticos (o share sobe ISSO, sem round-trip base64).
        assert_eq!(ler_bytes_cru(&f.to_string_lossy(), None).unwrap(), conteudo);

        // Diretório / inexistente / vazio / teto → mesmos erros do funil.
        assert!(matches!(
            ler_bytes_cru(&base.to_string_lossy(), None),
            Err(FsError::NotADirectory(_))
        ));
        assert!(matches!(
            ler_bytes_cru(&base.join("naoexiste").to_string_lossy(), None),
            Err(FsError::NotFound(_))
        ));
        assert!(matches!(ler_bytes_cru("", None), Err(FsError::InvalidPath(_))));
        assert!(matches!(
            ler_bytes_cru(&f.to_string_lossy(), Some(3)),
            Err(FsError::ArquivoGrande(_))
        ));
        std::fs::remove_dir_all(&base).ok();
    }

    // #1076 (RB32): helper é `#[cfg(windows)]`, então o teste também.
    #[cfg(windows)]
    #[test]
    fn normalizar_letra_drive_aceita_formatos_e_rejeita_lixo() {
        for s in ["z", "Z", "Z:", "Z:\\", "z:/"] {
            assert_eq!(normalizar_letra_drive(s).unwrap(), "Z:", "entrada {s}");
        }
        for ruim in ["", "  ", "ZZ", "1", "::", "\\\\"] {
            assert!(normalizar_letra_drive(ruim).is_err(), "{ruim:?} devia falhar");
        }
    }

    // #1076 (RB32): helper é `#[cfg(windows)]`, então o teste também.
    #[cfg(windows)]
    #[test]
    fn validar_unc_exige_server_e_share() {
        assert!(validar_unc("\\\\server\\share").is_ok());
        assert!(validar_unc("//server/share").is_ok());
        assert!(validar_unc("\\\\srv\\dir\\sub").is_ok());
        for ruim in ["\\\\server", "C:\\local", "\\\\", "", "server\\share"] {
            assert!(validar_unc(ruim).is_err(), "{ruim:?} devia falhar");
        }
    }

    #[test]
    fn raizes_de_busca_vazio_pega_drives_locais() {
        // root vazio = "This PC" → drives locais (não vazio numa máquina real);
        // root explícito = só ele.
        let uma = raizes_de_busca("C:\\Users");
        assert_eq!(uma.len(), 1);
        assert_eq!(uma[0], PathBuf::from("C:\\Users"));
    }

    #[test]
    fn this_pc_exclui_drives_de_rede() {
        // #1073 (RB30): "This PC" varre só drives LOCAIS; rede (DRIVE_REMOTE) fica
        // FORA (share lenta/offline fazia a busca parecer travada).
        assert!(kind_no_escopo_this_pc("fixed"));
        assert!(kind_no_escopo_this_pc("removable"));
        assert!(kind_no_escopo_this_pc("cloud"));
        assert!(!kind_no_escopo_this_pc("network"), "drive de rede fora do This PC");
        for outro in ["cdrom", "ramdisk", "unknown"] {
            assert!(!kind_no_escopo_this_pc(outro), "{outro} não é local");
        }
    }

    #[test]
    fn excede_max_path_detecta_fronteira() {
        // #1073 (RB29): detector do limite clássico do Windows.
        assert!(!excede_max_path("C:\\Users\\wagner\\arquivo.txt"));
        assert!(excede_max_path(&format!("C:\\{}", "a".repeat(300))));
        // fronteira: 259 cabe, 260 não (MAX_PATH inclui o NUL).
        assert!(!excede_max_path(&"x".repeat(259)));
        assert!(excede_max_path(&"x".repeat(260)));
    }

    /// #1073 (RB29 — decisão do PO): caminho >= MAX_PATH mandado pra Lixeira FALHA
    /// EXPLICITAMENTE e o arquivo permanece INTACTO — jamais delete permanente
    /// silencioso (o usuário pediu "Lixeira", reversível; caminho profundo é o dia a
    /// dia de OneDrive/SharePoint). Prova que trocamos um bug recuperável (falha) por
    /// nenhum bug irrecuperável (perda de dado).
    #[cfg(windows)]
    #[test]
    fn trash_recusa_caminho_longo_sem_apagar() {
        let base = dir_temp("trash-longo");
        // nome longo o bastante pra o caminho completo passar de MAX_PATH.
        let alvo = base.join("a".repeat(250));
        std::fs::write(com_long_path(&alvo), b"conteudo").unwrap();
        let alvo_str = alvo.to_string_lossy().into_owned();
        assert!(excede_max_path(&alvo_str), "o caminho de teste tem que exceder MAX_PATH");
        assert!(caminho_existe(&alvo_str), "pré-condição: o arquivo existe");

        let r = para_lixeira(&[alvo_str.clone()]);
        assert!(r.is_err(), "caminho longo deve FALHAR (não vai pra Lixeira)");
        // O CRUCIAL: o arquivo continua LÁ (não foi apagado permanentemente).
        assert!(
            caminho_existe(&alvo_str),
            "arquivo longo NÃO pode ter sido apagado — falha preserva o dado"
        );
        let _ = std::fs::remove_dir_all(com_long_path(&base));
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
    fn cancel_interrompe_no_meio_de_arquivo_real() {
        let base = dir_temp("cancel-mid-copy");
        let origem = base.join("src");
        std::fs::create_dir_all(&origem).unwrap();
        let arquivo = origem.join("grande.bin");
        let tamanho = 128 * 1024 * 1024u64;
        std::fs::File::create(&arquivo).unwrap().set_len(tamanho).unwrap();

        let destino = base.join("dst");
        let plano = planejar(&origem, &destino).unwrap();
        for d in &plano.dirs {
            std::fs::create_dir_all(com_long_path(d)).unwrap();
        }
        let ctx = ctx_teste(None);
        let processados = ctx.processados.clone();
        let cancelar = ctx.cancelar.clone();
        let gatilho = std::thread::spawn(move || {
            while processados.load(Ordering::Relaxed) == 0 {
                std::thread::yield_now();
            }
            cancelar.store(true, Ordering::Relaxed);
        });

        copiar_plano(&plano, 1, &ctx).unwrap();
        gatilho.join().unwrap();
        let copiados = ctx.processados.load(Ordering::Relaxed);
        assert!(copiados > 0, "o cancel ocorreu antes do primeiro chunk");
        assert!(copiados < tamanho, "o cancel não interrompeu a cópia em andamento");
        assert_eq!(ctx.arquivos_feitos.load(Ordering::Relaxed), 0);
        std::fs::remove_dir_all(&base).ok();
    }

    /// #898: pausar no meio de um arquivo grande SEGURA o worker (o progresso
    /// congela) e resumir COMPLETA a cópia do ponto exato — nenhum byte perdido.
    #[test]
    fn pause_segura_worker_e_resume_completa() {
        let base = dir_temp("pause-mid-copy");
        let origem = base.join("src");
        std::fs::create_dir_all(&origem).unwrap();
        let arquivo = origem.join("grande.bin");
        let tamanho = 128 * 1024 * 1024u64;
        std::fs::File::create(&arquivo).unwrap().set_len(tamanho).unwrap();

        let destino = base.join("dst");
        let plano = planejar(&origem, &destino).unwrap();
        for d in &plano.dirs {
            std::fs::create_dir_all(com_long_path(d)).unwrap();
        }
        let ctx = ctx_teste(None);
        let processados = ctx.processados.clone();
        let pausar = ctx.pausar.clone();
        let gatilho = std::thread::spawn(move || {
            // pausa assim que o primeiro chunk saiu (op em andamento).
            while processados.load(Ordering::Relaxed) == 0 {
                std::thread::yield_now();
            }
            pausar.store(true, Ordering::Relaxed);
            // deixa o worker assentar na espera + amostra o progresso 2x.
            std::thread::sleep(Duration::from_millis(250));
            let snap1 = processados.load(Ordering::Relaxed);
            std::thread::sleep(Duration::from_millis(200));
            let snap2 = processados.load(Ordering::Relaxed);
            pausar.store(false, Ordering::Relaxed); // resume
            (snap1, snap2)
        });

        copiar_plano(&plano, 1, &ctx).unwrap();
        let (snap1, snap2) = gatilho.join().unwrap();
        assert!(snap1 > 0, "pausou antes do primeiro chunk");
        assert!(snap1 < tamanho, "pausou só depois de copiar tudo (janela curta demais)");
        assert_eq!(snap1, snap2, "o progresso avançou DURANTE a pausa");
        // Resumido: a cópia terminou inteira e íntegra.
        assert_eq!(ctx.processados.load(Ordering::Relaxed), tamanho);
        assert_eq!(ctx.arquivos_feitos.load(Ordering::Relaxed), 1);
        assert_eq!(std::fs::metadata(destino.join("grande.bin")).unwrap().len(), tamanho);
        std::fs::remove_dir_all(&base).ok();
    }

    /// #898: cancel vence pause — com os dois flags ligados, o worker NÃO trava na
    /// espera: `esperar_se_pausado` retorna `true` (abortar) na hora.
    #[test]
    fn cancel_vence_pause() {
        let ctx = ctx_teste(None);
        ctx.pausar.store(true, Ordering::Relaxed);
        ctx.cancelar.store(true, Ordering::Relaxed);
        // Não bloqueia: cancel é visto antes/dentro do laço de pausa.
        assert!(esperar_se_pausado(&ctx), "cancel durante a pausa deve abortar");

        // E o plano inteiro sai cedo sem copiar nada.
        let base = dir_temp("cancel-vence-pause");
        let origem = base.join("src");
        std::fs::create_dir_all(&origem).unwrap();
        for i in 0..4 {
            std::fs::write(origem.join(format!("f{i}.txt")), vec![2u8; 100]).unwrap();
        }
        let destino = base.join("dst");
        let plano = planejar(&origem, &destino).unwrap();
        for d in &plano.dirs {
            std::fs::create_dir_all(com_long_path(d)).unwrap();
        }
        copiar_plano(&plano, 2, &ctx).unwrap();
        assert_eq!(ctx.arquivos_feitos.load(Ordering::Relaxed), 0);
        std::fs::remove_dir_all(&base).ok();
    }

    /// A UI do S4 traduz "Substituir" para o mesmo caminho de destino. O
    /// backend precisa aceitar essa decisão e trocar o conteúdo existente.
    #[test]
    fn substituir_sobrescreve_destino_existente() {
        let base = dir_temp("replace");
        let origem = base.join("origem.txt");
        let destino = base.join("destino.txt");
        std::fs::write(&origem, b"novo").unwrap();
        std::fs::write(&destino, b"antigo").unwrap();

        let resultado = copiar(&origem.to_string_lossy(), &destino.to_string_lossy());
        assert!(
            resultado.is_ok(),
            "a decisão Substituir foi recusada pelo backend: {resultado:?}"
        );
        assert_eq!(std::fs::read(&destino).unwrap(), b"novo");
        std::fs::remove_dir_all(&base).ok();
    }

    /// Paridade do #680: "Substituir" também vale pro MOVE (mesmo diálogo). O
    /// move honra a decisão e troca o destino existente (rename REPLACE_EXISTING).
    #[test]
    fn mover_substitui_destino_existente() {
        let base = dir_temp("move-replace");
        let origem = base.join("origem.txt");
        let destino = base.join("destino.txt");
        std::fs::write(&origem, b"novo").unwrap();
        std::fs::write(&destino, b"antigo").unwrap();

        let resultado = mover(&origem.to_string_lossy(), &destino.to_string_lossy());
        assert!(
            resultado.is_ok(),
            "o move recusou a decisão Substituir: {resultado:?}"
        );
        assert_eq!(std::fs::read(&destino).unwrap(), b"novo");
        assert!(!origem.exists(), "o move deixou a origem pra trás");
        std::fs::remove_dir_all(&base).ok();
    }

    // Smoke de HARDWARE REAL: prova que o IOCTL de seek-penalty responde num disco
    // FÍSICO (rode com `cargo test -- --ignored` na máquina do QA). Fica #[ignore]
    // porque o runner do CI usa disco VIRTUALIZADO, onde esse IOCTL não é suportado
    // e `tem_seek_penalty` devolve None — o fallback conservador DOCUMENTADO (o
    // `perfilar` trata None como HDD). Assumir `is_some()` amarra o teste a hardware
    // físico e derruba o job `rust` no CI. O caminho que importa (o consumidor
    // produzir um nº de workers são a partir de None) já é coberto de forma
    // determinística por `perfilar_da_pelo_menos_dois_workers`, que roda no CI.
    #[cfg(windows)]
    #[test]
    #[ignore = "requer disco físico; no disco virtual do CI o IOCTL não responde (None = fallback conservador, já coberto por perfilar_da_pelo_menos_dois_workers)"]
    fn perfil_de_disco_real_responde_no_volume_do_qa() {
        let resultado = tem_seek_penalty(Path::new(r"C:\"));
        assert!(resultado.is_some(), "IOCTL não classificou o volume C: {resultado:?}");
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

    #[test]
    fn ext_raster_so_aceita_raster_real() {
        // #820: raster real entra.
        for p in ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.bmp", "f.webp", "g.ico", "h.tiff"] {
            assert!(ext_raster_suportada(p), "{p} devia ser raster");
        }
        // Vetor e não-imagem NUNCA (o SVG de 23MB do repro cai aqui → ícone de tipo).
        for p in ["logo.svg", "doc.pdf", "video.mp4", "sem-ext", "a.svgz", "x.eps"] {
            assert!(!ext_raster_suportada(p), "{p} NÃO devia ser raster");
        }
    }

    #[test]
    fn para_lixeira_idempotente_ignora_caminho_ja_sumido() {
        // #849: um caminho bem-formado mas INEXISTENTE (o 2º/3º clique do delete
        // concorrente, alvo já removido) NÃO pode virar erro — para_lixeira filtra
        // e vira no-op (não chama a Lixeira, não retorna Err).
        let inexistente = std::env::temp_dir().join("galaxie-inexistente-849-zzz");
        let p = inexistente.to_string_lossy().into_owned();
        assert!(!caminho_existe(&p), "o alvo do teste não pode existir");
        assert!(
            para_lixeira(&[p]).is_ok(),
            "delete de caminho já sumido deve ser no-op idempotente, não erro"
        );
        // Lista vazia também é no-op.
        assert!(para_lixeira(&[]).is_ok());
    }

    // --- #899 U0: journal de operações (pro undo) ---

    #[test]
    fn podar_journal_mantem_as_ultimas_n() {
        let linhas: Vec<String> = (0..60).map(|i| i.to_string()).collect();
        let podado = podar_journal(linhas, JOURNAL_MAX); // 50
        assert_eq!(podado.len(), JOURNAL_MAX);
        assert_eq!(podado.first().unwrap(), "10"); // dropou as 10 mais velhas
        assert_eq!(podado.last().unwrap(), "59"); // manteve a mais nova
        // Abaixo do limite: intacto.
        let poucas: Vec<String> = vec!["a".into(), "b".into()];
        assert_eq!(podar_journal(poucas.clone(), JOURNAL_MAX), poucas);
    }

    #[test]
    fn montar_entrada_copy_lista_criados_sem_from() {
        let base = dir_temp("journal-copy");
        let origem = base.join("src");
        std::fs::create_dir_all(origem.join("sub")).unwrap();
        std::fs::write(origem.join("a.txt"), vec![7u8; 10]).unwrap();
        std::fs::write(origem.join("sub").join("b.bin"), vec![9u8; 20]).unwrap();
        let destino = base.join("dst");
        let plano = planejar(&origem, &destino).unwrap();
        for d in &plano.dirs {
            std::fs::create_dir_all(com_long_path(d)).unwrap();
        }
        copiar_plano(&plano, 2, &ctx_teste(None)).unwrap();

        let e = montar_entrada(7, false, 100, 200, &plano);
        assert_eq!(e.op_id, 7);
        assert_eq!(e.kind, "copy");
        assert_eq!(e.status, "success");
        // Os 2 arquivos aparecem como criados no destino, size correto, from vazio (copy).
        let arquivos: Vec<&JournalItem> = e.items.iter().filter(|i| !i.is_dir).collect();
        assert_eq!(arquivos.len(), 2);
        for it in &arquivos {
            assert!(it.created_by_op, "cópia cria o destino");
            assert!(!it.overwritten, "fluxo normal nunca sobrescreve");
            assert!(it.from.is_empty(), "copy não grava origem");
            assert!(it.to.contains("dst"));
        }
        let total: u64 = arquivos.iter().map(|i| i.size_at_end).sum();
        assert_eq!(total, 30, "size_at_end statado do destino");
        // Ao menos os dirs criados entram (raiz + sub).
        assert!(e.items.iter().any(|i| i.is_dir), "dirs criados no manifesto");
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn montar_entrada_move_preenche_from() {
        let base = dir_temp("journal-move");
        let origem = base.join("src");
        std::fs::create_dir_all(&origem).unwrap();
        std::fs::write(origem.join("c.txt"), vec![1u8; 5]).unwrap();
        let destino = base.join("dst");
        let plano = planejar(&origem, &destino).unwrap();
        for d in &plano.dirs {
            std::fs::create_dir_all(com_long_path(d)).unwrap();
        }
        copiar_plano(&plano, 1, &ctx_teste(None)).unwrap();

        let e = montar_entrada(9, true, 0, 1, &plano);
        assert_eq!(e.kind, "move");
        let arq = e.items.iter().find(|i| !i.is_dir).unwrap();
        assert!(!arq.from.is_empty(), "move grava a origem (undo = to→from)");
        assert!(arq.from.contains("src"));
        assert!(arq.to.contains("dst"));
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn journal_entry_roundtrip_serde_camelcase() {
        let e = OperationJournalEntry {
            op_id: 42,
            kind: "copy".into(),
            started_at_ms: 1,
            ended_at_ms: 2,
            status: "success".into(),
            resolucao: Some("manterAmbos".into()),
            items: vec![JournalItem {
                from: String::new(),
                to: "C:\\b\\f (2).png".into(),
                is_dir: false,
                created_by_op: true,
                overwritten: false,
                size_at_end: 2048,
                mtime_at_end: 1734200004000,
                hash_at_end: None,
                hash_alg: None,
                stat_indisponivel: false,
            }],
            trash_record_ids: Vec::new(),
            undo_granularidade: String::new(),
        };
        let json = serde_json::to_string(&e).unwrap();
        // camelCase no wire (casa com types.ts).
        assert!(json.contains("\"opId\":42"));
        assert!(json.contains("\"createdByOp\":true"));
        assert!(json.contains("\"trashRecordIds\":[]"));
        // Round-trip preserva tudo.
        let de: OperationJournalEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(de, e);
    }

    // --- #899 U1: undo verificado (classificação + execução) ---

    #[test]
    fn classificar_copy_seguro_depois_sumiu() {
        let base = dir_temp("undo-classif");
        let f = base.join("x.txt");
        std::fs::write(&f, vec![1u8; 8]).unwrap();
        let it = journal_item(&f, &f, false); // copy: to=f, from vazio
        assert_eq!(classificar_item(&it, false), ("seguro".into(), None));
        // Some o arquivo → pulado/sumiu.
        std::fs::remove_file(&f).unwrap();
        let (estado, motivo) = classificar_item(&it, false);
        assert_eq!(estado, "pulado");
        assert_eq!(motivo.as_deref(), Some("sumiu"));
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn classificar_modificado_pula() {
        let base = dir_temp("undo-mod");
        let f = base.join("y.txt");
        std::fs::write(&f, vec![2u8; 10]).unwrap();
        let mut it = journal_item(&f, &f, false);
        it.size_at_end = 999; // diverge do disco → modificado
        let (estado, motivo) = classificar_item(&it, false);
        assert_eq!(estado, "pulado");
        assert_eq!(motivo.as_deref(), Some("modificado"));
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn classificar_move_origem_reocupada_pula() {
        let base = dir_temp("undo-reocup");
        let origem = base.join("o.txt");
        let destino = base.join("d.txt");
        std::fs::write(&destino, vec![3u8; 6]).unwrap();
        std::fs::write(&origem, vec![9u8; 6]).unwrap(); // caminho de retorno OCUPADO
        let it = journal_item(&origem, &destino, true); // move: from=o, to=d
        let (estado, motivo) = classificar_item(&it, true);
        assert_eq!(estado, "pulado");
        assert_eq!(motivo.as_deref(), Some("origemReocupada"));
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn montar_plano_undo_conta_os_baldes() {
        let base = dir_temp("undo-plano");
        std::fs::create_dir_all(&base).unwrap();
        let seg = base.join("s.txt");
        std::fs::write(&seg, vec![1u8; 4]).unwrap();
        let it_seg = journal_item(&seg, &seg, false); // seguro
        let mut it_mod = journal_item(&seg, &seg, false);
        it_mod.size_at_end = 123; // pulado/modificado
        let mut it_ovr = journal_item(&seg, &seg, false);
        it_ovr.overwritten = true; // naoReversivel/sobrescrita
        let entry = OperationJournalEntry {
            op_id: 7,
            kind: "copy".into(),
            started_at_ms: 0,
            ended_at_ms: 1,
            status: "success".into(),
            resolucao: None,
            items: vec![it_seg, it_mod, it_ovr],
            trash_record_ids: Vec::new(),
            undo_granularidade: String::new(),
        };
        let plano = montar_plano_undo(&entry);
        assert_eq!(plano.seguros, 1);
        assert_eq!(plano.pulados, 1);
        assert_eq!(plano.nao_reversiveis, 1);
        assert_eq!(plano.itens.len(), 3);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn executar_undo_move_volta_para_origem() {
        let base = dir_temp("undo-move");
        let origem = base.join("src");
        std::fs::create_dir_all(&origem).unwrap();
        std::fs::write(origem.join("a.txt"), vec![5u8; 12]).unwrap();
        let destino = base.join("dst");
        // move real (rename mesmo-volume).
        mover(&origem.to_string_lossy(), &destino.to_string_lossy()).unwrap();
        assert!(destino.join("a.txt").exists());
        assert!(!origem.join("a.txt").exists());

        let entry = OperationJournalEntry {
            op_id: 1,
            kind: "move".into(),
            started_at_ms: 0,
            ended_at_ms: 1,
            status: "success".into(),
            resolucao: None,
            items: vec![
                journal_item(&destino, &destino, false), // dir dst (is_dir via stat)
                journal_item(&origem.join("a.txt"), &destino.join("a.txt"), true),
            ],
            trash_record_ids: Vec::new(),
            undo_granularidade: String::new(),
        };
        let rep = executar_undo(&entry);
        assert_eq!(rep.executados, 1, "o arquivo voltou pra origem");
        assert!(rep.erros.is_empty());
        assert!(origem.join("a.txt").exists(), "de volta na origem");
        assert!(!destino.join("a.txt").exists(), "saiu do destino");
        // o dir dst vazio foi limpo.
        assert!(!destino.exists(), "dir criado e esvaziado foi removido");
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn executar_undo_copy_manda_pra_lixeira_e_limpa_dirs() {
        // #1042 (TST-02): espelha `executar_undo_move_volta_para_origem` pro ramo
        // COPY. Cópia cria arquivos no destino; o undo manda os criados pra Lixeira
        // (revogável — §8; NÃO `remove_dir`/delete permanente) e remove os diretórios
        // criados que ficaram VAZIOS. `executados` = nº real de arquivos desfeitos.
        let base = dir_temp("undo-copy");
        let destino = base.join("dst");
        let sub = destino.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let a = destino.join("a.txt");
        let b = sub.join("b.bin");
        std::fs::write(&a, vec![5u8; 12]).unwrap();
        std::fs::write(&b, vec![7u8; 20]).unwrap();

        // Journal de COPY: 2 dirs criados + 2 arquivos criados (from vazio ⇒ mover=false).
        let entry = OperationJournalEntry {
            op_id: 3,
            kind: "copy".into(),
            started_at_ms: 0,
            ended_at_ms: 1,
            status: "success".into(),
            resolucao: None,
            items: vec![
                journal_item(&destino, &destino, false), // dir raiz (is_dir via stat)
                journal_item(&sub, &sub, false),          // sub-dir criado
                journal_item(&a, &a, false),              // arquivo criado
                journal_item(&b, &b, false),              // arquivo criado
            ],
            trash_record_ids: Vec::new(),
            undo_granularidade: String::new(),
        };
        let rep = executar_undo(&entry);
        assert_eq!(rep.executados, 2, "os 2 arquivos criados foram desfeitos (Lixeira)");
        assert!(rep.erros.is_empty(), "ramo copy feliz não acumula erro");
        // Foram pra Lixeira ⇒ sumiram do destino (não sobraram, nem sumiram na frente).
        assert!(!a.exists(), "a.txt saiu do destino (Lixeira)");
        assert!(!b.exists(), "b.bin saiu do destino (Lixeira)");
        // Dirs criados que ficaram vazios são removidos (mais fundos primeiro).
        assert!(!sub.exists(), "sub-dir vazio removido");
        assert!(!destino.exists(), "dir raiz criado e esvaziado removido");
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn executar_undo_copy_alvo_removido_antes_nao_infla_contagem() {
        // #1042 (TST-02, caso de borda): se um dos criados foi removido POR FORA antes
        // do undo, o re-classificar na hora (anti-TOCTOU §8) o marca "pulado" (sumiu) e
        // ele NÃO entra no batch da Lixeira — logo `executados` conta só os realmente
        // desfeitos, sem inflar, e não vira erro. Trava o comportamento observado hoje.
        //
        // Nota de contagem (documentação do DoD): a soma é `executados += n` do batch,
        // mas `n` só inclui alvos que classificaram "seguro" AQUI. A única janela
        // residual é entre esta classificação e o filtro `caminho_existe` do
        // `para_lixeira` (um alvo sumindo nesse intervalo curtíssimo contaria +1
        // fantasma); é benigna (Lixeira é idempotente) e não é reproduzível de forma
        // determinística num teste — por isso cobrimos o caso "removido ANTES do undo".
        let base = dir_temp("undo-copy-parcial");
        let destino = base.join("dst");
        std::fs::create_dir_all(&destino).unwrap();
        let vivo = destino.join("vivo.txt");
        let morto = destino.join("morto.txt");
        std::fs::write(&vivo, vec![1u8; 8]).unwrap();
        std::fs::write(&morto, vec![2u8; 8]).unwrap();

        let entry = OperationJournalEntry {
            op_id: 4,
            kind: "copy".into(),
            started_at_ms: 0,
            ended_at_ms: 1,
            status: "success".into(),
            resolucao: None,
            items: vec![
                journal_item(&destino, &destino, false),
                journal_item(&vivo, &vivo, false),
                journal_item(&morto, &morto, false),
            ],
            trash_record_ids: Vec::new(),
            undo_granularidade: String::new(),
        };
        // Remoção POR FORA (fora do controle do app) ANTES do undo rodar.
        std::fs::remove_file(&morto).unwrap();

        let rep = executar_undo(&entry);
        assert_eq!(rep.executados, 1, "só o alvo vivo foi desfeito — contagem não infla");
        assert_eq!(rep.pulados, 1, "alvo removido por fora vira 'pulado' (sumiu), não erro");
        assert!(rep.erros.is_empty(), "alvo já sumido é no-op idempotente, não erro");
        assert!(!vivo.exists(), "vivo.txt foi pra Lixeira");
        std::fs::remove_dir_all(&base).ok();
    }

    // --- #1067: hardening do undo/journal (data-loss) ---

    #[test]
    fn rb25_journal_item_marca_stat_indisponivel_quando_to_some() {
        // #1067 RB25(b): stat do `to` inexistente → flag ligada + size/mtime no fallback 0
        // (não são confiáveis; o undo deve pular por motivo próprio, não por "modificado").
        let base = dir_temp("journal-stat-none");
        let inexistente = base.join("nao-existe.txt");
        let it = journal_item(&inexistente, &inexistente, false);
        assert!(it.stat_indisponivel, "to inexistente → stat indisponível");
        assert_eq!(it.size_at_end, 0);
        assert_eq!(it.mtime_at_end, 0);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn rb25_classificar_stat_indisponivel_pula_com_motivo_proprio() {
        // #1067 RB25(b): item com stat falho no END NÃO pode virar "modificado". Precisa
        // classificar "pulado"/"stat_indisponivel" — motivo próprio, jamais confundido.
        let base = dir_temp("undo-stat-indisp");
        let f = base.join("z.txt");
        std::fs::write(&f, vec![4u8; 16]).unwrap();
        let mut it = journal_item(&f, &f, false); // to existe → seria "seguro"
        it.stat_indisponivel = true; // mas o stat falhou no fim da op
        let (estado, motivo) = classificar_item(&it, false);
        assert_eq!(estado, "pulado");
        assert_eq!(motivo.as_deref(), Some("stat_indisponivel"));
        assert_ne!(motivo.as_deref(), Some("modificado"), "nunca confundir stat falho com modificação");
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn rb27_precisa_reescrever_apenas_ao_atingir_o_teto() {
        // #1067 RB27: append barato enquanto cabe (< JOURNAL_MAX após o push); só reescreve
        // (podar) quando o push passaria do teto de ops. Predicado puro do append-vs-rewrite.
        assert!(!precisa_reescrever(0, JOURNAL_MAX));
        assert!(!precisa_reescrever(JOURNAL_MAX - 1, JOURNAL_MAX), "push → exatamente MAX ainda cabe");
        assert!(precisa_reescrever(JOURNAL_MAX, JOURNAL_MAX), "push → MAX+1 precisa podar");
        assert!(precisa_reescrever(JOURNAL_MAX + 5, JOURNAL_MAX));
    }

    #[test]
    fn rb27_reduzir_para_teto_marca_raiz_e_corta() {
        // #1067 RB27: manifesto acima do teto vira reduzido (undo_granularidade="raiz") com
        // no máximo `max` itens; no/abaixo do teto não mexe (None = grava como está).
        let base = dir_temp("teto");
        let f = base.join("f.txt");
        std::fs::write(&f, vec![1u8; 4]).unwrap();
        let item = journal_item(&f, &f, false);
        let mk = |n: usize| OperationJournalEntry {
            op_id: 1,
            kind: "copy".into(),
            started_at_ms: 0,
            ended_at_ms: 1,
            status: "success".into(),
            resolucao: None,
            items: vec![item.clone(); n],
            trash_record_ids: Vec::new(),
            undo_granularidade: String::new(),
        };
        assert!(reduzir_para_teto(&mk(3), 5).is_none(), "abaixo do teto não reduz");
        assert!(reduzir_para_teto(&mk(5), 5).is_none(), "no teto exato não reduz");
        let reduzido = reduzir_para_teto(&mk(9), 5).expect("acima do teto reduz");
        assert_eq!(reduzido.items.len(), 5, "truncado pro teto");
        assert_eq!(reduzido.undo_granularidade, "raiz", "corte marcado, nunca silencioso");
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn rb20_undo_manifesto_parcial_de_move_reverte_os_renames() {
        // #1067 RB20 (DoD): num multi-move cancelado, os renames mesmo-volume JÁ efetivados
        // precisam virar manifesto `status="partial"` pra continuarem desfazíveis. Aqui
        // reproduzimos o estado pós-cancel — 2 renames feitos + o manifesto parcial que o
        // fix grava — e provamos que `executar_undo` volta cada `to`→`from`. Contraste: SEM
        // esse manifesto (items vazio) não há o que desfazer = o buraco irreversível de antes.
        let base = dir_temp("undo-parcial-cancel");
        let origem = base.join("src");
        std::fs::create_dir_all(&origem).unwrap();
        let a_de = origem.join("a.txt");
        let b_de = origem.join("b.txt");
        std::fs::write(&a_de, vec![1u8; 10]).unwrap();
        std::fs::write(&b_de, vec![2u8; 20]).unwrap();
        let a_para = base.join("a.txt");
        let b_para = base.join("b.txt");
        // renames mesmo-volume efetivados ANTES do "cancel" (como no loop do multi-move).
        mover(&a_de.to_string_lossy(), &a_para.to_string_lossy()).unwrap();
        mover(&b_de.to_string_lossy(), &b_para.to_string_lossy()).unwrap();
        assert!(a_para.exists() && b_para.exists());
        assert!(!a_de.exists() && !b_de.exists());

        // O manifesto PARCIAL que o fix grava nos caminhos de erro/cancel (RB20).
        let itens_renome: Vec<JournalItem> =
            vec![journal_item(&a_de, &a_para, true), journal_item(&b_de, &b_para, true)];
        let entry = OperationJournalEntry {
            op_id: 77,
            kind: "move".into(),
            started_at_ms: 0,
            ended_at_ms: 1,
            status: "partial".into(),
            resolucao: None,
            items: itens_renome,
            trash_record_ids: Vec::new(),
            undo_granularidade: String::new(),
        };
        assert_eq!(entry.status, "partial", "renames de op abortada/cancelada = manifesto parcial");

        let rep = executar_undo(&entry);
        assert_eq!(rep.executados, 2, "os 2 renames foram revertidos");
        assert!(rep.erros.is_empty());
        assert!(a_de.exists() && b_de.exists(), "voltaram pra origem");
        assert!(!a_para.exists() && !b_para.exists(), "saíram do destino");

        // Sem manifesto, nada a desfazer — exatamente o estado irreversível que o RB20 fecha.
        let sem_manifesto = OperationJournalEntry {
            op_id: 78,
            kind: "move".into(),
            started_at_ms: 0,
            ended_at_ms: 1,
            status: "partial".into(),
            resolucao: None,
            items: Vec::new(),
            trash_record_ids: Vec::new(),
            undo_granularidade: String::new(),
        };
        let rep_vazio = executar_undo(&sem_manifesto);
        assert_eq!(rep_vazio.executados, 0, "sem manifesto não há reversão possível");
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn rb20_rota_erro_de_plano_planejar_muitas_falha_deterministicamente() {
        // #1067 RB20 (rejeição da Lúmen): a "rota de erro-de-plano" é a que dispara a 1ª
        // saída de erro da fase pós-rename — `let plano = planejar_muitas(&pares_path)?;`.
        // Aqui provo que essa condição de erro é REAL e determinística (não hipotética):
        // uma origem ilegível faz `planejar_muitas` devolver `Err`. No multi-move, uma
        // origem inexistente NÃO é filtrada pelo rename mesmo-volume (o rename falha), logo
        // ela cai em `a_planejar` e CHEGA ao `planejar_muitas` — exatamente o caminho em que
        // os renames já efetivados de OUTRAS origens precisam do manifesto parcial.
        let base = dir_temp("rota-erro-plano");
        let inexistente = base.join("nao-existe-src");
        let destino = base.join("dst");
        assert!(
            std::fs::rename(com_long_path(&inexistente), com_long_path(&destino)).is_err(),
            "origem inexistente NÃO é absorvida pelo rename mesmo-volume → vai pro plano"
        );
        let r = planejar_muitas(&[(inexistente.clone(), destino.clone())]);
        assert!(
            r.is_err(),
            "origem ilegível → planejar_muitas Err (saída #1 da fase pós-rename, antes de copiar)"
        );
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn rb20_entrada_parcial_renomes_monta_manifesto_reversivel_na_rota_de_erro() {
        // #1067 RB20 (rejeição da Lúmen): o funil grava, em TODA saída de erro/cancel da
        // fase pós-rename, exatamente o manifesto que `entrada_parcial_renomes` produz. Aqui
        // exercito ESSA unidade de produção (não um `OperationJournalEntry` montado à mão):
        // pra a rota de erro ela devolve `Some(status="partial", kind="move")` cobrindo os
        // renames JÁ efetivados, e `executar_undo` desse manifesto devolve cada `to`→`from`.
        // A ESCRITA via `registrar_journal` é runtime: as assinaturas usam `AppHandle<Wry>`,
        // que não se constrói em unit test (o mock dá `AppHandle<MockRuntime>`, incompatível),
        // por isso o e2e do caminho (A) é inviável e este é o fallback determinístico.
        let base = dir_temp("entrada-parcial-erro");
        let origem = base.join("src");
        std::fs::create_dir_all(&origem).unwrap();
        let a_de = origem.join("a.txt");
        let b_de = origem.join("b.txt");
        std::fs::write(&a_de, vec![1u8; 10]).unwrap();
        std::fs::write(&b_de, vec![2u8; 20]).unwrap();
        let a_para = base.join("a.txt");
        let b_para = base.join("b.txt");
        // renames mesmo-volume efetivados (como no loop do multi-move, ANTES da saída de erro).
        mover(&a_de.to_string_lossy(), &a_para.to_string_lossy()).unwrap();
        mover(&b_de.to_string_lossy(), &b_para.to_string_lossy()).unwrap();
        let itens_renome =
            vec![journal_item(&a_de, &a_para, true), journal_item(&b_de, &b_para, true)];

        // Sem renames → None (no-op: nada a journalar; o funil não grava linha vazia).
        assert!(entrada_parcial_renomes(1, 0, &[]).is_none());

        // Com renames → manifesto partial/move cobrindo os dois (o que o funil grava no `Err`).
        let entrada = entrada_parcial_renomes(99, 0, &itens_renome)
            .expect("há renames efetivados → Some(manifesto parcial)");
        assert_eq!(entrada.status, "partial", "rota de erro/cancel = manifesto parcial");
        assert_eq!(entrada.kind, "move");
        assert_eq!(entrada.items.len(), 2, "os dois renames entram no parcial");

        // `executar_undo` do parcial reverte os renames (to→from) — reversibilidade preservada.
        let rep = executar_undo(&entrada);
        assert_eq!(rep.executados, 2, "os 2 renames revertidos pelo manifesto parcial");
        assert!(rep.erros.is_empty());
        assert!(a_de.exists() && b_de.exists(), "voltaram à origem");
        assert!(!a_para.exists() && !b_para.exists(), "saíram do destino");
        std::fs::remove_dir_all(&base).ok();
    }

    // --- Cache de thumbnail (#737 F2) ---

    #[test]
    fn cache_key_determinista_e_sensivel_a_cada_campo() {
        let base = cache_key("C:/foto.jpg", 1000, 2048, 256);
        // determinístico
        assert_eq!(base, cache_key("C:/foto.jpg", 1000, 2048, 256));
        // mtime muda → chave nova (invalidação ao editar o arquivo)
        assert_ne!(base, cache_key("C:/foto.jpg", 1001, 2048, 256));
        // size muda → chave nova
        assert_ne!(base, cache_key("C:/foto.jpg", 1000, 4096, 256));
        // maxSize muda → chave nova (não colide thumbs de tamanhos diferentes)
        assert_ne!(base, cache_key("C:/foto.jpg", 1000, 2048, 128));
        // path muda → chave nova
        assert_ne!(base, cache_key("C:/outra.jpg", 1000, 2048, 256));
    }

    #[test]
    fn cache_mem_hit_miss_e_eviction_por_bytes() {
        use std::sync::Arc;
        let mut c = CacheMem::novo(100);
        let cap = 1000; // bytes
        c.inserir("a", Arc::new(vec![0u8; 600]), 10, 10, cap);
        assert!(c.obter("a").is_some()); // hit
        assert!(c.obter("z").is_none()); // miss
        // "a"(600) + "b"(600) = 1200 > cap(1000) → evicta o LRU ("a").
        c.inserir("b", Arc::new(vec![0u8; 600]), 10, 10, cap);
        assert!(c.obter("a").is_none(), "o mais antigo devia ter sido evictado");
        assert!(c.obter("b").is_some());
        assert!(c.bytes <= cap);
    }

    #[test]
    fn cache_mem_get_promove_no_lru() {
        use std::sync::Arc;
        let mut c = CacheMem::novo(100);
        let cap = 1000;
        c.inserir("a", Arc::new(vec![0u8; 400]), 1, 1, cap);
        c.inserir("b", Arc::new(vec![0u8; 400]), 1, 1, cap);
        let _ = c.obter("a"); // toca "a" → "b" vira o mais frio
        c.inserir("d", Arc::new(vec![0u8; 400]), 1, 1, cap); // 1200 > cap → evicta o LRU ("b")
        assert!(c.obter("a").is_some(), "'a' foi promovido, não devia sair");
        assert!(c.obter("b").is_none(), "'b' era o mais frio");
    }

    #[test]
    fn webp_dims_le_dimensoes() {
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            300,
            200,
            image::Rgba([1, 2, 3, 255]),
        ));
        let (_, _, webp) = resize_encode(&img, 256).unwrap();
        assert_eq!(webp_dims(&webp), (256, 171)); // 300×200 → maior lado 256
    }

    // --- Métricas de perf (#740 F5) ---

    #[test]
    fn metrics_calcula_hit_rate_e_gen_medio() {
        // 6 hits mem + 2 disco + 2 geradas = 10 total → hit_rate 0.8.
        // gen_ns = 2 geradas * 30ms = 60_000_000 ns → gen_medio 30ms.
        let m = montar_metrics(6, 2, 2, 60_000_000, 8, 1024, 96, 12345);
        assert_eq!(m.total, 10);
        assert!((m.hit_rate - 0.8).abs() < 1e-9);
        assert!((m.gen_medio_ms - 30.0).abs() < 1e-9);
        assert_eq!(m.pool_threads, 8);
        assert_eq!(m.mem_bytes, 12345);
    }

    #[test]
    fn metrics_sem_pedidos_nao_divide_por_zero() {
        let m = montar_metrics(0, 0, 0, 0, 4, 1024, 96, 0);
        assert_eq!(m.total, 0);
        assert_eq!(m.hit_rate, 0.0);
        assert_eq!(m.gen_medio_ms, 0.0);
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

        // delete permanente: recusa sem nonce válido, apaga com o nonce emitido.
        // #1047 (SEC7): a assinatura mudou — nonce de sessão no lugar do token fixo.
        let token = TokenExclusao::default();
        assert!(matches!(
            excluir_permanente(&[s(&f2)], "errado", &token).unwrap_err(),
            FsError::InvalidPath(_)
        ));
        assert!(f2.exists());
        let nonce = token.emitir();
        excluir_permanente(&[s(&f2), s(&d3)], &nonce, &token).unwrap();
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
    fn validar_barra_vetores_de_injecao_e_aceita_absoluto() {
        // #1046 (SEC2): defesa-em-profundidade léxica. No código ANTIGO só o
        // caminho vazio falhava — todos os casos abaixo (menos o vazio) PASSAVAM,
        // então este teste roda VERMELHO antes do fix.
        //
        // Limite honesto: o núcleo do fix é remover o `cmd.exe` de `abrir_caminho`
        // e as aspas manuais de `revelar_no_explorer` — isso elimina a injeção POR
        // CONSTRUÇÃO (não há mais linha de shell), e um teste não deve realmente
        // spawnar `calc.exe`. Este teste cobre a camada de validação
        // (defesa-em-profundidade) e o vetor de aspas do `revelar_no_explorer`.

        // Vazio: já barrava antes.
        assert!(matches!(validar(""), Err(FsError::InvalidPath(_))));

        // Caractere de controle (cobre \0..\x1f) — cross-platform.
        assert!(matches!(validar("x\u{0}y"), Err(FsError::InvalidPath(_))));

        // Relativo com o comando embutido: rejeitado por NÃO ser absoluto
        // (`x&calc.exe` não tem raiz nem no Windows nem no Unix).
        assert!(matches!(validar("x&calc.exe"), Err(FsError::InvalidPath(_))));

        // Aspas dupla: o vetor que furava o `/select,"..."` do revelar_no_explorer.
        #[cfg(windows)]
        assert!(matches!(
            validar("C:\\tmp\\x\".txt"),
            Err(FsError::InvalidPath(_))
        ));

        // Caractere de controle num caminho absoluto de Windows.
        #[cfg(windows)]
        assert!(matches!(
            validar("C:\\tmp\\x\u{1}.txt"),
            Err(FsError::InvalidPath(_))
        ));

        // Caminho absoluto normal continua ACEITO — não regride create/copy/rename.
        #[cfg(windows)]
        assert!(validar("C:\\Users\\x\\arquivo.txt").is_ok());
    }

    // ── #1047 (SEC7): traversal, dir sensível, reparse/data-loss e nonce ────────

    #[test]
    fn validar_rejeita_traversal_ponto_ponto() {
        // Componente `..` barrado em qualquer posição (path traversal).
        #[cfg(windows)]
        {
            assert!(matches!(
                validar(r"C:\Users\x\..\y"),
                Err(FsError::InvalidPath(_))
            ));
            assert!(matches!(validar(r"C:\..\Windows"), Err(FsError::InvalidPath(_))));
            // Absoluto sem `..` continua ok — não regride.
            assert!(validar(r"C:\Users\x\y.txt").is_ok());
        }
        #[cfg(not(windows))]
        {
            assert!(matches!(validar("/home/x/../y"), Err(FsError::InvalidPath(_))));
            assert!(validar("/home/x/y.txt").is_ok());
        }
    }

    #[test]
    fn dentro_de_dir_sensivel_puro() {
        #[cfg(windows)]
        {
            let raizes = vec![PathBuf::from(r"C:\Windows\System32")];
            // Dentro da raiz.
            assert!(dentro_de_dir_sensivel(
                Path::new(r"C:\Windows\System32\drivers\etc\hosts"),
                &raizes
            ));
            // Caixa diferente → ainda casa (Windows é case-insensitive).
            assert!(dentro_de_dir_sensivel(
                Path::new(r"c:\windows\system32\cmd.exe"),
                &raizes
            ));
            // Fora da raiz.
            assert!(!dentro_de_dir_sensivel(
                Path::new(r"C:\Users\wagner\doc.txt"),
                &raizes
            ));
            // Prefixo parcial de componente NÃO casa (System32 ≠ System32Extra).
            assert!(!dentro_de_dir_sensivel(
                Path::new(r"C:\Windows\System32Extra\x"),
                &raizes
            ));
        }
        #[cfg(not(windows))]
        {
            let raizes = vec![PathBuf::from("/usr/bin")];
            assert!(dentro_de_dir_sensivel(Path::new("/usr/bin/sh"), &raizes));
            assert!(!dentro_de_dir_sensivel(Path::new("/home/user/x"), &raizes));
            // Prefixo parcial de componente.
            assert!(!dentro_de_dir_sensivel(Path::new("/usr/binary/x"), &raizes));
        }
    }

    #[test]
    fn deve_remover_como_link_decisao_pura() {
        // Só dir + reparse = remover como link (o caso data-loss). Resto = não.
        assert!(deve_remover_como_link(true, true), "dir-symlink → só o link");
        assert!(!deve_remover_como_link(true, false), "dir normal → remove_dir_all");
        assert!(!deve_remover_como_link(false, true), "symlink de arquivo → remove_file");
        assert!(!deve_remover_como_link(false, false), "arquivo normal → remove_file");
    }

    #[test]
    #[ignore = "requer privilégio de symlink (SeCreateSymbolicLink/Developer Mode); \
                a decisão pura está coberta por deve_remover_como_link_decisao_pura"]
    fn remover_symlink_de_dir_apaga_so_o_link_alvo_intacto() {
        // ⚠️ Ponto data-loss-crítico: `remover` num dir-symlink apaga SÓ o link,
        // NUNCA o alvo apontado. Criar symlink no Windows exige privilégio → #[ignore].
        let base = temp_unico();
        std::fs::create_dir_all(&base).unwrap();
        let alvo = base.join("alvo-real");
        std::fs::create_dir_all(&alvo).unwrap();
        std::fs::write(alvo.join("conteudo.txt"), "intacto").unwrap();
        let link = base.join("link-para-alvo");

        #[cfg(windows)]
        let criado = std::os::windows::fs::symlink_dir(&alvo, &link).is_ok();
        #[cfg(not(windows))]
        let criado = std::os::unix::fs::symlink(&alvo, &link).is_ok();
        assert!(criado, "não conseguiu criar o symlink de dir (privilégio?)");

        remover(&s(&link)).unwrap();
        assert!(!link.exists(), "o link deveria ter sido removido");
        assert!(alvo.exists(), "o alvo real NÃO pode ser apagado (data-loss)");
        assert!(
            alvo.join("conteudo.txt").exists(),
            "o conteúdo do alvo deve ficar intacto"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn nonce_exclusao_single_use_hardcoded_e_expira() {
        let token = TokenExclusao::default();
        let n = token.emitir();
        // Single-use: vale na 1ª, recusa na 2ª.
        assert!(token.consumir(&n), "nonce válido na 1ª vez");
        assert!(!token.consumir(&n), "mesmo nonce recusado na 2ª vez");
        // O token hardcoded velho não vale mais.
        let n2 = token.emitir();
        assert!(
            !token.consumir("galaxie-excluir-permanente"),
            "token hardcoded velho recusado"
        );
        // Tentativa inválida não zera o nonce corrente.
        assert!(token.consumir(&n2), "nonce corrente sobrevive à tentativa inválida");
        // Expiração: TTL mínimo + sleep passa do prazo.
        let expira = token.emitir_com_ttl(Duration::from_millis(1));
        std::thread::sleep(Duration::from_millis(5));
        assert!(!token.consumir(&expira), "nonce expirado recusado");
    }

    #[test]
    fn checar_entrada_pipeline_barra_traversal_e_aceita_normal() {
        // O pipeline turbo (fs_*_with_progress) é o caminho REAL de cópia/move; a
        // guarda de entrada tem que rejeitar traversal e aceitar caminho normal.
        let base = temp_unico();
        std::fs::create_dir_all(&base).unwrap();
        let src = base.join("origem.txt");
        let dst = base.join("destino.txt");

        #[cfg(windows)]
        let travessia = r"C:\Users\x\..\y";
        #[cfg(not(windows))]
        let travessia = "/home/x/../y";

        // Traversal na origem OU no destino → recusado (copy e move).
        assert!(checar_entrada_copia(travessia, &s(&dst)).is_err());
        assert!(checar_entrada_copia(&s(&src), travessia).is_err());
        assert!(checar_entrada_move(travessia, &s(&dst)).is_err());
        assert!(checar_entrada_muitas(&[travessia.to_string()], &s(&base), false).is_err());
        // Destino relativo (não-absoluto) também barra.
        assert!(checar_entrada_muitas(&[s(&src)], "destino-relativo", false).is_err());

        // Caminho normal dentro de tempdir (não sensível) → ok (origem inexistente
        // é ok pra copy: `validar` é léxico, não exige existir).
        assert!(checar_entrada_copia(&s(&src), &s(&dst)).is_ok());
        assert!(checar_entrada_muitas(&[s(&src)], &s(&base), false).is_ok());

        let _ = std::fs::remove_dir_all(&base);
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

    // ── #1066: perda-de-dado em copy/move ───────────────────────────────────

    #[test]
    fn copia_completa_reprova_plano_incompleto() {
        // #1066: o gate que decide se um MOVE pode apagar a origem. Exige contagem
        // de arquivos E bytes iguais ao plano E zero pulos de enumeração; qualquer
        // folga = `false` = origem preservada. No código antigo o move removia a
        // origem SEM esse gate (Ok mentiroso) — este teste encoda o contrato novo.
        let mut plano = Plano { total_arquivos: 3, total_bytes: 300, ..Default::default() };
        assert!(copia_completa(&plano, 3, 300), "cópia exata libera a remoção");
        assert!(!copia_completa(&plano, 2, 300), "faltou arquivo → origem preservada");
        assert!(!copia_completa(&plano, 3, 299), "faltaram bytes → origem preservada");
        plano.erros.push("subpasta ilegível".into());
        assert!(!copia_completa(&plano, 3, 300), "pulo de enumeração → origem preservada");
    }

    #[test]
    fn copia_com_verify_confere_hash_do_disco() {
        // #1066 (RB22/RB23): com verify o `copiar_arquivo` faz `sync_all` antes de
        // reabrir pra hashear (hash do DISCO, não da page cache) e propaga o corte
        // final. Este teste prova que o caminho verify segue verde (sem regressão) e
        // que o gate aprova a remoção só com a cópia batendo exata.
        let base = dir_temp("verify-sync");
        let origem = base.join("src");
        std::fs::create_dir_all(&origem).unwrap();
        let grande = vec![7u8; (LIMITE_PEQUENO * 2) as usize]; // exercita prealloc+set_len
        std::fs::write(origem.join("g.bin"), &grande).unwrap();
        std::fs::write(origem.join("p.txt"), b"pequeno").unwrap();

        let destino = base.join("dst");
        let plano = planejar(&origem, &destino).unwrap();
        for d in &plano.dirs {
            std::fs::create_dir_all(com_long_path(d)).unwrap();
        }
        let ctx = ctx_teste(Some(VerifyAlg::Xxh3));
        copiar_plano(&plano, 4, &ctx).unwrap();

        assert_eq!(std::fs::read(destino.join("g.bin")).unwrap(), grande);
        assert_eq!(std::fs::read(destino.join("p.txt")).unwrap(), b"pequeno");
        let feitos = ctx.arquivos_feitos.load(Ordering::Relaxed);
        let bytes = ctx.processados.load(Ordering::Relaxed);
        assert!(copia_completa(&plano, feitos, bytes), "cópia verify bateu com o plano");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(windows)]
    #[test]
    fn planejar_acumula_erro_de_enumeracao_de_subpasta_ilegivel() {
        // #1066 (RB19): árvore de origem com uma subpasta que a enumeração NÃO
        // consegue ler (DACL nega leitura via icacls — enforcement independe de
        // sharing). O código antigo (`let Ok(entry) = .. else { continue }`) pulava
        // esse erro do jwalk em SILÊNCIO → o move depois apagaria a origem com a
        // subpasta inteira não copiada = perda de dado. Agora o erro é ACUMULADO e o
        // gate reprova a remoção da origem. Ambiente elevado que ignora a DACL
        // (SeBackupPrivilege) torna a via de I/O real inviável → no-op documentado.
        use std::process::Command;

        let base = dir_temp("enum-erro");
        let origem = base.join("src");
        std::fs::create_dir_all(&origem).unwrap();
        std::fs::write(origem.join("ok.txt"), b"enumeravel").unwrap();
        let travada = origem.join("travada");
        std::fs::create_dir_all(&travada).unwrap();
        std::fs::write(travada.join("perdido.txt"), b"seria perdido no move").unwrap();

        let travada_s = travada.to_string_lossy().to_string();
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "Users".into());
        // Nega leitura/listagem da subpasta (DACL).
        let _ = Command::new("icacls")
            .args([travada_s.as_str(), "/deny", &format!("{user}:(RX)")])
            .output();
        let bloqueou = std::fs::read_dir(&travada).is_err();

        let plano = planejar(&origem, &base.join("dst")).unwrap();

        // Restaura o acesso ANTES de limpar (senão o remove_dir_all também é negado).
        let _ = Command::new("icacls")
            .args([travada_s.as_str(), "/remove:d", &user])
            .output();
        let _ = std::fs::remove_dir_all(&base);

        if !bloqueou {
            eprintln!("SKIP planejar_acumula_erro…: DACL não bloqueou a leitura (ambiente elevado)");
            return;
        }
        // (a) NÃO é Ok silencioso: o erro de enumeração foi acumulado.
        assert!(
            !plano.erros.is_empty(),
            "enumeração da subpasta negada tinha que virar erro (o código antigo pulava calado)"
        );
        // (b) o gate anti-perda REPROVA a remoção da origem → no move a origem fica.
        assert!(
            !copia_completa(&plano, plano.total_arquivos, plano.total_bytes),
            "plano com pulo de enumeração não pode liberar a remoção da origem"
        );
    }

    // ── #1286: TODAS as contas OneDrive, não só as 2 do env ──────────────────
    //
    // O PO tem 8 contas sincronizando e o Files mostrava 2, porque
    // `detectar_clouds` lia só `%OneDriveConsumer%` / `%OneDriveCommercial%` /
    // `%OneDrive%`. Estes testes exercitam a função PURA com a lista injetada:
    // sem tocar registro e sem tocar disco (é o DoD do card).

    fn conta(chave: &str, display: &str, pasta: &str) -> ContaOneDrive {
        ContaOneDrive {
            chave: chave.into(),
            display_name: display.into(),
            user_folder: pasta.into(),
            bibliotecas: Vec::new(),
        }
    }

    /// Existência injetada: tudo existe, menos o que estiver na lista de mortos.
    fn existe_menos<'a>(mortos: &'a [&'a str]) -> impl Fn(&str) -> bool + 'a {
        move |p: &str| !mortos.iter().any(|m| p.eq_ignore_ascii_case(m))
    }

    #[test]
    fn oito_contas_do_registro_viram_oito_mounts() {
        let mut contas = vec![conta("Personal", "OneDrive", r"C:\Users\po\OneDrive")];
        for n in 1..=7 {
            contas.push(conta(
                &format!("Business{n}"),
                &format!("OneDrive - Cliente {n}"),
                &format!(r"C:\Users\po\OneDrive - Cliente {n}"),
            ));
        }

        let cl = montar_clouds_onedrive(&contas, |_| true);

        assert_eq!(cl.len(), 8, "as 8 contas do PO, nao as 2 do env");
        assert_eq!(cl[0].name, "OneDrive");
        assert_eq!(cl[0].provider, "onedrive", "Personal e pessoal");
        assert!(
            cl[1..].iter().all(|c| c.provider == "onedriveCommercial"),
            "Business* e comercial"
        );
        assert_eq!(cl[7].name, "OneDrive - Cliente 7");
    }

    #[test]
    fn conta_sem_display_name_usa_o_leaf_da_pasta() {
        let cl = montar_clouds_onedrive(
            &[conta("Business1", "  ", r"C:\Users\po\OneDrive - Contoso")],
            |_| true,
        );
        assert_eq!(cl.len(), 1);
        assert_eq!(cl[0].name, "OneDrive - Contoso");
    }

    #[test]
    fn pasta_que_sumiu_do_disco_nao_vira_mount_morto() {
        let morta = r"C:\Users\po\OneDrive - Ex-cliente";
        let contas = vec![
            conta("Personal", "OneDrive", r"C:\Users\po\OneDrive"),
            conta("Business1", "OneDrive - Ex-cliente", morta),
        ];

        let cl = montar_clouds_onedrive(&contas, existe_menos(&[morta]));

        assert_eq!(cl.len(), 1, "a conta desconectada fica de fora");
        assert_eq!(cl[0].name, "OneDrive");
    }

    #[test]
    fn bibliotecas_sharepoint_viram_mounts_agrupados_sob_a_conta() {
        let mut c = conta("Business1", "OneDrive - Contoso", r"C:\Users\po\OneDrive - Contoso");
        c.bibliotecas = vec![
            ("Contoso".into(), r"C:\Users\po\Contoso\Documentos".into()),
            ("Contoso".into(), r"C:\Users\po\Contoso\Engenharia".into()),
        ];
        let contas = vec![
            c,
            conta("Business2", "OneDrive - Fabrikam", r"C:\Users\po\OneDrive - Fabrikam"),
        ];

        let cl = montar_clouds_onedrive(&contas, |_| true);

        assert_eq!(cl.len(), 4);
        // as bibliotecas ficam LOGO ABAIXO da conta a que pertencem
        assert_eq!(cl[0].name, "OneDrive - Contoso");
        assert_eq!(cl[1].name, "Contoso — Documentos");
        assert_eq!(cl[2].name, "Contoso — Engenharia");
        assert_eq!(cl[3].name, "OneDrive - Fabrikam");
        assert!(
            cl.iter().all(|m| m.kind == "folder"),
            "biblioteca sincronizada e pasta, nao letra"
        );
    }

    #[test]
    fn dedupe_por_caminho_ignora_caixa_e_barra_final() {
        let mut c = conta("Business1", "OneDrive - Contoso", r"C:\Users\po\OneDrive - Contoso");
        // mesma pasta, escrita diferente — o registro faz isso de verdade
        c.bibliotecas = vec![("Contoso".into(), r"c:\users\po\onedrive - contoso\".into())];

        let cl = montar_clouds_onedrive(&[c], |_| true);

        assert_eq!(cl.len(), 1, "mesma pasta nao pode aparecer duas vezes");
    }

    /// O env NÃO pode duplicar o que o registro já trouxe — e continua servindo
    /// de reserva na máquina sem a chave (edge do AC).
    #[test]
    fn env_complementa_o_registro_sem_duplicar() {
        let base = dir_temp("clouds-1286");
        let pessoal = base.join("OneDrive");
        let so_no_env = base.join("OneDrive - SoEnv");
        std::fs::create_dir_all(&pessoal).unwrap();
        std::fs::create_dir_all(&so_no_env).unwrap();

        let do_registro = montar_clouds_onedrive(
            &[conta("Personal", "OneDrive", &pessoal.to_string_lossy())],
            caminho_existe,
        );
        assert_eq!(do_registro.len(), 1);

        let pastas = [
            // mesma pasta do registro, com barra final → dedup
            (Some(format!("{}\\", pessoal.to_string_lossy())), "onedrive"),
            // esta só existe no env → entra
            (Some(so_no_env.to_string_lossy().into_owned()), "onedriveCommercial"),
        ];

        let cl = montar_clouds(do_registro, &pastas, Vec::new());

        assert_eq!(cl.len(), 2, "1 do registro + 1 so do env (a repetida some)");
        assert_eq!(cl[0].name, "OneDrive");
        assert_eq!(cl[1].name, "OneDrive - SoEnv");
        std::fs::remove_dir_all(&base).ok();
    }

    /// Máquina sem a chave de registro: lista vazia, o env assume, nada quebra.
    #[test]
    fn sem_registro_cai_no_env_sem_erro() {
        let cl = montar_clouds_onedrive(&[], |_| true);
        assert!(cl.is_empty(), "sem contas, sem mounts — e sem panico");
    }

}
