# Rotação de segredos embutidos no binário (SEC9 / #1055)

O instalador do GALAXIE Toolbox é distribuído a cada cliente. Alguns segredos são
**embutidos no binário em tempo de compilação** (via `option_env!`, preenchido
pelos GitHub Actions secrets no `release.yml`). `option_env!` **não é ofuscação**:
o valor vira uma string literal extraível de qualquer cópia do executável.

Este documento lista o que é **público-na-prática**, por que isso é aceitável, e o
**processo de rotação** — a parte operacional que depende de quem tem as chaves
(o PO/infra), não do código.

## O que é público-na-prática

| Segredo | Onde | Por que sai no binário | Fronteira de confiança real |
|---|---|---|---|
| **Token de ingestão de telemetria** (`GALAXIE_TELEMETRY_INGEST_TOKEN`) | `telemetry.rs` (`option_env!`) → header `Authorization: Basic base64(email:token)` | precisa autenticar o POST OTLP/HTTP no OpenObserve a partir da máquina do cliente | **escopo do token**: tem que ser **write-only / ingest-only** para o stream específico. Nunca admin/read. Extrair o token só permite **escrever** no stream de telemetria (poluir), nunca ler dado de ninguém. |
| **`GOOGLE_CLIENT_SECRET`** | `config.rs` (`option_env!`) | o token endpoint do Google exige o secret no *code exchange* do fluxo "Desktop app" | **PKCE**: o secret de um OAuth *public client* (Desktop) **não é fronteira de confiança** — o Google trata o fluxo Desktop como público e o PKCE (code_verifier/challenge) é o que protege o exchange. Documentado como público pelo próprio Google. |

> **CLIENT_ID / GOOGLE_CLIENT_ID** também são públicos por design (identificadores,
> não segredos) — não requerem rotação.

## Mitigações já no código (não dependem de rotação)

- **Sem literal no source**: os valores vêm de `option_env!` (Actions secrets), nunca
  hardcoded no repositório (que é público).
- **Fail-closed**: config parcial (falta endpoint/email/token/stream) → transporte de
  telemetria **desativado**, nunca meio-ligado (`iniciar_transporte_configurado`).
- **Header sensível**: o `Authorization` é marcado `set_sensitive(true)` → nunca entra
  em log.
- **Seam pronto pro fim do embutido**: o trait `AuthProvider` (`telemetry.rs`) permite
  plugar o *installation-token flow* (token de curta duração emitido por endpoint
  próprio) **sem alterar o dreno da fila nem embutir segredo** — quando/se o PO
  provisionar esse endpoint, o token embutido deixa de existir.

## Processo de rotação do token de telemetria (runbook — ação do PO/infra)

Executar **a cada release** (ou imediatamente ao suspeitar de vazamento):

1. **Criar** um novo token **ingest-only** no OpenObserve (`telemetry.thegalaxie.cloud`),
   com escopo restrito ao stream de telemetria — **nunca** um token com permissão de
   leitura/admin.
2. **Atualizar** o Actions secret `GALAXIE_TELEMETRY_INGEST_TOKEN` no repositório de
   código (Settings → Secrets and variables → Actions) com o novo valor.
