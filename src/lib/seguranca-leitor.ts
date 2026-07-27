// Segurança do leitor de e-mail (#91) — lógica PURA e testável (sem React, sem
// Graph, sem DOM). Três frentes:
//  (a) link-safety: analisa um link do corpo (texto × href) e sinaliza mismatch
//      de domínio, encurtadores, hosts por IP, IDN/punycode, http inseguro e
//      redirecionamentos embutidos — pra mostrar o DESTINO REAL antes de abrir.
//  (b) autenticação do remetente: parse do header `Authentication-Results`
//      (SPF/DKIM/DMARC) → veredito pra um badge (verde/amarelo/vermelho).
//  (c) Reply-To divergente do From.
//
// Tudo aqui é função pura pra rodar headless nos testes (seguranca-leitor.test.ts).

// --- (b) Autenticação do remetente (SPF/DKIM/DMARC) ------------------------

/** Veredito de um mecanismo de autenticação, como aparece no header. */
export type EstadoAuth =
  | "pass"
  | "fail"
  | "softfail"
  | "neutral"
  | "none"
  | "temperror"
  | "permerror"
  | "unknown";

export interface ResultadoAutenticacao {
  spf: EstadoAuth | null;
  dkim: EstadoAuth | null;
  dmarc: EstadoAuth | null;
}

/** Nível derivado para o badge do leitor. */
export type NivelAutenticacao = "autenticado" | "parcial" | "falhou" | "indisponivel";

const ESTADOS_VALIDOS: ReadonlySet<string> = new Set([
  "pass",
  "fail",
  "softfail",
  "neutral",
  "none",
  "temperror",
  "permerror",
]);

/** Normaliza um token de estado (ex.: "Pass", "PermError") para `EstadoAuth`. */
function normalizarEstado(bruto: string | undefined): EstadoAuth | null {
  if (!bruto) return null;
  const v = bruto.trim().toLowerCase();
  if (ESTADOS_VALIDOS.has(v)) return v as EstadoAuth;
  return "unknown";
}

/**
 * Extrai TODOS os vereditos de um mecanismo (`spf`/`dkim`/`dmarc`) do conjunto
 * de headers `Authentication-Results`. Uma mensagem pode ter várias assinaturas
 * DKIM (várias ocorrências) ou vários headers AR (ARC/relay), então varremos
 * tudo. Regex: nome do mecanismo em fronteira de palavra, `=`, e o token do
 * resultado — ignora o que vem depois (`smtp.mailfrom=`, `header.d=`, etc).
 */
function coletarEstados(headers: string[], mecanismo: string): EstadoAuth[] {
  const re = new RegExp(`(?:^|[;\\s(])${mecanismo}\\s*=\\s*([a-zA-Z]+)`, "gi");
  const achados: EstadoAuth[] = [];
  for (const h of headers) {
    if (!h) continue;
    for (const m of h.matchAll(re)) {
      const e = normalizarEstado(m[1]);
      if (e) achados.push(e);
    }
  }
  return achados;
}

/**
 * Reduz vários vereditos de um mesmo mecanismo a um só. `pass` vence (basta uma
 * assinatura DKIM válida pra alinhar); senão devolve o pior veredito relevante
 * na ordem fail > softfail > permerror > temperror > neutral > none > unknown.
 */
function reduzirEstado(estados: EstadoAuth[]): EstadoAuth | null {
  if (estados.length === 0) return null;
  if (estados.includes("pass")) return "pass";
  const prioridade: EstadoAuth[] = [
    "fail",
    "softfail",
    "permerror",
    "temperror",
    "neutral",
    "none",
    "unknown",
  ];
  for (const p of prioridade) {
    if (estados.includes(p)) return p;
  }
  return estados[0];
}

/**
 * Faz o parse de um ou mais headers `Authentication-Results` (mais, opcional,
 * `Received-SPF` como fallback só pro SPF). Devolve o veredito de cada
 * mecanismo, ou `null` quando o mecanismo não aparece.
 */
