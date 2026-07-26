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
}

// --- Agenda do dia + inbox do dia (Control room rico) --------------------
export interface Participante {
  nome: string;
  email: string;
  iniciais: string;
  foto?: string | null;
}

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
}

export interface CategoriaCor {
  nome: string;
  cor: string;
}

export interface EventoDetalhe {
  assunto: string;
  inicio: string;
  fim: string;
  local: string;
  online: boolean;
  joinUrl?: string | null;
  organizador: string;
  corpo: string;
  corpoTipo: "html" | "text";
  participantes: Participante[];
  webLink: string;
}

export interface EmailItem {
  id: string;
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
}

export interface EmailDetalhe {
  assunto: string;
  de: string;
  deEmail: string;
  para: string[];
  cc: string[];
  recebido: string;
  corpo: string;
  corpoTipo: "html" | "text";
  anexos: AnexoEmail[];
  webLink: string;
}

export interface PastaEmail {
  id: string;
  tipo: string; // "inbox" | "drafts" | "sentitems" | "archive" | "junkemail" | "deleteditems" | "child"
  nome: string;
  naoLidos: number;
  total: number;
  filhos: number; // nº de subpastas — chevron de expandir só aparece quando > 0
}

/** Pessoa sugerida no autocomplete do compositor de e-mail. */
export interface Pessoa {
  nome: string;
  email: string;
}
