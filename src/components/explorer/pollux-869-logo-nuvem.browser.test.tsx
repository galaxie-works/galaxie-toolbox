// #869 (item 3) — cada mount de nuvem mostra o logo do SERVIÇO, não um ícone
// genérico.
//
// A guarda mede o efeito na tela: qual imagem cada mount renderiza. Não testa
// "a função `iconeDoProvider` devolve X" — isso provaria que a minha função
// chama a si mesma. O que importa é o `src` que chega no DOM.
//
// Navegador real: em happy-dom o accordion do animate-ui não monta os filhos.
import "@/index.css";
import { describe, it, expect, beforeEach } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { IdiomaProvider } from "@/lib/idioma";
import type { CloudLocation } from "@/lib/types";
import { ArvoreArquivos } from "./arvore";

const MOUNTS: CloudLocation[] = [
  { path: "C:\\Users\\eu\\OneDrive", name: "OneDrive - Pessoal", provider: "onedrive", kind: "folder" },
  { path: "C:\\Users\\eu\\OneDrive - Galaxie", name: "OneDrive - Galaxie", provider: "onedriveCommercial", kind: "folder" },
  { path: "G:\\", name: "Google Drive", provider: "googledrive", kind: "drive" },
];

async function ate<T extends Element>(busca: () => T | null, ms = 6000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const el = busca();
    if (el) return el;
    await new Promise((r) => setTimeout(r, 60));
  }
  return null;
}

function montar(cloudLocations: CloudLocation[]) {
  render(
    <IdiomaProvider>
      <div style={{ width: 320, height: 600 }}>
        <ArvoreArquivos
          drives={[]}
          cloudLocations={cloudLocations}
          networkLocations={[]}
          acessoRapido={[]}
          pins={[]}
          onAlternarFixar={() => {}}
          onRemoverAcessoRapido={() => {}}
          homePath=""
          currentPath=""
          onNavegar={() => {}}
        />
      </div>
    </IdiomaProvider>
  );
}

/** Os `src` das imagens que a árvore renderizou, na ordem do DOM. */
function logos(): string[] {
  return [...document.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
}

describe("#869 item 3 — logo por serviço nos Cloud drives", () => {
  beforeEach(() => {
    cleanup();
  });

  it("OneDrive pessoal e comercial mostram o logo do OneDrive", async () => {
    montar(MOUNTS);
    await ate(() => (logos().length > 0 ? document.body : null));
    const onedrive = logos().filter((s) => s.includes("onedrive"));
    expect(
      onedrive.length,
      `esperava 2 logos do OneDrive; vieram ${JSON.stringify(logos())}`,
    ).toBe(2);
  });

  it("Google Drive mostra o logo do Google Drive", async () => {
    montar(MOUNTS);
    await ate(() => (logos().length > 0 ? document.body : null));
    expect(logos().some((s) => s.includes("google-drive"))).toBe(true);
  });

  it("os arquivos de logo EXISTEM — src quebrado é buraco na tela", async () => {
    // Um `<img>` com src inválido não avisa ninguém: o alt é vazio (a imagem é
    // decorativa), então a falha seria silenciosa. Aqui a rede diz.
    montar(MOUNTS);
    await ate(() => (logos().length > 0 ? document.body : null));
    // `r.ok` NÃO basta: o dev server responde 200 com o `index.html` pra
    // qualquer caminho desconhecido (fallback de SPA). Medi — com um `src`
    // propositalmente quebrado, este teste passava. É o content-type que
    // distingue "o arquivo existe" de "o servidor te deu a página inteira".
    const respostas = await Promise.all(
      [...new Set(logos())].map(async (src) => {
        const r = await fetch(src);
        const tipo = r.headers.get("content-type") ?? "";
        return { src, ok: r.ok && /image|svg/i.test(tipo) };
      }),
    );
    const quebrados = respostas.filter((r) => !r.ok).map((r) => r.src);
    expect(quebrados, `logos que não existem em disco: ${quebrados.join(", ")}`).toEqual([]);
  });

  it("a imagem é decorativa — o nome já está no rótulo", async () => {
    montar(MOUNTS);
    await ate(() => (logos().length > 0 ? document.body : null));
    const imgs = [...document.querySelectorAll("img")];
    expect(imgs.every((i) => i.getAttribute("alt") === "")).toBe(true);
    expect(imgs.every((i) => i.hasAttribute("aria-hidden"))).toBe(true);
    // E o nome do mount continua visível como texto.
    expect(document.body.innerText).toContain("Google Drive");
  });
});
