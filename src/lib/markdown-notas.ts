// Markdown das notas de release (#1321) — parser PURO, sem dependência.
//
// Por que não `react-markdown`+`rehype-sanitize`: o DoD manda conferir antes de
// somar dependência, e o subconjunto que o feed REALMENTE usa é pequeno. Medi o
// corpo da v0.46.0 publicada: `## titulo`, `- item`, `**negrito**`. Só isso.
//
// A segurança aqui é ESTRUTURAL, não filtrada: este parser devolve DADOS, e o
// componente os transforma em elementos React — nunca em HTML. Não existe
// `dangerouslySetInnerHTML` no caminho, então "negar HTML por default" não
// depende de uma denylist estar completa: `<script>` no feed vira texto visível,
// porque texto é a única coisa que sabemos produzir.
//
// Sintaxe desconhecida fica LITERAL de propósito — nota de release nunca deve
// sumir da tela porque o parser não entendeu um caractere.
//
// Rode com:  node --test --experimental-strip-types src/lib/markdown-notas.test.ts

/** Pedaço de texto de uma linha, com as marcas que sobreviveram ao parse. */
export interface Trecho {
  texto: string;
  forte?: boolean;
  /** Só http(s). Qualquer outro esquema não vira link (fica literal). */
  href?: string;
}

export type Bloco =
  | { tipo: "titulo"; trechos: Trecho[] }
  | { tipo: "paragrafo"; trechos: Trecho[] }
  | { tipo: "lista"; itens: Trecho[][] };

const RE_INLINE = /\*\*([\s\S]+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** `javascript:`/`data:` e afins nunca viram href — só http(s). */
function hrefSeguro(url: string): string | undefined {
  const limpo = url.trim();
  return /^https?:\/\//i.test(limpo) ? limpo : undefined;
}

/** Quebra uma linha em trechos, honrando `**negrito**` e `[texto](url)`. */
export function trechos(linha: string): Trecho[] {
  const saida: Trecho[] = [];
  let ultimo = 0;
  for (const m of linha.matchAll(RE_INLINE)) {
    const inicio = m.index ?? 0;
    if (inicio > ultimo) saida.push({ texto: linha.slice(ultimo, inicio) });
    if (m[1] !== undefined) {
      saida.push({ texto: m[1], forte: true });
    } else {
      const href = hrefSeguro(m[3] ?? "");
      // Link com esquema não permitido: mantém o texto do markdown, sem href.
      saida.push(href ? { texto: m[2] ?? "", href } : { texto: m[0] });
    }
    ultimo = inicio + m[0].length;
  }
  if (ultimo < linha.length) saida.push({ texto: linha.slice(ultimo) });
  return saida.length ? saida : [{ texto: linha }];
}

/**
 * Converte o corpo do changelog em blocos renderizáveis.
 *
 * Linhas em branco separam blocos. `#`..`###` viram título (um só nível visual —
 * o modal é pequeno demais para hierarquia). `-`/`*` viram item de lista.
 */
export function blocosDeNotas(markdown: string): Bloco[] {
  const blocos: Bloco[] = [];
  let paragrafo: string[] = [];
  let lista: Trecho[][] | null = null;

  const fecharParagrafo = () => {
    if (paragrafo.length) {
      blocos.push({ tipo: "paragrafo", trechos: trechos(paragrafo.join(" ")) });
      paragrafo = [];
    }
  };
  const fecharLista = () => {
    if (lista?.length) blocos.push({ tipo: "lista", itens: lista });
    lista = null;
  };

  for (const bruta of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const linha = bruta.trim();
    if (!linha) {
      fecharParagrafo();
      fecharLista();
      continue;
    }
    const titulo = /^#{1,6}\s+(.*)$/.exec(linha);
    if (titulo) {
      fecharParagrafo();
      fecharLista();
      blocos.push({ tipo: "titulo", trechos: trechos(titulo[1]) });
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(linha);
    if (item) {
      fecharParagrafo();
      lista ??= [];
      lista.push(trechos(item[1]));
      continue;
    }
    fecharLista();
    paragrafo.push(linha);
  }
  fecharParagrafo();
  fecharLista();
  return blocos;
}