3. **Cortar o release** (o `release.yml` reinjeta o novo token no build).
4. **Verificar** que o build novo ingere: subir uma versão de teste e confirmar chegada
   de logs no stream (ou usar o probe de telemetria do #428). Checklist testável:
   - [ ] novo token criado com escopo ingest-only
   - [ ] Actions secret atualizado
   - [ ] release buildado com o secret novo
   - [ ] ingestão confirmada no stream com o token novo
   - [ ] **token antigo revogado** no OpenObserve (fecha a janela do valor que já saiu
     em binários anteriores)
5. **Revogar** o token anterior no OpenObserve — sem isso, o valor extraível dos
   binários já distribuídos continua válido.

> **Cadência mínima:** por-release. Como cada binário carrega o token da sua versão,
> revogar o antigo a cada rotação limita a janela de um token vazado ao intervalo entre
> dois releases.

## Rotação do `GOOGLE_CLIENT_SECRET`

Não é uma fronteira de confiança (PKCE protege). Rotacionar só se o Google exigir ou em
resposta a incidente: gerar novo secret no Google Cloud Console (mesmo OAuth client
"Desktop app"), atualizar o Actions secret `GOOGLE_CLIENT_SECRET`, cortar release.

## O que fica pendente do PO/infra (fora do código — #1055)

- [ ] **Confirmar/ajustar** que o `GALAXIE_TELEMETRY_INGEST_TOKEN` atual é **ingest-only**
      (não admin/read). Se hoje for um token amplo, criar um restrito e rotacionar por
      este runbook.
- [ ] **Adotar a cadência** de rotação por-release (revogar o antigo).
- [ ] **(Opcional, elimina o embutido)** provisionar o *installation-token endpoint*; o
      seam `AuthProvider` no código já está pronto pra consumir.

---

## Inventário COMPLETO do que é embutido em compile-time

> Medido no `feat` `68e6dfb`, **18/08/2026**, varrendo `option_env!` no repo
> inteiro (`--include=*.rs`, fora de `target/`). Este inventário é **gateado**:
> ver `src/lib/segredos-embutidos-gate.test.ts`.

O runbook nascia cobrindo os **dois** valores que o #1055 nomeia. A varredura do
escopo inteiro achou **oito**, em **quatro** arquivos — os outros seis não eram
segredo, mas também não estavam listados em lugar nenhum, e "não está listado" é
como um segredo novo entra sem ninguém notar.

| valor | arquivo | classe | rotação |
|---|---|---|---|
| `GALAXIE_TELEMETRY_INGEST_TOKEN` | `src-tauri/src/telemetry.rs` | 🔑 **credencial** | por-release (runbook acima) |
| `GALAXIE_TELEMETRY_INGEST_EMAIL` | `src-tauri/src/telemetry.rs` | 👤 identidade de ingestão — par do token; sozinho não autentica | junto do token |
| `GALAXIE_TELEMETRY_OTLP_ENDPOINT` | `src-tauri/src/telemetry.rs` | ⚙️ config (URL) | só se o host mudar |
| `GALAXIE_TELEMETRY_STREAM_NAME` | `src-tauri/src/telemetry.rs` | ⚙️ config (nome do stream) | só se o stream mudar |
| `GOOGLE_CLIENT_SECRET` | `src-tauri/src/config.rs` | 🔓 **público-na-prática** (PKCE é a fronteira) | só por exigência do Google/incidente |
| `GALAXIE_REMOTE_SIGNALING_URL` | `src-tauri/src/lib.rs` | ⚙️ config (URL do signaling) | só se o host mudar |
| `GALAXIE_SIGN_PIN_ISSUER` | `services/remote-system-agent/src/pipe_server.rs` | 📌 **pin de publisher** (não é segredo: atributo público do cert) | quando o cert EV existir (S7/F5) |
| `GALAXIE_SIGN_PIN_SUBJECT_O` | `services/remote-system-agent/src/pipe_server.rs` | 📌 **pin de publisher** | idem |

### Os dois pins estão VAZIOS hoje — e isso é fail-closed, não buraco

`PIN` (`pipe_server.rs:77-87`) cai em `""` quando a esteira não injeta, e
`avaliar_signer` **recusa tudo** nesse estado. Não há bypass de dev. Ou seja: o
S7 não fecha handshake até o certificado EV existir e a esteira assinar (F5).

Está listado aqui porque **valor embutido vazio hoje é valor embutido amanhã** —
quando o cert existir, estes dois passam a viajar em todo binário, e a hora de
já estarem no inventário é antes disso.

### Por que isto vira gate

O runbook é útil **enquanto estiver completo**. Um `option_env!` novo entra num
PR qualquer e nada obriga a atualizar este arquivo — a próxima pessoa a auditar
segredos embutidos leria uma lista que não corresponde ao binário.

O gate (`src/lib/segredos-embutidos-gate.test.ts`) varre o repo e exige que todo
nome usado em `option_env!` apareça nesta tabela. **Valor embutido novo reprova o
CI até ser documentado e classificado.**

É a mesma forma dos outros ratchets da casa (#1153 ícones, #1074 F1
`graph_enviar`, #1070 comando async): a lista só encolhe quando o valor sai do
código, nunca por esquecimento.
