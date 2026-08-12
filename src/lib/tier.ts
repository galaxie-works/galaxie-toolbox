import type { AppUser, Capability } from "./types";

/**
 * #699 (PS6) — gate central de tier. Substitui o gating implícito "tem tenant"
 * por um check EXPLÍCITO sobre o sinal do PS0 (`capabilities`/`accountKind`/
 * `orgStatus` do token). A UI checa **capability/tier**, não escopo cru.
 *
 * Regra de decisão (da issue): "quem controla isso pra empresa toda?"
 * (identidade/provisionamento/policy/diretório/branding/governança/shared/
 * billing) → **org**. "O que faço com as MINHAS coisas?" (mail/cal/tasks/files
 * próprios, Navigator, People CRM, personalização, config de nuvem) → qualquer
 * conta.
 *
 * Estes helpers são PUROS (sem React) de propósito — dá pra testar com
 * `node --test` e usar fora de componente. O Provider/hook fica em
 * `tier-context.tsx`.
 */

/**
 * Capabilities que só fazem sentido numa **org contratada** — a UI degrada
 * (empty-state/escondido) quando elas faltam nos tiers pessoal/uncontracted.
 */
export const CAPABILITIES_ORG: readonly Capability[] = [
  "directoryRead",
  "orgAdmin",
];

/** A conta traz esta capability no token? (base do gate fino por-feature.) */
export function temCapability(
  user: AppUser | null,
  cap: Capability
): boolean {
  return !!user && user.capabilities.includes(cap);
}

/**
 * Tier tem acesso às features de ORGANIZAÇÃO? (SharePoint Sites, compartilhados,
 * branding do tenant, diretório, governança/Org Admin.) Só a org contratada —
 * pessoal e uncontracted degradam pra empty-state (nunca erro).
 */
export function recursoOrgDisponivel(user: AppUser | null): boolean {
  return !!user && user.orgStatus === "contracted";
}

/** Um `Capability` é de organização? (útil pra gatear nav/menus por capability.) */
export function ehCapabilityOrg(cap: Capability): boolean {
  return CAPABILITIES_ORG.includes(cap);
}

/** Rótulo semântico do tier — "minhas coisas" vs "organização". */
export type Tier = "pessoal" | "organizacao";

export function tierDaConta(user: AppUser | null): Tier {
  return recursoOrgDisponivel(user) ? "organizacao" : "pessoal";
}

/**
 * Placeholder de billing/seat (#699) — SÓ o gancho, sem cobrança nesta story.
 * Org contratada = billing por-seat da org; qualquer outra conta = self-serve
 * individual. O fluxo real (Stripe/seat mgmt) pluga aqui num PS futuro.
 */
export type PlanoBilling = "org-seat" | "individual";

export function planoBilling(user: AppUser | null): PlanoBilling {
  return recursoOrgDisponivel(user) ? "org-seat" : "individual";
}
