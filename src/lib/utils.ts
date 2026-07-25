import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

const HOSTS_MS = [
  "office.com",
  "office365.com",
  "sharepoint.com",
  "microsoft365.com",
  "microsoft.com",
  "to-do.office.com",
  "whiteboard.office.com",
  "forms.office.com",
  "powerbi.com",
  "dynamics.com",
];

/**
 * Anexa `login_hint` às URLs de apps Microsoft, para o webview interno abrir na
 * conta ativa do app (e não numa sessão web antiga). Reforço do fix de sessão:
 * a limpeza de cookies no Rust é quem garante a troca de conta; isto só ajuda o
 * login a acertar a conta de primeira.
 */
export function comLoginHint(url: string, email?: string | null): string {
  if (!email) return url;
  try {
    const u = new URL(url);
    const ehMs = HOSTS_MS.some(
      (h) => u.hostname === h || u.hostname.endsWith("." + h)
    );
    if (!ehMs) return url;
    if (!u.searchParams.has("login_hint")) u.searchParams.set("login_hint", email);
    return u.toString();
  } catch {
    return url;
  }
}
