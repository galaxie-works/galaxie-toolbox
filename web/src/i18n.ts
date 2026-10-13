// i18n mínimo pt/en da plataforma web (#1484). Espelha a doutrina do app Tauri:
// dicionário por idioma, idioma detectado do navegador. Módulo puro (testável).
import type { Atalho, Capacidade, ModoAprovacao } from "@/lib/remoto";

export type Idioma = "pt-BR" | "en";

/** Chaves da allowlist de config que a UI sabe rotular (#1749). O BE não manda texto de UI. */
export type ChaveConfigConhecida = "app.tema" | "app.notificacoes";
/** Valores de opção da allowlist que a UI sabe rotular (#1749). */
export type OpcaoConfigConhecida = "claro" | "escuro" | "sistema";

export interface Dicionario {
  // #1484 — login (identidade federada, sem senha própria). `entrarCom` é o rótulo
  // por provedor (os mesmos do desktop, `api.ts:232`); a chave garante os 3 no tsc.
  email: string;
  bemVindo: string;
  subtitulo: string;
  entrarCom: Record<"microsoft" | "microsoft-personal" | "google", string>;
  semSenha: string;
  // #1484 + contrato #1734 — o callback OAuth falhou (qualquer causa, inclusive
  // "cancelei no provedor": o sinal é ÚNICO). Texto FIXO — nada da URL é mostrado.
  loginFalhou: string;
  loginFalhouDetalhe: string;
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
  naoGuardado: string;
  /** #1752 — nome ESTÁVEL da região viva do resultado de salvar (o texto dela muda). */
  resultadoSalvar: string;
  // #1749 — rótulos da allowlist de config. O BE devolve só `chave`/valores (sem
  // texto de UI, regra 7 do AGENTS): a copy mora aqui, indexada por eles. O TIPO
  // das chaves faz o `tsc` reprovar um idioma que esqueça uma tradução.
  configChave: Record<ChaveConfigConhecida, string>;
  configOpcao: Record<OpcaoConfigConhecida, string>;
  /** Chave que o BE manda e a UI ainda não conhece — nunca mostrar a chave crua. */
  configChaveDesconhecida: string;
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
  // #1490 fatia 3 — remoção de membro. O diálogo NOMEIA o membro (nome e e-mail
  // vêm da linha, são dado e não tradução) e diz o EFEITO. O efeito é verdade
  // desde o #1545/PR #1570: a borda revoga a sessão do alvo, portanto "perde o
  // acesso na hora" não é promessa, é o que acontece.
  removerTitulo: string;
  /** Enquanto o `DELETE` está em voo — ver o P2 do Codex na PR #1626. */
  removendo: string;
  removerAviso: string;
  removerFalhou: string;
  // `409 ultimo_admin` (§3, #1620) — MESMO HTTP que `conflito`, mensagem
  // própria. A diferença está no que o utilizador faz a seguir: esta ele
  // conserta sozinho, promovendo alguém. "Sem permissão" mandá-lo-ia pedir
  // suporte para um problema que é dele resolver — condição do @Altair.
  ultimoAdmin: string;
  ultimoAdminDetalhe: string;
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
  // Quando a FAIXA da página já anunciou a suspensão, o painel não repete a
  // mesma frase — diz o que é DELE: este conteúdo não vem. Achado na e2e do
  // composto (25/08): faixa e painel reportavam o mesmo fato com o mesmo texto,
  // e a tela gaguejava. Nenhum duplo mostrava isso, porque cada teste exercitava
  // um caminho só; só o composto contra a borda real põe os dois na mesma tela.
  orgSuspensaPainel: string;
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
  // #1472 — painel do Remote. As chaves com `remote.*` ao lado são a copy do
  // CARD (proposta da Mira; o PO valida). As outras o card não trazia: copy
  // proposta no próprio card pelo @Castor, com o mesmo aviso. As três `Record`
  // são TIPADAS pelas listas do `lib/remoto.ts`: capacidade, atalho ou modo sem
  // tradução não compila, e um 6.º valor também não.
  remoto: string;
  /** remote.notApplied — fixo e visível até a ponte #1729 existir. */
  remotoNaoAplicado: string;
  /** remote.cap.* */
  remotoCapacidade: Record<Capacidade, string>;
  /** remote.preset.* */
  remotoAtalho: Record<Atalho, string>;
  /** remote.approval.* */
  remotoAprovacao: Record<ModoAprovacao, string>;
  /** remote.unattended */
  remotoNaoSupervisionado: string;
  /** remote.grant */
  remotoConceder: string;
  /** remote.revoke */
  remotoRevogar: string;
  /** remote.deviceId */
  remotoDeviceId: string;
  /** remote.member */
  remotoMembro: string;
  /** remote.deviceLabel — `{id}` é trocado pelo id do device (dado, não tradução). */
  remotoDispositivo: string;
  remotoConcessoes: string;
  remotoTeto: string;
  remotoCapacidadesMaximas: string;
  remotoAprovacaoTitulo: string;
  remotoAcesso: string;
  remotoAtiva: string;
  remotoRevogada: string;
  remotoSemConcessoes: string;
  remotoEscolhaMembro: string;
  remotoDeviceIdInvalido: string;
  remotoConcedendo: string;
  remotoRevogando: string;
  remotoRevogarAviso: string;
  remotoFalhou: string;
  // #1756 — a secção do membro na `/conta` (copy do card, `remote.me.*`). As
  // capacidades, o ID e o aviso reusam as chaves do #1472 acima.
  /** remote.me.titulo */
  remotoMeTitulo: string;
  /** remote.me.explica — diz que SÓ reduz: o membro não vê o teto da org. */
  remotoMeExplica: string;
  /** remote.me.adicionar */
  remotoMeAdicionar: string;
  /** remote.me.remover */
  remotoMeRemover: string;
  /** remote.me.vazio */
  remotoMeVazio: string;
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
    loginFalhou: "Não foi possível entrar",
    loginFalhouDetalhe: "O login não foi concluído. Escolha a conta e tente de novo.",
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
    // pt-BR: o par de "Salvo" é "Não salvo". "Não guardado" era pt-PT (#1752).
    naoGuardado: "Não salvo",
    resultadoSalvar: "Resultado do salvamento",
    configChave: { "app.tema": "Tema", "app.notificacoes": "Notificações" },
    configOpcao: { claro: "Claro", escuro: "Escuro", sistema: "Sistema" },
    configChaveDesconhecida: "Preferência",
    adminOrg: "Administração da organização",
    membros: "Membros",
    dominios: "Domínios",
    convidarMembro: "Convidar membro",
    remover: "Remover",
    removerTitulo: "Remover membro",
    removendo: "Removendo…",
    removerAviso:
      "Perde o acesso imediatamente — a sessão dele é encerrada na hora.",
    removerFalhou: "Não foi possível remover",
    ultimoAdmin: "A organização ficaria sem administrador",
    ultimoAdminDetalhe:
      "Promova outro administrador antes de remover este.",
    papel: "Papel",
    papelAdmin: "Administrador",
    papelMembro: "Membro",
    semPermissao: "Você não administra esta organização",
    semPermissaoDetalhe:
      "Peça a um administrador da sua organização para conceder o acesso.",
    orgSuspensa: "Organização suspensa",
    orgSuspensaDetalhe:
      "O acesso está suspenso. Fale com o suporte para reativar a organização.",
    orgSuspensaPainel:
      "Este conteúdo fica indisponível enquanto a organização estiver suspensa.",
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
    remoto: "Acesso remoto",
    remotoNaoAplicado: "Configuração salva, mas ainda não é aplicada às sessões remotas.",
    remotoCapacidade: {
      screen: "Ver a tela",
      input: "Controlar teclado e mouse",
      fileTransfer: "Transferir arquivos",
      clipboard: "Área de transferência",
      audio: "Ouvir o áudio",
    },
    remotoAtalho: { ver: "Só ver", total: "Acesso total", personalizado: "Personalizado" },
    remotoAprovacao: {
      clique: "Aceitar com um clique",
      senha: "Aceitar com senha",
      senha_ou_clique: "Senha ou clique",
    },
    remotoNaoSupervisionado: "Permitir acesso sem ninguém no computador",
    remotoConceder: "Conceder acesso",
    remotoRevogar: "Revogar acesso",
    remotoDeviceId: "ID do dispositivo",
    remotoMembro: "Membro",
    remotoDispositivo: "Dispositivo {id}",
    remotoConcessoes: "Concessões de acesso",
    remotoTeto: "Limites da organização",
    remotoCapacidadesMaximas: "Permitido nas sessões",
    remotoAprovacaoTitulo: "Aprovação da sessão",
    remotoAcesso: "Acesso",
    remotoAtiva: "Ativa",
    remotoRevogada: "Revogada",
    remotoSemConcessoes: "Nenhuma concessão ainda.",
    remotoEscolhaMembro: "Escolha um membro",
    remotoDeviceIdInvalido: "Use até 128 caracteres: letras, números e . _ - : @",
    remotoConcedendo: "Concedendo…",
    remotoRevogando: "Revogando…",
    remotoRevogarAviso: "A concessão fica no histórico como revogada.",
    remotoFalhou: "Não foi possível salvar. Tente novamente.",
    remotoMeTitulo: "Acesso remoto ao meu dispositivo",
    remotoMeExplica:
      "Limite o que podem fazer no seu dispositivo. Isto só reduz o que a sua organização permite; nunca o alarga.",
    remotoMeAdicionar: "Adicionar dispositivo",
    remotoMeRemover: "Remover restrição",
    remotoMeVazio: "Ainda não limitou nenhum dispositivo.",
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
    loginFalhou: "We couldn't sign you in",
    loginFalhouDetalhe: "Sign-in didn't complete. Choose your account and try again.",
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
    naoGuardado: "Not saved",
    resultadoSalvar: "Save result",
    configChave: { "app.tema": "Theme", "app.notificacoes": "Notifications" },
    configOpcao: { claro: "Light", escuro: "Dark", sistema: "System" },
    configChaveDesconhecida: "Preference",
    adminOrg: "Organization admin",
    membros: "Members",
    dominios: "Domains",
    convidarMembro: "Invite member",
    remover: "Remove",
    removerTitulo: "Remove member",
    removendo: "Removing…",
    removerAviso: "Access ends immediately — their session is revoked at once.",
    removerFalhou: "Could not remove",
    ultimoAdmin: "The organization would be left with no administrator",
    ultimoAdminDetalhe: "Promote another administrator before removing this one.",
    papel: "Role",
    papelAdmin: "Admin",
    papelMembro: "Member",
    semPermissao: "You don't administer this organization",
    semPermissaoDetalhe:
      "Ask an administrator of your organization to grant access.",
    orgSuspensa: "Organization suspended",
    orgSuspensaDetalhe:
      "Access is suspended. Contact support to reactivate the organization.",
    orgSuspensaPainel:
      "This content is unavailable while the organization is suspended.",
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
    remoto: "Remote access",
    remotoNaoAplicado: "Settings saved, but not yet applied to remote sessions.",
    remotoCapacidade: {
      screen: "View screen",
      input: "Control keyboard and mouse",
      fileTransfer: "Transfer files",
      clipboard: "Clipboard",
      audio: "Hear audio",
    },
    remotoAtalho: { ver: "View only", total: "Full access", personalizado: "Custom" },
    remotoAprovacao: {
      clique: "Accept with a click",
      senha: "Accept with password",
      senha_ou_clique: "Password or click",
    },
    remotoNaoSupervisionado: "Allow unattended access",
    remotoConceder: "Grant access",
    remotoRevogar: "Revoke access",
    remotoDeviceId: "Device ID",
    remotoMembro: "Member",
    remotoDispositivo: "Device {id}",
    remotoConcessoes: "Access grants",
    remotoTeto: "Organization limits",
    remotoCapacidadesMaximas: "Allowed in sessions",
    remotoAprovacaoTitulo: "Session approval",
    remotoAcesso: "Access",
    remotoAtiva: "Active",
    remotoRevogada: "Revoked",
    remotoSemConcessoes: "No grants yet.",
    remotoEscolhaMembro: "Choose a member",
    remotoDeviceIdInvalido: "Use up to 128 characters: letters, numbers and . _ - : @",
    remotoConcedendo: "Granting…",
    remotoRevogando: "Revoking…",
    remotoRevogarAviso: "The grant stays in the history as revoked.",
    remotoFalhou: "Couldn't save. Please try again.",
    remotoMeTitulo: "Remote access to my device",
    remotoMeExplica:
      "Limit what others can do on your device. This only narrows what your organization allows; it never widens it.",
    remotoMeAdicionar: "Add device",
    remotoMeRemover: "Remove restriction",
    remotoMeVazio: "You haven't limited any device yet.",
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

/**
 * O `idioma` guardado na conta (`/me.idioma`) como um `Idioma` suportado, ou `null`
 * se vier ausente ou fora do que a UI fala. Aceita a tag com região (`pt-PT`,
 * `en-GB`) e sem caixa fixa — o que importa é a língua.
 */
export function idiomaDaConta(valor: string | null | undefined): Idioma | null {
  const v = valor?.trim().toLowerCase();
  if (!v) return null;
  if (v === "pt" || v.startsWith("pt-")) return "pt-BR";
  if (v === "en" || v.startsWith("en-")) return "en";
  return null;
}

/**
 * Precedência do #1732 (recomendação da Mira): **conta > navegador > pt-BR**. Sem
 * sessão (ex.: `/login`) não há conta, e vale o navegador — que já cai em pt-BR.
 */
export function resolverIdioma(conta: string | null | undefined, navegador?: string): Idioma {
  return idiomaDaConta(conta) ?? idiomaAtual(navegador);
}

/**
 * Alinha o idioma DECLARADO da página (`<html lang>`) ao idioma RENDERIZADO —
 * WCAG 3.1.1 (#1484, achado da @Íris). O `index.html` nasce `pt-BR` (o mesmo
 * default do `idiomaAtual`); sem isto, num navegador em inglês a UI inteira sai
 * em inglês com a página a declarar português, e o leitor de ecrã lê inglês com
 * fonética portuguesa. `Idioma` já é tag BCP 47 ("pt-BR" | "en") — vai direto.
 */
export function aplicarIdiomaNoDocumento(idioma: Idioma, doc: Document = document): void {
  doc.documentElement.lang = idioma;
}