export function parseAuthResults(
  authResults: string[],
  receivedSpf: string[] = [],
): ResultadoAutenticacao {
  const spf = reduzirEstado(coletarEstados(authResults, "spf"));
  const dkim = reduzirEstado(coletarEstados(authResults, "dkim"));
  const dmarc = reduzirEstado(coletarEstados(authResults, "dmarc"));

  // Fallback de SPF: alguns provedores só mandam `Received-SPF: pass (...)`.
  let spfFinal = spf;
  if (spfFinal === null && receivedSpf.length > 0) {
    const estados = receivedSpf
      .map((h) => normalizarEstado(h.trim().split(/[\s(]/)[0]))
      .filter((e): e is EstadoAuth => e !== null);
    spfFinal = reduzirEstado(estados);
  }

  return { spf: spfFinal, dkim, dmarc };
}

/**
 * Deriva o nível do badge a partir dos vereditos. `dmarc=pass` já basta pra
 * "autenticado" (o DMARC exige alinhamento de SPF **ou** DKIM). Qualquer falha
 * dura (fail) sem DMARC passando vira "falhou". Sem nenhum dado → "indisponível".
 */
export function nivelAutenticacao(r: ResultadoAutenticacao): NivelAutenticacao {
  if (r.spf === null && r.dkim === null && r.dmarc === null) return "indisponivel";
  if (r.dmarc === "pass") return "autenticado";
  if (r.dmarc === "fail" || r.spf === "fail" || r.dkim === "fail") return "falhou";
  if (r.spf === "pass" && r.dkim === "pass") return "autenticado";
  return "parcial";
}

// --- (c) Reply-To divergente -----------------------------------------------

export interface EnderecoNomeado {
  nome: string;
  email: string;
}

export interface DivergenciaReplyTo {
  divergente: boolean;
  /** Endereços de Reply-To que diferem do From (minúsculos). */
  enderecos: string[];
}

/** Normaliza um e-mail pra comparação (trim + minúsculas). */
function normalizarEmail(e: string): string {
  return (e ?? "").trim().toLowerCase();
}

/**
 * Reply-To divergente do From é tática comum de phishing: você responde
 * achando que fala com o remetente, mas a resposta vai pro atacante. Divergente
 * = existe ao menos um endereço de Reply-To diferente do From.
 */
export function replyToDivergente(
  fromEmail: string,
  replyTo: EnderecoNomeado[],
): DivergenciaReplyTo {
  const from = normalizarEmail(fromEmail);
  const diferentes: string[] = [];
  for (const r of replyTo) {
    const e = normalizarEmail(r.email);
    if (e && e !== from && !diferentes.includes(e)) diferentes.push(e);
  }
  // Só é divergência se sobrar algum endereço != From. Se o Reply-To só repete
  // o próprio From (ou está vazio), não há divergência.
  return { divergente: diferentes.length > 0, enderecos: diferentes };
}

// --- (a) Link-safety --------------------------------------------------------

/** Encurtadores/redirecionadores conhecidos — o destino real fica escondido. */
const ENCURTADORES: ReadonlySet<string> = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "buff.ly",
  "is.gd",
  "cutt.ly",
  "rebrand.ly",
  "bit.do",
  "shorturl.at",
  "rb.gy",
  "t.ly",
  "tiny.cc",
  "lnkd.in",
  "trib.al",
  "s.id",
  "v.gd",
  "shorte.st",
  "adf.ly",
  "soo.gd",
  "clck.ru",
  "qr.ae",
  "db.tt",
  "po.st",
  "bl.ink",
  "short.io",
  "smarturl.it",
]);

/** Chaves de parâmetro comumente usadas para redirecionamento aberto. */
const PARAMS_REDIRECT: ReadonlySet<string> = new Set([
  "url",
  "redirect",
  "redirect_uri",
  "redir",
  "next",
  "target",
  "dest",
  "destination",
  "u",
  "r",
  "goto",
  "return",
  "returnurl",
  "return_url",
  "continue",
  "link",
  "out",
]);

