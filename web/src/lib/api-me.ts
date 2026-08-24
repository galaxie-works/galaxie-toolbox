// Cliente dos recursos `/me/*` da conta (#1489, par do #1473-BE).
//
// Doutrina do Altair (#1473/#1265) que este cliente CARREGA no tipo:
//  • Tudo é escopado ao principal DA SESSÃO — as rotas são `/me/...`, NUNCA
//    `/users/<id>/...`. Não há parâmetro de id de dono em lugar nenhum aqui: o
//    servidor deriva o dono do cookie de sessão. Conta alheia = 404 (não 403).
//  • Sessão vive em cookie HttpOnly (o FE nunca toca no token) → `credentials`
//    manda o cookie; nada de Authorization montado no cliente.
//  • Mesma origem (SPA + API sob o mesmo host, via PathPrefix do Traefik) →
//    caminhos RELATIVOS, sem base cross-origin, sem CORS.
//
// A camada HTTP (pedir/ErroApi/ehNaoAutenticado) mora em `./http` desde o #1491
// (compartilhada por todas as facetas). Re-exporto ErroApi/ehNaoAutenticado aqui
// pra não quebrar quem já importava daqui (use-carregar, testes do #1489).

import { pedir } from "@/lib/http";
export { ErroApi, ehNaoAutenticado } from "@/lib/http";

export interface Perfil {
  nome: string;
  email: string;
  /** Idioma preferido do usuário (opcional; a UI cai no idioma do navegador). */
  idioma?: string | null;
}

export interface Assinatura {
  plano: string;
  status: "ativa" | "inadimplente" | "cancelada" | "nenhuma";
  /** Consumo do ciclo, quando o plano expõe (ex.: minutos, GB). Read-only. */
  consumo?: { usado: number; limite: number | null; unidade: string } | null;
}

export interface Dispositivo {
  id: string;
  nome: string;
  /** ISO-8601. */
  ultimoAcesso: string;
  /** true se é a sessão que está fazendo esta chamada (não pode se auto-revogar sem aviso). */
  sessaoAtual: boolean;
}

export function obterPerfil(): Promise<Perfil> {
  return pedir<Perfil>("/me");
}

export function atualizarPerfil(patch: Partial<Pick<Perfil, "nome" | "idioma">>): Promise<Perfil> {
  return pedir<Perfil>("/me", { method: "PATCH", body: JSON.stringify(patch) });
}

export function obterAssinatura(): Promise<Assinatura> {
  return pedir<Assinatura>("/me/assinatura");
}

export function listarDispositivos(): Promise<Dispositivo[]> {
  return pedir<Dispositivo[]>("/me/dispositivos");
}

/** Revoga UMA sessão/dispositivo próprio pelo id (rota escopada à sessão, sem id de dono). */
export function revogarDispositivo(id: string): Promise<void> {
  return pedir<void>(`/me/dispositivos/${encodeURIComponent(id)}`, { method: "DELETE" });
}
