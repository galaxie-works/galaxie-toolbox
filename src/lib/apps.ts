import type { Idioma } from "@/lib/strings";
import type { Dicionario } from "@/lib/strings";

/** Chave dentro de `t.apps` — o rotulo da categoria sai do dicionario. */
export type Categoria =
  | "produtividade"
  | "utilitarios"
  | "educacao"
  | "comunicacao"
  | "conteudo"
  | "projetos"
  | "experiencia"
  | "desenvolvimento";

export type ChaveCategoria = Extract<keyof Dicionario["apps"], Categoria>;

export interface AppM365 {
  id: string;
  /** Nome do produto: nao se traduz. */
  nome: string;
  resumo: Record<Idioma, string>;
  url: string;
  /** Um app aparece em mais de uma categoria, como no portal. */
  categorias: Categoria[];
}

/**
 * Catalogo do Microsoft 365, com os nomes, descricoes e a divisao por
 * categoria lidos do portal m365.cloud.microsoft/apps.
 *
 * DUAS RESSALVAS:
 *
 * 1. A lista do portal e POR TENANT — ela reflete o que esta licenciado e
 *    instalado. Esta aqui e fixa, entao um cliente sem Viva ou sem Power Apps
 *    vera cards de coisas que nao tem. Resolver isso exige ler os apps do
 *    tenant, e o Graph nao expoe esse catalogo.
 *
 * 2. Ficaram de fora "Suplementos" e "Learning Activities": nao sao
 *    aplicativos web com endereco proprio, sao extensoes dentro de outros.
 */
