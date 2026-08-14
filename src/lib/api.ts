import type {
  AcaoRsvp,
  AnexoConteudo,
  AppUser,
  DesafioDominio,
  DirSize,
  DriveInfo,
  FsChange,
  FsConflict,
  FsDirBatch,
  FsEntry,
  FsOpProgress,
  ThumbMetrics,
  ThumbRef,
  CaixaEntrada,
  Calendario,
  CategoriaCor,
  EmailDetalhe,
  EmailItem,
  EmailRecente,
  EventoAgenda,
  EventoDetalhe,
  EventoInput,
  Identidade,
  InsightsRemetente,
  PastaEmail,
  PastaOD,
  Pessoa,
  RecorrenciaInput,
  PeopleBulkDetailsChange,
  PeopleBulkDetailsWriteResult,
  PeopleCompanyWriteResult,
  PeopleEnrichApplyResult,
  PeopleContactEdit,
  PeopleEnrichField,
  PeopleEnrichPreview,
  PeopleInteraction,
  PeopleDirectoryResult,
  ContactFolder,
  ContactFoldersResult,
  PeopleGroupMembersResult,
  PeopleGroupsResult,
  PeopleListResult,
  PeopleOrganizationResult,
  PeopleRecord,
  Reuniao,
  SegurancaEmail,
  Site,
  Tarefa,
  TipoArquivo,
  UsoOneDrive,
} from "./types";

/** Estamos dentro do Tauri (webview do app) ou num browser comum (pnpm dev)? */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- MOCK usado apenas no browser (fora do Tauri), pra visualizar a UI ---
const MOCK_USER: AppUser = {
  displayName: "Wagner Consani",
  email: "wagner@voaz.builders",
  initials: "WC",
  organizacao: "Voaz",
  // #693: conta de trabalho contratada (o mock espelha o login org atual).
  provider: "microsoft",
  accountKind: "work",
  orgStatus: "contracted",
  domain: "voaz.builders",
  tenantId: "mock-tenant",
  capabilities: [
    "identity",
    "mailRead",
    "mailReadWrite",
    "mailSend",
    "calendar",
    "contacts",
    "tasks",
    "filePicker",
    "filesReadAll",
  ],
};

const MOCK_LOCK_PIN = "galaxie-mock-lock-pin";
let mockLockFailures = 0;
let mockLockBlockedUntil = 0;
let mockOneDriveSettings: string | null = null;

function mockPinSalvo(): string | null {
  const salvo = localStorage.getItem(MOCK_LOCK_PIN);
  if (salvo) return salvo;
  return new URLSearchParams(window.location.search).get("mockLock") === "1"
    ? "1234"
    : null;
}

// Sem numeros de proposito: o backend real tambem nao os devolve na lista,
// eles chegam depois pelo site_details. Assim o preview mostra os spinners.
const MOCK_SITES: Site[] = [
  { key: "PROJ", name: "Projetos", status: "connected" },
  { key: "MKT", name: "Marketing", status: "available" },
  { key: "GST", name: "Gestão", status: "connected" },
  { key: "COM", name: "Comercial", status: "available" },
  { key: "CPS", name: "Compras", status: "available" },
  { key: "FIN", name: "Financeiro", status: "available" },
  { key: "MOV", name: "Moving", status: "available" },
  { key: "ADM", name: "Administrativo", status: "connected" },
  { key: "RH", name: "RH", status: "noaccess" },
  { key: "WEBSITE", name: "Website", status: "noaccess" },
];

const MOCK_DETALHES: Record<string, { files: number; bytes: number }> = {
  PROJ: { files: 53668, bytes: 351_000_000_000 },
  MKT: { files: 12800, bytes: 166_000_000_000 },
  GST: { files: 1352, bytes: 79_000_000_000 },
  COM: { files: 44029, bytes: 70_000_000_000 },
  CPS: { files: 73393, bytes: 62_000_000_000 },
  FIN: { files: 100696, bytes: 58_000_000_000 },
  MOV: { files: 3800, bytes: 19_000_000_000 },
  ADM: { files: 1020, bytes: 17_000_000_000 },
};

/**
 * `idioma` vai para o backend porque a pagina de retorno do login e servida
 * pelo loopback em Rust, fora do React — sem isso ela sairia sempre em
 * portugues.
 */
/** Provider de identidade (#692 app público). `microsoft` = org + pessoal (o
 *  backend PS0/PS1 escolhe o app-registration pelo tipo de conta); `google` = PS3. */
// #746: `microsoft-personal` força a conta pessoal (tenant "consumers") — o
// backend (hook do Confucius) mapeia pro registration pessoal via client_id_para.
// `microsoft` = org (o backend deriva o tenant do e-mail). `google` = PS3.
export type AuthProvider = "microsoft" | "microsoft-personal" | "google";

/**
 * `email` agora é `login_hint` OPCIONAL (#695): o provider é a porta, não o e-mail.
 * `provider` é passado ao backend, que escolhe o registration certo (org de
 * produção vs 2º registration pessoal, PS0/PS1); comandos Tauri ignoram extras
 * até o backend ligar o param.
 */
export async function login(
  email: string,
  idioma: string,
  provider: AuthProvider = "microsoft"
): Promise<AppUser> {
  if (!inTauri()) {
    await sleep(800);
    const usado = email || MOCK_USER.email;
    // No Tauri, o tier REAL (accountKind/orgStatus/capabilities) vem do PS0 (deriva
    // do token). Aqui é mock: só um override de dev/QA pra exercitar os tiers.
    return { ...MOCK_USER, email: usado, ...mockTier() };
  }
  return invoke<AppUser>("login", { email, idioma, provider });
}

/**
 * Override de dev/QA do TIER (#698/#699) — só no mock (fora do Tauri). No app real
 * quem deriva isso é o PS0 a partir do TOKEN (`tid` MS / `hd` Google) contra o
 * registro de orgs. Aqui, `?mockOrg=contracted|uncontracted|none` força o tier pro
 * live-QA do gating; sem o param, cai no padrão do MOCK_USER (org contratada).
 * - `contracted`   → org: mantém as capabilities/accountKind do MOCK_USER.
 * - `uncontracted` → funcionário de empresa não-cliente: conta work, sem features org.
 * - `none`         → conta pessoal: accountKind personal, só "minhas coisas".
 */
function mockTier(): Partial<AppUser> {
  const forcado = new URLSearchParams(window.location.search).get("mockOrg");
  if (forcado === "uncontracted") {
    return { orgStatus: "uncontracted", accountKind: "work", organizacao: null };
  }
  if (forcado === "none") {
    return { orgStatus: "none", accountKind: "personal", organizacao: null };
  }
  return { orgStatus: "contracted" };
}

/** Descobre o tenant pelo dominio do e-mail (sem logar). */
export async function detectTenant(
  email: string
): Promise<{ tenantId: string; dominio: string }> {
  if (!inTauri()) {
    await sleep(300);
    return { tenantId: "mock-tenant", dominio: email.split("@")[1] ?? "" };
  }
  return invoke("detect_tenant", { email });
}

export async function logout(): Promise<void> {
  if (!inTauri()) {
    localStorage.removeItem(MOCK_LOCK_PIN);
    mockLockFailures = 0;
    mockLockBlockedUntil = 0;
    return;
  }
  return invoke<void>("logout");
}

export async function currentAccount(): Promise<AppUser | null> {
  if (!inTauri()) return null;
  return invoke<AppUser | null>("current_account");
}

export interface RequiredScopesStatus {
  missingScopes: string[];
}

/** Escopos Graph pedidos pela versão atual mas ausentes no token da sessão. */
export async function requiredScopesStatus(): Promise<RequiredScopesStatus> {
  if (!inTauri()) {
    const raw = new URLSearchParams(window.location.search).get(
      "mockMissingScopes",
    );
    return {
      missingScopes: raw
        ? raw.split(",").map((scope) => scope.trim()).filter(Boolean)
        : [],
    };
  }
  return invoke<RequiredScopesStatus>("required_scopes_status");
}

/** Identidade em cache (foto/iniciais) - instantanea, sem rede. */
export async function cachedIdentity(): Promise<Identidade | null> {
  if (!inTauri()) return null;
  return invoke<Identidade | null>("cached_identity");
}

/** Retoma a sessao guardada no cofre do Windows. null = precisa logar. */
export async function restoreSession(): Promise<AppUser | null> {
  if (!inTauri()) return null;
  return invoke<AppUser | null>("restore_session");
}

export interface OneDriveSettingsReadResult {
  content: string | null;
  eTag: string | null;
  cTag: string | null;
}

export interface OneDriveSettingsWriteResult {
  eTag: string | null;
  cTag: string | null;
}

let mockOneDriveSettingsETag = 0;

/** Arquivo privado de configuração + versão otimista do driveItem. */
export async function onedriveSettingsRead(): Promise<OneDriveSettingsReadResult> {
  if (!inTauri()) {
    return {
      content: mockOneDriveSettings,
      eTag: mockOneDriveSettings === null ? null : `mock-${mockOneDriveSettingsETag}`,
      cTag: mockOneDriveSettings === null ? null : `mock-${mockOneDriveSettingsETag}`,
    };
  }
  return invoke<OneDriveSettingsReadResult>("onedrive_settings_read");
}

/** PUT condicional: o Graph devolve 412 quando outra máquina venceu a corrida. */
export async function onedriveSettingsWrite(
  content: string,
  eTag: string | null,
): Promise<OneDriveSettingsWriteResult> {
  if (!inTauri()) {
    const atual = mockOneDriveSettings === null
      ? null
      : `mock-${mockOneDriveSettingsETag}`;
    if (eTag !== atual) throw new Error("onedrive-settings-conflict");
    mockOneDriveSettings = content;
    mockOneDriveSettingsETag += 1;
    return {
      eTag: `mock-${mockOneDriveSettingsETag}`,
      cTag: `mock-${mockOneDriveSettingsETag}`,
    };
  }
  return invoke<OneDriveSettingsWriteResult>("onedrive_settings_write", {
    content,
    eTag,
  });
}

/** Config Google no Drive appDataFolder (PS4 #697). `revision` = headRevisionId. */
export interface GoogleDriveSettingsReadResult {
  content: string | null;
  revision: string | null;
}

export interface GoogleDriveSettingsWriteResult {
  revision: string | null;
}

let mockGDriveSettings: string | null = null;
let mockGDriveRevision = 0;

/** Lê o toolbox.json privado no appDataFolder do Google Drive. */
export async function gdriveSettingsRead(): Promise<GoogleDriveSettingsReadResult> {
  if (!inTauri()) {
    return {
      content: mockGDriveSettings,
      revision: mockGDriveSettings === null ? null : `mock-${mockGDriveRevision}`,
    };
  }
  return invoke<GoogleDriveSettingsReadResult>("gdrive_settings_read");
}

/** Grava o toolbox.json no appDataFolder. `revision` é bookkeeping (single-user). */
export async function gdriveSettingsWrite(
  content: string,
  _revision: string | null,
): Promise<GoogleDriveSettingsWriteResult> {
  if (!inTauri()) {
    mockGDriveSettings = content;
    mockGDriveRevision += 1;
    return { revision: `mock-${mockGDriveRevision}` };
  }
  return invoke<GoogleDriveSettingsWriteResult>("gdrive_settings_write", {
    content,
    revision: _revision,
  });
}

export interface LockStatus {
  enabled: boolean;
}

export interface PinResult {
  ok: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number;
}

/** Consulta o gate local antes de restaurar qualquer conteúdo protegido. */
export async function lockStatus(): Promise<LockStatus> {
  if (!inTauri()) return { enabled: mockPinSalvo() !== null };
  return invoke<LockStatus>("lock_status");
}

export async function lockSetPin(
  pin: string,
  currentPin?: string
): Promise<void> {
  if (!inTauri()) {
    const atual = mockPinSalvo();
    if (atual && atual !== currentPin) throw new Error("PIN atual incorreto.");
    if (!/^\d{4,8}$/.test(pin)) {
      throw new Error("O PIN deve conter de 4 a 8 dígitos.");
    }
    localStorage.setItem(MOCK_LOCK_PIN, pin);
    mockLockFailures = 0;
    mockLockBlockedUntil = 0;
    return;
  }
  return invoke<void>("lock_set_pin", { pin, currentPin });
}

export async function lockDisablePin(pin: string): Promise<void> {
  if (!inTauri()) {
    if (mockPinSalvo() !== pin) throw new Error("PIN atual incorreto.");
    localStorage.removeItem(MOCK_LOCK_PIN);
    mockLockFailures = 0;
    mockLockBlockedUntil = 0;
    return;
  }
  return invoke<void>("lock_disable_pin", { pin });
}

export async function lockVerifyPin(pin: string): Promise<PinResult> {
  if (!inTauri()) {
    const agora = Date.now();
    if (mockLockBlockedUntil > agora) {
      return {
        ok: false,
        remainingAttempts: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((mockLockBlockedUntil - agora) / 1000)
        ),
      };
    }
    if (pin === mockPinSalvo()) {
      mockLockFailures = 0;
      mockLockBlockedUntil = 0;
      return { ok: true, remainingAttempts: 5, retryAfterSeconds: 0 };
    }
    mockLockFailures += 1;
    const remainingAttempts = Math.max(0, 5 - mockLockFailures);
    if (remainingAttempts === 0) mockLockBlockedUntil = agora + 30_000;
    return {
      ok: false,
      remainingAttempts,
      retryAfterSeconds: remainingAttempts === 0 ? 30 : 0,
    };
  }
  return invoke<PinResult>("lock_verify_pin", { pin });
}

export async function listSites(): Promise<Site[]> {
  if (!inTauri()) {
    await sleep(400);
    return MOCK_SITES.map((s) => ({ ...s }));
  }
  return invoke<Site[]>("list_sites");
}

/** Tamanho e contagens de uma biblioteca. Uma chamada por site. */
export async function siteDetails(
  site: Site
): Promise<Pick<Site, "bytes" | "folders" | "files" | "libraryUrl">> {
  if (!inTauri()) {
    await sleep(600 + Math.random() * 1800);
    const d = MOCK_DETALHES[site.key];
    return {
      bytes: d?.bytes,
      files: d?.files,
      folders: d ? Math.round(d.files / 12) : undefined,
      libraryUrl: `https://exemplo.sharepoint.com/sites/${site.key}/Documentos%20Compartilhados`,
    };
  }
  return invoke("site_details", { siteId: site.siteId, webUrl: site.webUrl });
}

