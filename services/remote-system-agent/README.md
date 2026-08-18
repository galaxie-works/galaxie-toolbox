# galaxie-remote-system-agent (S7)

Worker **privilegiado** da sessão interativa do GALAXIE Remote (#690, S7). Roda
como **LocalSystem**, na sessão que o broker Delphi mandou, e é o único ponto do
sistema que alcança o **secure desktop** (Winlogon/UAC) — que a sessão do usuário
não alcança.

O broker (Delphi) detém SCM, sessão e IPC; este binário **verifica** que ainda é
LocalSystem na sessão pedida, prende a thread de captura ao desktop de input
escolhido e expõe transições de estado determinísticas pro driver de
captura/transporte. **Nenhuma credencial atravessa o pipe do S7.**

## Módulos

| Módulo | Papel |
|---|---|
| `session_channel` (`src/session_channel.rs`) | canal de sessão worker↔owner: handshake e **autoridade** (passo 2 da §9) |
| `pipe_server` (`src/pipe_server.rs`) | named pipe da sessão + **DACL** + presença local + **Authenticode/pin de publisher** (passo 2b-io) |
| `lib.rs` | `DesktopMode`, bootstrap e verificação de privilégio |

## O gate de admissão

`validar_hello` (`session_channel.rs`) é **puro e fail-closed**, nesta ordem:

1. nonce refletido confere · 2. nonce não expirou · 3. **o PID do owner está na
sessão alvo** (a verdade é `PID→sessão`, não o `session_id` que o cliente diz) ·
4. **Authenticode + pin de publisher do binário do owner** · 5. ticket do S8 →
válido dá autoridade do ticket (serve o não-supervisionado); ausente só passa no
*attended*; inválido recusa sempre.

O pipe já nasce restrito por DACL a **SYSTEM + o Logon SID daquela sessão**
(`dacl_sddl`) — o atacante relevante é código na sessão do usuário, não remoto.

## Gate de Authenticode + pin de publisher (US #1052, SEC4)

O passo 4 tem que garantir que o owner é um **binário GALAXIE assinado**, não um
processo qualquer do usuário. São duas camadas, em `pipe_server.rs`:

1. **Cadeia confiável** — `WinVerifyTrust(WINTRUST_ACTION_GENERIC_VERIFY_V2)`
   confirma que a assinatura fecha numa raiz confiável.
2. **Pin de publisher (F1)** — `avaliar_signer` extrai o cert do signer do estado
   do `WinVerifyTrust` (`WTHelperProvDataFromStateData` → `WTHelperGetProvSignerFromChain`
   → `pasCertChain[0]` → `CertGetNameStringW`) e exige **Issuer ∧ Subject O**
   iguais ao publisher fixado. Só a cadeia confiável NÃO basta: qualquer binário
   assinado por qualquer CA pública fecha numa raiz confiável — o pin é o que
   amarra a identidade ao **nosso** cert.

Regra primária: **Issuer fixado ∧ Subject O fixado ∧ cadeia válida**. (Allowlist de
SPKI é reforço opcional, ainda não implementada — ver `TODO(#1052)` no código.)

Além disso, o #1052 fecha o **TOCTOU de PID (F2)**: o handle do processo cliente é
aberto UMA vez, logo após `GetNamedPipeClientProcessId`, e **segurado por toda a
validação** (mantém o objeto-processo vivo ⇒ o PID não recicla). Caminho da
imagem e sessão saem DESSE handle; e o `.exe` é aberto com `CreateFileW` **sem
`FILE_SHARE_WRITE`/`FILE_SHARE_DELETE`** e passado por `hFile` ao `WINTRUST_FILE_INFO`
(F3) — verifica-se o objeto que se está segurando, não um caminho que pode trocar
embaixo. Um cinto de timing (`GetProcessTimes`: criação < connect) é defesa em
profundidade (limitação documentada no código).

### De onde vem o pin

Valores de env de **compilação** (`option_env!`), lidos pela esteira ao buildar o
release assinado:

| Variável                     | Conteúdo                              |
| ---------------------------- | ------------------------------------- |
| `GALAXIE_SIGN_PIN_ISSUER`    | DN do Issuer do cert de code signing  |
| `GALAXIE_SIGN_PIN_SUBJECT_O` | Subject O (organização) do cert       |

Comparação de DN é **case-insensitive ASCII** (com apara de espaços).

### Fail-closed hoje (F5 — cert EV ainda não existe)

> ⚠️ **Hoje nada é assinado no build.** O pin nasce **vazio** ⇒ `avaliar_signer`
> devolve `PinNaoConfigurado` e **recusa TUDO**. É **esperado e proposital**: sem
> cert não dá pra verificar publisher, então a postura segura é recusar. Logo, o
> handshake de runtime do S7 **não fecha** até a esteira assinar e preencher as env
> acima (US de assinatura, pré-requisito). **Não há bypass de dev.**

## Plano de rotação do cert (F4)

O pin é por **Issuer ∧ Subject O**, não por thumbprint/serial — isso torna a
rotação barata na maioria dos casos:

- **Renovação na MESMA CA e MESMO O** (o caso comum): Issuer e Subject O não mudam
  ⇒ **zero mudança de código**. É o motivo de fixar o par (Issuer, O) em vez do
  cert exato.
- **Troca de CA** (Issuer muda): rotação em **duas fases, NUNCA ao contrário** —
  1. publicar uma versão que aceita **os dois issuers** (antigo e novo);
  2. trocar a assinatura da esteira pro cert novo;
  3. só na versão **seguinte** remover o issuer antigo.
  Na ordem inversa (remover o antigo antes de todos migrarem) quebra o handshake
  de quem ainda roda o binário assinado pelo cert velho.
- **Mudança de O** (reorganização/rename legal): mesmo esquema de duas fases,
  aceitando os dois `O` na transição.

## `WTD_REVOKE_NONE` — sem kill-switch (F4, contingência)

A verificação usa `fdwRevocationChecks = WTD_REVOKE_NONE`: **não** consulta
CRL/OCSP. Escolha deliberada (o agente SYSTEM não pode depender de rede pra decidir
um handshake local, e checagem online é lenta/failível). Custo honesto: **se a
chave privada de assinatura vazar, revogar o cert NÃO derruba os binários já
distribuídos** — o pin segue aceitando qualquer coisa assinada com aquela chave.
Não há kill-switch remoto.

**Contingência se a chave vazar:** a única saída é **publicar um agente novo**
assinado com cert novo (girando o pin conforme a rotação acima) e retirar de
circulação as versões que confiavam no cert comprometido. Por isso a proteção da
chave (idealmente HSM/EV com chave não-exportável) é requisito de release.

## Testes

`cargo test` cobre o núcleo puro sem precisar de cert:

- `avaliar_signer`: pin vazio → recusa; cadeia não-confiável → recusa; issuer/O
  divergentes → recusa; issuer+O certos (case-insensitive) + cadeia → `Ok`.
- Reprodução do bypass F1: uma cadeia confiável de OUTRO issuer, que o gate antigo
  (só `WinVerifyTrust`) aceitaria, agora é recusada pelo pin.

O caso "aceita a imagem REAL da Galaxie" fica **pendente do F5** (precisa do cert
publicado + `GALAXIE_SIGN_PIN_*` preenchidas na esteira).

## Dependência enxuta, de propósito

Consome **só o núcleo leve** do `galaxie-remote-net` (`default` = protocol/ticket/
identity) — `Capabilities` + `TicketVerifier` **sem** arrastar `tokio`, `rustls` ou
`opaque-ke` pra dentro de um binário SYSTEM (D1-bis, #971). Ao mexer nas deps,
confirme o corte:

```
cargo tree -p galaxie-remote-system-agent | grep -E "tokio|rustls|opaque|openssl"   # deve sair vazio
```

Release é compilado com `lto = "thin"`, `codegen-units = 1` e `strip`.
