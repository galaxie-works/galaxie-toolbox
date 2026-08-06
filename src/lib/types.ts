export type SiteStatus =
  | "connected" // atalho ja no OneDrive do usuario
  | "available" // tem acesso, ainda nao conectado
  | "connecting" // criando o atalho agora
  | "noaccess"; // sem permissao

export interface Site {
  key: string; // codigo curto do site (PROJ, ADM...)
  name: string; // nome de exibicao / nome do atalho (limpo, curto)
  status: SiteStatus;
  description?: string; // descricao do site no SharePoint (costuma vir vazia)
  siteId?: string; // id composto do Graph (hostname,siteGuid,webGuid)
  webUrl?: string; // home do site (usada para criar o atalho)
  // Preenchidos depois da lista, um site por vez (ver SiteDetalhes no Rust).
  // files/folders sao aproximados: vem do indice de busca do SharePoint.
  libraryUrl?: string; // endereco da biblioteca em si — e para ca que mandamos
  /** Sem numero + "carregando" = spinner; sem numero + "pronto" = nao veio. */
  detalhes?: "carregando" | "pronto";
  bytes?: number;
  folders?: number;
  files?: number;
}

export interface AppUser {
  displayName: string;
  email: string;
  initials: string;
  /** Foto do perfil (data URI). Ausente = usa as iniciais. */
  photo?: string | null;
  /** Nome da organizacao, exibido no topo da sidebar. */
  organizacao?: string | null;
}

/** Identidade em cache, usada na tela de carregamento (sem rede). */
export interface Identidade {
  displayName: string;
  initials: string;
  photo?: string | null;
}

/** Pasta de primeiro nivel do OneDrive do usuario (aba "My files"). */
export interface PastaOD {
  id: string;
  name: string;
  bytes: number; // recursivo, exato
  webUrl: string;
  childCount: number; // filhos imediatos
  // folders/files sao recursivos e APROXIMADOS (indice de busca), como no
  // SharePoint. Buscados depois da lista, pasta por pasta.
  detalhes?: "carregando" | "pronto";
  folders?: number;
  files?: number;
}

/** Uso do OneDrive: usado x limite. */
export interface UsoOneDrive {
  used: number;
  total: number;
  webUrl: string;
}

/** Tipo de arquivo com contagem (nao peso — ver graph::onedrive_tipos). */
export interface TipoArquivo {
  tipo: string;
  quantidade: number;
}

// --- Control room (dashboard) --------------------------------------------
export interface Reuniao {
  assunto: string;
  inicio: string; // ISO UTC (sem Z; o front adiciona)
  fim: string;
  local: string;
  online: boolean;
}

export interface EmailRecente {
  assunto: string;
  de: string;
  recebido: string;
}

export interface CaixaEntrada {
  naoLidos: number;
  recentes: EmailRecente[];
}

export interface Tarefa {
  titulo: string;
  lista: string;
  // #184 (Atoms S2): ids pra concluir in-place + prazo (ISO) pro score.
  id: string;
  listaId: string;
  prazo?: string | null;
}

// --- Agenda do dia + inbox do dia (Control room rico) --------------------
export interface Participante {
  nome: string;
  email: string;
  iniciais: string;
  foto?: string | null;
}

/**
 * Semântica de resposta a um convite (#287) — espelha `responseStatus.response`
 * do Graph. `organizer` = evento próprio (sem RSVP); `notResponded`/`none` =
 * pendente; `tentativelyAccepted` = talvez; `accepted`/`declined` = decididos.
 */
export type RespostaConvite =
  | "none"
  | "organizer"
  | "tentativelyAccepted"
  | "accepted"
  | "declined"
  | "notResponded";

/** Ação de RSVP enviada ao backend (#287): mapeia 1:1 aos endpoints do Graph. */
export type AcaoRsvp = "accept" | "tentativelyAccept" | "decline";

