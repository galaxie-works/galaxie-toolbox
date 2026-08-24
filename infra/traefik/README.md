# Traefik — conferido contra o host (#1307)

✅ **O compose aqui É o que roda na VPS `telemetry`.** Copiado do host em
**2026-08-24** por `altair` (quem tem o acesso), com os segredos fora.

Traefik é a **borda**: termina TLS, redireciona `:80 → :443` e emite/renova o
certificado por ACME/Let's Encrypt (HTTP-01). Roda em `network_mode: host`, por
isso não tem labels de rota próprios — ele lê os labels **dos outros**
containers via `providers.docker`.

`exposedbydefault=false`: um container só é publicado se disser
`traefik.enable=true`. Default-deny — subir um serviço na VPS não o expõe à
internet por acidente.

## Onde fica no host

```
/docker/traefik/          # docker-compose.yml + .env (só ACME_EMAIL)
volume traefik-letsencrypt  # acme.json — chave privada do cert, NÃO sai do host
```

## Divergências conhecidas (registradas, não corrigidas aqui)

Corrigir no repo sem corrigir no host é exatamente a deriva que o #1303 nos
custou. Então ficam anotadas e viram card:

| o que | por que importa |
|---|---|
| `image: traefik:latest` sem pin | o que roda hoje é **v3.7.10** (medido). Um reinício pode trocar a versão sem ninguém pedir — e a borda que termina TLS é o pior lugar para uma mudança não pedida |

## Mudar algo aqui

Pelo procedimento único em [`../README.md`](../README.md) — repo → PR → host.
Nunca editando direto no host.