// --- OneDrive pessoal (aba "My files") -----------------------------------
const MOCK_PASTAS_OD: PastaOD[] = [
  { id: "od-proj", name: "Projetos", bytes: 351_000_000_000, webUrl: "", childCount: 25 },
  { id: "od-fin", name: "Financeiro", bytes: 58_000_000_000, webUrl: "", childCount: 24 },
  { id: "od-fotos", name: "Fotos", bytes: 41_000_000_000, webUrl: "", childCount: 8 },
  { id: "od-desktop", name: "Área de Trabalho", bytes: 2_200_000, webUrl: "", childCount: 12 },
];

export async function onedriveFolders(): Promise<PastaOD[]> {
  if (!inTauri()) {
    await sleep(400);
    return MOCK_PASTAS_OD.map((p) => ({ ...p }));
  }
  return invoke<PastaOD[]>("onedrive_folders");
}

export async function onedriveFolderDetails(
  webUrl: string
): Promise<Pick<PastaOD, "folders" | "files">> {
  if (!inTauri()) {
    await sleep(500 + Math.random() * 1500);
    const n = Math.floor(Math.random() * 8000);
    return { files: n, folders: Math.round(n / 15) };
  }
  return invoke("onedrive_folder_details", { webUrl });
}

export async function onedriveQuota(): Promise<UsoOneDrive> {
  if (!inTauri()) {
    await sleep(300);
    return { used: 494_000_000_000, total: 1_099_511_627_776, webUrl: "" };
  }
  return invoke<UsoOneDrive>("onedrive_quota");
}

export async function onedriveTipos(webUrl: string): Promise<TipoArquivo[]> {
  if (!inTauri()) {
    await sleep(700);
    return [
      { tipo: "pdf", quantidade: 18432 },
      { tipo: "docx", quantidade: 9210 },
      { tipo: "xlsx", quantidade: 6003 },
      { tipo: "jpg", quantidade: 4120 },
      { tipo: "png", quantidade: 2890 },
    ];
  }
  return invoke<TipoArquivo[]>("onedrive_tipos", { webUrl });
}

// --- Control room ---------------------------------------------------------
export async function crReunioes(): Promise<Reuniao[]> {
  if (!inTauri()) {
    await sleep(400);
    const agora = new Date();
    const em = (h: number) => new Date(agora.getTime() + h * 3600_000).toISOString().replace("Z", "");
    return [
      { assunto: "Daily do time", inicio: em(1), fim: em(1.5), local: "Teams", online: true },
      { assunto: "Reunião com cliente VOAZ", inicio: em(4), fim: em(5), local: "Sala 2", online: false },
    ];
  }
  return invoke<Reuniao[]>("cr_reunioes");
}

export async function crEmail(): Promise<CaixaEntrada> {
  if (!inTauri()) {
    await sleep(500);
    return {
      naoLidos: 7,
      recentes: [
        { assunto: "Fatura de julho", de: "Financeiro", recebido: new Date().toISOString() },
        { assunto: "Aprovação pendente", de: "João", recebido: new Date().toISOString() },
      ],
    };
  }
  return invoke<CaixaEntrada>("cr_email");
}

/** #440 (Atoms A1): e-mail do dashboard num único $batch (não-lidos + sinalizados
 * + recentes). 1 comando, 1 caminho de erro — substitui o
 * Promise.all([crEmail, crContadores]) que derrubava o widget quando só o
 * contador falhava (#187). O não-lido é sinal-chave: um erro real propaga. */
export interface AtomsEmail {
  naoLidos: number;
  sinalizados: number;
  recentes: EmailRecente[];
}

export async function crAtomsEmail(): Promise<AtomsEmail> {
  if (!inTauri()) {
    await sleep(500);
    return {
      naoLidos: 12,
      sinalizados: 3,
      recentes: [
        { assunto: "Fatura de julho", de: "Financeiro", recebido: new Date().toISOString() },
        { assunto: "Aprovação pendente", de: "João", recebido: new Date().toISOString() },
      ],
    };
  }
  return invoke<AtomsEmail>("atoms_email");
}

export async function crTarefas(): Promise<Tarefa[]> {
  if (!inTauri()) {
    await sleep(450);
    const ontem = new Date(Date.now() - 86_400_000).toISOString();
    return [
      { titulo: "Revisar migração PROJ-H", lista: "Trabalho", id: "t1", listaId: "l1", prazo: ontem },
      { titulo: "Ligar para o suporte MS", lista: "Trabalho", id: "t2", listaId: "l1", prazo: null },
    ];
  }
  return invoke<Tarefa[]>("cr_tarefas");
}

/** Atoms (#184): conclui uma tarefa do To Do (complete-in-place). */
export async function crTarefaConcluir(
  listaId: string,
  tarefaId: string,
): Promise<void> {
  if (!inTauri()) {
    await sleep(250);
    return;
  }
  return invoke<void>("cr_tarefa_concluir", { listaId, tarefaId });
}

/** #186 (Atoms S4): estado local do sync do OneDrive (sonda Rust, não Graph). */
export interface OneDriveSync {
  estado: "ok" | "pausado" | "naoConfigurado";
  contas: number;
  ultimoErro: string | null;
}

export async function atomsOnedriveSync(): Promise<OneDriveSync> {
  if (!inTauri()) {
    await sleep(150);
    return { estado: "naoConfigurado", contas: 0, ultimoErro: null };
  }
  return invoke<OneDriveSync>("atoms_onedrive_sync");
}

/** #186 (Atoms S4): o token tem Chat.Read? Gate do widget de chats do Teams. */
export async function crTeamsDisponivel(): Promise<boolean> {
  if (!inTauri()) {
    const { missingScopes } = await requiredScopesStatus();
    return !missingScopes.some((s) => s.toLocaleLowerCase() === "chat.read");
  }
  return invoke<boolean>("cr_teams_disponivel");
}

// --- Agenda do dia + inbox do dia ----------------------------------------
const MOCK_PARTS = [
  { nome: "Ana Silva", email: "ana@voaz.com.br", iniciais: "AS", foto: null },
  { nome: "Bruno Costa", email: "bruno@voaz.com.br", iniciais: "BC", foto: null },
  { nome: "Carla Dias", email: "carla@voaz.com.br", iniciais: "CD", foto: null },
];

export async function crAgenda(
  inicio: string,
  fim: string,
  mailbox?: string,
): Promise<EventoAgenda[]> {
  if (!inTauri()) {
    await sleep(400);
    const base = new Date(inicio);
    const em = (h: number) => {
      const d = new Date(base);
      d.setHours(h, 0, 0, 0);
      return d.toISOString().replace("Z", "");
    };
    return [
      {
        id: "ev1",
        tipo: "singleInstance",
        assunto: "PROH + VOAZ — Orçamento e Compras",
        inicio: em(9),
        fim: em(10),
        local: "Teams",
        online: true,
        diaInteiro: false,
        categoria: "meeting",
        participantes: MOCK_PARTS.slice(0, 2),
        totalParticipantes: 2,
        temAnexos: false,
        categorias: ["Crítico"],
        // Evento próprio: organizador, sem RSVP (#287).
        resposta: "organizer",
        souOrganizador: true,
        organizadorEmail: "wagner@voaz.builders",
        respostaSolicitada: false,
      },
      {
        id: "ev2",
        tipo: "singleInstance",
        assunto: "KPMG RJ — Checkpoint interno",
        inicio: em(14),
        fim: em(15),
        local: "Sala 2",
        online: false,
        diaInteiro: false,
        categoria: "meeting",
        participantes: MOCK_PARTS,
        totalParticipantes: 6,
        temAnexos: true,
        categorias: [],
        // Convite pendente: aparece com semântica de "sem resposta" e RSVP (#287).
        resposta: "notResponded",
        souOrganizador: false,
        organizadorEmail: "ana.kpmg@kpmg.com",
        respostaSolicitada: true,
      },
    ];
  }
  return invoke<EventoAgenda[]>("cr_agenda", { inicio, fim, mailbox: mailboxArg(mailbox) });
}

/** Lista os calendários do usuário (#233) — /me/calendars, ou /users/{addr} (#495). */
export async function crCalendarios(mailbox?: string): Promise<Calendario[]> {
  if (!inTauri()) {
    await sleep(300);
    return [
      { id: "cal-default", nome: "Calendário", cor: "#0078D4", isDefaultCalendar: true, canEdit: true },
      { id: "cal-aniversarios", nome: "Aniversários", cor: "#E3008C", isDefaultCalendar: false, canEdit: false },
      { id: "cal-feriados", nome: "Feriados", cor: "#498205", isDefaultCalendar: false, canEdit: false },
    ];
  }
  return invoke<Calendario[]>("cr_calendarios", { mailbox: mailboxArg(mailbox) });
}

/** Eventos de um calendário específico no intervalo (#233). */
export async function crAgendaCalendario(
  calendarioId: string,
  inicio: string,
  fim: string,
  mailbox?: string,
): Promise<EventoAgenda[]> {
  if (!inTauri()) {
    // Reaproveita o mock do calendário padrão para simular a carga por id.
    return crAgenda(inicio, fim);
  }
  return invoke<EventoAgenda[]>("cr_agenda_calendario", {
    calendarioId,
    inicio,
    fim,
    mailbox: mailboxArg(mailbox),
  });
}

export async function crCategorias(): Promise<CategoriaCor[]> {
  if (!inTauri()) {
    await sleep(200);
    return [
      { nome: "Crítico", cor: "#D13438" },
      { nome: "Categoria Azul", cor: "#0078D4" },
      { nome: "Categoria verde", cor: "#498205" },
    ];
  }
  return invoke<CategoriaCor[]>("cr_categorias");
}

/** Cria uma categoria mestra (#211). `preset` = nome do preset de cor do
 *  Outlook ("preset0".."preset24"). Devolve a categoria criada com o hex. */
export async function crCriarCategoria(
  nome: string,
  preset: string,
): Promise<CategoriaCor> {
  if (!inTauri()) {
    await sleep(200);
    const HEX: Record<string, string> = {
      preset0: "#D13438",
      preset4: "#498205",
      preset7: "#0078D4",
      preset8: "#8764B8",
      preset1: "#FF8C00",
      preset5: "#00B7C3",
    };
    return { nome, cor: HEX[preset] ?? "#8A8886" };
  }
  return invoke<CategoriaCor>("cr_criar_categoria", { nome, preset });
}

export async function crEventoCorpo(id: string): Promise<EventoDetalhe> {
  if (!inTauri()) {
    await sleep(300);
    return {
      assunto: "PROH + VOAZ — Orçamento e Compras",
      inicio: new Date().toISOString().replace("Z", ""),
      fim: new Date().toISOString().replace("Z", ""),
      local: "Teams",
      online: true,
      joinUrl: "https://teams.microsoft.com/l/meetup-join/mock",
      organizador: "Wagner Consani",
      organizadorEmail: "wagner@voaz.builders",
      souOrganizador: false,
      // Convite pendente no mock (#287) para exibir o RSVP no dev do browser.
      resposta: "notResponded",
      respostaSolicitada: true,
      corpo: "<p>Pauta: revisar orçamento de compras do trimestre e alinhar próximos passos.</p>",
      corpoTipo: "html",
      participantes: MOCK_PARTS,
      webLink: "https://outlook.office365.com/mock",
    };
  }
  return invoke<EventoDetalhe>("cr_evento_corpo", { id });
}

/** Responde a um convite de reunião (#287): RSVP Aceitar/Talvez/Recusar via
 *  POST /me/events/{id}/{accept|tentativelyAccept|decline}. `enviarResposta`
 *  liga o aviso ao organizador; `comentario` opcional acompanha a resposta. */
export async function crResponderEvento(
  id: string,
  resposta: AcaoRsvp,
  enviarResposta: boolean,
  comentario: string,
): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  await invoke("cr_responder_evento", {
    id,
    resposta,
    enviarResposta,
    comentario,
  });
}

/** Cria um evento no calendário (#211). Devolve o id do evento criado. */
export async function crCriarEvento(input: EventoInput): Promise<string> {
  if (!inTauri()) {
    await sleep(300);
    return `mock-${Date.now()}`;
  }
  return invoke<string>("cr_criar_evento", { input });
}

/** Edita um evento existente (#211). */
export async function crEditarEvento(id: string, input: EventoInput): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  await invoke("cr_editar_evento", { id, input });
}

/** #213: reagenda um evento arrastando — PATCH só de início/fim/dia-inteiro,
 * preservando convidados/corpo/categorias/recorrência (diferente do editar, que
 * reenvia os attendees). Envia hora-de-parede local + fuso IANA, como o criar. */
export async function crReagendarEvento(
  id: string,
  inicio: string,
  fim: string,
  diaInteiro: boolean,
  timeZone: string,
): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  await invoke("cr_reagendar_evento", { id, inicio, fim, diaInteiro, timeZone });
}

/** #397: recorrência da SÉRIE (do seriesMaster) pra o form carregar os campos ao
 * editar "a série inteira". `null` = evento único ou padrão não modelado (relative*). */
export async function crEventoRecorrencia(
  id: string,
): Promise<RecorrenciaInput | null> {
  if (!inTauri()) {
    await sleep(200);
    return null;
  }
  return invoke<RecorrenciaInput | null>("cr_evento_recorrencia", { id });
}

/** Exclui um evento (#211). */
export async function crExcluirEvento(id: string): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  await invoke("cr_excluir_evento", { id });
}

/** Cancela um evento organizado pelo usuário (#260): envia o cancelamento aos
 *  convidados via POST /me/events/{id}/cancel, com comentário opcional.
 *  Distinto de excluir (silencioso). */
export async function crCancelarEvento(id: string, comentario: string): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  await invoke("cr_cancelar_evento", { id, comentario });
}

