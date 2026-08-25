# `infra/` — o que roda na VPS

**Origem:** #1307 (desenho do `altair`) · fatia 1 = **#1311**. Existe por causa do
**#1303**: um P0 foi fabricado a partir de *deriva invisível* — o que rodava na
VPS não tinha origem rastreável no repo, e ninguém conseguia responder **"qual
commit está no ar?"** sem abrir a imagem.

Esta pasta é a resposta para as duas metades do problema:

| pergunta | resposta |
|---|---|
| *o que roda?* | está aqui, versionado |
| *qual commit?* | `curl https://<host>/remote/healthz` — ⚠️ **ainda NÃO em produção**, ver abaixo |

---

## Qual commit está no ar

> 🔴 **CONFERIDO EM PRODUÇÃO em 2026-08-25 (altair, #1480): isto ainda NÃO funciona.**
> Duas coisas estavam erradas nesta seção, e as duas enganavam justamente sobre deriva:
>
> 1. **A URL estava errada.** `telemetry.thegalaxie.cloud/healthz` (host **sem path**) é o
>    **OpenObserve**, não o signaling — o signaling está atrás de `PathPrefix(/remote)`.
>    Os dois devolvem `200`, então o erro não aparecia: só o `Content-Type` os separa
>    (`application/json` vs `text/plain`).
> 2. **O carimbo não está no ar.** O `/remote/healthz` de produção responde `ok`, texto
>    puro — sem `commit`, sem `version`. O `docker-compose.yml` **deste repo** passa o
>    `GALAXIE_BUILD_SHA`; o **do host não tem esse build-arg**. O #1311 está escrito
>    aqui e nunca foi implantado.
>
> Ou seja: **a pergunta "qual commit está no ar?" continua sem resposta em produção**, e
> este README afirmava o contrário. O bloco abaixo descreve o comportamento PRETENDIDO —
> ele passa a valer quando o compose do host for atualizado (ver #1307/#1311).

```bash
curl -s https://telemetry.thegalaxie.cloud/remote/healthz
```

Pretendido:

```json
{ "status": "ok", "version": "0.1.0", "commit": "943ee66…" }
```

Hoje, de fato:

```
ok
```

- `commit` é carimbado em **build-time** (`--build-arg GALAXIE_BUILD_SHA` → `ENV`
  → `option_env!` no binário). **Não** é lido do ambiente em runtime, de
  propósito: valor de runtime pode ser trocado num container já rodando, e o
  campo existe justamente para não depender da boa-fé de quem responde.
- `"commit": "desconhecido"` = a imagem foi construída **sem** o build-arg. Isso
  é informação verdadeira, não falha: significa que aquela imagem não tem
  procedência rastreável. **Nunca** carimbamos um SHA inventado — SHA falso
  esconde a deriva em vez de mostrá-la.
- O endpoint é **público** e responde **só** `status`, `version` e `commit`.
  Há teste que falha se alguém acrescentar campo (config/env não entram aqui).

---

## Procedimento único para aplicar mudança de infra

Substitui a cópia ad-hoc (`scp` de pasta), que é o mecanismo pelo qual a deriva
entrava.

1. **Mude no repo**, nesta pasta. Nunca edite direto no host.
2. **Abra PR** com a mudança e diga no corpo qual serviço ela afeta.
3. **Com a PR integrada**, no host:
   ```bash
   cd /caminho/do/clone && git pull
   export GALAXIE_BUILD_SHA=$(git rev-parse HEAD)
   docker compose -f infra/remote/docker-compose.yml up -d --build
   ```
   O `GALAXIE_BUILD_SHA` é o que faz o `/healthz` responder depois.
4. **Confirme** que o que subiu é o que você mandou:
   ```bash
   curl -s https://<host>/healthz     # commit == git rev-parse HEAD
   ```
5. **Registre no PR/issue** o SHA que ficou no ar. Sem esse registro, a próxima
   pessoa volta a não saber.

> **Segredos nunca entram no repo.** Ficam no host, em `.env` e `secrets/`. Aqui
> vive só o `.env.example` de cada serviço, com as chaves e **sem** valores.

---

## Estado de cada serviço

| serviço | pasta | o que está aqui |
|---|---|---|
| **Remote (signaling + coturn)** | [`remote/`](remote/) | compose, unit systemd, config do coturn, scripts — **completo** |
| **Traefik** | [`traefik/`](traefik/) | compose + `.env.example` — **conferido contra o host em 2026-08-24** |
| **OpenObserve** | [`openobserve/`](openobserve/) | compose + `.env.example` — **conferido contra o host em 2026-08-24** |

Os três serviços que rodam na VPS estão espelhados aqui. Cada README de serviço
lista as **divergências conhecidas** entre o que roda e o que seria bom (pins de
imagem, healthcheck desligado, chave morta no `.env`): elas ficam **registradas
e não corrigidas no repo**, porque corrigir aqui sem corrigir no host recria a
deriva do #1303 — agora com aparência de resolvida. Cada uma vira card.

---

## Subir um serviço NOVO na VPS

O procedimento acima cobre *mudar* o que já existe. Para *acrescentar*:

1. **Crie a pasta do serviço aqui**, com `docker-compose.yml` e `.env.example`
   (chaves sem valores) — antes de existir no host. O repo é a origem; o host é
   o destino.
2. **Decida a exposição.** O Traefik roda com `exposedbydefault=false`: sem
   `traefik.enable=true` o serviço **não** vai para a internet. Só publique o
   que precisa ser público, e prefira porta interna + label a publicar porta no
   host.
3. **Se for público**, o serviço precisa dos 4 labels (troque `<nome>`):
   ```yaml
   - traefik.enable=true
   - traefik.http.routers.<nome>.rule=Host(`<host>`) && PathPrefix(`/<prefixo>`)
   - traefik.http.routers.<nome>.entrypoints=websecure
   - traefik.http.routers.<nome>.tls.certresolver=letsencrypt
   - traefik.http.services.<nome>.loadbalancer.server.port=<porta-interna>
   ```
   TLS e renovação saem de graça daí — não configure certificado por serviço.
4. **Exponha `/healthz` com o commit**, como o `remote-signaling` faz
   (`GALAXIE_BUILD_SHA` em build-time). Serviço sem isso volta a ser
   inauditável, que é a razão desta pasta existir.
5. **Segredos:** chaves no `.env.example` daqui, valores só no `.env` do host.
   Se o serviço lê segredo de arquivo, confira **dono e modo** antes de subir —
   `chmod 600` num arquivo lido por container não-root derruba o serviço (já
   aconteceu: ~10 min de relay fora do ar). Use
   `chown --reference=<arquivo-que-já-funciona>`.
6. **PR primeiro, host depois.** Só então rode o procedimento de aplicar
   mudança, e registre no card o SHA que ficou no ar.

> **Antes de apagar qualquer coisa do host**, garanta que existe caminho de
> volta. Imagem construída localmente (`:local`) não tem procedência: se ela for
> podada, o estado anterior não volta sem recompilar.
