# Como afirmar log num teste (#1301)

**Por que isto existe:** ACs do tipo *"a falha não morre em silêncio → loga"*
(#1296, #1238, #1076) eram promessa, não teste — o repo tinha 137 chamadas
`log::*` no `src-tauri`, `tracing` no signaling e `console.*` no front, e
**nenhum** jeito de um teste afirmar que uma delas aconteceu. Quem gatava isso
era a QA na mão.

Os três mundos têm a **mesma ergonomia** de propósito: abre escopo, roda o
código, recebe uma lista, afirma.

---

## 1. Rust `log` — `src-tauri`

```rust
use crate::teste_log::{assert_logou, assert_nao_logou, capturar_logs};

#[test]
fn erro_de_persistencia_nao_morre_em_silencio() {
    let logs = capturar_logs(|| snapshot_e_gravar(&inner_envenenado));
    assert_logou(&logs, log::Level::Error, "mutex envenenado");
}
```

**Log emitido por thread que o código sob teste cria** (worker de fundo) não é
alcançado pela captura por thread. Para esse caso:

```rust
use crate::teste_log::{capturar_logs_globais, esperar_log_global};

let logs = capturar_logs_globais(|| {
    iniciar_persistidor(inner, persist, Duration::from_millis(0));
    // espera o worker acordar, sem `sleep` chutado
    esperar_log_global(log::Level::Error, "worker de persistência", Duration::from_secs(5));
});
```

> ⚠️ **Use a captura global só para afirmar PRESENÇA.** Enquanto o escopo global
> está aberto, log de outros testes rodando em paralelo também cai nele. Para
> afirmar **ausência** (`assert_nao_logou`), use sempre `capturar_logs`.

## 2. Rust `tracing` — `services/remote-signaling`

```rust
use crate::teste_tracing::{assert_logou, capturar_tracing};

let logs = capturar_tracing(|| { /* … */ });
assert_logou(&logs, tracing::Level::WARN, "register recusado");
```

Campos estruturados entram no texto: `warn!(device_id = %id, "recusado")` casa
tanto com `"recusado"` quanto com o valor do `device_id`.

**Cuidado com `#[tokio::test]`:** a captura é por thread. Se o código roda num
runtime que muda de thread, o log sai fora do escopo. Use `#[test]` + um runtime
`new_current_thread()` dentro do `capturar_tracing`.

## 3. TypeScript `console` — `src/test-utils/capturar-console.ts`

Serve igual no `node --test` e no vitest/browser.

```ts
import { assertLogou, comConsole } from "@/test-utils/capturar-console";

const { capturado } = await comConsole(async () => {
  await clicarNoBotaoQueFalha();
});
assertLogou(capturado, "error", "minimizar");
```

Prefira `comConsole` a `capturarConsole` + `restaurar()` na mão: ele restaura o
console **mesmo se o corpo lançar**. Esquecer o restore vaza o mock para os
testes seguintes — falha intermitente, difícil de rastrear.

---

## Regras que valem nos três

1. **Nada vai a disco nem ao stdout.** Os registros ficam só em memória e morrem
   com o teste — inclusive em CI (lição RB de PII, #1076).
2. **Falha alto se a captura não puder funcionar.** Se outro logger/subscriber já
   estiver instalado no processo, os helpers dão panic com a explicação, em vez
   de devolver lista vazia — lista vazia faria um `assert_nao_logou` passar por
   engano, que é o defeito que este trabalho existe para matar.
3. **Escreva o par negativo.** `assert_logou` sozinho passa mesmo se o código
   logar *sempre*. O que prova o comportamento é o par: erro loga, caminho feliz
   não loga.
4. **A mensagem de falha lista o que foi capturado** — quem depura não deve ter
   de adivinhar o que havia.