/**
 * Sufixos públicos de 2 níveis mais comuns (aproximação da PSL, sem trazer a
 * lista inteira). Usado pra derivar o "domínio registrável" (eTLD+1) e comparar
 * o texto do link com o host real. Ex.: `mail.google.com` → `google.com`;
 * `foo.bar.co.uk` → `bar.co.uk`.
 */
const SUFIXOS_DUPLOS: ReadonlySet<string> = new Set([
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "com.br",
  "net.br",
  "org.br",
  "gov.br",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "co.nz",
  "co.za",
  "com.mx",
  "com.ar",
  "com.co",
  "co.in",
  "com.tr",
  "com.cn",
  "com.hk",
  "com.sg",
  "com.pt",
]);

/** Host é um IPv4 literal? (IPv6 chega entre colchetes, tratado à parte.) */
function ehIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).every((o) => Number(o) <= 255);
}

/**
 * Domínio registrável (eTLD+1) de um host, com a tabela reduzida de sufixos
 * duplos. Devolve o host inteiro se tiver poucas partes.
 */
export function dominioRegistravel(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  const partes = h.split(".").filter(Boolean);
  if (partes.length <= 2) return partes.join(".");
  const ultimosDois = partes.slice(-2).join(".");
  if (SUFIXOS_DUPLOS.has(ultimosDois)) {
    return partes.slice(-3).join(".");
  }
  return ultimosDois;
}

/**
 * Tenta extrair um host/domínio do TEXTO visível do link, quando o texto parece
 * um endereço (ex.: "banco.com", "www.banco.com", "https://banco.com/x",
 * "clique em paypal.com"). Devolve o host em minúsculas ou `null` se o texto
 * não aparenta ser uma URL/domínio (ex.: "clique aqui").
 */
