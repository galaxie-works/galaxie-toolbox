import type { AppUser, Identidade, Site } from "./types";

/** Estamos dentro do Tauri (webview do app) ou num browser comum (pnpm dev)? */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- MOCK usado apenas no browser (fora do Tauri), pra visualizar a UI ---
const MOCK_USER: AppUser = {
  displayName: "Wagner Consani",
  email: "wagner@voaz.builders",
  initials: "WC",
  organizacao: "Voaz",
};

// Sem numeros de proposito: o backend real tambem nao os devolve na lista,
// eles chegam depois pelo site_details. Assim o preview mostra os spinners.
const MOCK_SITES: Site[] = [
  { key: "PROJ", name: "Projetos", status: "connected" },
  { key: "MKT", name: "Marketing", status: "available" },
  { key: "GST", name: "Gestão", status: "connected" },
  { key: "COM", name: "Comercial", status: "available" },
  { key: "CPS", name: "Compras", status: "available" },
  { key: "FIN", name: "Financeiro", status: "available" },
  { key: "MOV", name: "Moving", status: "available" },
  { key: "ADM", name: "Administrativo", status: "connected" },
  { key: "RH", name: "RH", status: "noaccess" },
  { key: "WEBSITE", name: "Website", status: "noaccess" },
];

const MOCK_DETALHES: Record<string, { files: number; bytes: number }> = {
  PROJ: { files: 53668, bytes: 351_000_000_000 },
  MKT: { files: 12800, bytes: 166_000_000_000 },
  GST: { files: 1352, bytes: 79_000_000_000 },
  COM: { files: 44029, bytes: 70_000_000_000 },
  CPS: { files: 73393, bytes: 62_000_000_000 },
  FIN: { files: 100696, bytes: 58_000_000_000 },
  MOV: { files: 3800, bytes: 19_000_000_000 },
  ADM: { files: 1020, bytes: 17_000_000_000 },
};

/**
 * `idioma` vai para o backend porque a pagina de retorno do login e servida
 * pelo loopback em Rust, fora do React — sem isso ela sairia sempre em
 * portugues.
 */
export async function login(email: string, idioma: string): Promise<AppUser> {
  if (!inTauri()) {
    await sleep(800);
    return { ...MOCK_USER, email };
  }
  return invoke<AppUser>("login", { email, idioma });
}

/** Descobre o tenant pelo dominio do e-mail (sem logar). */
export async function detectTenant(
  email: string
): Promise<{ tenantId: string; dominio: string }> {
  if (!inTauri()) {
    await sleep(300);
    return { tenantId: "mock-tenant", dominio: email.split("@")[1] ?? "" };
  }
  return invoke("detect_tenant", { email });
}

export async function logout(): Promise<void> {
  if (!inTauri()) return;
  return invoke<void>("logout");
}

export async function currentAccount(): Promise<AppUser | null> {
  if (!inTauri()) return null;
  return invoke<AppUser | null>("current_account");
}

/** Identidade em cache (foto/iniciais) - instantanea, sem rede. */
export async function cachedIdentity(): Promise<Identidade | null> {
  if (!inTauri()) return null;
  return invoke<Identidade | null>("cached_identity");
}

/** Retoma a sessao guardada no cofre do Windows. null = precisa logar. */
export async function restoreSession(): Promise<AppUser | null> {
  if (!inTauri()) return null;
  return invoke<AppUser | null>("restore_session");
}

export async function listSites(): Promise<Site[]> {
  if (!inTauri()) {
    await sleep(400);
    return MOCK_SITES.map((s) => ({ ...s }));
  }
  return invoke<Site[]>("list_sites");
}

/** Tamanho e contagens de uma biblioteca. Uma chamada por site. */
export async function siteDetails(
  site: Site
): Promise<Pick<Site, "bytes" | "folders" | "files" | "libraryUrl">> {
  if (!inTauri()) {
    await sleep(600 + Math.random() * 1800);
    const d = MOCK_DETALHES[site.key];
    return {
      bytes: d?.bytes,
      files: d?.files,
      folders: d ? Math.round(d.files / 12) : undefined,
      libraryUrl: `https://exemplo.sharepoint.com/sites/${site.key}/Documentos%20Compartilhados`,
    };
  }
  return invoke("site_details", { siteId: site.siteId, webUrl: site.webUrl });
}

export async function connectSite(site: Site): Promise<void> {
  if (!inTauri()) {
    await sleep(1000);
    return;
  }
  return invoke<void>("connect_site", {
    siteId: site.siteId,
    name: site.name,
    webUrl: site.webUrl,
  });
}

export async function disconnectSite(site: Site): Promise<void> {
  if (!inTauri()) {
    await sleep(700);
    return;
  }
  return invoke<void>("disconnect_site", { siteId: site.siteId });
}

export async function openInExplorer(name: string): Promise<void> {
  if (!inTauri()) {
    // eslint-disable-next-line no-console
    console.log("[dev] abrir no Explorer:", name);
    return;
  }
  return invoke<void>("open_in_explorer", { name });
}

/** Abre uma URL no navegador padrao (menu do usuario). */
export async function openUrl(url: string): Promise<void> {
  if (!inTauri()) {
    window.open(url, "_blank");
    return;
  }
  return invoke<void>("open_url", { url });
}

export async function longPathsStatus(): Promise<boolean> {
  if (!inTauri()) return true;
  return invoke<boolean>("long_paths_status");
}

export async function enableLongPaths(): Promise<string> {
  if (!inTauri()) return "already";
  return invoke<string>("enable_long_paths");
}