export async function crInboxDia(inicio: string, fim: string): Promise<EmailItem[]> {
  if (!inTauri()) {
    await sleep(500);
    const t = (h: number) => {
      const d = new Date(inicio);
      d.setHours(h, 12, 0, 0);
      return d.toISOString();
    };
    return [
      { id: "m1", assunto: "Fatura de julho", de: "Financeiro VOAZ", deEmail: "fin@voaz.com.br", iniciais: "FV", recebido: t(8), preview: "Segue em anexo a fatura referente aos serviços de julho.", lido: false, temAnexos: true, sinalizado: false },
      { id: "m2", assunto: "Aprovação pendente — compra PROH", de: "João Pereira", deEmail: "joao@proh.com.br", iniciais: "JP", recebido: t(10), preview: "Oi Wagner, preciso da sua aprovação para seguir com o pedido.", lido: false, temAnexos: false, sinalizado: true },
      { id: "m3", assunto: "Seu OneDrive está sem espaço", de: "Microsoft", deEmail: "no-reply@microsoft.com", iniciais: "MS", recebido: t(13), preview: "Seu armazenamento do OneDrive está cheio. Libere espaço para continuar.", lido: true, temAnexos: false, sinalizado: false },
    ];
  }
  return invoke<EmailItem[]>("cr_inbox_dia", { inicio, fim });
}

function mailboxArg(mailbox?: string): string | null {
  const valor = mailbox?.trim();
  return valor && valor !== "me" ? valor.toLowerCase() : null;
}

export async function crEmailCorpo(
  id: string,
  mailbox?: string
): Promise<EmailDetalhe> {
  if (!inTauri()) {
    await sleep(300);
    // Remetente UNIDIRECIONAL (#94): servidor/no-reply. Casa com a mensagem
    // "server" da lista → o popover de insights recebe server@voaz.builders e
    // mostra recebidos + 1º/último contato + frequência, com enviados = 0.
    if (/server/i.test(id)) {
      return {
        assunto: "Relatório diário de backup — VOAZ",
        de: "VOAZ | SERVER",
        deEmail: "server@voaz.builders",
        para: ["Wagner Consani"],
        cc: [],
        paraEmails: ["wagner@galaxie.works"],
        ccEmails: [],
        recebido: new Date().toISOString(),
        corpo: "<p>Backup concluído com sucesso às 03:00. Nenhuma ação necessária.</p>",
        corpoTipo: "html",
        anexos: [],
        webLink: "https://outlook.office365.com/mock",
      };
    }
    // Corpo com links variados p/ exercitar o link-safety (#91):
    //  - mismatch: texto "www.bradesco.com.br" mas href aponta pra evil.ru
    //  - encurtador: bit.ly (destino escondido)
    //  - limpo: outlook.office365.com (sem avisos)
    const corpo =
      "<p>Oi Wagner,</p>" +
      "<p>Preciso da sua aprovação para seguir com o pedido de compra da PROH. " +
      "Confirme os dados bancários em " +
      '<a href="https://evil.ru/login">www.bradesco.com.br</a>.</p>' +
      '<p>Veja a proposta encurtada: <a href="https://bit.ly/3xYzAbC">abrir proposta</a>.</p>' +
      '<p>Ou acesse direto no <a href="https://outlook.office365.com/mail">Outlook</a>.</p>' +
      "<p>Abraço,<br/>João</p>";
    return {
      assunto: "Aprovação pendente — compra PROH",
      de: "João Pereira",
      deEmail: "joao@proh.com.br",
      para: ["Wagner Consani"],
      cc: ["Financeiro VOAZ", "Ana Silva"],
      paraEmails: ["wagner@galaxie.works"],
      ccEmails: ["fin@voaz.com.br", "ana@exemplo.com"],
      recebido: new Date().toISOString(),
      corpo,
      corpoTipo: "html",
      anexos: [
        {
          id: "mock-proposta",
          nome: "proposta.pdf",
          tamanho: 245_760,
          contentType: "application/pdf",
          odataType: "#microsoft.graph.fileAttachment",
          isInline: false,
        },
      ],
      webLink: "https://outlook.office365.com/mock",
    };
  }
  return invoke<EmailDetalhe>("cr_email_corpo", { id, mailbox: mailboxArg(mailbox) });
}

/**
 * Dados de segurança do e-mail (#91). No mock (browser), varia por id p/ o QA
 * ver os três estados do badge + o alerta de Reply-To. Cicla pelo último número
 * do id (ex.: "inbox-0-2" → índice 2): 0 = autenticado (verde), 1 = parcial
 * (amarelo) + Reply-To divergente, 2 = falha (vermelho) + Reply-To divergente.
 */
export async function crEmailSeguranca(
  id: string,
  mailbox?: string
): Promise<SegurancaEmail> {
  if (!inTauri()) {
    await sleep(200);
    const ultimoNum = id.match(/(\d+)(?!.*\d)/);
    const caso = ultimoNum ? Number(ultimoNum[1]) % 3 : 1;
    if (caso === 0) {
      return {
        replyTo: [],
        autenticacao: [
          "spf=pass (sender IP is 40.1.2.3) smtp.mailfrom=voaz.com.br; " +
            "dkim=pass header.d=voaz.com.br; dmarc=pass action=none header.from=voaz.com.br",
        ],
        receivedSpf: [],
      };
    }
    if (caso === 2) {
      return {
        replyTo: [{ nome: "Suporte", email: "suporte@microsoft-alerta.ru" }],
        autenticacao: [
          "spf=fail (sender IP is 5.6.7.8) smtp.mailfrom=microsoft-alerta.ru; " +
            "dkim=none; dmarc=fail action=oreject header.from=microsoft.com",
        ],
        receivedSpf: [],
      };
    }
    // caso 1 (default): parcial + Reply-To divergente do From
    return {
      replyTo: [{ nome: "Cobranças PROH", email: "cobranca@proh-pagamentos.ru" }],
      autenticacao: ["spf=pass smtp.mailfrom=proh.com.br; dkim=none; dmarc=none"],
      receivedSpf: [],
    };
  }
  return invoke<SegurancaEmail>("cr_email_seguranca", {
    id,
    mailbox: mailboxArg(mailbox),
  });
}

const MOCK_PASTAS: PastaEmail[] = [
  { id: "inbox", tipo: "inbox", nome: "Caixa de entrada", naoLidos: 3, total: 128, filhos: 1 },
  { id: "drafts", tipo: "drafts", nome: "Rascunhos", naoLidos: 0, total: 45, filhos: 0 },
  { id: "sentitems", tipo: "sentitems", nome: "Enviados", naoLidos: 0, total: 312, filhos: 0 },
  { id: "archive", tipo: "archive", nome: "Arquivo", naoLidos: 0, total: 12, filhos: 0 },
  { id: "junkemail", tipo: "junkemail", nome: "Lixo eletrônico", naoLidos: 3, total: 8, filhos: 0 },
  { id: "deleteditems", tipo: "deleteditems", nome: "Itens excluídos", naoLidos: 0, total: 34, filhos: 0 },
];

export async function crMailFolders(mailbox?: string): Promise<PastaEmail[]> {
  if (!inTauri()) {
    await sleep(300);
    return MOCK_PASTAS.map((p) => ({ ...p }));
  }
  return invoke<PastaEmail[]>("cr_mail_folders", { mailbox: mailboxArg(mailbox) });
}

// --- Caixas compartilhadas (#111) — adicionar caixa por endereço ----------

/** Discriminante devolvido pela validação de uma caixa compartilhada. */
export type StatusCaixa = "ok" | "sem_acesso" | "nao_encontrado" | "precisa_relogin";

export type ValidacaoCaixa = { endereco: string; status: StatusCaixa };

/**
 * Valida na hora se o usuário tem acesso a uma caixa por endereço (#111):
 * `GET /users/{addr}/mailFolders/inbox`. NÃO lista o conteúdo (isso é a #112) —
 * só devolve 200/403/404 para o seletor decidir se adiciona.
 *
 * MOCK (fora do Tauri, para QA visual dos 3 caminhos):
 * - `semacesso@x.com`            → sem_acesso (403)
 * - `naoexiste@x.com`            → nao_encontrado (404)
 * - qualquer `@voaz.builders`    → ok (200) — ex.: compartilhada@voaz.builders
 * - qualquer outro e-mail válido → nao_encontrado (404)
 */
export async function crValidarCaixa(endereco: string): Promise<ValidacaoCaixa> {
  const addr = endereco.trim().toLowerCase();
  if (!inTauri()) {
    await sleep(600);
    if (!addr.includes("@") || !addr.includes(".")) throw new Error("endereco invalido");
    let status: StatusCaixa;
    if (addr === "semacesso@x.com") status = "sem_acesso";
    else if (addr === "naoexiste@x.com") status = "nao_encontrado";
    else if (addr.endsWith("@voaz.builders")) status = "ok";
    else status = "nao_encontrado";
    return { endereco: addr, status };
  }
  return invoke<ValidacaoCaixa>("cr_validar_caixa", { endereco: addr });
}

/**
 * O token atual traz o escopo Mail.Read.Shared? Falso ⇒ o app sinaliza "faça
 * login novamente" (escopo novo na SCOPES, sem consent admin — já concedido).
 * MOCK: sempre `true` (o mock não tem token real).
 */
export async function crMailSharedDisponivel(): Promise<boolean> {
  if (!inTauri()) {
    await sleep(150);
    return true;
  }
  return invoke<boolean>("cr_mail_shared_disponivel");
}

/**
 * O token atual traz Mail.Send.Shared (#114)? Mantido separado da checagem de
 * leitura/escrita para o app pedir relogin só no fluxo de envio compartilhado.
 */
export async function crMailSendSharedDisponivel(): Promise<boolean> {
  if (!inTauri()) {
    await sleep(150);
    return true;
  }
  return invoke<boolean>("cr_mail_send_shared_disponivel");
}

/** Subpastas de uma pasta de e-mail (para a árvore de pastas). */
export async function crSubpastas(
  folderId: string,
  mailbox?: string
): Promise<PastaEmail[]> {
  if (!inTauri()) {
    await sleep(300);
    return [
      { id: `${folderId}-sub1`, tipo: "child", nome: "Clientes", naoLidos: 2, total: 40, filhos: 0 },
    ];
  }
  return invoke<PastaEmail[]>("cr_subpastas", {
    folderId,
    mailbox: mailboxArg(mailbox),
  });
}

// --- Compositor de e-mail (pessoas, envio novo, contatos) -----------------
const MOCK_PESSOAS: Pessoa[] = [
  // "Seus contatos" = contatos PESSOAIS do usuário (/me/contacts).
  { nome: "Ana Silva", email: "ana@voaz.com.br", cargo: "Gerente de Projetos", origem: "contatos" },
  { nome: "Bruno Costa", email: "bruno@voaz.com.br", cargo: "Engenheiro Civil", origem: "contatos" },
  { nome: "Amanda Rocha", email: "amanda.rocha@gmail.com", cargo: "Fornecedora", origem: "contatos" },
  { nome: "Marca Ferramentas", email: "vendas@marcaferramentas.com.br", cargo: null, origem: "contatos" },
  // "De sua organização" = diretório do tenant (/users).
  { nome: "Carla Dias", email: "carla@voaz.com.br", cargo: "Arquiteta", origem: "organizacao" },
  { nome: "Wagner Consani", email: "wagner@voaz.builders", cargo: null, origem: "organizacao" },
  { nome: "Henrique Garcia", email: "henrique.garcia@voaz.com.br", cargo: "Coordenador de Obras", origem: "organizacao" },
  { nome: "Mariana Alves", email: "mariana.alves@voaz.com.br", cargo: "Analista Financeira", origem: "organizacao" },
  { nome: "Rafael Andrade", email: "rafael.andrade@voaz.com.br", cargo: "Comprador", origem: "organizacao" },
  { nome: "Fernanda Aguiar", email: "fernanda.aguiar@voaz.com.br", cargo: "Assistente Administrativa", origem: "organizacao" },
  { nome: "Gustavo Barata", email: "gustavo.barata@voaz.com.br", cargo: "Estagiário de Engenharia", origem: "organizacao" },
];

const MOCK_DIRECTORY_RECORDS: PeopleRecord[] = [
  {
    id: "directory-ada",
    source: "directory",
    name: "Ada Lovelace",
    emails: [{ address: "ada@example.com" }],
    phones: [],
    jobTitle: "Product Director",
    company: "Analytical Engines",
    organization: true,
    peopleRank: null,
  },
  {
    id: "directory-grace",
    source: "directory",
    name: "Grace Hopper",
    emails: [{ address: "grace@example.com" }],
    phones: [{ number: "+1 212 555 0102", label: "mobile" }],
    jobTitle: "Engineering Lead",
    company: "Compiler Labs",
    organization: true,
    peopleRank: null,
  },
];

/**
 * Fotos (avatar) de remetentes internos, em lote (#39). Recebe e-mails e devolve
 * um mapa e-mail(minúsculo) → data URI | null (null = sem foto). Fora do Tauri
 * (mock) devolve {} — no browser não há fotos reais, então o AvatarFallback
 * (iniciais) continua. O backend usa `$batch` (até 20/chamada); o cache
 * (`fotos.ts`) já limita a 20 e filtra por domínio do tenant.
 */
export async function crFotosContatos(
  emails: string[]
): Promise<Record<string, string | null>> {
  if (!inTauri()) return {};
  const arr = await invoke<{ email: string; foto: string | null }[]>(
    "cr_fotos_contatos",
    { emails }
  );
  const map: Record<string, string | null> = {};
  for (const f of arr) map[f.email] = f.foto;
  return map;
}

/** Busca pessoas para o autocomplete do compositor. */
export async function crPessoas(query: string): Promise<Pessoa[]> {
  if (!inTauri()) {
    await sleep(200);
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return MOCK_PESSOAS.filter(
      (p) => p.nome.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
    );
  }
  return invoke<Pessoa[]>("cr_pessoas", { query });
}

