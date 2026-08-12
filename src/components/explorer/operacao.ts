// #724 (Explorer S4 UI): helpers PUROS da transferência com progresso — plano de
// resolução de conflitos (Substituir/Pular/Manter ambos), geração de nome
// "manter ambos" ( (2), (3)…) e formatação de ETA/velocidade. Em `.ts` puro (sem
// React) de propósito — testável no `node --test` e reusável. A UI (progress
// panel, conflito dialog, wiring do colar) vive nos `.tsx`; aqui só a lógica.
import type { FsConflict } from "@/lib/types";
// Extensão `.ts` explícita: o `node --test` (strip-types) resolve por caminho
// exato, e o app (Vite + tsconfig `allowImportingTsExtensions`) aceita igual.
import { juntarCaminho, nomeBase, separarNomeExt } from "./caminho.ts";

/** Resolução única aplicada a TODOS os conflitos de uma transferência (v1). */
export type ResolucaoConflito = "substituir" | "pular" | "manterAmbos";

/** Um par origem→destino já resolvido, pronto pra `copiarComProgresso`/`moverComProgresso`. */
export interface PlanoItem {
  from: string;
  to: string;
}

/**
 * Gera um nome "manter ambos" sufixando " (2)", " (3)"… preservando a extensão
 * ("foto.png" → "foto (2).png"; "Pasta" → "Pasta (2)"). `usadosLower` é o
 * conjunto de nomes JÁ ocupados no destino (minúsculos) — inclui os nomes em
 * conflito conhecidos e os que este mesmo lote já reservou.
 */
export function nomeManterAmbos(nome: string, usadosLower: Set<string>): string {
  const { base, ext } = separarNomeExt(nome);
  let n = 2;
  let candidato = `${base} (${n})${ext}`;
  while (usadosLower.has(candidato.toLowerCase())) {
    n += 1;
    candidato = `${base} (${n})${ext}`;
  }
  return candidato;
}

/**
 * Monta o plano de destinos de uma op de colar/copiar/mover aplicando UMA
 * resolução a todos os conflitos (v1 — decisão única, não por-item). Fontes sem
 * conflito entram com o nome original. Nos conflitos:
 *  - `substituir` → mesmo destino (o backend sobrescreve);
 *  - `pular`      → sai do plano;
 *  - `manterAmbos`→ novo nome único ( (n) ), sem colidir com o destino conhecido
 *    nem com nomes já reservados neste lote.
 *
 * Limite conhecido (v1): "manter ambos" só conhece os nomes que o
 * `checarConflitos` reportou — se o destino tiver um "foo (2).txt" que NÃO
 * colidia com nenhuma fonte, ele não entra no conjunto e o (2) pode reincidir. O
 * caminho comum (colar N itens de uma vez) está coberto.
 */
export function planejarTransferencia(
  sources: string[],
  destDir: string,
  conflitos: FsConflict[],
  resolucao: ResolucaoConflito,
): PlanoItem[] {
  const conflitantes = new Set(conflitos.map((c) => c.name.toLowerCase()));
  const usados = new Set(conflitantes);
  const plano: PlanoItem[] = [];
  for (const from of sources) {
    const nome = nomeBase(from);
    if (!conflitantes.has(nome.toLowerCase())) {
      plano.push({ from, to: juntarCaminho(destDir, nome) });
      continue;
    }
    if (resolucao === "pular") continue;
    if (resolucao === "substituir") {
      plano.push({ from, to: juntarCaminho(destDir, nome) });
      continue;
    }
    const novo = nomeManterAmbos(nome, usados);
    usados.add(novo.toLowerCase());
    plano.push({ from, to: juntarCaminho(destDir, novo) });
  }
  return plano;
}

/** Rótulos i18n das unidades de duração (passados de fora pra manter puro). */
export interface RotulosDuracao {
  seg: string;
  min: string;
  hora: string;
}

/**
 * ETA legível a partir de milissegundos: "45 s", "2 min", "2 min 30 s",
 * "1 h 5 min". `null`/negativo/não-finito → `null` (a UI omite o tempo).
 */
export function formatarEta(
  etaMs: number | null,
  r: RotulosDuracao,
): string | null {
  if (etaMs == null || !Number.isFinite(etaMs) || etaMs < 0) return null;
  const totalSeg = Math.round(etaMs / 1000);
  if (totalSeg < 60) return `${totalSeg} ${r.seg}`;
  const totalMin = Math.floor(totalSeg / 60);
  if (totalMin < 60) {
    const seg = totalSeg % 60;
    return seg > 0 ? `${totalMin} ${r.min} ${seg} ${r.seg}` : `${totalMin} ${r.min}`;
  }
  const horas = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min > 0 ? `${horas} ${r.hora} ${min} ${r.min}` : `${horas} ${r.hora}`;
}

/**
 * Velocidade instantânea (bytes/s) a partir do delta de bytes entre dois eventos
 * de progresso. Delta não-positivo ou tempo ≤ 0 → 0 (evita ruído/negativo).
 */
export function calcVelocidade(
  bytes: number,
  bytesAnterior: number,
  msDecorrido: number,
): number {
  if (msDecorrido <= 0) return 0;
  const delta = bytes - bytesAnterior;
  if (delta <= 0) return 0;
  return (delta * 1000) / msDecorrido;
}