export function hostDoTexto(texto: string): string | null {
  const t = (texto ?? "").trim();
  if (!t) return null;
  // 1) texto que já é uma URL completa
  const comEsquema = t.match(/\bhttps?:\/\/([^/\s"'<>]+)/i);
  if (comEsquema) {
    return comEsquema[1].toLowerCase().replace(/:\d+$/, "");
  }
  // 2) texto que é (ou contém) um domínio "nu" — ao menos dois labels e um TLD
  //    alfabético de 2+ letras. Evita casar "arquivo.pdf" exigindo TLD não-numérico.
  const nu = t.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i);
  if (nu) {
    const host = nu[1].toLowerCase();
    // descarta nomes de arquivo comuns (ex.: documento.pdf) que não são domínios
    const tld = host.split(".").pop() ?? "";
    const EXT_ARQUIVO = new Set([
      "pdf",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "png",
      "jpg",
      "jpeg",
      "gif",
      "zip",
      "txt",
      "csv",
      "ppt",
      "pptx",
    ]);
    if (host.split(".").length === 2 && EXT_ARQUIVO.has(tld)) return null;
    return host;
  }
  return null;
}

/** Códigos de aviso que a UI traduz para texto legível. */
export type AvisoLink =
  | "mismatch"
  | "encurtador"
  | "ip"
  | "punycode"
  | "inseguro"
  | "redirecionamento";

export interface AnaliseLink {
  /** href original, como veio no e-mail. */
  href: string;
  /** Host de destino real (minúsculo, sem porta). Vazio se o href não parseia. */
  hostDestino: string;
  /** Domínio registrável do destino (eTLD+1). */
  dominioDestino: string;
  /** Texto visível do link. */
  textoLink: string;
  /** Esquema do href (ex.: "https:"). */
  esquema: string;
  /** href não parseia como URL válida. */
  invalido: boolean;
  /** O texto aparenta um domínio diferente do host real. */
  mismatch: boolean;
  /** Domínio aparente no texto (quando o texto parece uma URL/domínio). */
  dominioTexto: string | null;
  /** Host de destino é um encurtador conhecido. */
  encurtador: boolean;
  /** Host de destino é um IP literal. */
  ip: boolean;
  /** Host de destino usa punycode/IDN (risco de homógrafo). */
  punycode: boolean;
  /** Link não-HTTPS (http puro). */
  inseguro: boolean;
  /** href embute outra URL/param de redirecionamento. */
  redirecionamento: boolean;
  /** Lista de avisos ativos (pra UI). */
  avisos: AvisoLink[];
  /** Há ao menos um sinal forte de risco (mismatch/encurtador/ip/punycode/redirect). */
  suspeito: boolean;
}

/** O valor do parâmetro parece uma URL ou host (indício de redirect aberto)? */
function valorPareceUrl(v: string): boolean {
  if (/https?:\/\//i.test(v)) return true;
  if (/^\/\//.test(v)) return true; // protocol-relative
  // domínio nu com TLD alfabético
  return /(?:[a-z0-9-]+\.)+[a-z]{2,}/i.test(v);
}

/**
 * Analisa um link do corpo do e-mail (texto visível × href real) e devolve os
 * sinais de risco. Núcleo do modal de link-safety — o app mostra o DESTINO REAL
 * e os avisos ANTES de abrir. Não faz rede (não segue redirects); detecta os
 * padrões estáticos de phishing.
 */
export function analisarLink(textoLink: string, href: string): AnaliseLink {
  const texto = (textoLink ?? "").trim();
  const bruto = (href ?? "").trim();

  let url: URL | null = null;
  try {
    url = new URL(bruto);
  } catch {
    url = null;
  }

  if (!url) {
    return {
      href: bruto,
      hostDestino: "",
      dominioDestino: "",
      textoLink: texto,
      esquema: "",
      invalido: true,
      mismatch: false,
      dominioTexto: null,
      encurtador: false,
      ip: false,
      punycode: false,
      inseguro: false,
      redirecionamento: false,
      avisos: [],
      suspeito: false,
    };
  }

  const esquema = url.protocol.toLowerCase();
  // hostname já vem sem porta; IPv6 vem entre colchetes.
  const host = url.hostname.toLowerCase();
  const hostSemColchetes = host.replace(/^\[|\]$/g, "");
  const semWww = host.replace(/^www\./, "");
  const dominioDestino = dominioRegistravel(host);

  const encurtador = ENCURTADORES.has(semWww);
  const ip = ehIpv4(hostSemColchetes) || host.startsWith("[");
  const punycode = host.split(".").some((l) => l.startsWith("xn--"));
  const inseguro = esquema === "http:";

  // Redirecionamento embutido: outra URL no path ou um param de redirect com
  // valor que parece URL/host.
  let redirecionamento = false;
  for (const [k, v] of url.searchParams) {
    if (PARAMS_REDIRECT.has(k.toLowerCase()) && valorPareceUrl(v)) {
      redirecionamento = true;
      break;
    }
  }
  if (!redirecionamento) {
    // URL aninhada em qualquer lugar depois do host (path/query cru).
    const depoisDoHost = bruto.slice(bruto.indexOf(host) + host.length);
    if (/https?(?::|%3a)\/\/|%2f%2f/i.test(depoisDoHost)) redirecionamento = true;
  }

  // Mismatch texto × href: só quando o texto aparenta um domínio.
  const dominioTexto = (() => {
    const h = hostDoTexto(texto);
    return h ? dominioRegistravel(h) : null;
  })();
  const mismatch =
    dominioTexto !== null && dominioDestino !== "" && dominioTexto !== dominioDestino;

  const avisos: AvisoLink[] = [];
  if (mismatch) avisos.push("mismatch");
  if (encurtador) avisos.push("encurtador");
  if (ip) avisos.push("ip");
  if (punycode) avisos.push("punycode");
  if (redirecionamento) avisos.push("redirecionamento");
  if (inseguro) avisos.push("inseguro");

  const suspeito = mismatch || encurtador || ip || punycode || redirecionamento;

  return {
    href: bruto,
    hostDestino: host,
    dominioDestino,
    textoLink: texto,
    esquema,
    invalido: false,
    mismatch,
    dominioTexto,
    encurtador,
    ip,
    punycode,
    inseguro,
    redirecionamento,
    avisos,
    suspeito,
  };
}