/** Dados iniciais do módulo People, mantendo falhas e permissões por fonte. */
export async function crPeopleList(
  nextLinks: string[] = [],
  mailbox?: string,
): Promise<PeopleListResult> {
  if (!inTauri()) {
    await sleep(450);
    if (nextLinks.length > 0) {
      return {
        missingScopes: [],
        failures: [],
        nextLinks: [],
        records: Array.from({ length: 80 }, (_, index) => ({
          id: `contact-page-2-${index}`,
          source: "contacts" as const,
          name: `Contact ${String(index + 5).padStart(3, "0")}`,
          emails: [{ address: `contact${index + 5}@example.com`, label: "work" }],
          phones: index % 3 === 0
            ? [{ number: `+1 555 01${String(index).padStart(2, "0")}`, label: "work" }]
            : [],
          jobTitle: index % 2 === 0 ? "Specialist" : null,
          company: index % 2 === 0 ? "Compiler Labs" : "Analytical Engines",
          organization: index % 2 === 0,
          peopleRank: null,
        })),
      };
    }
    return {
      missingScopes: [],
      failures: [],
      nextLinks: ["mock:contacts:2"],
      records: [
        {
          id: "contact-ada",
          source: "contacts",
          name: "Ada Lovelace",
          emails: [{ address: "ada@example.com", label: "work" }],
          phones: [{ number: "+44 20 7946 0958", label: "work" }],
          jobTitle: "Product Architect",
          company: "Analytical Engines",
          organization: false,
          peopleRank: null,
        },
        {
          id: "people-ada",
          source: "people",
          name: "Ada Lovelace",
          emails: [{ address: "ada@example.com" }],
          phones: [],
          jobTitle: "Product Architect",
          company: "Analytical Engines",
          organization: true,
          peopleRank: 0,
        },
        {
          id: "people-grace",
          source: "people",
          name: "Grace Hopper",
          emails: [{ address: "grace@example.com" }],
          phones: [{ number: "+1 212 555 0102", label: "mobile" }],
          jobTitle: "Engineering Lead",
          company: "Compiler Labs",
          organization: true,
          peopleRank: 1,
        },
        {
          id: "contact-alan",
          source: "contacts",
          name: "Alan Turing",
          emails: [{ address: "alan@example.net", label: "work" }],
          phones: [],
          jobTitle: null,
          company: "Bletchley Research",
          organization: false,
          peopleRank: null,
        },
      ],
    };
  }
  return invoke<PeopleListResult>("cr_people_list", {
    nextLinks,
    mailbox: mailboxArg(mailbox),
  });
}

/** Organização canônica do tenant atual; não é uma organização criada no app. */
export async function crPeopleOrganization(): Promise<PeopleOrganizationResult> {
  if (!inTauri()) {
    await sleep(250);
    return {
      organization: {
        id: "organization-voaz",
        name: MOCK_USER.organizacao ?? "Voaz",
      },
      missingScopes: [],
      failures: [],
    };
  }
  return invoke<PeopleOrganizationResult>("cr_organizacao");
}

/** Snapshot completo do diretório M365; a paginação é consumida no backend. */
export async function crPeopleDirectory(): Promise<PeopleDirectoryResult> {
  if (!inTauri()) {
    await sleep(400);
    return {
      records: MOCK_DIRECTORY_RECORDS.map((record) => ({
        ...record,
        emails: record.emails.map((email) => ({ ...email })),
        phones: record.phones.map((phone) => ({ ...phone })),
      })),
      missingScopes: [],
      failures: [],
    };
  }
  return invoke<PeopleDirectoryResult>("cr_people_directory");
}

/** Grupos M365 diretos do usuário atual (#293). */
export async function crPeopleGroups(): Promise<PeopleGroupsResult> {
  if (!inTauri()) {
    await sleep(350);
    return {
      groups: [
        {
          id: "group-product",
          name: "Product",
          description: "Time de produto — squad de discovery e delivery.",
          mail: "product@voaz.builders",
          visibility: "Private",
          memberCount: null,
        },
        {
          id: "group-leadership",
          name: "Leadership",
          description: "",
          mail: "leadership@voaz.builders",
          visibility: "Public",
          memberCount: null,
        },
      ],
      missingScopes: [],
      failures: [],
    };
  }
  return invoke<PeopleGroupsResult>("cr_grupos");
}

/** Membros usuários de um grupo M365, carregados sob demanda (#293). */
export async function crPeopleGroupMembers(
  groupId: string,
): Promise<PeopleGroupMembersResult> {
  if (!inTauri()) {
    await sleep(450);
    const all = MOCK_DIRECTORY_RECORDS.map((record) => ({
      ...record,
      emails: record.emails.map((email) => ({ ...email })),
      phones: record.phones.map((phone) => ({ ...phone })),
    }));
    const records = groupId === "group-leadership" ? all.slice(0, 1) : all;
    return { records, memberCount: records.length };
  }
  return invoke<PeopleGroupMembersResult>("cr_grupo_membros", { groupId });
}

// #562: grupos de contato PESSOAIS via contactFolders (Contacts.ReadWrite) —
// pastas editáveis do usuário, distintas dos grupos M365 read-only acima.

/** Lista as pastas de contato pessoais do usuário. */
export async function crContactFolders(): Promise<ContactFoldersResult> {
  if (!inTauri()) {
    await sleep(300);
    return {
      folders: [
        { id: "folder-clientes", name: "Clientes", parentFolderId: "" },
        { id: "folder-fornecedores", name: "Fornecedores", parentFolderId: "" },
      ],
      missingScopes: [],
      failures: [],
    };
  }
  return invoke<ContactFoldersResult>("cr_contact_folders");
}

/** Contatos dentro de uma pasta pessoal (mesmo shape do crPeopleList). */
export async function crFolderContacts(
  folderId: string,
  nextLinks: string[] = [],
): Promise<PeopleListResult> {
  if (!inTauri()) {
    await sleep(400);
    // Contatos de pasta são contatos pessoais editáveis (source "contacts" →
    // ganham contactId, que habilita o "mover para pasta").
    const base = MOCK_DIRECTORY_RECORDS.map((record, i) => ({
      ...record,
      id: `${folderId}-c${i}`,
      source: "contacts" as const,
      emails: record.emails.map((email) => ({ ...email })),
      phones: record.phones.map((phone) => ({ ...phone })),
    }));
    const records =
      folderId === "folder-fornecedores" ? base.slice(0, 1) : base.slice(0, 2);
    return { records, missingScopes: [], failures: [], nextLinks: [] };
  }
  return invoke<PeopleListResult>("cr_pasta_contatos", { folderId, nextLinks });
}

/** Cria uma pasta de contatos pessoal; devolve a pasta criada (com id real). */
export async function crCreateContactFolder(nome: string): Promise<ContactFolder> {
  if (!inTauri()) {
    await sleep(300);
    return { id: `folder-${Date.now()}`, name: nome, parentFolderId: "" };
  }
  return invoke<ContactFolder>("cr_criar_pasta_contato", { nome });
}

/** Renomeia uma pasta de contatos pessoal. */
export async function crRenameContactFolder(
  folderId: string,
  nome: string,
): Promise<void> {
  if (!inTauri()) {
    await sleep(250);
    return;
  }
  await invoke("cr_renomear_pasta_contato", { folderId, nome });
}

/** Exclui uma pasta de contatos pessoal (os contatos dela vão junto). */
export async function crDeleteContactFolder(folderId: string): Promise<void> {
  if (!inTauri()) {
    await sleep(250);
    return;
  }
  await invoke("cr_excluir_pasta_contato", { folderId });
}

/** Move um contato pra outra pasta (PATCH parentFolderId; id do contato estável). */
export async function crMoveContact(
  contactId: string,
  folderId: string,
): Promise<void> {
  if (!inTauri()) {
    await sleep(250);
    return;
  }
  await invoke("cr_mover_contato", { contactId, folderId });
}

/** Busca sugestões revisáveis para um contato sem alterar nada. */
export async function crPeopleEnrichPreview(
  contactId: string | null,
  email: string,
  directoryUser = false,
): Promise<PeopleEnrichPreview> {
  if (!inTauri()) {
    await sleep(650);
    const readOnly = email.toLowerCase().includes("alan@");
    return {
      writeAvailable: Boolean(contactId) && !readOnly,
      failures: [],
      fields: readOnly
        ? [
            {
              key: "jobTitle",
              value: "Research Director",
              source: "people",
            },
            {
              key: "businessPhone",
              value: "+44 20 7946 0123",
              source: "directory",
              label: "work",
            },
            {
              key: "department",
              value: "Cryptanalysis",
              source: "directory",
            },
          ]
        : [
            {
              key: "department",
              value: "Product Research",
              source: "directory",
            },
            {
              key: "officeLocation",
              value: "London / 2.14",
              source: "directory",
            },
            {
              key: "manager",
              value: "Charles Babbage",
              source: "directory",
            },
          ],
    };
  }
  return invoke<PeopleEnrichPreview>("cr_people_enrich_preview", {
    contactId,
    email,
    directoryUser,
  });
}

/** Confirma no Graph apenas os campos aceitos no preview. */
export async function crPeopleEnrichApply(
  contactId: string,
  fields: PeopleEnrichField[],
): Promise<PeopleEnrichApplyResult> {
  if (!inTauri()) {
    await sleep(550);
    return { saved: true, writeAvailable: true };
  }
  return invoke<PeopleEnrichApplyResult>("cr_people_enrich_apply", {
    contactId,
    fields,
  });
}

/** Indica se o token atual permite alterar contatos do usuário. */
export async function crPeopleWriteAvailable(): Promise<boolean> {
  if (!inTauri()) {
    const { missingScopes } = await requiredScopesStatus();
    return !missingScopes.some(
      (scope) => scope.toLocaleLowerCase() === "contacts.readwrite",
    );
  }
  return invoke<boolean>("cr_people_write_available");
}

/**
 * #206 (Org Admin S1): o token carrega os escopos de settings org-wide? Gate do
 * painel Organization. Fora do Tauri, deriva do status de escopos (mock/dev).
 */
export async function crOrgAdminAvailable(): Promise<boolean> {
  if (!inTauri()) {
    const { missingScopes } = await requiredScopesStatus();
    return !missingScopes.some(
      (scope) =>
        scope.toLocaleLowerCase() === "orgsettings-appsandservices.read.all",
    );
  }
  return invoke<boolean>("cr_org_admin_available");
}

/** #425: status de um cartão OrgSettings — read-only, degrada por card. */
export type OrgCardStatus = "ok" | "forbidden" | "error";

export interface AppsAndServicesCard {
  status: OrgCardStatus;
  isOfficeStoreEnabled: boolean | null;
  isAppAndServicesTrialEnabled: boolean | null;
}

export interface FormsCard {
  status: OrgCardStatus;
  isExternalSendFormEnabled: boolean | null;
  isExternalShareCollaborationEnabled: boolean | null;
  isExternalShareResultEnabled: boolean | null;
  isExternalShareTemplateEnabled: boolean | null;
  isRecordIdentityByDefaultEnabled: boolean | null;
  isBingImageSearchEnabled: boolean | null;
  isInOrgFormsPhishingScanEnabled: boolean | null;
}

export interface M365AppsPlatform {
  isMicrosoft365AppsEnabled: boolean | null;
  isProjectEnabled: boolean | null;
  isSkypeForBusinessEnabled: boolean | null;
  isVisioEnabled: boolean | null;
}

export interface M365InstallCard {
  status: OrgCardStatus;
  updateChannel: string | null;
  appsForWindows: M365AppsPlatform | null;
  appsForMac: M365AppsPlatform | null;
}

/** #208: To Do org-wide (OrgSettings-Todo). */
export interface OrgTodoCard {
  status: OrgCardStatus;
  isPushNotificationEnabled: boolean | null;
  isExternalJoinEnabled: boolean | null;
  isExternalShareEnabled: boolean | null;
}

export interface OrgSettingsResult {
  appsAndServices: AppsAndServicesCard;
  forms: FormsCard;
  microsoft365Install: M365InstallCard;
  todo: OrgTodoCard;
}

/**
 * #425 (Org Admin S2): lê os cartões read-only de OrgSettings do tenant. Fora do
 * Tauri devolve um mock representativo pra visualizar o painel no dev/browser.
 */
export async function crOrgSettings(): Promise<OrgSettingsResult> {
  if (!inTauri()) {
    await sleep(400);
    return {
      appsAndServices: {
        status: "ok",
        isOfficeStoreEnabled: false,
        isAppAndServicesTrialEnabled: true,
      },
      forms: {
        status: "ok",
        isExternalSendFormEnabled: true,
        isExternalShareCollaborationEnabled: false,
        isExternalShareResultEnabled: false,
        isExternalShareTemplateEnabled: true,
        isRecordIdentityByDefaultEnabled: true,
        isBingImageSearchEnabled: true,
        isInOrgFormsPhishingScanEnabled: false,
      },
      microsoft365Install: {
        status: "ok",
        updateChannel: "current",
        appsForWindows: {
          isMicrosoft365AppsEnabled: true,
          isProjectEnabled: true,
          isSkypeForBusinessEnabled: false,
          isVisioEnabled: false,
        },
        appsForMac: {
          isMicrosoft365AppsEnabled: false,
          isProjectEnabled: null,
          isSkypeForBusinessEnabled: true,
          isVisioEnabled: null,
        },
      },
      todo: {
        status: "ok",
        isPushNotificationEnabled: true,
        isExternalJoinEnabled: false,
        isExternalShareEnabled: true,
      },
    };
  }
  return invoke<OrgSettingsResult>("cr_org_settings");
}

/**
 * #208 (RW): grava UMA setting org-wide de To Do (OrgSettings-Todo.ReadWrite.All).
 * ⚠️ O endpoint `/admin/todo` ainda não foi confirmado no tenant real — a UI mantém
 * a escrita TRAVADA (`TODO_RW_HABILITADO`) até o live-QA de admin validar. Este
 * wrapper fica pronto; ativar é só destravar a UI. Fora do Tauri é no-op (mock).
 */
export async function crOrgTodoSet(campo: string, valor: boolean): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  return invoke<void>("cr_org_todo_set", { campo, valor });
}

/** #207: app real do tenant (service principal lançável). */
export interface TenantApp {
  appId: string;
  displayName: string;
  url: string;
}

export interface TenantAppsResult {
  status: OrgCardStatus;
  apps: TenantApp[];
}

/**
 * #207 (Org Admin): apps reais do tenant pra a tela Apps complementar o catálogo
 * estático. Fora do Tauri devolve um mock representativo pra visualizar no dev.
 */
