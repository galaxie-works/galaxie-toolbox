#!/bin/sh
set -eu

cd "$(dirname "$0")"
test -s secrets/turn_secret

suffix=$$
client_network="galaxie-turn-test-a-$suffix"
peer_network="galaxie-turn-test-b-$suffix"
peer_container="galaxie-turn-peer-$suffix"
log_file=$(mktemp /tmp/galaxie-turn-relay.XXXXXX)

cleanup() {
  docker rm -f "$peer_container" >/dev/null 2>&1 || true
  docker network rm "$client_network" "$peer_network" >/dev/null 2>&1 || true
  rm -f "$log_file"
}
trap cleanup EXIT INT TERM

docker network create "$client_network" >/dev/null
docker network create "$peer_network" >/dev/null
docker run -d --name "$peer_container" --network "$peer_network" \
  --entrypoint turnutils_peer coturn/coturn:4.15.0-r0-alpine -p 3480 >/dev/null
sleep 1

peer_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$peer_container")
turn_ip=$(docker network inspect -f '{{(index .IPAM.Config 0).Gateway}}' "$client_network")
turn_secret=$(tr -d '\r\n' < secrets/turn_secret)

docker run --rm --network "$client_network" --entrypoint turnutils_uclient \
  coturn/coturn:4.15.0-r0-alpine \
  -v -c -n 20 -u galaxie-probe -W "$turn_secret" -p 3478 \
  -e "$peer_ip" -r 3480 "$turn_ip" > "$log_file" 2>&1
unset turn_secret

grep -Eq 'tot_recv_msgs=[1-9][0-9]*' "$log_file"
grep -Eq 'Total lost packets 0 \(0\.000000%\)' "$log_file"
grep -E 'Received relay addr|tot_send_msgs=.*tot_recv_msgs=|Total lost packets' "$log_file" \
  | sed -E 's/([0-9]+\.[0-9]+)\.[0-9]+\.[0-9]+/\1.x.x/g' \
  | tail -8
printf '%s\n' 'turn_relay_ok isolated_networks=2 messages=20 loss=0_percent'
