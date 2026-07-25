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
