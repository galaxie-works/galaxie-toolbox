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
