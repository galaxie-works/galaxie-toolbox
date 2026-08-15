/**
 * CSV → matriz de valores para pré-visualização (#451 · épico #178, S7).
 *
 * Parser client-side tolerante (RFC 4180): detecta delimitador (`,` `;` tab),
 * respeita aspas + escape `""`, lida com `\r\n`/`\n` e BOM. Valores como texto
 * puro (sem HTML/fórmula) → seguro por construção. Módulo puro, testável.
 */
export interface CsvTabela {
  /** Linhas já capadas em `MAX_LINHAS`. Primeira linha = header. */
  linhas: string[][];
  /** Total de linhas no arquivo (antes do cap). */
  total: number;
  /** true quando `total > linhas.length` (arquivo grande, mostrado parcial). */
  truncado: boolean;
  delimitador: string;
}

/**
 * Teto de linhas materializadas (#941). Antes era 2000 (o preview só renderizava
 * um `<table>` inteiro e travava). Com o grid VIRTUALIZADO (só linhas visíveis no
 * DOM) o teto sobe para 100k: rende dataset grande sem jank e sem OOM em arquivo
 * patológico (10M linhas) — o restante fica sob o aviso `truncado`.
 */
export const MAX_LINHAS_CSV = 100000;

// `|` incluído por último para o `.psv` funcionar; em CSV/TSV normal ele quase
// nunca aparece na 1ª linha, então não rouba a detecção (#941).
const CANDIDATOS = [",", ";", "\t", "|"];

/** Detecta o delimitador contando ocorrências fora de aspas na 1ª linha. */
function detectarDelimitador(texto: string): string {
  const amostra = texto.slice(0, 8192);
  let melhor = ",";
  let melhorN = -1;
  for (const d of CANDIDATOS) {
    let n = 0;
    let emAspas = false;
    for (let i = 0; i < amostra.length; i++) {
      const c = amostra[i];
      if (c === '"') emAspas = !emAspas;
      else if (c === "\n" && !emAspas) break;
      else if (c === d && !emAspas) n++;
    }
    if (n > melhorN) {
      melhorN = n;
      melhor = d;
    }
  }
  return melhor;
}

export function parseCsv(textoBruto: string): CsvTabela {
  // Remove BOM UTF-8.
  const texto =
    textoBruto.charCodeAt(0) === 0xfeff ? textoBruto.slice(1) : textoBruto;
  const delim = detectarDelimitador(texto);

  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let emAspas = false;
  let total = 0;
  let temConteudo = false;

  const fecharCampo = () => {
    linha.push(campo);
    campo = "";
  };
  const fecharLinha = () => {
    fecharCampo();
    total++;
    if (linhas.length < MAX_LINHAS_CSV) linhas.push(linha);
    linha = [];
    temConteudo = false;
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (emAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          emAspas = false;
        }
      } else {
        campo += c;
      }
      temConteudo = true;
    } else if (c === '"') {
      emAspas = true;
      temConteudo = true;
    } else if (c === delim) {
      fecharCampo();
      temConteudo = true;
    } else if (c === "\n") {
      fecharLinha();
    } else if (c !== "\r") {
      campo += c;
      temConteudo = true;
    }
  }
  // Última linha sem `\n` final (só se houver algo pendente).
  if (temConteudo || campo !== "" || linha.length > 0) fecharLinha();

  return {
    linhas,
    total,
    truncado: total > linhas.length,
    delimitador: delim,
  };
}

/**
 * Decodifica os bytes do CSV para texto (#941). UTF-8 é o caso comum (e o BOM é
 * removido no `parseCsv`); mas CSV exportado do Excel pt-BR costuma vir em
 * Windows-1252/Latin-1 (acentos como bytes 0x80-0xFF). Tenta UTF-8 ESTRITO
 * (`fatal`) — se bater byte inválido, cai para `windows-1252`, que nunca falha
 * e preserva os acentos em vez de virar `` (U+FFFD).
 */
export function decodificarTexto(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Alinhamento de uma coluna do grid: numérico (à direita) ou texto (à esquerda). */
export type AlinhamentoColuna = "num" | "txt";

export interface ColunaMeta {
  alinhamentos: AlinhamentoColuna[];
  /** Largura estimada (px) por coluna, para o grid virtualizado ter scroll H. */
  larguras: number[];
  /** Nº de colunas (máximo entre header e as linhas amostradas). */
  numColunas: number;
}

/**
 * Uma célula é numérica se representa um número finito (#941). Aceita o caso
 * direto (`Number(v)` finito) e normaliza formatos comuns de planilha: milhar
 * com ponto/espaço + decimal com vírgula (pt-BR "1.234,56"), sinais e `%`/moeda.
 * Mantido simples de propósito — só decide alinhamento, não converte valor.
 */
export function ehCelulaNumerica(valor: string): boolean {
  const v = valor.trim();
  if (v === "") return false;
  if (Number.isFinite(Number(v))) return true;
  // Remove espaços, `%` e símbolos de moeda comuns; normaliza pt-BR → ponto.
  const semRuido = v.replace(/[\s%$€£R]/g, "");
  const ptbr = semRuido.replace(/\./g, "").replace(",", ".");
  return ptbr !== "" && Number.isFinite(Number(ptbr));
}

// Amostra para inferir alinhamento/largura sem varrer 100k linhas.
const AMOSTRA_CSV = 200;
// Estimativa de largura por caractere no `text-xs` + padding lateral (px).
const PX_POR_CHAR = 7;
const PAD_CELULA = 20;
const LARGURA_MIN = 56;
const LARGURA_MAX = 384;

/**
 * Infere, por AMOSTRAGEM (header + primeiras `AMOSTRA_CSV` linhas), o alinhamento
 * de cada coluna (maioria numérica → à direita) e uma largura fixa por coluna
 * (#941). Larguras fixas são o que permite header + linhas virtualizadas ficarem
 * alinhados e o scroll horizontal ter uma extensão total previsível — o browser
 * não pode auto-dimensionar colunas quando só as linhas visíveis estão no DOM.
 */
export function calcularColunasCsv(linhas: string[][]): ColunaMeta {
  const amostra = linhas.slice(0, AMOSTRA_CSV + 1);
  let numColunas = 0;
  for (const l of amostra) if (l.length > numColunas) numColunas = l.length;

  const alinhamentos: AlinhamentoColuna[] = [];
  const larguras: number[] = [];
  const header = linhas[0] ?? [];
  for (let c = 0; c < numColunas; c++) {
    let numericos = 0;
    let preenchidos = 0;
    let maxChars = (header[c] ?? "").length;
    // Corpo da amostra (pula o header na contagem de numéricos).
    for (let r = 1; r < amostra.length; r++) {
      const cel = amostra[r][c] ?? "";
      if (cel.length > maxChars) maxChars = cel.length;
      if (cel.trim() === "") continue;
      preenchidos++;
      if (ehCelulaNumerica(cel)) numericos++;
    }
    alinhamentos.push(
      preenchidos > 0 && numericos * 2 > preenchidos ? "num" : "txt",
    );
    larguras.push(
      Math.min(
        LARGURA_MAX,
        Math.max(LARGURA_MIN, maxChars * PX_POR_CHAR + PAD_CELULA),
      ),
    );
  }
  return { alinhamentos, larguras, numColunas };
}
