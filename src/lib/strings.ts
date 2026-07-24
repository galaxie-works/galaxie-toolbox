/**
 * Textos do aplicativo. O pt-BR e a fonte da verdade: o tipo Dicionario sai
 * dele, e o TypeScript reprova o `en` se faltar alguma chave.
 *
 * Convencao de interpolacao: `{nome}` no texto, trocado em tempo de render
 * (ver `preencher` e `comDestaque` em lib/idioma.tsx). Nada de concatenar
 * pedacos de frase em codigo — em ingles a ordem das palavras muda.
 */

export type Idioma = "pt-BR" | "en";

/**
 * `sigla` no lugar da bandeira: o Windows nao tem glifo para emoji de bandeira
 * (os regional indicators saem como duas letras cruas), entao a bandeira do
 * exemplo do reui apareceria como "US" solto. A sigla e proposital e renderiza
 * igual em qualquer maquina.
 */
export const IDIOMAS: { valor: Idioma; rotulo: string; sigla: string }[] = [
  { valor: "pt-BR", rotulo: "Português (Brasil)", sigla: "BR" },
  { valor: "en", rotulo: "English", sigla: "EN" },
];

const pt = {
  login: {
    convite: "Entre para desbloquear um universo de possibilidades.",
    rotuloEmail: "E-mail corporativo",
    placeholderEmail: "voce@suaempresa.com",
    ajudaEmail: "Usamos o domínio do seu e-mail para identificar a sua organização.",
    entrar: "Entrar com Microsoft",
    entrando: "Abrindo o login da Microsoft...",
    // {senha} recebe destaque em negrito
    aviso: "Você entra na página oficial da Microsoft. O app {senha} — recebe apenas uma autorização.",
    avisoSenha: "nunca vê sua senha",
    idioma: "Idioma",
  },

  carregando: {
    preparando: "Preparando o seu universo...",
  },

  nav: {
    organizacao: "Organização",
    plataforma: "Plataforma",
    microsoft365: "Microsoft 365",
    // Grupo da sidebar. Separado do "Microsoft 365" acima, que e a legenda da
    // organizacao no topo e continua sendo o nome da plataforma.
    copilot: "M365 Copilot",
    windows: "Windows",
    outlook: "Outlook",
    onedrive: "OneDrive",
    apps: "Apps",
    performance: "Performance",
    caminhosLongos: "Caminhos longos",
    configuracoes: "Configurações",
    conta: "Conta",
    irPara365: "Ir para Microsoft 365",
    sharepoint: "SharePoint",
    sair: "Sair",
    alternarMenu: "Alternar menu",
  },

  abas: {
    bibliotecas: "Bibliotecas",
    problemas: "Solução de problemas",
  },

  bibliotecas: {
    titulo: "Biblioteca de documentos",
    descricao:
      "As bibliotecas de documentos organizam todo o inventário da empresa em sites do SharePoint. Use esta seção para habilitar a sincronização do seu OneDrive com as bibliotecas que você tem acesso.",
    descricaoPadrao: "Biblioteca de documentos do SharePoint.",
    rodape:
      "As bibliotecas aparecem no seu OneDrive, no Explorer. Só ocupam espaço quando você abre um arquivo.",
    carregando: "Carregando suas bibliotecas...",
    vazio: "Nenhuma biblioteca disponível para a sua conta.",
    conectado: "Conectado",
    desconectado: "Desconectado",
    semAcesso: "Sem acesso",
    abrir: "Abrir biblioteca",
    abrirExplorer: "Abrir no Explorer",
    abrirSharepoint: "Abrir no SharePoint",
    conectar: "Conectar {nome}",
    desconectar: "Desconectar {nome}",
    tamanho: "Tamanho da biblioteca",
    pastas: "{n} pastas",
    arquivos: "{n} arquivos",
    tituloPastas: "Pastas (aproximado, vem da busca do SharePoint)",
    tituloArquivos: "Arquivos (aproximado, vem da busca do SharePoint)",
    consultando: "{o} — consultando",
  },

  confirmar: {
    tituloConectar: "Antes de continuar",
    tituloDesconectar: "Remover esta biblioteca?",
    descConectar:
      "Ao habilitar {nome}, o OneDrive vai sincronizar todas as pastas e arquivos dela com a sua máquina. Eles aparecem no Explorer, mas só ocupam espaço quando você abre.",
    descDesconectar:
      "A pasta {nome} sai do seu OneDrive e do Explorer, inclusive os arquivos que você baixou para uso offline. Nada é apagado do SharePoint: a biblioteca continua lá e você pode reconectar quando quiser.",
    cartaoPastas: "Pastas",
    cartaoArquivos: "Arquivos",
    cartaoPeso: "Peso",
    pastasConectar: "Quantidade de pastas na biblioteca",
    pastasDesconectar: "Pastas que saem do seu Explorer",
    arquivosConectar: "Quantidade de arquivos na biblioteca",
    arquivosDesconectar: "Arquivos que saem do seu Explorer",
    pesoDescricao: "Tamanho da biblioteca na nuvem",
    naoPerguntar: "Não pedir confirmação novamente",
    naoPerguntarAjuda:
      "Nas próximas vezes, a biblioteca conecta direto ao ligar a chave. Dá para reativar o aviso em Configurações.",
    continuar: "Continuar",
    depois: "Deixar pra depois",
    remover: "Remover biblioteca",
    removendo: "Removendo",
    removida: "Removida",
    cancelar: "Cancelar",
  },

  problemas: {
    titulo: "Solução de problemas",
    descricao:
      "Correções para os perrengues clássicos do OneDrive, sem precisar abrir chamado.",
    item1: "Reiniciar o OneDrive",
    item2: "Destravar a sincronização",
    item3: "Reconectar a conta do Microsoft 365",
    item4: "Liberar espaço com arquivos sob demanda",
  },

  emBreveOutlook: {
    descricao: "Ferramentas de diagnóstico do e-mail vão aparecer aqui.",
    item1: "Verificar regras e encaminhamentos",
    item2: "Tamanho da caixa e limpeza",
    item3: "Reparar perfil do Outlook",
  },

  emBrevePerformance: {
    descricao: "Diagnóstico e ajustes de desempenho da máquina.",
    item1: "Espaço em disco e arquivos temporários",
    item2: "Programas que iniciam com o Windows",
    item3: "Estado da sincronização do OneDrive",
  },

  emBreveConfig: {
    descricao: "Preferências do aplicativo e da sua conta.",
  },

  apps: {
    maisUsados: "Mais utilizados",
    explorar: "Explore por categoria",
    abrirAqui: "Abrir aqui",
    abrirNavegador: "Abrir no navegador padrão",
    maisOpcoes: "Mais opções",
    produtividade: "Produtividade",
    utilitarios: "Utilitários",
    educacao: "Educação",
    comunicacao: "Comunicação",
    conteudo: "Gestão de conteúdo",
    projetos: "Gestão de projetos",
    experiencia: "Experiência do funcionário",
    desenvolvimento: "Ferramentas de desenvolvimento",
    avisoSessao:
      "Os aplicativos abrem aqui dentro. Na primeira vez a Microsoft pede o seu login nesta janela; depois a sessão fica guardada.",
  },

  atualizacao: {
    titulo: "Atualização disponível!",
    versao: "Versão {v} ({d})",
    descricao:
      "Uma nova versão do aplicativo está pronta. Ao atualizar agora, o app reinicia e volta com as últimas correções.",
    baixando: "Baixando a atualização... {p}%",
    agora: "Atualizar agora",
    atualizando: "Atualizando",
    depois: "Lembrar depois",
  },

  caminhosLongos: {
    titulo: "Caminhos longos",
    descricao:
      "Por padrão o Windows trava em 260 caracteres de caminho. Pastas de projeto muito aninhadas passam disso e o arquivo simplesmente não abre — nem pelo Explorer, nem pelos aplicativos.",
    verificando: "verificando",
    ativado: "Ativado",
    desativado: "Desativado",
    aviso:
      "A alteração é feita no registro do Windows e vale para o computador inteiro, por isso o Windows vai pedir sua confirmação de administrador. Alguns programas só reconhecem a mudança depois de reiniciar.",
    nadaAFazer: "Nada a fazer — este computador já aceita caminhos longos.",
    ativar: "Ativar caminhos longos",
    aplicando: "Aplicando...",
  },

  tema: {
    alternar: "Alternar tema claro e escuro",
  },
} as const;

