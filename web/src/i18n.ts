// i18n mínimo pt/en da plataforma web (#1484). Espelha a doutrina do app Tauri:
// dicionário por idioma, idioma detectado do navegador. Módulo puro (testável).
export type Idioma = "pt-BR" | "en";

export interface Dicionario {
  // #1484 — login (identidade federada, sem senha própria). `entrarCom` é o rótulo
  // por provedor (os mesmos do desktop, `api.ts:232`); a chave garante os 3 no tsc.
  email: string;
  bemVindo: string;
  subtitulo: string;
  entrarCom: Record<"microsoft" | "microsoft-personal" | "google", string>;
  semSenha: string;
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
  // #1544 / contrato v1.4 — `org_suspensa` tem o MESMO HTTP que `negado` (403)
  // e razão diferente. O contrato manda a UI dizer "fale com o admin", não
  // "papel insuficiente": nenhum administrador da org resolve uma suspensão,
  // então mandar pedir acesso a ele é mandar a pessoa ao lugar errado.
  orgSuspensa: string;
  orgSuspensaDetalhe: string;
  naoEhSuaOrg: string;
  naoEhSuaOrgDetalhe: string;
  // Estado TEMPORÁRIO: o contrato exige `/orgs/{org}` mas não há rota de onde
  // o cliente descubra o `{org}` (`GET /me` não devolve org). Some quando a
  // lacuna fechar; até lá a tela diz o que não sabe, em vez de eu inventar.
  orgIndefinida: string;
  orgIndefinidaDetalhe: string;
  // #1490 fatia 5 — painel de domínios (contrato v1.3). `verificado`/`pendente`
  // são os DOIS valores que o doc declara; nomear os dois aqui é o que impede a
  // UI de inventar um terceiro.
  estado: string;
  verificado: string;
  pendente: string;
  semDominios: string;
  // #1492 — back-office (staff). `naoEncontrado` é o texto de rota inexistente:
  // o contrato manda 404 pra não-staff "não revela o back-office", então a tela
  // não pode ter frase sobre staff nem permissão — dizer desfaz o 404.
  backOffice: string;
  listaPendente: string;
  naoEncontrado: string;
  suspender: string;
  suspenderConfirmacao: string;
  suspenderAviso: string;
  cancelar: string;
}

export const DICIONARIOS: Record<Idioma, Dicionario> = {
  "pt-BR": {
    email: "E-mail",
    bemVindo: "Bem-vindo à Galaxie",
    subtitulo: "Entre com sua conta para continuar",
    entrarCom: {
      microsoft: "Entrar com Microsoft",
      "microsoft-personal": "Conta Microsoft pessoal",
      google: "Entrar com Google",
    },
    semSenha: "A Galaxie usa sua conta federada — sem senha própria.",
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
    orgSuspensa: "Organização suspensa",
    orgSuspensaDetalhe:
      "O acesso está suspenso. Fale com o suporte para reativar a organização.",
    // Deliberadamente vago: não confirma nem nega que a organização exista.
    naoEhSuaOrg: "Organização não encontrada",
    naoEhSuaOrgDetalhe: "Confira se você está na conta certa.",
    orgIndefinida: "Organização não identificada",
    orgIndefinidaDetalhe:
      "Ainda não é possível saber a qual organização esta sessão pertence.",
    estado: "Estado",
    verificado: "Verificado",
    pendente: "Pendente",
    semDominios: "Nenhum domínio reivindicado",
    backOffice: "Back-office",
    listaPendente: "A lista de organizações entra quando o contrato definir o formato.",
    naoEncontrado: "Página não encontrada",
    suspender: "Suspender",
    suspenderConfirmacao: "Isto vai suspender a organização",
    suspenderAviso: "A ação é destrutiva e fica registrada em auditoria.",
    cancelar: "Cancelar",
  },
  en: {
    email: "Email",
    bemVindo: "Welcome to Galaxie",
    subtitulo: "Sign in with your account to continue",
    entrarCom: {
      microsoft: "Sign in with Microsoft",
      "microsoft-personal": "Personal Microsoft account",
      google: "Sign in with Google",
    },
    semSenha: "Galaxie uses your federated account — no password of its own.",
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
    orgSuspensa: "Organization suspended",
    orgSuspensaDetalhe:
      "Access is suspended. Contact support to reactivate the organization.",
    // Deliberadamente vago: não confirma nem nega que a organização exista.
    naoEhSuaOrg: "Organization not found",
    naoEhSuaOrgDetalhe: "Check whether you're in the right account.",
    orgIndefinida: "Organization not identified",
    orgIndefinidaDetalhe:
      "We can't yet tell which organization this session belongs to.",
    estado: "Status",
    verificado: "Verified",
    pendente: "Pending",
    semDominios: "No domains claimed",
    backOffice: "Back office",
    listaPendente: "The organization list lands once the contract defines its shape.",
    naoEncontrado: "Page not found",
    suspender: "Suspend",
    suspenderConfirmacao: "This will suspend the organization",
    suspenderAviso: "This action is destructive and is recorded in the audit log.",
    cancelar: "Cancel",
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
