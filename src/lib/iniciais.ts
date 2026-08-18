/**
 * #1023 (FE5): cálculo de iniciais de avatar UNIFICADO num só lugar.
 *
 * Antes eram ~11 implementações com 4 algoritmos divergentes (People pegava as
 * 2 primeiras letras da string; Compose primeira+última palavra; Agenda/Bridge
 * só o local-part do e-mail; Organizations sem fallback → nome vazio virava
 * avatar em branco). Resultado: a MESMA pessoa aparecia com iniciais diferentes
 * por tela. Este helper é a fonte única.
 *
 * Regra canônica:
 * 1. displayName com ≥2 palavras → primeira letra da PRIMEIRA + primeira da ÚLTIMA;
 * 2. displayName com 1 palavra → 2 primeiras letras dela;
 * 3. sem nome → local-part do e-mail (2 primeiras letras);
 * 4. nada disso → `'?'` (NUNCA string vazia — o bug do organizations-view).
 */
export function iniciais(nome?: string | null, email?: string | null): string {
  const n = (nome ?? "").trim();
  if (n) {
    const partes = n.split(/\s+/).filter(Boolean);
    if (partes.length === 1) {
      return partes[0].slice(0, 2).toLocaleUpperCase();
    }
    const primeira = partes[0][0] ?? "";
    const ultima = partes[partes.length - 1][0] ?? "";
    const ini = (primeira + ultima).toLocaleUpperCase();
    if (ini) return ini;
  }

  const e = (email ?? "").trim();
  if (e) {
    const local = e.split("@")[0]?.trim() ?? "";
    if (local) {
      // Trata o local-part como nome: separadores comuns (. _ - +) viram
      // "palavras" → 1ª+última inicial (mesma regra do displayName). Assim
      // `wagner.consani` → "WC" (não "WA"), consistente com o nome.
      const partes = local.split(/[._\-+]+/).filter(Boolean);
      if (partes.length >= 2) {
        const ini = ((partes[0][0] ?? "") + (partes[partes.length - 1][0] ?? "")).toLocaleUpperCase();
        if (ini) return ini;
      }
      return local.slice(0, 2).toLocaleUpperCase();
    }
  }

  return "?";
}
