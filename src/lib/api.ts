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

const MOCK_SITES: Site[] = [
  { key: "PROJ", name: "Projetos", status: "connected", files: 53668, bytes: 351_000_000_000 },
  { key: "MKT", name: "Marketing", status: "available", files: 12800, bytes: 166_000_000_000 },
  { key: "GST", name: "Gestão", status: "connected", files: 1352, bytes: 79_000_000_000 },
  { key: "COM", name: "Comercial", status: "available", files: 44029, bytes: 70_000_000_000 },
  { key: "CPS", name: "Compras", status: "available", files: 73393, bytes: 62_000_000_000 },
  { key: "FIN", name: "Financeiro", status: "available", files: 100696, bytes: 58_000_000_000 },
  { key: "MOV", name: "Moving", status: "available", files: 3800, bytes: 19_000_000_000 },
  { key: "ADM", name: "Administrativo", status: "connected", files: 1020, bytes: 17_000_000_000 },
  { key: "RH", name: "RH", status: "noaccess" },
  { key: "WEBSITE", name: "Website", status: "noaccess" },
];

export async function login(email: string): Promise<AppUser> {
  if (!inTauri()) {
    await sleep(800);
    return { ...MOCK_USER, email };
  }
  return invoke<AppUser>("login", { email });
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
): Promise<Pick<Site, "bytes" | "folders" | "files">> {
  if (!inTauri()) {
    await sleep(200 + Math.random() * 900);
    return {
      bytes: site.bytes,
      files: site.files,
      folders: site.files ? Math.round(site.files / 12) : undefined,
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
