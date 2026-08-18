import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import test from "node:test";

// #1070 §5.2 — gate ESTRUTURAL: todo `#[tauri::command]` é `async`, salvo os que
// estiverem na ALLOW-list abaixo, cada um com justificativa.
//
// ── Por que ESTE gate, e não o que eu tinha proposto ────────────────────────
// A primeira proposta (§3 do doc) varria o CORPO do comando procurando chamada
// bloqueante (`.join()`, `.recv()`, `block_on`). Medido em `ba73c22` (18/08):
//
//     #[tauri::command] async : 167
//     #[tauri::command] SYNC  :  15
//     SYNC com chamada bloqueante NO CORPO : 0
//
// Zero. E as QUATRO ocorrências conhecidas da família (#834, #1073, #1227 e o
// ramo de limpeza do `remote_session_start`) bloqueiam **uma chamada de
// profundidade** — `session.stop()` → `worker.join()`. Um scan do corpo não vê
// isso: daria CI verde afirmando uma propriedade que não verifica, o mesmo
// defeito do `icon: true` (#1153) e do `eh_erro_permissao` (#1075 F1).
//
// Este gate não precisa saber o que o comando CHAMA. Se `sync` é barrado por
// padrão, a profundidade da chamada deixa de importar — decide pela FORMA, não
// farejando texto.
//
// A prova de que funciona veio ao montar a ALLOW-list: obrigado a justificar
// cada síncrono, achei que `telemetry_track` grava a fila em DISCO (serde +
// DPAPI + `fs::write`, `telemetry.rs:360-378`) segurando o Mutex, **a cada
// evento**. O scan de corpo não acharia — o `fs::write` está dois níveis abaixo.
//
// ── Ratchet ─────────────────────────────────────────────────────────────────
// A lista só ENCOLHE. Comando `sync` novo reprova na hora; entrada que virou
// `async` (ou sumiu) também reprova, para a baseline não guardar dívida já paga.

const ALVOS = "src-tauri/src/**/*.rs";

/**
 * Comandos que hoje são `fn` (não `async fn`), com o motivo.
 *
 * Ao converter um para `async`, REMOVA a entrada — o gate cobra.
 */
const SINCRONOS_CONHECIDOS: Record<string, string> = {
  // ── delegadores de 1-2 linhas, sem IO nem espera ──────────────────────────
  fs_delete_permanent_token: "1 linha: `emitir` (evento in-process)",
  dominio_iniciar_verificacao: "1 linha: `iniciar_desafio` (gera nonce em memória)",
  reset_session_memo: "1 linha: `limpar_memo_sessao` (limpa HashMap)",
  log_frontend_error: "1 linha: `log::error!`",
  telemetry_status: "1 linha: lê estado em memória",
  remote_log: "1 linha: `log::*`",
  remote_signaling_endpoint: "resolve string de config (sem rede)",
  remote_signaling_endpoint_v2: "deriva string a partir do v1 (sem rede)",

  // ── DÍVIDA CONHECIDA: fazem IO/bloqueio na thread do IPC ──────────────────
  // Achados ao montar esta lista. Não são "trivialmente seguros" — estão aqui
  // porque a baseline congela o que existe, não porque estão certos.
  telemetry_track:
    "DÍVIDA #1238: `gravar_fila` → serde + DPAPI + fs::write, com o Mutex na mão, A CADA EVENTO",
  telemetry_set_consent: "DÍVIDA #1238: `gravar_consent` + `gravar_fila` (2 escritas em disco)",
  telemetry_revoke: "DÍVIDA #1238: `gravar_consent` + `gravar_fila` (2 escritas em disco)",
  telemetry_debug_dump: "DÍVIDA #1238: lê estado sob Mutex; conferir se toca disco",
  remote_session_start:
    "DÍVIDA (#1070 §5.3, item de DoD ABERTO): o ramo de limpeza chama `session.stop()` → `worker.join()` segurando `active.lock()`. Severidade baixa hoje (só roda com `finished == true`), mas é a metade do DoD que o RB9 não cobriu",
  remote_session_signal: "envia por canal já aberto (`send_to_session`), sem join",
  remote_session_input: "`try_send` (não bloqueia; descarta quando cheio)",
};

/**
 * Zera comentários (linha e bloco) preservando o comprimento, para os índices
 * seguirem válidos e o scanner não contar exemplo escrito dentro de doc.
 */
function semComentarios(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("//", i)) {
      const fim = src.indexOf("\n", i);
      const ate = fim === -1 ? src.length : fim;
      out += " ".repeat(ate - i);
      i = ate;
    } else if (src.startsWith("/*", i)) {
      const fim = src.indexOf("*/", i + 2);
      const ate = fim === -1 ? src.length : fim + 2;
      for (let k = i; k < ate; k++) out += src[k] === "\n" ? "\n" : " ";
      i = ate;
    } else {
      out += src[i];
      i += 1;
    }
  }
  return out;
}

/** `#[tauri::command]` + atributos intermediários + a assinatura. */
const COMANDO =
  /#\[tauri::command[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*(?:pub\s+)?(async\s+)?fn\s+(\w+)/g;

function varrer() {
  const sincronos: string[] = [];
  let total = 0;
  for (const arq of globSync(ALVOS)) {
    const src = semComentarios(readFileSync(arq, "utf8"));
    for (const m of src.matchAll(COMANDO)) {
      total += 1;
      if (!m[1]) sincronos.push(m[2]);
    }
  }
  return { sincronos, total };
}

test("#1070: comando Tauri é async, salvo ALLOW-list — e a lista só encolhe", () => {
  const { sincronos, total } = varrer();

  assert.ok(
    total > 100,
    `o scanner achou só ${total} comandos — o regex quebrou, não o código`,
  );

  const conhecidos = new Set(Object.keys(SINCRONOS_CONHECIDOS));
  const achados = new Set(sincronos);

  // As DUAS direções num assert só: se fossem dois, o primeiro a falhar
  // mascararia o segundo — foi o erro que a F1 do #1074 me ensinou.
  const novos = sincronos.filter((n) => !conhecidos.has(n));
  const resolvidos = [...conhecidos].filter((n) => !achados.has(n));

  assert.deepEqual(
    [
      ...novos.map(
        (n) =>
          `NOVO comando sync: ${n} — use \`async fn\` + \`spawn_blocking\` para o trabalho pesado, ou justifique na ALLOW-list`,
      ),
      ...resolvidos.map((n) => `RESOLVIDO, tire da ALLOW-list: ${n}`),
    ],
    [],
    "comando síncrono roda na thread do IPC: qualquer espera lá dentro trava a UI (família do P0 #834)",
  );
});

test("#1070: toda entrada da ALLOW-list tem justificativa não-vazia", () => {
  const semMotivo = Object.entries(SINCRONOS_CONHECIDOS)
    .filter(([, motivo]) => motivo.trim().length < 10)
    .map(([nome]) => nome);
  assert.deepEqual(
    semMotivo,
    [],
    "entrada sem motivo vira baseline eterna — o motivo é o que permite alguém remover depois",
  );
});
