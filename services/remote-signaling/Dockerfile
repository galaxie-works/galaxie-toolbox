FROM rust:1.89-bookworm AS builder

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --locked --release

FROM debian:bookworm-slim AS runtime

RUN groupadd --system --gid 10001 galaxie-remote \
    && useradd --system --uid 10001 --gid galaxie-remote --no-create-home galaxie-remote

COPY --from=builder /build/target/release/galaxie-remote-signaling /usr/local/bin/galaxie-remote-signaling

USER 10001:10001
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/galaxie-remote-signaling"]
