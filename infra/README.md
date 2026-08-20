# `infra/` — o que roda na VPS

**Origem:** #1307 (desenho do `altair`) · fatia 1 = **#1311**. Existe por causa do
**#1303**: um P0 foi fabricado a partir de *deriva invisível* — o que rodava na
VPS não tinha origem rastreável no repo, e ninguém conseguia responder **"qual
commit está no ar?"** sem abrir a imagem.

Esta pasta é a resposta para as duas metades do problema:

| pergunta | resposta |
|---|---|
| *o que roda?* | está aqui, versionado |
| *qual commit?* | `curl https://<host>/healthz` |

---

## Qual commit está no ar

```bash
curl -s https://telemetry.thegalaxie.cloud/healthz
```

```json
{ "status": "ok", "version": "0.1.0", "commit": "943ee66…" }
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
| **Traefik** | [`traefik/`](traefik/) | ⚠️ **esqueleto** — ver aviso abaixo |
| **OpenObserve** | [`openobserve/`](openobserve/) | ⚠️ **esqueleto** — ver aviso abaixo |

### ⚠️ Traefik e OpenObserve ainda NÃO espelham o host

O `remote/` já é o que roda. Os outros dois entraram nesta fatia como
**estrutura + `.env.example` + procedimento**, e o conteúdo real precisa vir de
quem opera a VPS (`altair`, canon: infra do Remote é raia dele).

**Isto está escrito aqui de propósito**, em vez de commitar um compose plausível
mas não conferido: um arquivo que *parece* ser o que roda e não é seria pior que
a ausência dele — recria a deriva invisível com aparência de resolvida.

**Como fechar** (uma PR pequena, por serviço):

1. No host, copie o compose/config real do serviço.
2. Tire os segredos e ponha as chaves no `.env.example`.
3. Abra PR trocando o esqueleto pelo real e diga no corpo: *"conferido contra o
   host em `<data>`"*.
4. A partir daí, mudança só pelo procedimento acima.
