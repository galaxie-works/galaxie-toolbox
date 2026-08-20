#!/bin/sh
# Teste-que-reproduz do #1378 — fail-CLOSED no segredo do coturn.
# Roda o entrypoint real contra arquivos temporários (paths via env) com um
# `turnserver` stub no PATH. Sem Docker. POSIX sh.
#
#   sh infra/remote/coturn-entrypoint.test.sh   # exit 0 = tudo passou
#
# O caso que separa o bug do fix: segredo SÓ-WHITESPACE (só \r\n). O guard antigo
# (`[ ! -s ]`) passa porque o arquivo TEM tamanho, mas o valor lido pós-`tr` é
# vazio => o coturn subia com `static-auth-secret=` em branco. O fix recusa subir.
set -u

here="$(CDPATH= cd "$(dirname "$0")" && pwd)"
entry="$here/coturn-entrypoint.sh"
fail=0

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# turnserver stub: o entrypoint termina em `exec turnserver ...`; aqui ele só sai 0.
mkdir -p "$tmp/bin"
printf '#!/bin/sh\nexit 0\n' > "$tmp/bin/turnserver"
chmod +x "$tmp/bin/turnserver"

# base config mínimo que o entrypoint copia
printf 'listening-port=3478\n' > "$tmp/base.conf"

run() { # $1=secret_file  -> ecoa "rc=<exit> cfg=<runtime_config>"
  rc_cfg="$tmp/runtime.conf"
  : > "$rc_cfg"
  PATH="$tmp/bin:$PATH" \
  GALAXIE_TURN_SECRET_FILE="$1" \
  GALAXIE_TURN_RUNTIME_CONFIG="$rc_cfg" \
  GALAXIE_TURN_BASE_CONFIG="$tmp/base.conf" \
  GALAXIE_REMOTE_PUBLIC_IP="203.0.113.7" \
  GALAXIE_REMOTE_REALM="telemetry.example.com" \
    sh "$entry" >/dev/null 2>"$tmp/err"
  echo "$?"
}

ok()   { printf '  PASS  %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=$((fail+1)); }

# 1) segredo válido -> sobe (exit 0 via stub) e grava o secret certo
printf 'S3cr3t-abc\n' > "$tmp/valid"
rc="$(run "$tmp/valid")"
if [ "$rc" = 0 ] && grep -q '^static-auth-secret=S3cr3t-abc$' "$tmp/runtime.conf"; then
  ok "segredo valido -> sobe com static-auth-secret correto"
else
  bad "segredo valido deveria subir com o secret (rc=$rc)"
fi

# 2) segredo SÓ-WHITESPACE (\r\n) -> fail-closed (o caso que o -s antigo deixava passar)
printf '\r\n' > "$tmp/ws"
rc="$(run "$tmp/ws")"
if [ "$rc" != 0 ] && ! grep -q '^static-auth-secret=$' "$tmp/runtime.conf"; then
  ok "segredo so-whitespace -> NAO sobe (fail-closed), sem auth em branco"
else
  bad "segredo so-whitespace deveria recusar subir (rc=$rc) — REGRESSAO do bug #1378"
fi

# 3) arquivo vazio (tamanho 0) -> fail-closed
: > "$tmp/empty"
rc="$(run "$tmp/empty")"
[ "$rc" != 0 ] && ok "arquivo vazio -> NAO sobe" || bad "arquivo vazio deveria recusar (rc=$rc)"

# 4) arquivo ausente/ilegivel na leitura -> fail-closed
rc="$(run "$tmp/nao-existe")"
[ "$rc" != 0 ] && ok "secret ausente/ilegivel -> NAO sobe" || bad "ausente deveria recusar (rc=$rc)"

# 5) mensagem nomeia o motivo real (nao 'Cannot find credentials of user')
if grep -qi 'fail-closed' "$tmp/err"; then
  ok "log nomeia o motivo (fail-closed), nao culpa o cliente"
else
  bad "log deveria nomear o segredo ilegivel/vazio"
fi

# 6) segredo com CONTEUDO mas ilegivel (gatilho real de producao: mode 600 +
#    grupo errado). `-s` passa (tem tamanho), a leitura falha -> valor vazio.
#    So asserta onde as perms POSIX de fato bloqueiam a leitura (pula em root e
#    em FS que nao forca perms, ex.: Git Bash/Windows), senao vira falso-negativo.
printf 'x\n' > "$tmp/noperm"; chmod 000 "$tmp/noperm" 2>/dev/null
if [ "$(id -u 2>/dev/null || echo 0)" != 0 ] && ! cat "$tmp/noperm" >/dev/null 2>&1; then
  rc="$(run "$tmp/noperm")"
  [ "$rc" != 0 ] && ok "conteudo ilegivel (mode 000, -s passa) -> NAO sobe" || bad "ilegivel deveria recusar (rc=$rc)"
else
  printf '  SKIP  ilegivel-com-conteudo (perms POSIX nao valem aqui - root ou FS Windows)\n'
fi
chmod 600 "$tmp/noperm" 2>/dev/null || true

[ "$fail" -eq 0 ] && { echo "OK — fail-closed garantido."; exit 0; }
echo "$fail falha(s)."; exit 1
