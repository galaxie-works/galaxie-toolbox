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
