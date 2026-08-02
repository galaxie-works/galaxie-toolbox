//! Fachada tipada da taxonomia dos 5 eventos (#390, S4 do épico #380).
//!
//! Todo evento sai por AQUI (nunca `telemetryTrack` cru nos call sites): mantém
//! nomes de evento, categorias e atributos num só lugar, com valores restritos a
//! enum/bucket — **nada de PII**. O Rust (TelemetryPolicy, #388) carimba o
//! contexto comum (versão/canal/OS coarse/session-id) e aplica consent+scrub+
//! sampling; aqui só descrevemos o QUÊ.

import { telemetryTrack } from "./api.ts";
import type { Tela } from "./navegacao.ts";

/** Resultado genérico de uma ação/ciclo (enum fechado). */
export type ResultadoAcao = "ok" | "erro" | "cancelado";

/** Resultado da verificação de update (enum fechado). */
export type ResultadoUpdate = "disponivel" | "sem-atualizacao" | "erro";

/** Bucketiza duração em faixas — nunca o valor exato (evita fingerprinting). */
function bucketDuracaoMs(ms: number): string {
  if (ms < 100) return "<100ms";
  if (ms < 500) return "100-500ms";
  if (ms < 1000) return "500ms-1s";
  if (ms < 5000) return "1-5s";
  if (ms < 15000) return "5-15s";
  return ">15s";
}

/** `app_session_started` — início de uma sessão do app (uma vez por processo). */
export function telSessaoIniciada(): void {
  void telemetryTrack({ categoria: "analytics", evento: "app_session_started" });
}

/** `module_opened` — abertura de um módulo (Bridge/Navigator/Settings…). */
export function telModuloAberto(modulo: Tela): void {
  void telemetryTrack({
    categoria: "analytics",
    evento: "module_opened",
    atributos: { modulo: { t: "enum", v: modulo } },
  });
}

/** `feature_action_completed` — conclusão de uma ação de feature. `feature` é um
 *  id curto de conjunto fechado (ex.: "email_enviado", "contatos_merge"). */
export function telAcaoConcluida(feature: string, resultado: ResultadoAcao): void {
  void telemetryTrack({
    categoria: "analytics",
    evento: "feature_action_completed",
    atributos: {
      feature: { t: "enum", v: feature },
      resultado: { t: "enum", v: resultado },
    },
  });
}

/** `sync_cycle_completed` — fim de um ciclo de sincronização (Bridge/Agenda). */
export function telSyncConcluido(resultado: ResultadoAcao, duracaoMs: number): void {
  void telemetryTrack({
    categoria: "diagnostico",
    evento: "sync_cycle_completed",
    atributos: {
      resultado: { t: "enum", v: resultado },
      duracao: { t: "bucket", v: bucketDuracaoMs(duracaoMs) },
    },
  });
}

/** `update_check_completed` — fim de uma verificação de atualização. */
export function telUpdateVerificado(resultado: ResultadoUpdate): void {
  void telemetryTrack({
    categoria: "diagnostico",
    evento: "update_check_completed",
    atributos: { resultado: { t: "enum", v: resultado } },
  });
}

/** Origem de um crash capturado (enum fechado). */
export type OrigemCrash = "window" | "promise" | "boundary" | "rust_panic";

/**
 * `app_crashed` — sinal de crash (#391, S5). Categoria `crash`. Carrega SÓ a
 * origem (enum) — a mensagem/stack fica no log local (`log.ts` / log do Rust);
 * o envio com stack scrubbed pro GlitchTip é o transporte do S1.
 */
export function telAppCrashed(origem: OrigemCrash): void {
  void telemetryTrack({
    categoria: "crash",
    evento: "app_crashed",
    atributos: { origem: { t: "enum", v: origem } },
  });
}
