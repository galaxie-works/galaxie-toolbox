#!/bin/sh
set -eu

# Paths overridáveis por env (defaults = produção) — seam de teste do #1378.
secret_file="${GALAXIE_TURN_SECRET_FILE:-/run/secrets/turn_secret}"
runtime_config="${GALAXIE_TURN_RUNTIME_CONFIG:-/run/coturn/turnserver.conf}"
base_config="${GALAXIE_TURN_BASE_CONFIG:-/opt/galaxie/turnserver.conf}"

# #1378: fail-CLOSED no segredo de auth. O guard antigo (`[ ! -s ]`) testava o
# TAMANHO do arquivo, nao a LEGIBILIDADE: com o secret em modo 600 e o processo
# sem o dono/grupo certo (`group_add 20000`), o `stat` passava mas a LEITURA
# devolvia vazio => o coturn subia com `static-auth-secret=` em branco e recusava
# TODA credencial com "Cannot find credentials of user" (log que culpa o cliente).
# Lemos o VALOR primeiro e validamos DEPOIS do `tr`: ausente, ilegivel, vazio ou
# so-whitespace => o container NAO sobe e o log nomeia o motivo real.
turn_secret="$(tr -d '\r\n' < "$secret_file" 2>/dev/null || true)"
case "$(printf '%s' "$turn_secret" | tr -d '[:space:]')" in
  '')
    echo "turn secret ilegivel, ausente ou vazio ($secret_file): coturn nao sobe (fail-closed)" >&2
    exit 1
    ;;
esac

case "${GALAXIE_REMOTE_PUBLIC_IP:-}" in
  ''|*[!0-9a-fA-F:.]*)
    echo "GALAXIE_REMOTE_PUBLIC_IP invalido" >&2
    exit 1
    ;;
esac

case "${GALAXIE_REMOTE_REALM:-}" in
  ''|*[!A-Za-z0-9.-]*)
    echo "GALAXIE_REMOTE_REALM invalido" >&2
    exit 1
    ;;
esac

umask 077
cp "$base_config" "$runtime_config"
{
  printf 'realm=%s\n' "$GALAXIE_REMOTE_REALM"
  printf 'server-name=%s\n' "$GALAXIE_REMOTE_REALM"
  printf 'external-ip=%s\n' "$GALAXIE_REMOTE_PUBLIC_IP"
  printf 'static-auth-secret=%s\n' "$turn_secret"
} >> "$runtime_config"

exec turnserver -c "$runtime_config"