export async function crTenantApps(): Promise<TenantAppsResult> {
  if (!inTauri()) {
    await sleep(400);
    return {
      status: "ok",
      apps: [
        { appId: "m1", displayName: "Teams", url: "https://teams.microsoft.com/" },
        { appId: "m2", displayName: "Viva Engage", url: "https://engage.cloud.microsoft/" },
        {
          appId: "m3",
          displayName: "Power BI",
          url: "https://app.powerbi.com/",
        },
        {
          appId: "m4",
          displayName: "Contoso RH",
          url: "https://rh.contoso.com/",
        },
        {
          appId: "m5",
          displayName: "Salesforce",
          url: "https://login.salesforce.com/",
        },
      ],
    };
  }
  return invoke<TenantAppsResult>("cr_tenant_apps");
}

/** #541: logo do tenant (Entra branding) pro header do sidebar. Data URLs. */
export interface OrgBranding {
  /** Logo pra fundo claro — null se o tenant não configurou branding. */
  squareLogo: string | null;
  /** Logo pra fundo escuro — null se não configurado. */
  squareLogoDark: string | null;
}

let brandingCache: Promise<OrgBranding> | null = null;

/**
 * #541: logo do tenant (claro + escuro) do Entra branding. Memoizado — o
 * branding muda raramente, então busca uma vez por sessão. Fora do Tauri devolve
 * um logo de exemplo pra visualizar o header no dev.
 */
export function crOrgBranding(): Promise<OrgBranding> {
  brandingCache ??= (async () => {
    if (!inTauri()) {
      await sleep(300);
      const logo = (fundo: string) =>
        `data:image/svg+xml;utf8,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${fundo}"/><text x="16" y="23" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#fff" text-anchor="middle">V</text></svg>`
        )}`;
      // claro = marca escura sobre fundo claro; escuro = marca clara.
      return { squareLogo: logo("#2563eb"), squareLogoDark: logo("#60a5fa") };
    }
    return invoke<OrgBranding>("cr_org_branding");
  })();
  return brandingCache;
}

/**
 * #555 (P0): invalida o memo do branding pra o próximo `crOrgBranding` buscar o
 * logo do TENANT NOVO. Sem isto, a troca de conta herdava o logo do tenant
 * anterior (memo "1 fetch/sessão" que nunca resetava). Chamado no reset de sessão.
 */
export function invalidarBrandingCache(): void {
  brandingCache = null;
}

/**
 * #555 (P0): zera o memo curto do Graph no backend (Rust) na troca de conta.
 * No-op fora do Tauri. Chamado pelo seam de reset de sessão.
 */
export async function resetSessionMemo(): Promise<void> {
  if (!inTauri()) return;
  try {
    await invoke("reset_session_memo");
  } catch {
    // best-effort: o memo tem TTL de 2,5s de qualquer forma.
  }
}

/** #426: tenant membro de uma organização multi-tenant. */
export interface MultiTenantMember {
  tenantId: string;
  displayName: string;
  /** "owner" | "member" */
  role: string;
  /** "active" | "pending" | "removed" */
  state: string;
}

export interface MultiTenantCard {
  /** "ok" | "inactive" | "forbidden" | "error" */
  status: "ok" | "inactive" | OrgCardStatus;
  displayName: string | null;
  members: MultiTenantMember[];
}

/**
 * #426 (Org Admin S3): contexto multi-tenant da org (org + tenants membros).
 * Fora do Tauri devolve um mock representativo pra visualizar o cartão no dev.
 */
export async function crMultiTenant(): Promise<MultiTenantCard> {
  if (!inTauri()) {
    await sleep(400);
    return {
      status: "ok",
      displayName: "Voaz Group",
      members: [
        { tenantId: "1fd6544e", displayName: "Voaz Engenharia", role: "owner", state: "active" },
        { tenantId: "4a12efe6", displayName: "Voaz Builders", role: "member", state: "active" },
        { tenantId: "5036a0a0", displayName: "Voaz Labs", role: "member", state: "pending" },
      ],
    };
  }
  return invoke<MultiTenantCard>("cr_multi_tenant");
}

/** Atualiza, em uma única operação, os campos editáveis de um contato. */
export async function crPeopleContactUpdate(
  contactId: string,
  input: PeopleContactEdit,
): Promise<void> {
  if (!inTauri()) {
    await sleep(550);
    return;
  }
  return invoke<void>("cr_people_contact_update", { contactId, input });
}

/**
 * Atribui as categorias do Outlook a um contato (#278 S3b): PATCH parcial só do
 * campo `categories` — não mexe nos outros dados. `categorias` são os NOMES das
 * masterCategories (multi-valor). Serve pro detalhe e pro bulk.
 */
export async function crPeopleContactCategories(
  contactId: string,
  categorias: string[],
): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  return invoke<void>("cr_people_contact_categories", { contactId, categorias });
}

/**
 * Cria um contato completo (POST /me/contacts) e devolve o id do Graph criado.
 * Usado pelo Undo do merge (#379) pra recriar os absorvidos deletados — o
 * `crSalvarContatos` legado deduplica por email e não devolve id.
 */
export async function crPeopleContactCreate(
  input: PeopleContactEdit,
): Promise<string> {
  if (!inTauri()) {
    await sleep(400);
    return `mock-contact-${crypto.randomUUID()}`;
  }
  return invoke<string>("cr_people_contact_create", { input });
}

/**
 * Exclui um contato (DELETE /me/contacts/{id}); 404 conta como sucesso
 * (idempotente). Execução do merge (#379) — o chamador trata item a item.
 */
export async function crPeopleContactDelete(contactId: string): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  return invoke<void>("cr_people_contact_delete", { contactId });
}

/**
 * Grava `companyName` apenas nos contatos pessoais editáveis. O backend usa
 * `$batch` (20 por envelope) e devolve sucesso/falha por contato para rollback.
 */
export async function crPeopleCompanyWrite(
  contactIds: string[],
  companyName: string,
): Promise<PeopleCompanyWriteResult> {
  if (!inTauri()) {
    await sleep(550);
    return {
      writeAvailable: true,
      savedContactIds: [...new Set(contactIds)],
      failedContactIds: [],
    };
  }
  return invoke<PeopleCompanyWriteResult>("cr_people_company_write", {
    contactIds,
    companyName,
  });
}

/**
 * Grava campos seguros em contatos pessoais editáveis. O backend aplica as
 * mudanças via `$batch` e devolve sucesso/falha por contato para rollback.
 */
export async function crPeopleDetailsWrite(
  contactIds: string[],
  changes: PeopleBulkDetailsChange[],
): Promise<PeopleBulkDetailsWriteResult> {
  if (!inTauri()) {
    await sleep(550);
    return {
      writeAvailable: true,
      savedContactIds: [...new Set(contactIds)],
      failedContactIds: [],
    };
  }
  return invoke<PeopleBulkDetailsWriteResult>("cr_people_details_write", {
    contactIds,
    changes,
  });
}

/** Mensagens recentes diretamente relacionadas ao endereço selecionado. */
export async function crPeopleInteractions(
  email: string,
): Promise<PeopleInteraction[]> {
  if (!inTauri()) {
    await sleep(450);
    const now = Date.now();
    return [
      {
        id: `mock-${email}-1`,
        subject: "Project follow-up",
        occurredAt: new Date(now - 36e5).toISOString(),
        direction: "inbound",
      },
      {
        id: `mock-${email}-2`,
        subject: "Re: Project follow-up",
        occurredAt: new Date(now - 864e5).toISOString(),
        direction: "outbound",
      },
    ];
  }
  return invoke<PeopleInteraction[]>("cr_people_interactions", { email });
}

/**
 * Anexo pronto para enviar: nome do arquivo, MIME e o conteúdo já em base64.
 * É o que `ComporMensagemHandle.getAnexos()` devolve e o que os comandos de
 * envio recebem (fileAttachment do Graph).
 */
export interface AnexoEnvio {
  nome: string;
  tipo: string;
  conteudoB64: string;
}

/** Envia um e-mail novo (do zero), opcionalmente com anexos. */
export async function crEnviarNovo(
  para: string[],
  cc: string[],
  cco: string[],
  assunto: string,
  corpo: string,
  anexos: AnexoEnvio[] = [],
  mailbox?: string
): Promise<void> {
  if (!inTauri()) {
    await sleep(700);
    return;
  }
  return invoke<void>("cr_enviar_novo", {
    para,
    cc,
    cco,
    assunto,
    corpo,
    anexos,
    mailbox: mailboxArg(mailbox),
  });
}

/**
 * Sobe um arquivo para "Bridge Anexos" no OneDrive do usuário e devolve um link
 * de compartilhamento (visualização, escopo da organização). O front insere
 * esse link no corpo do e-mail. Files.ReadWrite.
 */
export async function crCompartilharOneDrive(
  nome: string,
  conteudoB64: string
): Promise<string> {
  if (!inTauri()) {
    await sleep(700);
    return `https://exemplo-my.sharepoint.com/:b:/g/mock/${encodeURIComponent(nome)}`;
  }
  return invoke<string>("cr_compartilhar_onedrive", { nome, conteudoB64 });
}

/** Salva contatos pessoais (sem duplicar). Retorna quantos foram criados. */
export async function crSalvarContatos(pessoas: Pessoa[]): Promise<number> {
  if (!inTauri()) {
    await sleep(400);
    return pessoas.length;
  }
  return invoke<number>("cr_salvar_contatos", { pessoas });
}

/** Chave de ordenação da lista (mapeada no backend para $orderby do Graph).
 *  Só campos ordenáveis server-side, sem dependência: tamanho/importância/flag
 *  saíram do escopo (não são ordenáveis no Graph / dependem de feature irmã). */
export type OrdenarMensagens = "data" | "remetente" | "assunto";

export async function crFolderMensagens(
  folderId: string,
  skip = 0,
  ordenar: OrdenarMensagens = "data",
  descendente = true,
  mailbox?: string
): Promise<EmailItem[]> {
  if (!inTauri()) {
    await sleep(400);
    if (skip >= 24) return []; // mock: acaba depois de algumas páginas
    const base = new Date();
    const t = (h: number) => new Date(base.getTime() - h * 3600_000).toISOString();
    const nomes = [
      "Marcus Lee",
      "Emma Wilson",
      "GitHub",
      "Stripe",
      "Alex Martin",
      "Vercel",
      "Jessica Brooks",
      "Linear",
    ];
    const itens: EmailItem[] = nomes.map((n, i) => ({
      id: `${folderId}-${skip}-${i}`,
      // Primeira página traz uma conversa realista de 3 mensagens para o QA
      // visual do #29. Demais itens seguem como conversas individuais.
      conversationId:
        skip === 0 && i < 3
          ? `${folderId}-conversation-planning`
          : `${folderId}-${skip}-${i}`,
      // Edm.Binary chega do Graph como Base64. Maior posição = mensagem mais
      // recente; i=0 é a linha mais nova no mock.
      conversationIndex:
        skip === 0 && i < 3
          ? ["AAM=", "AAI=", "AAE="][i]
          : "AAE=",
      assunto: [
        "Q4 Sprint planning — final agenda",
        "Re: Q4 Sprint planning — design review",
        "Re: Q4 Sprint planning — initial draft",
        "Payment received · $299 from Acme Corp",
        "Invoice #1024 · November services",
        "Deployment successful · reui.io/pro",
        "Following up on your Config 2024 talk",
        "Sprint review: 18 issues closed this week",
      ][i],
      de: n,
      deEmail: `${n.toLowerCase().replace(/\s+/g, ".")}@example.com`,
      iniciais: n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
      // Espalha 1 item por dia (24h) — dá datas variadas p/ exercitar o filtro
      // de intervalo de datas (#110) e os buckets de período (#30) no mock.
      recebido: t(i * 24),
      preview:
        "Hey team, sharing the draft for review. Let me know your thoughts before we finalize...",
      lido: i > 2,
      temAnexos: i === 0 || i === 4,
      // Uma resposta antiga da conversa principal está sinalizada: prova que o
      // fio inteiro sobe para Flagged sem ser rachado entre grupos (#29).
      sinalizado: i === 1 || i === 6,
    }));
    // Remetente UNIDIRECIONAL (#94): servidor/no-reply que só MANDA e-mail e nunca
    // é respondido. Abrir esta mensagem e clicar no nome prova que 1º/último
    // contato e frequência aparecem mesmo com enviados = 0 (o bug que o PO
    // reprovou). O id contém "server" → `crEmailCorpo` devolve este remetente.
    if (skip === 0) {
      itens.unshift({
        id: `${folderId}-${skip}-server`,
        conversationId: `${folderId}-server`,
        conversationIndex: "AAE=",
        assunto: "Relatório diário de backup — VOAZ",
        de: "VOAZ | SERVER",
        deEmail: "server@voaz.builders",
        iniciais: "VS",
        recebido: t(0),
        preview:
          "Backup concluído com sucesso às 03:00. Nenhuma ação necessária.",
        lido: true,
        temAnexos: false,
        sinalizado: false,
      });
    }
    return itens;
  }
  return invoke<EmailItem[]>("cr_folder_mensagens", {
    folderId,
    skip,
    ordenar,
    descendente,
    mailbox: mailboxArg(mailbox),
  });
}

export async function crResponder(
  id: string,
  corpo: string,
  todos: boolean,
  anexos: AnexoEnvio[] = [],
  mailbox?: string
): Promise<void> {
  if (!inTauri()) {
    await sleep(700);
    return;
  }
  return invoke<void>("cr_responder", {
    id,
    corpo,
    todos,
    anexos,
    mailbox: mailboxArg(mailbox),
  });
}

export async function crEncaminhar(
  id: string,
  corpo: string,
  para: string[],
  anexos: AnexoEnvio[] = [],
  mailbox?: string
): Promise<void> {
  if (!inTauri()) {
    await sleep(700);
    return;
  }
  return invoke<void>("cr_encaminhar", {
    id,
    corpo,
    para,
    anexos,
    mailbox: mailboxArg(mailbox),
  });
}

export async function crExcluirEmail(id: string, mailbox?: string): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  return invoke<void>("cr_excluir_email", { id, mailbox: mailboxArg(mailbox) });
}

/** Exclui vários e-mails em série (com retry no 429 no backend). Retorna os ids
 *  que foram realmente excluídos. */
export async function crExcluirEmails(
  ids: string[],
  permanente = false,
  mailbox?: string
): Promise<string[]> {
  if (!inTauri()) {
    await sleep(300);
    return ids;
  }
  return invoke<string[]>("cr_excluir_emails", {
    ids,
    permanente,
    mailbox: mailboxArg(mailbox),
  });
}

