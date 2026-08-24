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
