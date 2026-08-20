/**
 * Ponte para o navegador embutido (webviews nativos gerenciados no Rust).
 *
 * O React manda o RETANGULO onde o webview deve aparecer, em pixels logicos
 * (CSS), medido com getBoundingClientRect. Como a janela roda decorations:false
 * e o webview principal preenche a janela inteira, a origem do viewport (0,0)
 * coincide com a origem da janela — então o rect do DOM já é o que o Rust quer.
 */

import { urlDeBusca } from "@/lib/navigator-tabs";
// #1033: fronteira mock/real no ponto único (`./tauri`), não mais duplicada aqui.
import { inTauri, invoke } from "./tauri.ts";

export interface Retangulo {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Abre (ou revela) uma aba no retângulo dado e a deixa em foco. */
export async function abrir(
  id: string,
  url: string,
  r: Retangulo
): Promise<void> {
  if (!inTauri()) return;
  return invoke("browser_abrir", { id, url, x: r.x, y: r.y, w: r.w, h: r.h });
}

/** Traz uma aba já aberta para frente, reposicionando. */
export async function trocar(id: string, r: Retangulo): Promise<void> {
  if (!inTauri()) return;
  return invoke("browser_trocar", { id, x: r.x, y: r.y, w: r.w, h: r.h });
}

/** Reposiciona a aba ativa (resize da janela, sidebar abrir/fechar). */
export async function layout(id: string, r: Retangulo): Promise<void> {
  if (!inTauri()) return;
  return invoke("browser_layout", { id, x: r.x, y: r.y, w: r.w, h: r.h });
}

export async function fechar(id: string): Promise<void> {
  if (!inTauri()) return;
  return invoke("browser_fechar", { id });
}

/** Esconde todos os webviews — chamar ao sair da tela do navegador. */
export async function esconderTodas(): Promise<void> {
  if (!inTauri()) return;
  return invoke("browser_esconder_todas");
}

/** Recarrega a página navegada NA aba (não o app) — F5/Ctrl+R do Navigator (#310). */
export async function recarregar(id: string): Promise<void> {
  if (!inTauri()) return;
  return invoke("browser_recarregar", { id });
}

/** Destrói todas as webviews-filhas — cleanup no boot contra webview órfã (#310). */
export async function fecharTodas(): Promise<void> {
  if (!inTauri()) return;
  return invoke("browser_fechar_todas");
}

/**
 * Captura a aba como um data URL JPEG (#275 rework) — chamado ANTES de esconder
 * a webview ao abrir um overlay, pra mostrar a imagem estática por baixo (o
 * conteúdo congela mas não some). `null` no mock/web ou se a captura falhar.
 */
export async function snapshot(id: string): Promise<string | null> {
  if (!inTauri()) return null;
  return (await invoke<string | null>("browser_snapshot", { id })) ?? null;
}

/**
 * Interpreta o que a pessoa digitou na barra do Cruiser: se parece endereço,
 * vira URL; senão, vira busca na web. `nome` é o rótulo curto para a aba.
 */
export function interpretar(entrada: string): {
  url: string;
  nome: string;
  tipo: "url" | "busca";
} {
  const t = entrada.trim();
  const jaTemEsquema = /^https?:\/\//i.test(t);
  // "parece dominio": sem espaços e com um ponto seguido de 2+ letras.
  const pareceUrl = jaTemEsquema || /^[^\s]+\.[^\s]{2,}$/.test(t);

  if (pareceUrl) {
    const url = jaTemEsquema ? t : `https://${t}`;
    let nome = t;
    try {
      nome = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      // deixa o texto cru como nome
    }
    return { url, nome, tipo: "url" };
  }
  return {
    // Provedor de pesquisa configurável (#305) — antes fixo em Bing.
    url: urlDeBusca(t),
    nome: t,
    tipo: "busca",
  };
}