/** Move vários e-mails para uma pasta (#88), em série e com retry no 429 no
 *  backend. `destino` é o id da pasta — well-known ("archive", "junkemail"…) ou
 *  o id real de uma subpasta, do jeitinho que `crMailFolders`/`crSubpastas`
 *  devolvem. Retorna os ids que realmente saíram (o front reconcilia o
 *  otimista com isso). */
export async function crMoverEmails(
  ids: string[],
  destino: string,
  mailbox?: string
): Promise<string[]> {
  if (!inTauri()) {
    await sleep(300);
    return ids;
  }
  return invoke<string[]>("cr_mover_emails", {
    ids,
    destino,
    mailbox: mailboxArg(mailbox),
  });
}

export async function crMarcarEmail(
  id: string,
  sinalizado: boolean,
  mailbox?: string
): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  return invoke<void>("cr_marcar_email", {
    id,
    sinalizado,
    mailbox: mailboxArg(mailbox),
  });
}

/** Marca um e-mail como lido ou não lido (com retry no 429 no backend). */
export async function crMarcarLido(
  id: string,
  lido: boolean,
  mailbox?: string
): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  return invoke<void>("cr_marcar_lido", {
    id,
    lido,
    mailbox: mailboxArg(mailbox),
  });
}

/** Uma página de resultados de busca: os itens e a URL de continuação. */
export interface BuscaPagina {
  itens: EmailItem[];
  /** `@odata.nextLink` do Graph para pedir a próxima página; `null` na última. */
  proximo: string | null;
}

/**
 * Busca mensagens numa pasta pelo termo (busca no servidor, páginas de 50).
 *
 * Paginação por CONTINUAÇÃO: o $search do Graph não aceita $skip, então a
 * próxima página é pedida com o `nextLink` devolvido em `proximo`. Chame sem
 * `nextLink` para a 1ª página; passe `proximo` de volta para as seguintes. A
 * última página vem com `proximo: null`.
 */
export async function crBuscar(
  folderId: string,
  termo: string,
  nextLink?: string | null,
  mailbox?: string
): Promise<BuscaPagina> {
  if (!inTauri()) {
    await sleep(400);
    return { itens: [], proximo: null };
  }
  return invoke<BuscaPagina>("cr_buscar", {
    folderId,
    termo,
    nextLink,
    mailbox: mailboxArg(mailbox),
  });
}

/**
 * Filtra a pasta pelos filtros que EXIGEM o servidor ("tome" | "mentions" |
 * "invites") — os client-side (all/unread/flagged/files) são aplicados no
 * front sobre a lista carregada. Devolve a mesma `BuscaPagina` de `crBuscar`
 * (itens + `proximo` para continuação). Fora do Tauri (mock) devolve vazio.
 *
 * D6: "mentions"/"invites" podem não existir no tenant; nesse caso o backend
 * rejeita com um erro iniciado por "HTTP 400" para o chamador esconder a opção.
 */
export async function crFiltrar(
  folderId: string,
  filtro: string,
  nextLink?: string | null,
  mailbox?: string
): Promise<BuscaPagina> {
  if (!inTauri()) {
    await sleep(400);
    return { itens: [], proximo: null };
  }
  return invoke<BuscaPagina>("cr_filtrar", {
    folderId,
    filtro,
    nextLink,
    mailbox: mailboxArg(mailbox),
  });
}

/**
 * Conta na pasta inteira as mensagens que batem com um filtro ("flagged" |
 * "anexos"), via endpoint /$count do Graph. Fora do Tauri (mock) devolve 0.
 */
export async function crContar(
  folderId: string,
  filtro: string,
  mailbox?: string
): Promise<number> {
  if (!inTauri()) {
    await sleep(200);
    return 0;
  }
  return invoke<number>("cr_contar", {
    folderId,
    filtro,
    mailbox: mailboxArg(mailbox),
  });
}

/** Os dois contadores por-pasta das abas (Sinalizados / Com anexos). */
export interface Contadores {
  flagged: number;
  anexos: number;
}

/**
 * Conta os dois contadores por-pasta das abas (Sinalizados/Flagged e Com
 * anexos/Files) numa ÚNICA chamada — no backend é um `$batch` do Graph (1
 * request em vez de 2 `$count` separados), reduzindo a rajada de 429 na carga
 * inicial e na troca de pasta (#87). O contador de não lidos NÃO entra aqui: já
 * vem coalescido (1 request pra todas as pastas) em `crMailFolders` e carrega os
 * ajustes otimistas. Fora do Tauri (mock) devolve zeros.
 */
export async function crContadores(
  folderId: string,
  mailbox?: string
): Promise<Contadores> {
  if (!inTauri()) {
    await sleep(200);
    return { flagged: 0, anexos: 0 };
  }
  return invoke<Contadores>("cr_contadores", {
    folderId,
    mailbox: mailboxArg(mailbox),
  });
}

/**
 * Insights do remetente (#94): resumo do relacionamento com um endereço —
 * e-mails recebidos/enviados e data do 1º/último contato. Chamada LAZY: só
 * dispara quando o usuário abre o popover no leitor.
 *
 * Custo real (dentro do Tauri): até 4 chamadas Graph — ver
 * `graph::cr_insights_remetente`. Fora do Tauri devolve um mock coerente para o
 * QA visual: endereços de servidor ("server"/"mailer"/"newsletter"/…) simulam um
 * remetente UNIDIRECIONAL (903 recebidos, 0 enviados, mas COM 1º/último contato e
 * frequência — o caso do #94); "no-reply"/"microsoft"/"noreply" simulam PRIMEIRO
 * CONTATO (tudo zerado); os demais, um histórico plausível derivado do endereço.
 */
export async function crInsightsRemetente(
  endereco: string
): Promise<InsightsRemetente> {
  if (!inTauri()) {
    await sleep(500);
    const addr = (endereco || "").toLowerCase();
    const agora = Date.now();
    const iso = (dias: number) =>
      new Date(agora - dias * 86_400_000).toISOString();
    // Remetente UNIDIRECIONAL (servidor/no-reply que só MANDA e-mail; o usuário
    // nunca respondeu): muitos recebidos, ZERO enviados, mas COM 1º/último
    // contato e frequência. Prova o fix do #94 — antes só a contagem aparecia.
    if (/server|mailer|newsletter|notifica|daemon/.test(addr)) {
      return { recebidos: 903, enviados: 0, primeiro: iso(540), ultimo: iso(1) };
    }
    // Remetentes automáticos sem histórico: primeiro contato (estado vazio).
    if (/no-?reply|microsoft|noreply/.test(addr)) {
      return { recebidos: 0, enviados: 0, primeiro: null, ultimo: null };
    }
    // Histórico plausível e estável por endereço (hash simples do texto).
    let h = 0;
    for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
    const recebidos = 12 + (h % 180);
    const enviados = 3 + (h % 60);
    const diasPrimeiro = 200 + (h % 900); // ~7 meses a ~3 anos atrás
    const diasUltimo = h % 20; // até ~3 semanas atrás
    return {
      recebidos,
      enviados,
      primeiro: iso(diasPrimeiro),
      ultimo: iso(diasUltimo),
    };
  }
  return invoke<InsightsRemetente>("cr_insights_remetente", { endereco });
}

/**
 * Esvazia uma pasta (só faz sentido em Lixeira e Lixo Eletrônico): apaga cada
 * mensagem, paginando até a pasta ficar vazia. `folderId` aceita o nome
 * well-known ("deleteditems"/"junkemail") ou o id real. Devolve quantas saíram.
 */
export async function crEsvaziarPasta(
  folderId: string,
  mailbox?: string
): Promise<number> {
  if (!inTauri()) {
    await sleep(500);
    return 12;
  }
  return invoke<number>("cr_esvaziar_pasta", {
    folderId,
    mailbox: mailboxArg(mailbox),
  });
}

/**
 * Marca como lidas TODAS as mensagens não lidas de uma pasta (#89). Devolve
 * quantas foram marcadas (0 = a pasta já estava toda lida).
 */
export async function crMarcarPastaLida(
  folderId: string,
  mailbox?: string
): Promise<number> {
  if (!inTauri()) {
    await sleep(500);
    return 7;
  }
  return invoke<number>("cr_marcar_pasta_lida", {
    folderId,
    mailbox: mailboxArg(mailbox),
  });
}

// --- CRUD de pastas (#90) ---------------------------------------------------
// Só o menu de contexto de pasta CUSTOM oferece renomear/excluir/mover; "criar
// subpasta" vale também em inbox/archive. O backend aceita qualquer id — quem
// esconde as ações inválidas é a UI (decisão do PO na #71/S4).

/**
 * Cria uma subpasta dentro de `paiId` (well-known como "inbox"/"archive" ou o id
 * real de uma custom). Devolve a pasta criada. Nome duplicado estoura no Graph
 * (409) — a UI já barra antes, comparando com as irmãs conhecidas.
 */
export async function crCriarSubpasta(
  paiId: string,
  nome: string,
  mailbox?: string
): Promise<PastaEmail> {
  if (!inTauri()) {
    await sleep(400);
    return {
      id: `${paiId}-nova-${Date.now()}`,
      tipo: "child",
      nome,
      naoLidos: 0,
      total: 0,
      filhos: 0,
    };
  }
  return invoke<PastaEmail>("cr_criar_subpasta", {
    paiId,
    nome,
    mailbox: mailboxArg(mailbox),
  });
}

/** Renomeia uma pasta (#90). Devolve a pasta já com o nome novo. */
export async function crRenomearPasta(
  id: string,
  nome: string,
  mailbox?: string
): Promise<PastaEmail> {
  if (!inTauri()) {
    await sleep(400);
    return { id, tipo: "child", nome, naoLidos: 0, total: 0, filhos: 0 };
  }
  return invoke<PastaEmail>("cr_renomear_pasta", {
    id,
    nome,
    mailbox: mailboxArg(mailbox),
  });
}

/**
 * Exclui uma pasta (#90). Decisão do PO na #71/D3: é REVERSÍVEL — a pasta vai
 * para a Lixeira (`POST /move` com `destinationId:"deleteditems"`), não é
 * apagada de vez. Devolve `true` quando foi pra lixeira e `false` quando o move
 * não rolou e o backend caiu no fallback `DELETE` (aí sim definitivo) — a UI usa
 * isso pra escolher o texto do toast.
 */
export async function crExcluirPasta(
  id: string,
  mailbox?: string
): Promise<boolean> {
  if (!inTauri()) {
    await sleep(400);
    return true;
  }
  return invoke<boolean>("cr_excluir_pasta", {
    id,
    mailbox: mailboxArg(mailbox),
  });
}

/** Move uma pasta (com conteúdo e subpastas) para dentro de `novoPai` (#90). */
export async function crMoverPasta(
  id: string,
  novoPai: string,
  mailbox?: string
): Promise<PastaEmail> {
  if (!inTauri()) {
    await sleep(400);
    return { id, tipo: "child", nome: "Pasta", naoLidos: 0, total: 0, filhos: 0 };
  }
  return invoke<PastaEmail>("cr_mover_pasta", {
    id,
    novoPai,
    mailbox: mailboxArg(mailbox),
  });
}

/** Baixa um anexo para a pasta Downloads e devolve o caminho absoluto. */
export async function crBaixarAnexo(
  messageId: string,
  attachmentId: string,
  mailbox?: string
): Promise<string> {
  if (!inTauri()) {
    await sleep(600);
    return "C:/Users/voce/Downloads/exemplo.pdf";
  }
  return invoke<string>("cr_baixar_anexo", {
    messageId,
    attachmentId,
    mailbox: mailboxArg(mailbox),
  });
}

/**
 * Resultado de "Salvar como… .eml" (#637): caminhos gravados + falhas por item
 * (assunto + motivo). O front deriva o toast de sucesso a partir de `salvos`.
 */
export interface SalvarEmailResultado {
  /** Caminhos absolutos dos `.eml` gravados (um por e-mail bem-sucedido). */
  salvos: string[];
  /** Itens que falharam, com assunto e motivo legível. */
  falhas: { assunto: string; erro: string }[];
}

/**
 * Salva um ou vários e-mails como `.eml` (MIME íntegro do Graph via `$value`)
 * na `pasta` escolhida. Lote resiliente: a falha de um item não aborta os
 * demais — veja `resultado.falhas`. O nome do arquivo é o assunto sanitizado,
 * com sufixo ` (2)`… em caso de colisão (#637).
 */
export async function crSalvarEmailEml(
  ids: string[],
  pasta: string,
  mailbox?: string
): Promise<SalvarEmailResultado> {
  if (!inTauri()) {
    await sleep(600);
    return {
      salvos: ids.map(
        (_, i) => `${pasta}\\exemplo${i > 0 ? ` (${i + 1})` : ""}.eml`
      ),
      falhas: [],
    };
  }
  return invoke<SalvarEmailResultado>("cr_salvar_email_eml", {
    ids,
    pasta,
    mailbox: mailboxArg(mailbox),
  });
}

/**
 * Lê um anexo em memória (base64) para pré-visualização, sem gravar em
 * Downloads (#188). Só trata `fileAttachment`; item/reference vêm em fatias
 * posteriores do épico (#178 §5).
 */
export async function crLerAnexo(
  messageId: string,
  attachmentId: string,
  mailbox?: string
): Promise<AnexoConteudo> {
  if (!inTauri()) {
    await sleep(400);
    // "Exemplo de preview." em base64 (text/plain) para o modo dev.
    return {
      bytesB64: "RXhlbXBsbyBkZSBwcmV2aWV3Lg==",
      contentType: "text/plain",
      nome: "exemplo.txt",
    };
  }
  return invoke<AnexoConteudo>("cr_ler_anexo", {
    messageId,
    attachmentId,
    mailbox: mailboxArg(mailbox),
  });
}

/**
 * Path C (#190): converte um anexo Office para PDF em alta fidelidade via
 * OneDrive do usuário (upload temp → `?format=pdf` → cleanup). Devolve o PDF em
 * base64 para o pdf.js. Usa `Files.ReadWrite` (já concedido).
 */
