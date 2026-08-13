FROM rust:1.89-bookworm AS builder

WORKDIR /build
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
