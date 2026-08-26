FROM rust:1.89-bookworm AS builder

# #1311: SHA do commit que gerou este binario. Chega por --build-arg (o compose
# passa `git rev-parse HEAD`) e vira env de COMPILACAO, lido por `option_env!`.
# Sem o arg, o binario responde "desconhecido" — nunca um SHA inventado.
ARG GALAXIE_BUILD_SHA
ENV GALAXIE_BUILD_SHA=${GALAXIE_BUILD_SHA}

WORKDIR /build
# remote-signaling -> remote-net -> remote-capabilities (dep de path, remote-net/Cargo.toml).
# Sem esta cópia, `cargo build --locked` não carrega o manifesto de `../remote-capabilities`
# e o build falha — furo que o Codex apanhou no #1631 (o Dockerfile ficou stale: a dep entrou
# depois da imagem de 12/08 do host). Folha primeiro, para o grafo estar completo antes do build.
COPY services/remote-capabilities/Cargo.toml services/remote-capabilities/Cargo.lock ./services/remote-capabilities/
COPY services/remote-capabilities/src ./services/remote-capabilities/src
COPY services/remote-net/Cargo.toml services/remote-net/Cargo.lock ./services/remote-net/
COPY services/remote-net/src ./services/remote-net/src
COPY services/remote-signaling/Cargo.toml services/remote-signaling/Cargo.lock ./services/remote-signaling/
COPY services/remote-signaling/src ./services/remote-signaling/src
WORKDIR /build/services/remote-signaling
RUN cargo build --locked --release

FROM debian:bookworm-slim AS runtime

RUN groupadd --system --gid 10001 galaxie-remote \
    && useradd --system --uid 10001 --gid galaxie-remote --no-create-home galaxie-remote \
    && install -d -m 0700 -o galaxie-remote -g galaxie-remote /var/lib/galaxie-remote

COPY --from=builder /build/services/remote-signaling/target/release/galaxie-remote-signaling /usr/local/bin/galaxie-remote-signaling

USER 10001:10001
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/galaxie-remote-signaling"]
