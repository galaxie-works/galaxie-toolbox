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

/** Teto de linhas renderizadas (preview é para "decidir", não abrir o dataset). */
export const MAX_LINHAS_CSV = 2000;

const CANDIDATOS = [",", ";", "\t"];

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