export interface EventoAgenda {
  id: string;
  assunto: string;
  inicio: string; // ISO UTC
  fim: string;
  local: string;
  online: boolean;
  diaInteiro: boolean;
  categoria: "meeting" | "event";
  participantes: Participante[];
  totalParticipantes: number;
  temAnexos: boolean;
  categorias: string[];
  /** Semântica do convite (#287): estado da resposta do usuário ao evento. */
  resposta: RespostaConvite;
  /** True quando o usuário organiza o evento (Graph `isOrganizer`) — sem RSVP. */
  souOrganizador: boolean;
  /** E-mail do organizador (#570): habilita o avatar do organizador no chip
   *  (day/week). Aditivo, igual ao `organizadorEmail` do EventoDetalhe (#515). */
  organizadorEmail: string;
  /** Graph `responseRequested`: false = convite informativo (sem pedir RSVP). */
  respostaSolicitada: boolean;
  /** Id do calendário de origem (#233). Marcado no front ao mesclar múltiplos
   *  calendários; ausente quando vindo do calendário padrão (/me/calendarView). */
  calendarioId?: string;
  /** Cor (hex) do calendário de origem (#233), aplicada ao evento no merge. */
  corCalendario?: string;
  /** Graph `type` (#397): "singleInstance" | "occurrence" | "exception" |
   *  "seriesMaster". Occurrence/exception/seriesMaster = recorrente. */
  tipo: string;
  /** Graph `seriesMasterId` (#397): id da série mãe (ocorrências/exceções). */
  seriesMasterId?: string;
}

export interface CategoriaCor {
  nome: string;
  cor: string;
}

/** Um calendário do usuário (#233) — /me/calendars. */
export interface Calendario {
  id: string;
  nome: string;
  cor: string; // hex (#RRGGBB)
  isDefaultCalendar: boolean;
  canEdit: boolean;
}

/**
 * Dados de escrita de um evento (criar/editar) — #211. `inicio`/`fim` são
 * hora-de-parede local (ISO sem Z, ex. "2026-07-30T09:00:00"); `timeZone` é o
 * IANA local. Assim o Graph interpreta o horário no fuso certo tanto para
 * eventos com hora quanto para dia inteiro (que exige meia-noite no fuso).
 */
/** Convidado de um evento (#211): endereço + nome, vira um `attendees[]`. */
export interface ConvidadoInput {
  email: string;
  nome: string;
}

/** Frequência da recorrência (#396). */
export type RecorrenciaFrequencia = "daily" | "weekly" | "monthly" | "yearly";
/** Como a série termina (#396). */
export type RecorrenciaFim = "noEnd" | "endDate" | "numbered";
/** Dia da semana no formato do Graph (só weekly). */
export type DiaSemana =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

/**
 * Recorrência de um evento (#396, S1). Modelo do app; o Rust traduz pro
 * `recurrence` do Graph (pattern + range).
 */
export interface RecorrenciaInput {
  frequencia: RecorrenciaFrequencia;
  intervalo: number;
  /** Só weekly. */
  diasSemana: DiaSemana[];
  /** Monthly/yearly: dia do mês (1..31). */
  diaDoMes?: number;
  /** Yearly: mês (1..12). */
  mes?: number;
  fimTipo: RecorrenciaFim;
  /** Início da série (YYYY-MM-DD). */
  dataInicio: string;
  dataFim?: string;
  numeroOcorrencias?: number;
}

export interface EventoInput {
  assunto: string;
  inicio: string; // hora local, sem Z
  fim: string; // hora local, sem Z
  diaInteiro: boolean;
  local: string;
  corpo: string;
  categorias: string[];
  timeZone: string; // IANA (ex. "America/Sao_Paulo")
  /** Convidados (#211): cada um vira attendee `required` no payload Graph. */
  convidados: ConvidadoInput[];
  /** Reunião do Teams (#211): liga isOnlineMeeting + teamsForBusiness. */
  reuniaoTeams: boolean;
  /** Calendário-alvo (#233). Ausente/"" = calendário padrão (/me/events). */
  calendarioId?: string;
  /** Recorrência (#396). Ausente = evento único. */
  recorrencia?: RecorrenciaInput;
  /** #397: PATCH só de campos (sem start/end/recurrence) — "editar a série". */
  somenteCampos?: boolean;
}

export interface EventoDetalhe {
  assunto: string;
  inicio: string;
  fim: string;
  local: string;
  online: boolean;
  joinUrl?: string | null;
  organizador: string;
  /** E-mail do organizador (Graph `organizer.emailAddress.address`). Aditivo
   *  (#515): habilita o `PersonHoverCard` no organizador do detalhe. */
  organizadorEmail: string;
  /** True quando o usuário ativo organiza o evento (Graph `isOrganizer`).
   *  Habilita a ação "Cancelar evento" (#260), que notifica os convidados. */
  souOrganizador: boolean;
  /** Semântica do convite (#287): estado da resposta do usuário — habilita o
   *  RSVP (Aceitar/Talvez/Recusar) e o badge de estado no detalhe. */
  resposta: RespostaConvite;
  /** Graph `responseRequested`: false = convite informativo (sem RSVP). */
  respostaSolicitada: boolean;
  corpo: string;
  corpoTipo: "html" | "text";
  participantes: Participante[];
  webLink: string;
}

