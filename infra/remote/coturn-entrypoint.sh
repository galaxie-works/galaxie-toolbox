#!/bin/sh
set -eu

secret_file=/run/secrets/turn_secret
runtime_config=/run/coturn/turnserver.conf

if [ ! -s "$secret_file" ]; then
  echo "turn secret ausente ou vazio" >&2
  exit 1
fi

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
cp /opt/galaxie/turnserver.conf "$runtime_config"
{
  printf 'realm=%s\n' "$GALAXIE_REMOTE_REALM"
  printf 'server-name=%s\n' "$GALAXIE_REMOTE_REALM"
  printf 'external-ip=%s\n' "$GALAXIE_REMOTE_PUBLIC_IP"
  printf 'static-auth-secret=%s\n' "$(tr -d '\r\n' < "$secret_file")"
} >> "$runtime_config"

exec turnserver -c "$runtime_config"
