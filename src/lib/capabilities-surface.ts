import type { AppUser } from "./types.ts";

/**
 * Superfícies de feature que batem em backend específico de provider (#803). Uma
 * conta só deve chamar o endpoint de uma superfície se o provider/account-kind a
 * suporta — senão toma 401/400 (Google→MS Mail, MS-pessoal→/sites) e polui o log
 * / chuta o usuário.
 */
export type Surface =
  | "mail" // Outlook mail via MS Graph (/me/mailFolders)
  | "sites" // SharePoint (/sites) — org-only
  | "peopleDirectory" // diretório da org (/users) — org-only
  | "files" // OneDrive (MS) ou Drive/appData (Google)
  | "calendar"
  | "contacts";

/**
 * Matriz de capabilities por provider/account-kind — a FONTE ÚNICA (#803). Diz se
 * uma superfície é suportada pela conta ativa. Para o whack-a-mole (#783 Google,
 * #802 MS pessoal): cada surface só chama o backend se isto for `true`; senão
 * degrada gracioso (estado vazio/indisponível), sem request 401/400.
 *
 * - **mail** (Outlook, MS Graph): microsoft org ✅ e pessoal ✅; google ❌ (Gmail é
 *   o PS8 restricted, futuro).
 * - **sites** (SharePoint): só microsoft **org** ✅.
 * - **peopleDirectory** (/users): só microsoft **org** ✅.
 * - **files**: microsoft (OneDrive) ✅ e google (Drive/appData, caminho próprio) ✅.
 * - **calendar/contacts**: microsoft ✅ e google ✅ (o GoogleProvider concede).
 */
export function surfaceSuportada(
  user: Pick<AppUser, "provider" | "accountKind"> | null | undefined,
  surface: Surface,
): boolean {
  if (!user) return false;
  const ms = user.provider === "microsoft"; // org ou pessoal
  const msOrg = ms && user.accountKind === "work";
  const google = user.provider === "google";

  switch (surface) {
    case "mail":
      return ms;
    case "sites":
      return msOrg;
    case "peopleDirectory":
      return msOrg;
    case "files":
      return ms || google;
    case "calendar":
      return ms || google;
    case "contacts":
      return ms || google;
    default:
      return false;
  }
}
