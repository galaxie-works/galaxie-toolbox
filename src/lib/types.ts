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
  webUrl?: string; // url da biblioteca (siteUrl do atalho)
  // Preenchidos depois da lista, um site por vez (ver SiteDetalhes no Rust).
  // files/folders sao aproximados: vem do indice de busca do SharePoint.
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
