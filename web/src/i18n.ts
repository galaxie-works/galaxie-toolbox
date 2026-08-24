// i18n mínimo pt/en da plataforma web (#1484). Espelha a doutrina do app Tauri:
// dicionário por idioma, idioma detectado do navegador. Módulo puro (testável).
export type Idioma = "pt-BR" | "en";

export interface Dicionario {
  entrar: string;
  cadastrar: string;
  recuperarSenha: string;
  email: string;
  senha: string;
  bemVindo: string;
  subtitulo: string;
  semConta: string;
  jaTemConta: string;
  // #1489 — conta/perfil
  minhaConta: string;
  perfil: string;
  nome: string;
  salvar: string;
  salvo: string;
  assinatura: string;
  plano: string;
  consumo: string;
  semAssinatura: string;
  dispositivos: string;
  sessaoAtual: string;
  ultimoAcesso: string;
  revogar: string;
  revogado: string;
  carregando: string;
  erroCarregar: string;
  tentarNovamente: string;
  sair: string;
  // #1491 — config do app
  configuracoes: string;
  semConfig: string;
  // #1490 — admin da org. O TIPO é a lista: campo sem tradução nos dois idiomas
  // não compila — o pt/en do DoD fica provado pelo `tsc`, não pela boa vontade
  // de quem editar o dicionário depois.
  //
  // Reuso em vez de duplicar: `assinatura`/`carregando`/`erroCarregar` vieram do
  // #1489 e `configuracoes` do #1491, todos com o mesmo sentido. Eu tinha escrito
  // `tentarDeNovo` e o #1489 já trazia `tentarNovamente` — mesma frase, dois
  // nomes; fiquei com o dele. Dicionário com dois nomes pro mesmo texto diverge
  // na primeira tradução que esquecer um dos dois.
  adminOrg: string;
  membros: string;
  dominios: string;
  convidarMembro: string;
  remover: string;
  papel: string;
  papelAdmin: string;
  papelMembro: string;
  // #1490 fatia 2 — 403 e 404 têm mensagens DIFERENTES de propósito. Ver o
  // cabeçalho de `lib/org.ts`: quem leva 403 já é da org e já sabe que ela
  // existe, então "peça a um admin" é acionável e não revela nada; quem leva
  // 404 não pertence, e a mensagem não pode confirmar que a org existe.
  semPermissao: string;
  semPermissaoDetalhe: string;
  naoEhSuaOrg: string;
  naoEhSuaOrgDetalhe: string;
}

export const DICIONARIOS: Record<Idioma, Dicionario> = {
  "pt-BR": {
    entrar: "Entrar",
    cadastrar: "Criar conta",
    recuperarSenha: "Esqueci minha senha",
    email: "E-mail",
    senha: "Senha",
    bemVindo: "Bem-vindo à Galaxie",
    subtitulo: "Acesse sua conta para continuar",
    semConta: "Não tem conta?",
    jaTemConta: "Já tem conta?",
    minhaConta: "Minha conta",
    perfil: "Perfil",
    nome: "Nome",
    salvar: "Salvar",
    salvo: "Salvo",
    assinatura: "Assinatura",
    plano: "Plano",
    consumo: "Consumo",
    semAssinatura: "Sem assinatura ativa",
    dispositivos: "Dispositivos e sessões",
    sessaoAtual: "Sessão atual",
    ultimoAcesso: "Último acesso",
    revogar: "Revogar",
    revogado: "Revogado",
    carregando: "Carregando…",
    erroCarregar: "Não foi possível carregar",
    tentarNovamente: "Tentar novamente",
    sair: "Sair",
    configuracoes: "Configurações",
    semConfig: "Nada para configurar",
    adminOrg: "Administração da organização",
    membros: "Membros",
    dominios: "Domínios",
    convidarMembro: "Convidar membro",
    remover: "Remover",
    papel: "Papel",
    papelAdmin: "Administrador",
    papelMembro: "Membro",
    semPermissao: "Você não administra esta organização",
    semPermissaoDetalhe:
      "Peça a um administrador da sua organização para conceder o acesso.",
    // Deliberadamente vago: não confirma nem nega que a organização exista.
    naoEhSuaOrg: "Organização não encontrada",
    naoEhSuaOrgDetalhe: "Confira se você está na conta certa.",
  },
  en: {
    entrar: "Sign in",
    cadastrar: "Create account",
    recuperarSenha: "Forgot my password",
    email: "Email",
    senha: "Password",
    bemVindo: "Welcome to Galaxie",
    subtitulo: "Sign in to your account to continue",
    semConta: "No account yet?",
    jaTemConta: "Already have an account?",
    minhaConta: "My account",
    perfil: "Profile",
    nome: "Name",
    salvar: "Save",
    salvo: "Saved",
    assinatura: "Subscription",
    plano: "Plan",
    consumo: "Usage",
    semAssinatura: "No active subscription",
    dispositivos: "Devices and sessions",
    sessaoAtual: "Current session",
    ultimoAcesso: "Last access",
    revogar: "Revoke",
    revogado: "Revoked",
    carregando: "Loading…",
    erroCarregar: "Couldn't load",
    tentarNovamente: "Try again",
    sair: "Sign out",
    configuracoes: "Settings",
    semConfig: "Nothing to configure",
    adminOrg: "Organization admin",
    membros: "Members",
    dominios: "Domains",
    convidarMembro: "Invite member",
    remover: "Remove",
    papel: "Role",
    papelAdmin: "Admin",
    papelMembro: "Member",
    semPermissao: "You don't administer this organization",
    semPermissaoDetalhe:
      "Ask an administrator of your organization to grant access.",
    // Deliberadamente vago: não confirma nem nega que a organização exista.
    naoEhSuaOrg: "Organization not found",
    naoEhSuaOrgDetalhe: "Check whether you're in the right account.",
  },
};

/** Detecta o idioma pelo navegador; default pt-BR (mesma regra do app Tauri). */
export function idiomaAtual(
  navegador: string | undefined = typeof navigator !== "undefined"
    ? navigator.language
    : undefined,
): Idioma {
  return navegador?.toLowerCase().startsWith("en") ? "en" : "pt-BR";
}