export async function crAnexoParaPdf(
  messageId: string,
  attachmentId: string,
  mailbox?: string
): Promise<AnexoConteudo> {
  if (!inTauri()) {
    await sleep(700);
    // Conversão depende do Graph real; no dev exercita o caminho de erro/degrade.
    throw new Error("Conversão via Microsoft 365 indisponível no modo dev");
  }
  return invoke<AnexoConteudo>("cr_anexo_para_pdf", {
    messageId,
    attachmentId,
    mailbox: mailboxArg(mailbox),
  });
}

/**
 * Lê a mensagem embutida de um itemAttachment (e-mail encaminhado/.msg) para o
 * reader aninhado (#191).
 */
export async function crLerAnexoEmail(
  messageId: string,
  attachmentId: string,
  mailbox?: string
): Promise<EmailDetalhe> {
  if (!inTauri()) {
    await sleep(400);
    return {
      assunto: "Fwd: Proposta comercial (exemplo)",
      de: "Ana Souza",
      deEmail: "ana@exemplo.com",
      para: ["voce@galaxie.works"],
      cc: [],
      paraEmails: ["voce@galaxie.works"],
      ccEmails: [],
      recebido: "2026-08-01T10:00:00Z",
      corpo: "<p>Segue a proposta em anexo. Abraço,<br/>Ana</p>",
      corpoTipo: "html",
      anexos: [],
      webLink: "https://outlook.office365.com/mock",
    };
  }
  return invoke<EmailDetalhe>("cr_ler_anexo_email", {
    messageId,
    attachmentId,
    mailbox: mailboxArg(mailbox),
  });
}

/** Link de destino de um referenceAttachment (sem baixar bytes) (#191). */
export async function crAnexoLink(
  messageId: string,
  attachmentId: string,
  mailbox?: string
): Promise<string> {
  if (!inTauri()) {
    await sleep(300);
    return "https://exemplo-my.sharepoint.com/personal/doc.docx";
  }
  return invoke<string>("cr_anexo_link", {
    messageId,
    attachmentId,
    mailbox: mailboxArg(mailbox),
  });
}

// --- #636 (épico #635): "Salvar como…" (PDF) --------------------------------
// Comando POR FORMATO, mesma forma do `crSalvarEmailEml` (#637): `(ids, pasta,
// mailbox?)` → `SalvarEmailResultado`. O `.eml` (crSalvarEmailEml) e o PDF (real,
// #639) vivem aqui. O `.msg` foi descartado pelo PO (#638 cancelado → #651).
// Imprimir (#640) tem comando próprio (`cr_imprimir_email`, ShowPrintUI) — abaixo.

/** Salva N e-mails como PDF na pasta escolhida. (real: #639) */
export async function crSalvarEmailPdf(
  ids: string[],
  pasta: string,
  mailbox?: string
): Promise<SalvarEmailResultado> {
  if (!inTauri()) {
    await sleep(400);
    return { salvos: ids.map((_, i) => `${pasta}\\exemplo${i > 0 ? ` (${i + 1})` : ""}.pdf`), falhas: [] };
  }
  return invoke<SalvarEmailResultado>("cr_salvar_email_pdf", {
    ids,
    pasta,
    mailbox: mailboxArg(mailbox),
  });
}

/**
 * #640: abre o PREVIEW de impressão do Chromium (não o diálogo legado Win32) para
 * o e-mail em leitura. O backend (`cr_imprimir_email`) renderiza o e-mail numa
 * janela visível e chama `ICoreWebView2_16::ShowPrintUI(BROWSER)`. Escopo = 1
 * e-mail (o do leitor); `ids` mantém a forma da família salvar-como.
 */
export async function crImprimirEmail(
  ids: string[],
  mailbox?: string
): Promise<void> {
  if (!inTauri()) {
    await sleep(200);
    return; // no mock não há WebView2 — no-op
  }
  return invoke<void>("cr_imprimir_email", { ids, mailbox: mailboxArg(mailbox) });
}

/** Abre um arquivo local com o aplicativo padrao. */
export async function abrirCaminho(path: string): Promise<void> {
  if (!inTauri()) {
    // eslint-disable-next-line no-console
    console.log("[dev] abrir arquivo:", path);
    return;
  }
  return invoke<void>("abrir_caminho", { path });
}

/** Abre o Explorer com o arquivo selecionado. */
export async function revelarNoExplorer(path: string): Promise<void> {
  if (!inTauri()) {
    // eslint-disable-next-line no-console
    console.log("[dev] revelar no Explorer:", path);
    return;
  }
  return invoke<void>("revelar_no_explorer", { path });
}

export async function connectSite(site: Site): Promise<void> {
  if (!inTauri()) {
    await sleep(1000);
    return;
  }
  return invoke<void>("connect_site", {
    siteId: site.siteId,
    name: site.name,
    webUrl: site.webUrl,
  });
}

export async function disconnectSite(site: Site): Promise<void> {
  if (!inTauri()) {
    await sleep(700);
    return;
  }
  return invoke<void>("disconnect_site", { siteId: site.siteId });
}

export async function openInExplorer(name: string): Promise<void> {
  if (!inTauri()) {
    // eslint-disable-next-line no-console
    console.log("[dev] abrir no Explorer:", name);
    return;
  }
  return invoke<void>("open_in_explorer", { name });
}

/** Abre uma URL no navegador padrao (menu do usuario). */
export async function openUrl(url: string): Promise<void> {
  if (!inTauri()) {
    window.open(url, "_blank");
    return;
  }
  return invoke<void>("open_url", { url });
}

/** Abre um app do M365 numa janela interna do Toolbox. */
export async function abrirAppInterno(
  id: string,
  url: string,
  titulo: string
): Promise<void> {
  if (!inTauri()) {
    window.open(url, "_blank");
    return;
  }
  return invoke<void>("abrir_app_interno", { id, url, titulo });
}

export async function longPathsStatus(): Promise<boolean> {
  if (!inTauri()) return true;
  return invoke<boolean>("long_paths_status");
}

export async function enableLongPaths(): Promise<string> {
  if (!inTauri()) return "already";
  return invoke<string>("enable_long_paths");
}

// --- Favoritos do Navigator (#176) ----------------------------------------
// Importa favoritos do Chrome/Edge lendo SOMENTE o arquivo `Bookmarks` (JSON)
// via Rust `std::fs` — nunca `Login Data`/senhas. O comando devolve a arvore
// por navegador+perfil; o front mostra em `tree`, o usuario seleciona e aplica.

/** Um no da arvore importada: pasta (sem `url`, com `filhos`) ou link. */
export interface BookmarkNode {
  id: string;
  nome: string;
  url?: string;
  filhos: BookmarkNode[];
}

/** Favoritos de um perfil de um navegador. */
export interface BrowserBookmarks {
  navegador: "chrome" | "edge" | string;
  perfil: string;
  roots: BookmarkNode[];
}

/**
 * Resultado da importação automática com diagnóstico honesto (#176): distingue
 * "lido", "detectado mas bloqueado" (antivírus/EDR protegendo a pasta de perfil)
 * e "não instalado" — o front decide a mensagem e oferece import por arquivo HTML.
 */
export interface ImportarFavoritosResultado {
  navegadores: BrowserBookmarks[];
  /** Navegadores instalados (User Data existe): "chrome" | "edge". */
  detectados: string[];
  /** Detectados mas com o Bookmarks ilegível (acesso bloqueado). */
  bloqueados: string[];
}

const MOCK_BOOKMARKS: BrowserBookmarks[] = [
  {
    navegador: "chrome",
    perfil: "Default",
    roots: [
      {
        id: "bm-bar",
        nome: "Barra de favoritos",
        filhos: [
          { id: "bm-gh", nome: "GitHub", url: "https://github.com", filhos: [] },
          {
            id: "bm-work",
            nome: "Trabalho",
            filhos: [
              { id: "bm-o365", nome: "Microsoft 365", url: "https://www.office.com", filhos: [] },
              { id: "bm-sp", nome: "SharePoint", url: "https://voazeng.sharepoint.com", filhos: [] },
            ],
          },
        ],
      },
      {
        id: "bm-other",
        nome: "Outros favoritos",
        filhos: [
          { id: "bm-yt", nome: "YouTube", url: "https://www.youtube.com", filhos: [] },
        ],
      },
    ],
  },
  {
    navegador: "edge",
    perfil: "Default",
    roots: [
      {
        id: "bm-e-bar",
        nome: "Barra de favoritos",
        filhos: [
          { id: "bm-bing", nome: "Bing", url: "https://www.bing.com", filhos: [] },
        ],
      },
    ],
  },
];

/**
 * Importa favoritos do Chrome/Edge (#176). Leitura pura em Rust `std::fs` do
 * arquivo `Bookmarks`; jamais toca em `Login Data`/senhas. Fora do Tauri (mock)
 * devolve uma arvore de exemplo para o QA visual.
 */
export async function importBrowserBookmarks(): Promise<ImportarFavoritosResultado> {
  if (!inTauri()) {
    await sleep(400);
    return {
      navegadores: MOCK_BOOKMARKS.map((b) => ({ ...b })),
      detectados: ["chrome", "edge"],
      bloqueados: [],
    };
  }
  return invoke<ImportarFavoritosResultado>("import_browser_bookmarks");
}

/**
 * Favicon do PRÓPRIO domínio de uma URL (#276). O fetch HTTP acontece no Rust
 * (sem CORS, e só no site pedido — nunca serviço de terceiros, por privacidade).
 * Devolve um data URI pronto pra `<img src>`, ou `null`. Fora do Tauri: `null`.
 */
export async function fetchFavicon(url: string): Promise<string | null> {
  if (!inTauri()) return null;
  try {
    return (await invoke<string | null>("fetch_favicon", { url })) ?? null;
  } catch {
    return null;
  }
}

// --- Launch on startup (#123) --------------------------------------------
// Autostart do SO via tauri-plugin-autostart (comandos Rust finos). Fora do
// Tauri (mock) guarda o estado em memoria, so pra visualizar o toggle na UI.
let mockAutostart = false;

/** O app esta configurado para iniciar junto com o sistema? */
export async function autostartEnabled(): Promise<boolean> {
  if (!inTauri()) return mockAutostart;
  return invoke<boolean>("autostart_status");
}

/** Liga/desliga o autostart do SO. */
export async function setAutostartEnabled(enabled: boolean): Promise<void> {
  if (!inTauri()) {
    mockAutostart = enabled;
    return;
  }
  return invoke<void>("autostart_set", { enabled });
}

// --- Telemetria (#388, S2) --------------------------------------------------
// Fachada fina: o React manda só envelopes tipados; o Rust (TelemetryPolicy)
// carimba o contexto, aplica consent+denylist+sampling e enfileira. NADA vai
// pra rede antes do opt-in + transporte (S1). A telemetria NUNCA quebra o app.

/** Consentimento por categoria (default: tudo OFF). */
export interface TelemetryConsent {
  crash: boolean;
  diagnostico: boolean;
  analytics: boolean;
}

export type TelemetryCategoria = "crash" | "diagnostico" | "analytics";

/** Valor de atributo: só enum/bucket/inteiro/bool — nunca texto livre com PII. */
export type TelemetryValor =
  | { t: "enum"; v: string }
  | { t: "bucket"; v: string }
  | { t: "int"; v: number }
  | { t: "bool"; v: boolean };

export interface TelemetryEnvelope {
  categoria: TelemetryCategoria;
  evento: string;
  atributos?: Record<string, TelemetryValor>;
}

export interface TelemetryStatus {
  consent: TelemetryConsent;
  sessionId: string;
  queued: number;
  /** #389: há consent gravado? `false` = 1º run (default ON) → mostra o aviso. */
  configurado: boolean;
}

/** Envelope já carimbado e higienizado na fila (dump do inspetor DEV, #389).
 *  Campos em snake_case porque o Rust não renomeia (é interno/dev-only). */
export interface TelemetryEnvelopeCarimbado {
  schema_version: number;
  app_version: string;
  build_channel: string;
  os: string;
  arch: string;
  session_id: string;
  ts_unix: number;
  categoria: TelemetryCategoria;
  evento: string;
  atributos: Record<string, TelemetryValor>;
}

/** Emite um evento (fire-and-forget). Engole qualquer erro — telemetria não
 *  pode derrubar a UI. */
export async function telemetryTrack(envelope: TelemetryEnvelope): Promise<void> {
  if (!inTauri()) return;
  try {
    await invoke<void>("telemetry_track", { envelope });
  } catch {
    // best-effort
  }
}

/** Define o consentimento por categoria (chamado pela Consent UI do S3). */
export async function telemetrySetConsent(
  consent: TelemetryConsent,
): Promise<void> {
  if (!inTauri()) return;
  return invoke<void>("telemetry_set_consent", { consent });
}

/** Revoga tudo: consent OFF, apaga a fila local e reinicia o session-id. */
export async function telemetryRevoke(): Promise<void> {
  if (!inTauri()) return;
  return invoke<void>("telemetry_revoke");
}

/** Estado atual (consent + session-id efêmero + itens na fila). */
export async function telemetryStatus(): Promise<TelemetryStatus | null> {
  if (!inTauri()) return null;
  return invoke<TelemetryStatus>("telemetry_status");
}

/** Inspetor DEV (#389): envelopes já na fila (scrubbed). Vazio fora do Tauri e
 *  em builds de release (o backend só devolve dados em debug). */
export async function telemetryDebugDump(): Promise<
  TelemetryEnvelopeCarimbado[]
> {
  if (!inTauri()) return [];
  try {
    return await invoke<TelemetryEnvelopeCarimbado[]>("telemetry_debug_dump");
  } catch {
    return [];
  }
}

// --- Explorer de Arquivos (#676, épico #675) --------------------------------
// Fachada fina do backend FS read-only. Erros chegam tipados (FsError.code);
// fora do Tauri (mock) devolve uma árvore de exemplo pro QA visual da UI.

