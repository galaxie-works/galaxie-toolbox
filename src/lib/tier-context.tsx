import { createContext, useContext, type ReactNode } from "react";
import type { AppUser, Capability } from "./types";
import {
  planoBilling,
  recursoOrgDisponivel,
  temCapability,
  tierDaConta,
  type PlanoBilling,
  type Tier,
} from "./tier";

/**
 * #699 (PS6) — expõe o tier da conta logada pra qualquer componente checar,
 * SEM prop-drill e sem mexer no store (que é o seam de reset de conta, #555).
 * O Provider é alimentado pelo `user` do App; a lógica de decisão mora em
 * `tier.ts` (puro/testável) — aqui é só a fiação React.
 */

interface TierCtxValor {
  user: AppUser | null;
  /** Tier tem features de organização? (org contratada.) */
  recursoOrgDisponivel: boolean;
  tier: Tier;
  plano: PlanoBilling;
  temCapability: (cap: Capability) => boolean;
}

const TierCtx = createContext<TierCtxValor | null>(null);

export function TierProvider({
  user,
  children,
}: {
  user: AppUser | null;
  children: ReactNode;
}) {
  const valor: TierCtxValor = {
    user,
    recursoOrgDisponivel: recursoOrgDisponivel(user),
    tier: tierDaConta(user),
    plano: planoBilling(user),
    temCapability: (cap) => temCapability(user, cap),
  };
  return <TierCtx.Provider value={valor}>{children}</TierCtx.Provider>;
}

/** Lê o tier da conta. Fora do Provider, degrada pra "pessoal" (sem features org). */
export function useTier(): TierCtxValor {
  return (
    useContext(TierCtx) ?? {
      user: null,
      recursoOrgDisponivel: false,
      tier: "pessoal",
      plano: "individual",
      temCapability: () => false,
    }
  );
}