export const APPS: AppM365[] = [
  {
    id: "outlook",
    nome: "Outlook",
    resumo: { "pt-BR": "E-mail, agenda e tarefas.", en: "Email, schedule, and set tasks." },
    url: "https://outlook.office.com/mail/",
    categorias: ["comunicacao", "produtividade"],
  },
  {
    id: "word",
    nome: "Word",
    resumo: { "pt-BR": "Documentos de texto.", en: "Text documents." },
    url: "https://www.office.com/launch/word",
    categorias: ["produtividade"],
  },
  {
    id: "excel",
    nome: "Excel",
    resumo: { "pt-BR": "Planilhas e análises.", en: "Spreadsheets and analysis." },
    url: "https://www.office.com/launch/excel",
    categorias: ["produtividade"],
  },
  {
    id: "powerpoint",
    nome: "PowerPoint",
    resumo: { "pt-BR": "Apresentações.", en: "Presentations." },
    url: "https://www.office.com/launch/powerpoint",
    categorias: ["produtividade"],
  },
  {
    id: "onenote",
    nome: "OneNote",
    resumo: { "pt-BR": "Blocos de anotações.", en: "Notebooks." },
    url: "https://www.onenote.com/notebooks",
    categorias: ["produtividade"],
  },
  {
    id: "onedrive",
    nome: "OneDrive",
    resumo: { "pt-BR": "Seus arquivos na nuvem.", en: "Your files in the cloud." },
    url: "https://www.office.com/launch/onedrive",
    categorias: ["conteudo"],
  },
  {
    id: "teams",
    nome: "Teams",
    resumo: { "pt-BR": "Reuniões, chamadas e conversas.", en: "Meetings, calls, and chat." },
    url: "https://teams.cloud.microsoft",
    categorias: ["comunicacao"],
  },
  {
    id: "sharepoint",
    nome: "SharePoint",
    resumo: { "pt-BR": "Sites e bibliotecas da empresa.", en: "Company sites and libraries." },
    url: "https://www.office.com/launch/sharepoint",
    categorias: ["conteudo"],
  },
  {
    id: "clipchamp",
    nome: "Clipchamp",
    resumo: { "pt-BR": "Edição de vídeo no navegador.", en: "Video editing in the browser." },
    url: "https://app.clipchamp.com",
    categorias: ["conteudo", "produtividade"],
  },
  {
    id: "bookings",
    nome: "Bookings",
    resumo: {
      "pt-BR": "Organiza agendamentos dentro e fora da empresa.",
      en: "Simplify how you schedule and manage appointments both inside and outside your organization.",
    },
    url: "https://outlook.office.com/bookings/",
    categorias: ["produtividade", "educacao", "comunicacao"],
  },
  {
    id: "calendario",
    nome: "Calendário",
    resumo: { "pt-BR": "Gerencie e compartilhe sua agenda.", en: "Manage and share your schedule." },
    url: "https://outlook.office.com/calendar/",
    categorias: ["produtividade", "comunicacao"],
  },
  {
    id: "connections",
    nome: "Connections",
    resumo: {
      "pt-BR": "Ferramentas, notícias e recursos personalizados.",
      en: "Access personalized tools, news, and resources.",
    },
    url: "https://connections.cloud.microsoft",
    categorias: ["produtividade", "experiencia"],
  },
  {
    id: "engage",
    nome: "Engage",
    resumo: {
      "pt-BR": "Conecte-se com colegas e organize-se por projeto.",
      en: "Connect with coworkers, share information, and organize around projects.",
    },
    url: "https://engage.cloud.microsoft",
    categorias: ["produtividade", "comunicacao", "experiencia"],
  },
  {
    id: "forms",
    nome: "Forms",
    resumo: {
      "pt-BR": "Pesquisas e questionários com resultado em tempo real.",
      en: "Customize surveys and quizzes, get real-time results.",
    },
    url: "https://forms.office.com",
    categorias: ["produtividade", "utilitarios", "educacao"],
  },
  {
    id: "insights",
    nome: "Insights",
    resumo: {
      "pt-BR": "Produtividade e bem-estar com o Viva Insights.",
      en: "Improve your productivity and wellbeing with Microsoft Viva Insights.",
    },
    url: "https://insights.cloud.microsoft",
    categorias: ["produtividade"],
  },
  {
    id: "learning",
    nome: "Learning",
    resumo: {
      "pt-BR": "Continue aprendendo com o Viva Learning.",
      en: "Keep learning, keep growing with Viva Learning.",
    },
    url: "https://learning.cloud.microsoft",
    categorias: ["produtividade", "educacao", "experiencia"],
  },
  {
    id: "lists",
    nome: "Lists",
    resumo: {
      "pt-BR": "Crie, compartilhe e acompanhe dados em listas.",
      en: "Create, share, and track data inside lists.",
    },
    url: "https://www.office.com/launch/lists",
    categorias: ["produtividade", "conteudo"],
  },
  {
    id: "loop",
    nome: "Loop",
    resumo: {
      "pt-BR": "Pensar, planejar e criar junto.",
      en: "Enabling teams to think, plan, and create together.",
    },
    url: "https://loop.cloud.microsoft",
    categorias: ["produtividade"],
  },
  {
    id: "power-pages",
    nome: "Power Pages",
    resumo: {
      "pt-BR": "Sites corporativos seguros, com pouco código.",
      en: "Craft secure, low-code business websites with ease.",
    },
    url: "https://make.powerpages.microsoft.com",
    categorias: ["produtividade", "utilitarios", "desenvolvimento"],
  },
  {
    id: "planner",
    nome: "Planner",
    resumo: {
      "pt-BR": "Planos, tarefas, arquivos e progresso.",
      en: "Create plans, organize and assign tasks, share files, and get progress updates.",
    },
    url: "https://planner.cloud.microsoft",
    categorias: ["produtividade", "educacao", "projetos"],
  },
  {
    id: "power-automate",
    nome: "Power Automate",
    resumo: {
      "pt-BR": "Automatize fluxos e sincronizações.",
      en: "Sync files and more to simplify your work.",
    },
    url: "https://make.powerautomate.com",
    categorias: ["produtividade", "utilitarios"],
  },
  {
    id: "power-apps",
    nome: "Power Apps",
    resumo: {
      "pt-BR": "Aplicativos web e móveis com os dados que a empresa já usa.",
      en: "Build mobile and web apps with the data your organization already uses.",
    },
    url: "https://make.powerapps.com",
    categorias: ["desenvolvimento"],
  },
  {
    id: "sway",
    nome: "Sway",
    resumo: {
      "pt-BR": "Relatórios e apresentações interativas.",
      en: "Create interactive reports and presentations.",
    },
    url: "https://sway.cloud.microsoft",
    categorias: ["produtividade", "utilitarios", "educacao"],
  },
  {
    id: "todo",
    nome: "To Do",
    resumo: { "pt-BR": "Liste e gerencie suas tarefas.", en: "List and manage your tasks." },
    url: "https://to-do.office.com",
    categorias: ["produtividade", "utilitarios"],
  },
  {
    id: "visio",
    nome: "Visio",
    resumo: {
      "pt-BR": "Comunique informação complexa visualmente.",
      en: "Simplify and communicate complex information visually.",
    },
    url: "https://www.office.com/launch/visio",
    categorias: ["produtividade", "utilitarios"],
  },
  {
    id: "whiteboard",
    nome: "Whiteboard",
    resumo: {
      "pt-BR": "Quadro livre para caneta, toque e teclado.",
      en: "Ideate and collaborate on a freeform canvas designed for pen, touch and keyboard.",
    },
    url: "https://whiteboard.office.com",
    categorias: ["produtividade", "conteudo"],
  },
  {
    id: "pessoas",
    nome: "Pessoas",
    resumo: {
      "pt-BR": "Agrupe, compartilhe e gerencie contatos.",
      en: "Group, share, and manage contacts.",
    },
    url: "https://people.cloud.microsoft",
    categorias: ["utilitarios"],
  },
  {
    id: "admin",
    nome: "Admin",
    resumo: {
      "pt-BR": "Portal de administração da assinatura.",
      en: "Your admin web portal for subscription management.",
    },
    url: "https://admin.cloud.microsoft",
    categorias: ["utilitarios"],
  },
];

/** Ordem das abas, igual à do portal. */
export const CATEGORIAS: Categoria[] = [
  "produtividade",
  "utilitarios",
  "educacao",
  "comunicacao",
  "conteudo",
  "projetos",
  "experiencia",
  "desenvolvimento",
];

/**
 * "Mais utilizados" — os mesmos do topo do portal, na mesma ordem.
 * Lista curada: o Graph nao expoe o ranking de uso do portal, e um "mais
 * usados" inventado a partir de nada seria pior do que uma lista assumida.
 */
export const MAIS_USADOS = [
  "outlook",
  "word",
  "excel",
  "powerpoint",
  "onenote",
  "onedrive",
  "teams",
  "sharepoint",
  "clipchamp",
];

export const porId = (id: string) => APPS.find((a) => a.id === id);

export const porCategoria = (c: Categoria) =>
  APPS.filter((a) => a.categorias.includes(c));
