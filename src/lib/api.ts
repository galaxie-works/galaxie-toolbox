import type {
  AppUser,
  CaixaEntrada,
  CategoriaCor,
  EmailDetalhe,
  EmailItem,
  EventoAgenda,
  EventoDetalhe,
  Identidade,
  PastaEmail,
  PastaOD,
  Pessoa,
  Reuniao,
  Site,
  Tarefa,
  TipoArquivo,
  UsoOneDrive,
} from "./types";

/** Estamos dentro do Tauri (webview do app) ou num browser comum (pnpm dev)? */
function inTauri(): boolean {
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
};

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
export async function login(email: string, idioma: string): Promise<AppUser> {
  if (!inTauri()) {
    await sleep(800);
    return { ...MOCK_USER, email };
  }
  return invoke<AppUser>("login", { email, idioma });
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
  if (!inTauri()) return;
  return invoke<void>("logout");
}

export async function currentAccount(): Promise<AppUser | null> {
  if (!inTauri()) return null;
  return invoke<AppUser | null>("current_account");
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

export async function crTarefas(): Promise<Tarefa[]> {
  if (!inTauri()) {
    await sleep(450);
    return [
      { titulo: "Revisar migração PROJ-H", lista: "Trabalho" },
      { titulo: "Ligar para o suporte MS", lista: "Trabalho" },
    ];
  }
  return invoke<Tarefa[]>("cr_tarefas");
}

// --- Agenda do dia + inbox do dia ----------------------------------------
const MOCK_PARTS = [
  { nome: "Ana Silva", email: "ana@voaz.com.br", iniciais: "AS", foto: null },
  { nome: "Bruno Costa", email: "bruno@voaz.com.br", iniciais: "BC", foto: null },
  { nome: "Carla Dias", email: "carla@voaz.com.br", iniciais: "CD", foto: null },
];

export async function crAgenda(inicio: string, fim: string): Promise<EventoAgenda[]> {
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
      },
      {
        id: "ev2",
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
      },
    ];
  }
  return invoke<EventoAgenda[]>("cr_agenda", { inicio, fim });
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
      corpo: "<p>Pauta: revisar orçamento de compras do trimestre e alinhar próximos passos.</p>",
      corpoTipo: "html",
      participantes: MOCK_PARTS,
      webLink: "https://outlook.office365.com/mock",
    };
  }
  return invoke<EventoDetalhe>("cr_evento_corpo", { id });
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

export async function crEmailCorpo(id: string): Promise<EmailDetalhe> {
  if (!inTauri()) {
    await sleep(300);
    return {
      assunto: "Aprovação pendente — compra PROH",
      de: "João Pereira",
      deEmail: "joao@proh.com.br",
      para: ["Wagner Consani"],
      cc: ["Financeiro VOAZ", "Ana Silva"],
      recebido: new Date().toISOString(),
      corpo: "<p>Oi Wagner,</p><p>Preciso da sua aprovação para seguir com o pedido de compra da PROH. Fico no aguardo.</p><p>Abraço,<br/>João</p>",
      corpoTipo: "html",
      anexos: [],
      webLink: "https://outlook.office365.com/mock",
    };
  }
  return invoke<EmailDetalhe>("cr_email_corpo", { id });
}

const MOCK_PASTAS: PastaEmail[] = [
  { id: "inbox", tipo: "inbox", nome: "Caixa de entrada", naoLidos: 3, total: 128, filhos: 1 },
  { id: "drafts", tipo: "drafts", nome: "Rascunhos", naoLidos: 0, total: 45, filhos: 0 },
  { id: "sentitems", tipo: "sentitems", nome: "Enviados", naoLidos: 0, total: 312, filhos: 0 },
  { id: "archive", tipo: "archive", nome: "Arquivo", naoLidos: 0, total: 12, filhos: 0 },
  { id: "junkemail", tipo: "junkemail", nome: "Lixo eletrônico", naoLidos: 3, total: 8, filhos: 0 },
  { id: "deleteditems", tipo: "deleteditems", nome: "Itens excluídos", naoLidos: 0, total: 34, filhos: 0 },
];