export interface EmailItem {
  id: string;
  /** Identificador da conversa no Microsoft Graph. Ausente em dados legados. */
  conversationId?: string | null;
  /** Posição binária Base64 da mensagem dentro da conversa no Graph. */
  conversationIndex?: string | null;
  assunto: string;
  de: string;
  deEmail: string;
  iniciais: string;
  recebido: string; // ISO UTC
  preview: string;
  lido: boolean;
  temAnexos: boolean;
  sinalizado: boolean;
  /** Foto (data URI) do remetente interno, resolvida pelo cache de fotos (#39).
   *  Ausente/null = usa as iniciais (AvatarFallback). */
  foto?: string | null;
}

export interface AnexoEmail {
  id: string;
  nome: string;
  tamanho: number;
  /** MIME do anexo (`contentType` do Graph). Vazio quando não informado. */
  contentType: string;
  /**
   * `@odata.type` do anexo: `#microsoft.graph.fileAttachment` /
   * `itemAttachment` / `referenceAttachment`. Roteia o renderer (#178 §5).
   */
  odataType: string;
  /** Anexo inline (embutido no corpo) vs. anexo real. */
  isInline: boolean;
}

/** Conteúdo de um anexo lido em memória para preview (#188). */
export interface AnexoConteudo {
  /** Bytes do anexo em base64 (repassados do `contentBytes` do Graph). */
  bytesB64: string;
  /** MIME informado pelo Graph (ou vazio). */
  contentType: string;
  nome: string;
}

export interface EmailDetalhe {
  assunto: string;
  de: string;
  deEmail: string;
  para: string[];
  cc: string[];
  /** E-mails dos destinatários, alinhados 1:1 com `para`/`cc` (#515) — pro hover
   *  card por pessoa. Podem vir "" (recipient só com nome); o front cai em texto. */
  paraEmails: string[];
  ccEmails: string[];
  recebido: string;
  corpo: string;
  corpoTipo: "html" | "text";
  anexos: AnexoEmail[];
  webLink: string;
}

/**
 * Dados de segurança de um e-mail (#91): Reply-To + headers de autenticação
 * brutos. O parse de SPF/DKIM/DMARC e a detecção de divergência ficam no helper
 * `seguranca-leitor.ts` (testável). Buscado à parte do corpo (best-effort).
 */
export interface SegurancaEmail {
  /** Endereços de Reply-To (para detectar divergência do From). */
  replyTo: { nome: string; email: string }[];
  /** Valores dos headers `Authentication-Results` / `ARC-Authentication-Results`. */
  autenticacao: string[];
  /** Valores de `Received-SPF` (fallback de SPF). */
  receivedSpf: string[];
}

export interface PastaEmail {
  id: string;
  tipo: string; // "inbox" | "drafts" | "sentitems" | "archive" | "junkemail" | "deleteditems" | "child"
  nome: string;
  naoLidos: number;
  total: number;
  filhos: number; // nº de subpastas — chevron de expandir só aparece quando > 0
  /** 403 apenas nesta pasta de uma caixa compartilhada; a árvore segue utilizável. */
  acessoNegado?: boolean;
}

/**
 * Insights do remetente (#94): resumo do relacionamento com um endereço,
 * mostrado no popover do leitor. Todos os campos são opcionais — cada parte é
 * buscada de forma best-effort no backend e pode faltar sem quebrar o painel.
 */
export interface InsightsRemetente {
  /** Nº de e-mails recebidos deste endereço (filtro por `from`). */
  recebidos?: number | null;
  /** Nº de e-mails enviados a este endereço. Ausente = não foi possível contar. */
  enviados?: number | null;
  /** ISO do e-mail recebido mais antigo (1º contato). */
  primeiro?: string | null;
  /** ISO do e-mail recebido mais recente (último contato). */
  ultimo?: string | null;
}

/** Seção do autocomplete de destinatários (#40): de onde a sugestão veio. */
export type OrigemPessoa = "contatos" | "organizacao";

/** Pessoa sugerida no autocomplete do compositor de e-mail. */
export interface Pessoa {
  nome: string;
  email: string;
  /** Cargo (`jobTitle`) exibido como 2ª linha da sugestão. Pode faltar. */
  cargo?: string | null;
  /** `contatos` = /me/people · `organizacao` = diretório (/users). Ausente em
   *  endereço digitado à mão e nos contatos que o front manda pro backend. */
  origem?: OrigemPessoa | null;
  /** Foto (data URI) do contato interno, resolvida pelo cache de fotos (#39).
   *  Ausente/null = usa as iniciais (AvatarFallback). */
  foto?: string | null;
}