const MOCK_FS_ENTRIES: FsEntry[] = [
  {
    name: "Projetos",
    path: "C:\\Users\\Wagner\\Projetos",
    isDir: true,
    isSymlink: false,
    size: 0,
    modifiedMs: 1_722_000_000_000,
    createdMs: 1_700_000_000_000,
    extension: null,
    isHidden: false,
    isReadonly: false,
  },
  {
    name: "Documentos",
    path: "C:\\Users\\Wagner\\Documentos",
    isDir: true,
    isSymlink: false,
    size: 0,
    modifiedMs: 1_723_000_000_000,
    createdMs: 1_700_000_000_000,
    extension: null,
    isHidden: false,
    isReadonly: false,
  },
  {
    name: "relatorio.pdf",
    path: "C:\\Users\\Wagner\\relatorio.pdf",
    isDir: false,
    isSymlink: false,
    size: 348_112,
    modifiedMs: 1_723_500_000_000,
    createdMs: 1_721_000_000_000,
    extension: "pdf",
    isHidden: false,
    isReadonly: false,
  },
  {
    name: "notas.txt",
    path: "C:\\Users\\Wagner\\notas.txt",
    isDir: false,
    isSymlink: false,
    size: 1_204,
    modifiedMs: 1_724_000_000_000,
    createdMs: 1_722_000_000_000,
    extension: "txt",
    isHidden: false,
    isReadonly: false,
  },
];

const MOCK_DRIVES: DriveInfo[] = [
  {
    path: "C:\\",
    name: "Windows",
    kind: "fixed",
    fsName: "NTFS",
    totalSpace: 512_000_000_000,
    freeSpace: 128_000_000_000,
  },
  {
    path: "D:\\",
    name: "Dados",
    kind: "fixed",
    fsName: "NTFS",
    totalSpace: 1_000_000_000_000,
    freeSpace: 640_000_000_000,
  },
];

/** Lista um diretório, pastas-primeiro. Caminho primário pra pastas normais. */
export async function listarDir(path: string): Promise<FsEntry[]> {
  if (!inTauri()) {
    await sleep(120);
    return MOCK_FS_ENTRIES.map((e) => ({ ...e }));
  }
  return invoke<FsEntry[]>("fs_read_dir", { path });
}

/** Metadados de um único item (arquivo ou pasta). */
export async function statCaminho(path: string): Promise<FsEntry> {
  if (!inTauri()) {
    await sleep(60);
    return { ...MOCK_FS_ENTRIES[0], path };
  }
  return invoke<FsEntry>("fs_stat", { path });
}

/** Tamanho agregado (recursivo) de uma pasta. */
export async function tamanhoDir(path: string): Promise<DirSize> {
  if (!inTauri()) {
    await sleep(200);
    return { path, totalBytes: 12_345_678, fileCount: 42, dirCount: 7 };
  }
  return invoke<DirSize>("fs_dir_size", { path });
}

/** Drives montados com tipo, label e espaço. */
export async function listarDrives(): Promise<DriveInfo[]> {
  if (!inTauri()) {
    await sleep(80);
    return MOCK_DRIVES.map((d) => ({ ...d }));
  }
  return invoke<DriveInfo[]>("fs_list_drives");
}

/** Pastas de acesso rápido do SO (home/desktop/documentos/downloads). */
export async function dirsConhecidos(): Promise<FsEntry[]> {
  if (!inTauri()) {
    await sleep(60);
    return MOCK_FS_ENTRIES.filter((e) => e.isDir).map((e) => ({ ...e }));
  }
  return invoke<FsEntry[]>("fs_known_dirs");
}

/**
 * Thumbnail webp (data URI) gerado no backend (#736): pool rayon + fast-path EXIF
 * + downscale. NUNCA decodifica o arquivo original no DOM. `maxSize` = maior lado.
 */
export async function gerarThumbnail(
  path: string,
  maxSize = 256,
): Promise<ThumbRef> {
  if (!inTauri()) {
    await sleep(40);
    return { dataUri: "", width: maxSize, height: maxSize, source: "decode" };
  }
  return invoke<ThumbRef>("fs_thumbnail", { path, maxSize });
}

/**
 * Domain-claim (PS7 #700, slice 1): cria o desafio de posse de domínio (token +
 * registro a publicar). A checagem real da prova (DNS/well-known) é a slice 2.
 */
export async function iniciarVerificacaoDominio(
  dominio: string,
): Promise<DesafioDominio> {
  if (!inTauri()) {
    const token = "mock".padEnd(32, "0");
    return {
      dominio: dominio.trim().replace(/^@/, "").toLowerCase(),
      token,
      registro: `galaxie-verify=${token}`,
    };
  }
  return invoke<DesafioDominio>("dominio_iniciar_verificacao", { dominio });
}

/**
 * Domain-claim slice 2 (#700): verifica a posse lendo o TXT do domínio e
 * conferindo o `registro` (`galaxie-verify=<token>`). `true` = posse provada.
 */
export async function verificarDominio(
  dominio: string,
  registro: string,
): Promise<boolean> {
  if (!inTauri()) return false;
  return invoke<boolean>("dominio_verificar", { dominio, registro });
}

/** Ajusta os tetos do cache de thumbnail (#737): disco/memória em MB. */
export async function configurarCacheThumbnail(
  diskMb: number,
  memMb: number,
): Promise<void> {
  if (!inTauri()) return;
  await invoke("fs_thumb_cache_limits", { diskMb, memMb });
}

/** Métricas de perf do gerador de thumbnail (#740): hit-rate, geração, pool/caps. */
export async function obterMetricasThumbnail(): Promise<ThumbMetrics> {
  if (!inTauri()) {
    return {
      hitMem: 0, hitDisco: 0, geradas: 0, total: 0, hitRate: 0,
      genMedioMs: 0, poolThreads: 0, diskCapMb: 1024, memCapMb: 96, memBytes: 0,
    };
  }
  return invoke<ThumbMetrics>("fs_thumb_metrics");
}

/** Zera os contadores de métrica (baseline limpo antes de medir). */
export async function resetarMetricasThumbnail(): Promise<void> {
  if (!inTauri()) return;
  await invoke("fs_thumb_metrics_reset");
}

/** Revela o item no Explorer do Windows. */
export async function revelarCaminho(path: string): Promise<void> {
  if (!inTauri()) return;
  return invoke<void>("fs_reveal", { path });
}

/** Abre o item com o app padrão do Windows. */
export async function abrirCaminhoFs(path: string): Promise<void> {
  if (!inTauri()) return;
  return invoke<void>("fs_open", { path });
}

/**
 * #873: lê um arquivo LOCAL em memória (base64) para a pré-visualização do
 * Explorer — mesma forma do `crLerAnexo` (bytes em memória, sem handler de OS no
 * caminho de preview). `maxBytes` limita a leitura no backend (o front já corta
 * em 25 MB antes de chamar). Devolve `{ bytesB64, contentType, nome }` para
 * reusar os MESMOS decodificadores dos viewers (pdf/docx/xlsx/csv/imagem/mídia).
 *
 * Backend: comando NOVO `fs_read_file_bytes` (raia do Confucius) — ainda não
 * existe no `src-tauri`. Fora do Tauri (mock/dev) devolve um exemplo curto.
 */
export async function lerArquivoBytes(
  path: string,
  maxBytes?: number,
): Promise<AnexoConteudo> {
  if (!inTauri()) {
    await sleep(200);
    return {
      bytesB64: "RXhlbXBsbyBkZSBwcmV2aWV3Lg==",
      contentType: "text/plain",
      nome: path.split(/[\\/]/).pop() ?? path,
    };
  }
  return invoke<AnexoConteudo>("fs_read_file_bytes", { path, maxBytes });
}

/**
 * Stream de pasta gigante: registra o listener de `fs-dir-batch`, dispara o
 * comando e resolve com o total quando o backend sinaliza `done`. `onLote`
 * recebe cada lote (o último com `done: true`). Filtra pelo `path` pra suportar
 * duas listagens concorrentes. Sempre desliga o listener no fim.
 */
export async function listarDirStreamed(
  path: string,
  batch: number,
  onLote: (lote: FsDirBatch) => void,
): Promise<number> {
  if (!inTauri()) {
    await sleep(120);
    const entries = MOCK_FS_ENTRIES.map((e) => ({ ...e }));
    onLote({ path, entries, done: true });
    return entries.length;
  }
  const { listen } = await import("@tauri-apps/api/event");
  const desligar = await listen<FsDirBatch>("fs-dir-batch", (ev) => {
    if (ev.payload.path === path) onLote(ev.payload);
  });
  try {
    return await invoke<number>("fs_read_dir_streamed", { path, batch });
  } finally {
    desligar();
  }
}

// --- Mutações do Explorer (#679 S3) — delete → Lixeira é o padrão ------------
// Fora do Tauri (mock) são no-op (a UI é validada no app real). Erros tipados
// (FsError) chegam do backend.

/** Token interno que autoriza a exclusão PERMANENTE — o gate real é o
 *  Shift+confirmação na UI, que só então chama `excluirPermanente`. */
const TOKEN_EXCLUSAO_PERMANENTE = "galaxie-excluir-permanente";

/** Cria uma pasta nova (erra se já existe). */
export async function criarPasta(path: string): Promise<void> {
  if (!inTauri()) return;
  return invoke<void>("fs_create_dir", { path });
}

/** Cria um arquivo novo (erra se já existe); `contents` opcional. */
export async function criarArquivo(
  path: string,
  contents?: string,
): Promise<void> {
  if (!inTauri()) return;
  return invoke<void>("fs_create_file", { path, contents: contents ?? null });
}

/** Renomeia (mesma pasta) — conflito de nome barrado no backend. */
export async function renomear(from: string, to: string): Promise<void> {
  if (!inTauri()) return;
  return invoke<void>("fs_rename", { from, to });
}

/** Copia arquivo/pasta (recursivo). */
export async function copiar(from: string, to: string): Promise<void> {
  if (!inTauri()) return;
  return invoke<void>("fs_copy", { from, to });
}

/** Move (rename rápido; fallback copy+delete cross-volume). */
export async function mover(from: string, to: string): Promise<void> {
  if (!inTauri()) return;
  return invoke<void>("fs_move", { from, to });
}

/** Manda os itens pra Lixeira do SO (reversível). Padrão do delete. */
export async function paraLixeira(paths: string[]): Promise<void> {
  if (!inTauri()) return;
  return invoke<void>("fs_trash", { paths });
}

/** Apaga PERMANENTEMENTE (sem Lixeira). Só depois do Shift+confirmação na UI. */
export async function excluirPermanente(paths: string[]): Promise<void> {
  if (!inTauri()) return;
  return invoke<void>("fs_delete_permanent", {
    paths,
    confirmToken: TOKEN_EXCLUSAO_PERMANENTE,
  });
}

// --- Progresso + conflito + watcher (#680 S4) -------------------------------

/** Algoritmo de verificação pós-cópia (opt-in). `undefined` = cópia normal. */
export type VerifyAlg = "xxh3" | "blake3" | "sha256";

/**
 * Copia com progresso TURBO — devolve o `opId` (acompanhe via `onProgressoOp`).
 * O engine perfila os discos (SSD/HDD) e paraleliza o mix pequeno+grande.
 * `verify` liga a checagem de integridade por hash (mais lento).
 */
export async function copiarComProgresso(
  from: string,
  to: string,
  verify?: VerifyAlg,
): Promise<number> {
  if (!inTauri()) return 0;
  return invoke<number>("fs_copy_with_progress", { from, to, verify: verify ?? null });
}

/** Move com progresso (rename rápido; senão copy+delete turbo) — devolve o `opId`. */
export async function moverComProgresso(
  from: string,
  to: string,
  verify?: VerifyAlg,
): Promise<number> {
  if (!inTauri()) return 0;
  return invoke<number>("fs_move_with_progress", { from, to, verify: verify ?? null });
}

/**
 * #850 (fatia B): copia VÁRIAS origens pra `destDir` numa OP/plano só (modelo
 * TeraCopy). Prefira isto a N `copiarComProgresso` numa multi-seleção — enumera
 * tudo antes, é uma fase de cópia (mata o "2 pastas sequenciais") e o benchmark
 * (START/PROGRESS/END no log) é global. Devolve um único `opId`.
 */
export async function copiarVariasComProgresso(
  sources: string[],
  destDir: string,
  verify?: VerifyAlg,
): Promise<number> {
  if (!inTauri()) return 0;
  return invoke<number>("fs_copy_many_with_progress", {
    sources,
    destDir,
    verify: verify ?? null,
  });
}

/** #850 (fatia B): move VÁRIAS origens pra `destDir` numa op só. Devolve o `opId`. */
export async function moverVariasComProgresso(
  sources: string[],
  destDir: string,
  verify?: VerifyAlg,
): Promise<number> {
  if (!inTauri()) return 0;
  return invoke<number>("fs_move_many_with_progress", {
    sources,
    destDir,
    verify: verify ?? null,
  });
}

/** Cancela uma op de copy/move em andamento. */
export async function cancelarOp(opId: number): Promise<void> {
  if (!inTauri()) return;
  return invoke<void>("fs_cancel", { opId });
}

/** Conflitos de nome no destino, ANTES da op (pro diálogo de resolução). */
export async function checarConflitos(
  sources: string[],
  destDir: string,
): Promise<FsConflict[]> {
  if (!inTauri()) return [];
  return invoke<FsConflict[]>("fs_check_conflicts", { sources, destDir });
}

/** Assina o progresso das ops (`fs-op-progress`); devolve o unsubscribe. */
export async function onProgressoOp(
  cb: (p: FsOpProgress) => void,
): Promise<() => void> {
  if (!inTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<FsOpProgress>("fs-op-progress", (ev) => cb(ev.payload));
}

/**
 * Observa uma pasta e chama `cb` a cada mudança no disco (live refresh). O
 * listener é registrado ANTES do `fs_watch` e filtra pelo `watcherId`. `parar`
 * desliga o listener E solta o watcher no backend (sem vazar).
 */
export async function observarPasta(
  path: string,
  recursive: boolean,
  cb: (c: FsChange) => void,
): Promise<{ watcherId: number; parar: () => Promise<void> }> {
  if (!inTauri()) {
    return { watcherId: 0, parar: async () => {} };
  }
  const { listen } = await import("@tauri-apps/api/event");
  let watcherId = -1;
  const desligar = await listen<FsChange>("fs-change", (ev) => {
    if (ev.payload.watcherId === watcherId) cb(ev.payload);
  });
  watcherId = await invoke<number>("fs_watch", { path, recursive });
  return {
    watcherId,
    parar: async () => {
      desligar();
      await invoke<void>("fs_unwatch", { watcherId });
    },
  };
}