export async function crMailFolders(): Promise<PastaEmail[]> {
  if (!inTauri()) {
    await sleep(300);
    return MOCK_PASTAS.map((p) => ({ ...p }));
  }
  return invoke<PastaEmail[]>("cr_mail_folders");
}

/** Subpastas de uma pasta de e-mail (para a árvore de pastas). */
export async function crSubpastas(folderId: string): Promise<PastaEmail[]> {
  if (!inTauri()) {
    await sleep(300);
    return [
      { id: `${folderId}-sub1`, tipo: "child", nome: "Clientes", naoLidos: 2, total: 40, filhos: 0 },
    ];
  }
  return invoke<PastaEmail[]>("cr_subpastas", { folderId });
}

// --- Compositor de e-mail (pessoas, envio novo, contatos) -----------------
const MOCK_PESSOAS: Pessoa[] = [
  { nome: "Ana Silva", email: "ana@voaz.com.br" },
  { nome: "Bruno Costa", email: "bruno@voaz.com.br" },
  { nome: "Carla Dias", email: "carla@voaz.com.br" },
  { nome: "Wagner Consani", email: "wagner@voaz.builders" },
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
  anexos: AnexoEnvio[] = []
): Promise<void> {
  if (!inTauri()) {
    await sleep(700);
    return;
  }
  return invoke<void>("cr_enviar_novo", { para, cc, cco, assunto, corpo, anexos });
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
  descendente = true
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
    return nomes.map((n, i) => ({
      id: `${folderId}-${skip}-${i}`,
      assunto: [
        "Q4 Sprint planning, your input needed",
        "Partnership proposal · ReUI integration",
        "[keenthemes] Security advisory on rollup",
        "Payment received · $299 from Acme Corp",
        "Invoice #1024 · November services",
        "Deployment successful · reui.io/pro",
        "Following up on your Config 2024 talk",
        "Sprint review: 18 issues closed this week",
      ][i],
      de: n,
      deEmail: `${n.toLowerCase().replace(/\s+/g, ".")}@example.com`,
      iniciais: n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
      recebido: t(i * 5),
      preview:
        "Hey team, sharing the draft for review. Let me know your thoughts before we finalize...",
      lido: i > 2,
      temAnexos: i === 0 || i === 4,
      sinalizado: i === 6,
    }));
  }
  return invoke<EmailItem[]>("cr_folder_mensagens", {
    folderId,
    skip,
    ordenar,
    descendente,
  });
}

export async function crResponder(
  id: string,
  corpo: string,
  todos: boolean,
  anexos: AnexoEnvio[] = []
): Promise<void> {
  if (!inTauri()) {
    await sleep(700);
    return;
  }
  return invoke<void>("cr_responder", { id, corpo, todos, anexos });
}

export async function crEncaminhar(
  id: string,
  corpo: string,
  para: string[],
  anexos: AnexoEnvio[] = []
): Promise<void> {
  if (!inTauri()) {
    await sleep(700);
    return;
  }
  return invoke<void>("cr_encaminhar", { id, corpo, para, anexos });
}

export async function crExcluirEmail(id: string): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  return invoke<void>("cr_excluir_email", { id });
}

/** Exclui vários e-mails em série (com retry no 429 no backend). Retorna os ids
 *  que foram realmente excluídos. */
export async function crExcluirEmails(
  ids: string[],
  permanente = false
): Promise<string[]> {
  if (!inTauri()) {
    await sleep(300);
    return ids;
  }
  return invoke<string[]>("cr_excluir_emails", { ids, permanente });
}

/** Move vários e-mails para uma pasta (#88), em série e com retry no 429 no
 *  backend. `destino` é o id da pasta — well-known ("archive", "junkemail"…) ou
 *  o id real de uma subpasta, do jeitinho que `crMailFolders`/`crSubpastas`
 *  devolvem. Retorna os ids que realmente saíram (o front reconcilia o
 *  otimista com isso). */
export async function crMoverEmails(
  ids: string[],
  destino: string
): Promise<string[]> {
  if (!inTauri()) {
    await sleep(300);
    return ids;
  }
  return invoke<string[]>("cr_mover_emails", { ids, destino });
}

export async function crMarcarEmail(
  id: string,
  sinalizado: boolean
): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  return invoke<void>("cr_marcar_email", { id, sinalizado });
}