export type Dicionario = typeof pt;

/** Estrutura identica ao pt: o TypeScript reprova chave faltando ou sobrando. */
const en: { [K in keyof Dicionario]: { [C in keyof Dicionario[K]]: string } } = {
  login: {
    convite: "Sign in to unlock a universe of possibilities.",
    rotuloEmail: "Work email",
    placeholderEmail: "you@yourcompany.com",
    ajudaEmail: "We use your email domain to identify your organization.",
    entrar: "Sign in with Microsoft",
    entrando: "Opening the Microsoft sign-in...",
    aviso:
      "You sign in on Microsoft's official page. This app {senha} — it only receives an authorization.",
    avisoSenha: "never sees your password",
    idioma: "Language",
  },

  carregando: {
    preparando: "Getting your universe ready...",
  },

  nav: {
    organizacao: "Organization",
    plataforma: "Platform",
    microsoft365: "Microsoft 365",
    copilot: "M365 Copilot",
    windows: "Windows",
    outlook: "Outlook",
    onedrive: "OneDrive",
    apps: "Apps",
    performance: "Performance",
    caminhosLongos: "Long paths",
    configuracoes: "Settings",
    conta: "Account",
    irPara365: "Go to Microsoft 365",
    sharepoint: "SharePoint",
    sair: "Sign out",
    alternarMenu: "Toggle sidebar",
  },

  abas: {
    bibliotecas: "Libraries",
    problemas: "Troubleshooting",
  },

  bibliotecas: {
    titulo: "Document library",
    descricao:
      "Document libraries organize the whole company inventory across SharePoint sites. Use this section to sync your OneDrive with the libraries you have access to.",
    descricaoPadrao: "SharePoint document library.",
    rodape:
      "Libraries show up in your OneDrive, in File Explorer. They only take up space when you open a file.",
    carregando: "Loading your libraries...",
    vazio: "No libraries available for your account.",
    conectado: "Connected",
    desconectado: "Disconnected",
    semAcesso: "No access",
    abrir: "Open library",
    abrirExplorer: "Open in File Explorer",
    abrirSharepoint: "Open in SharePoint",
    conectar: "Connect {nome}",
    desconectar: "Disconnect {nome}",
    tamanho: "Library size",
    pastas: "{n} folders",
    arquivos: "{n} files",
    tituloPastas: "Folders (approximate, from SharePoint search)",
    tituloArquivos: "Files (approximate, from SharePoint search)",
    consultando: "{o} — checking",
  },

  confirmar: {
    tituloConectar: "Before you continue",
    tituloDesconectar: "Remove this library?",
    descConectar:
      "Turning on {nome} makes OneDrive sync every folder and file in it to your machine. They show up in File Explorer, but only take up space once you open them.",
    descDesconectar:
      "The {nome} folder leaves your OneDrive and File Explorer, including files you downloaded for offline use. Nothing is deleted from SharePoint: the library stays there and you can reconnect whenever you want.",
    cartaoPastas: "Folders",
    cartaoArquivos: "Files",
    cartaoPeso: "Size",
    pastasConectar: "Number of folders in the library",
    pastasDesconectar: "Folders leaving your File Explorer",
    arquivosConectar: "Number of files in the library",
    arquivosDesconectar: "Files leaving your File Explorer",
    pesoDescricao: "Library size in the cloud",
    naoPerguntar: "Don't ask for confirmation again",
    naoPerguntarAjuda:
      "Next time, the library connects straight away when you flip the switch. You can turn the warning back on in Settings.",
    continuar: "Continue",
    depois: "Maybe later",
    remover: "Remove library",
    removendo: "Removing",
    removida: "Removed",
    cancelar: "Cancel",
  },

  problemas: {
    titulo: "Troubleshooting",
    descricao: "Fixes for the classic OneDrive headaches, without filing a ticket.",
    item1: "Restart OneDrive",
    item2: "Unstick syncing",
    item3: "Reconnect the Microsoft 365 account",
    item4: "Free up space with files on-demand",
  },

  emBreveOutlook: {
    descricao: "Email diagnostic tools will show up here.",
    item1: "Check rules and forwarding",
    item2: "Mailbox size and cleanup",
    item3: "Repair the Outlook profile",
  },

  emBrevePerformance: {
    descricao: "Diagnostics and performance tuning for this machine.",
    item1: "Disk space and temporary files",
    item2: "Programs that start with Windows",
    item3: "OneDrive sync status",
  },

  emBreveConfig: {
    descricao: "App and account preferences.",
  },

  apps: {
    maisUsados: "Most used",
    explorar: "Explore by category",
    abrirAqui: "Open here",
    abrirNavegador: "Open in default browser",
    maisOpcoes: "More options",
    produtividade: "Productivity",
    utilitarios: "Utilities",
    educacao: "Education",
    comunicacao: "Communication",
    conteudo: "Content management",
    projetos: "Project management",
    experiencia: "Employee Experience",
    desenvolvimento: "Developer tools",
    avisoSessao:
      "Apps open right here. The first time, Microsoft asks you to sign in inside this window; after that the session is kept.",
  },

  atualizacao: {
    titulo: "Update available!",
    versao: "Version {v} ({d})",
    descricao:
      "A new version of the app is ready. Updating now restarts the app and brings the latest fixes.",
    baixando: "Downloading the update... {p}%",
    agora: "Update now",
    atualizando: "Updating",
    depois: "Remind me later",
  },

  caminhosLongos: {
    titulo: "Long paths",
    descricao:
      "By default Windows stops at 260 characters of path. Deeply nested project folders go past that and the file simply won't open — not in File Explorer, not in your apps.",
    verificando: "checking",
    ativado: "Enabled",
    desativado: "Disabled",
    aviso:
      "The change is made in the Windows registry and applies to the whole computer, so Windows will ask for administrator confirmation. Some programs only pick up the change after a restart.",
    nadaAFazer: "Nothing to do — this computer already accepts long paths.",
    ativar: "Enable long paths",
    aplicando: "Applying...",
  },

  tema: {
    alternar: "Toggle light and dark theme",
  },
};

export const DICIONARIOS: Record<Idioma, Dicionario> = {
  "pt-BR": pt,
  en: en as Dicionario,
};
