# OpenObserve — conferido contra o host (#1307)

✅ **O compose aqui É o que roda na VPS `telemetry`.** Copiado do host em
**2026-08-24** por `altair` (quem tem o acesso), com os segredos fora.

É onde a telemetria do app aterrissa. Publicado pelo Traefik em
`https://telemetry.thegalaxie.cloud`, porta interna **5080**.

## Onde fica no host

```
/docker/openobserve-pwch/   # nome da pasta = COMPOSE_PROJECT_NAME, e ele entra
                            # nos nomes dos routers/services do Traefik
volume openobserve_data     # /data — os dados de telemetria
```

## Divergências conhecidas (registradas, não corrigidas aqui)

| o que | por que importa |
|---|---|
| `image: …/openobserve:latest` sem pin | reinício pode trocar a versão sem ninguém pedir |
| `healthcheck: disable: true` | o container não reporta saúde ao Docker ⇒ **`docker ps` dizer `Up` não é evidência de que o serviço responde**. Quem verificar telemetria tem de bater no endpoint, não olhar o `ps` |
| `TRAEFIK_HOST` no `.env` do host | chave presente e **não usada** — o Host está fixo no label. Chave morta engana quem for mexer |
| 2 arquivos `.before-*` ao lado do compose | versionamento por sufixo de arquivo, que é o sintoma que o #1307 existe para eliminar |

Nenhuma dessas é corrigida aqui: mexer no host é mudança de produção e vai em
card próprio. Esta pasta responde *"o que roda?"* — com a verdade, inclusive a
inconveniente.

## Mudar algo aqui

Pelo procedimento único em [`../README.md`](../README.md) — repo → PR → host.