/** Fonte original de um registro entregue pelo Graph ao módulo People. */
export type PeopleSource = "contacts" | "people" | "directory";
export type PeopleEnrichSource = PeopleSource;
export type PeopleEnrichFieldKey =
  | "photo"
  | "email"
  | "businessPhone"
  | "mobilePhone"
  | "jobTitle"
  | "companyName"
  | "department"
  | "officeLocation"
  | "manager";

export interface PeopleEmail {
  address: string;
  label?: string | null;
  source?: PeopleEnrichSource;
}

export interface PeoplePhone {
  number: string;
  label: string;
  source?: PeopleEnrichSource;
}

/** Registro ainda não deduplicado, exatamente como veio de uma das fontes. */
export interface PeopleRecord {
  id: string;
  source: PeopleSource;
  name: string;
  emails: PeopleEmail[];
  phones: PeoplePhone[];
  jobTitle?: string | null;
  company?: string | null;
  department?: string | null;
  officeLocation?: string | null;
  manager?: string | null;
  organization: boolean;
  /** Posição em `/me/people`; os dez primeiros são "Frequent". */
  peopleRank?: number | null;
  /** Categorias do Outlook (#406); só `source==="contacts"`. */
  categories?: string[];
}

/** Resultado parcial: uma fonte pode falhar sem apagar a outra. */
export interface PeopleListResult {
  records: PeopleRecord[];
  missingScopes: string[];
  failures: string[];
  /** Continuações opacas devolvidas pelo Graph para Contacts e People. */
  nextLinks: string[];
}

/** Organização canônica do tenant atual, separada das organizações do app. */
export interface PeopleTenantOrganization {
  id: string;
  name: string;
}

export interface PeopleOrganizationResult {
  organization?: PeopleTenantOrganization | null;
  missingScopes: string[];
  failures: string[];
}

/** Snapshot completo e paginado no backend dos usuários do tenant. */
export interface PeopleDirectoryResult {
  records: PeopleRecord[];
  missingScopes: string[];
  failures: string[];
}

/** Grupo M365 ao qual o usuário atual pertence (#293). */
export interface PeopleGroup {
  id: string;
  name: string;
  /** #578: descrição do grupo (M365 `description`), pro detalhe. "" se ausente. */
  description: string;
  /** #578 rework: e-mail do grupo (M365 `mail`); "" em security group sem mail. */
  mail: string;
  /** #578 rework: `Public`/`Private` (M365 `visibility`); "" em security group. */
  visibility: string;
  /** Só existe depois que os membros desse grupo foram carregados. */
  memberCount?: number | null;
}

export interface PeopleGroupsResult {
  groups: PeopleGroup[];
  missingScopes: string[];
  failures: string[];
}

export interface PeopleGroupMembersResult {
  records: PeopleRecord[];
  memberCount: number;
}

/** #562: pasta de contatos pessoal (Graph contactFolder) — grupo editável do
 *  usuário, distinto dos grupos M365 read-only (PeopleGroup). */
export interface ContactFolder {
  id: string;
  name: string;
  parentFolderId: string;
}

export interface ContactFoldersResult {
  folders: ContactFolder[];
  missingScopes: string[];
  failures: string[];
}

/** Uma adição revisável sugerida pelo Enrich, ainda sem efeito no contato. */
export interface PeopleEnrichField {
  key: PeopleEnrichFieldKey;
  value: string;
  source: PeopleEnrichSource;
  label?: string | null;
}

export interface PeopleEnrichPreview {
  fields: PeopleEnrichField[];
  failures: string[];
  /** Reflete o escopo efetivamente presente no token atual e um contato gravável. */
  writeAvailable: boolean;
}

export interface PeopleEnrichApplyResult {
  saved: boolean;
  writeAvailable: boolean;
}

/** Resultado por contato do write-back Company ↔ Organization (#288). */
export interface PeopleCompanyWriteResult {
  writeAvailable: boolean;
  savedContactIds: string[];
  failedContactIds: string[];
}

export type PeopleBulkDetailsField =
  | "companyName"
  | "department"
  | "officeLocation";

export interface PeopleBulkDetailsChange {
  field: PeopleBulkDetailsField;
  value: string | null;
}

export interface PeopleBulkDetailsWriteResult {
  writeAvailable: boolean;
  savedContactIds: string[];
  failedContactIds: string[];
}

export interface PeopleContactEdit {
  name: string;
  emails: PeopleEmail[];
  phones: PeoplePhone[];
  company?: string | null;
}

export interface PeopleInteraction {
  id: string;
  subject: string;
  occurredAt: string;
  direction: "inbound" | "outbound";
}