/** Marca um e-mail como lido ou não lido (com retry no 429 no backend). */
export async function crMarcarLido(id: string, lido: boolean): Promise<void> {
  if (!inTauri()) {
    await sleep(300);
    return;
  }
  return invoke<void>("cr_marcar_lido", { id, lido });
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
  nextLink?: string | null
): Promise<BuscaPagina> {
  if (!inTauri()) {
    await sleep(400);
    return { itens: [], proximo: null };
  }
  return invoke<BuscaPagina>("cr_buscar", { folderId, termo, nextLink });
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
  nextLink?: string | null
): Promise<BuscaPagina> {
  if (!inTauri()) {
    await sleep(400);
    return { itens: [], proximo: null };
  }
  return invoke<BuscaPagina>("cr_filtrar", { folderId, filtro, nextLink });
}

/**
 * Conta na pasta inteira as mensagens que batem com um filtro ("flagged" |
 * "anexos"), via endpoint /$count do Graph. Fora do Tauri (mock) devolve 0.
 */
export async function crContar(folderId: string, filtro: string): Promise<number> {
  if (!inTauri()) {
    await sleep(200);
    return 0;
  }
  return invoke<number>("cr_contar", { folderId, filtro });
}

/**
 * Esvazia uma pasta (só faz sentido em Lixeira e Lixo Eletrônico): apaga cada
 * mensagem, paginando até a pasta ficar vazia. `folderId` aceita o nome
 * well-known ("deleteditems"/"junkemail") ou o id real. Devolve quantas saíram.
 */
export async function crEsvaziarPasta(folderId: string): Promise<number> {
  if (!inTauri()) {
    await sleep(500);
    return 12;
  }
  return invoke<number>("cr_esvaziar_pasta", { folderId });
}

/**
 * Marca como lidas TODAS as mensagens não lidas de uma pasta (#89). Devolve
 * quantas foram marcadas (0 = a pasta já estava toda lida).
 */
export async function crMarcarPastaLida(folderId: string): Promise<number> {
  if (!inTauri()) {
    await sleep(500);
    return 7;
  }
  return invoke<number>("cr_marcar_pasta_lida", { folderId });
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
  nome: string
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
  return invoke<PastaEmail>("cr_criar_subpasta", { paiId, nome });
}

/** Renomeia uma pasta (#90). Devolve a pasta já com o nome novo. */
export async function crRenomearPasta(
  id: string,
  nome: string
): Promise<PastaEmail> {
  if (!inTauri()) {
    await sleep(400);
    return { id, tipo: "child", nome, naoLidos: 0, total: 0, filhos: 0 };
  }
  return invoke<PastaEmail>("cr_renomear_pasta", { id, nome });
}

/**
 * Exclui uma pasta (#90). Decisão do PO na #71/D3: é REVERSÍVEL — a pasta vai
 * para a Lixeira (`POST /move` com `destinationId:"deleteditems"`), não é
 * apagada de vez. Devolve `true` quando foi pra lixeira e `false` quando o move
 * não rolou e o backend caiu no fallback `DELETE` (aí sim definitivo) — a UI usa
 * isso pra escolher o texto do toast.
 */
export async function crExcluirPasta(id: string): Promise<boolean> {
  if (!inTauri()) {
    await sleep(400);
    return true;
  }
  return invoke<boolean>("cr_excluir_pasta", { id });
}

/** Move uma pasta (com conteúdo e subpastas) para dentro de `novoPai` (#90). */
export async function crMoverPasta(
  id: string,
  novoPai: string
): Promise<PastaEmail> {
  if (!inTauri()) {
    await sleep(400);
    return { id, tipo: "child", nome: "Pasta", naoLidos: 0, total: 0, filhos: 0 };
  }
  return invoke<PastaEmail>("cr_mover_pasta", { id, novoPai });
}

/** Baixa um anexo para a pasta Downloads e devolve o caminho absoluto. */
export async function crBaixarAnexo(
  messageId: string,
  attachmentId: string
): Promise<string> {
  if (!inTauri()) {
    await sleep(600);
    return "C:/Users/voce/Downloads/exemplo.pdf";
  }
  return invoke<string>("cr_baixar_anexo", { messageId, attachmentId });
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
