# 5. Autorização da plataforma

> **Medido contra:** `96a85934` (HEAD da `pre-prod`) · **em** 2026-08-31 · por Altair (Arquiteto)
> **Fonte:** `services/platform-identity`, `platform-concessao`, `platform-http`, `platform-org-admin`, `platform-back-office`
> **Scaffold nesta vista:** a plataforma é **nascente** — o domínio está escrito e testado; a borda HTTP entrou em fatias. `Sujeito::GrupoAad` está **deferido** de propósito.

## O que esta vista responde

Quem pode o quê — e **onde** isso é decidido, que é a pergunta que evita que a resposta se espalhe.

## Os dois eixos

```mermaid
flowchart TB
    subgraph eixo1["Eixo 1 — PAPEL: <i>quem é?</i>"]
        direction TB
        P["<b>Principal</b> — três TIPOS, não um com flags"]
        P1["UsuarioFinal { usuario, org }"]
        P2["AdminOrg { usuario, org }"]
        P3["Staff { usuario }<br/><i>fora de banda, sem org cliente</i>"]
        P --> P1 & P2 & P3
    end

    subgraph eixo2["Eixo 2 — CONCESSÃO: <i>o que foi concedido?</i>"]
        direction TB
        C["<b>Concessao</b> { sujeito, capacidade, alvo }"]
        C1["LicencaBridge<br/><i>empacotamento comercial</i>"]
        C2["AcessoAstroIA<br/><i>controlo real</i>"]
        C --> C1 & C2
    end

    SESSAO["<b>Sessao</b><br/><i>o escopo vem SEMPRE daqui</i>"]
    ORG["<b>EstadoOrg</b><br/>Provisionada | Suspensa<br/><i>lido do armazém a cada request</i>"]
    AUTZ{{"<b>autorizar(sessao, op)</b><br/>default-deny · match exaustivo"}}
    DEC["<b>Decisao</b><br/>Permitido | Negado"]

    SESSAO --> AUTZ
    eixo1 --> AUTZ
    ORG --> AUTZ
    AUTZ --> DEC
    eixo2 -.->|"pergunta separada:<br/>capacidades efetivas"| DEC
```

## Fluxo de um request

```mermaid
sequenceDiagram
    autonumber
    participant CL as web/ (cliente)
    participant HT as platform-http (borda axum)
    participant ID as platform-identity (domínio)
    participant AR as Armazém

    CL->>HT: request + cookie de sessão
    HT->>HT: parse do cookie → SessaoId
    HT->>AR: resolve sessão
    AR-->>HT: Principal + Org
    HT->>AR: estado da org (AGORA, não da sessão)
    AR-->>HT: Provisionada | Suspensa
    HT->>ID: autorizar(sessao, Operacao::…)
    ID-->>HT: Permitido | Negado
    alt Negado por não ser dono do recurso
        HT-->>CL: <b>404</b> (idêntico ao inexistente)
    else Org suspensa
        HT-->>CL: 403 OrgSuspensa
    else Permitido
        HT-->>CL: 200
    end
```

## As decisões que sustentam isto, e o que cada uma impede

**1. `Principal` são três TIPOS, não um tipo com flags.** O tipo carrega a fronteira de confiança; a mais dura é *staff ↔ cliente*. 🔑 **Se `Staff` fosse um `Papel`, um `org_admin` podia concedê-lo** — e o back-office ficava alcançável de dentro de uma conta cliente. Ser um variante à parte torna essa escalada **inexprimível**, não apenas proibida.

**2. `Decisao` não tem terceiro estado, e a `Operacao` é exaustiva sem *catch-all*.** Adicionar uma variante a `Operacao` **quebra a compilação** até ganhar política explícita. É a guarda que obriga a **decidir**, em vez de confiar em que alguém se lembre.

**3. O escopo vem sempre da SESSÃO, nunca do payload.** `GET /me/...`, não `GET /users/<id>/...`. Se um id chega na rota, é **conferido** contra a sessão.

**4. Recurso de outro responde 404, não 403.** Um 403 confirma que o recurso existe — e transforma a autorização num oráculo de enumeração. ⚠️ **Não basta o status: a resposta tem de ser idêntica à do inexistente no fio**, senão o oráculo sobrevive na diferença.

**5. O `estado` da org é privado e só muda por TRANSIÇÃO.** Nasce `Provisionada`; `suspender`/`reativar` são as únicas portas. Não há literal público nem *setter*, portanto **ninguém forja "não suspensa" por fora**. E é lido **a cada request** — vale no acto, sem corrida de *"matar sessões"*. Sobrevivem à suspensão `/me`, `/me/orgs` e `DELETE /session`: sem isso o utilizador não alcança o ecrã que lhe explica a suspensão.

**6. Concessão só CONCEDE — "negar" não é representável.** Revogar é **remover a linha**, nunca acrescentar um "não". A resolução é **união**, nunca interseção, e por isso é monótona: acrescentar uma concessão nunca tira acesso. Um "negar" representável abriria a porta a conflitos de precedência, que é onde os modelos de autorização apodrecem.

**7. O `role` do M365 não é autorização nossa.** `MultiTenantMember` traz `role: "owner"|"member"` do Graph — isso é **topologia de tenant da Microsoft**. Se virasse a fonte de `org_admin`, quem administra o tenant M365 passava a administrar a org Galaxie.

**8. `LicencaBridge` chama-se *Licença* e não *Acesso* de propósito.** O Bridge fala com o M365 com a credencial **do próprio utilizador** — negar a capacidade é **empacotamento comercial**, não proteção: a pessoa abre a mesma porta pelo Outlook. 🔑 **O nome impede uma leitura falsa daqui a seis meses**, quando alguém vir "negado" e concluir que o dado está protegido. `AcessoAstroIA` chama-se *Acesso* porque o Astro **é** recurso nosso e negar barra de facto.

**9. `Sujeito` é enum FECHADO com `GrupoAad` deferido.** Quando o grupo entrar, o `match` da resolução **obriga** a decidir *"o utilizador pertence a este grupo?"* — em vez de nascer agora um braço irresolúvel.

**10. Domínio e borda são crates separados.** `platform-oauth` **decide** o que os bytes significam; `platform-http` **busca** os bytes. A segurança fica em código puro e testável, longe do I/O.

## Onde isto ainda não está fechado

- A borda HTTP entrou **em fatias**; nem toda a superfície do contrato está servida.
- `Capacidade` tem **duas** variantes hoje — o eixo existe, o catálogo é pequeno.
- `Sujeito::GrupoAad` espera a fatia de Graph/consent.
