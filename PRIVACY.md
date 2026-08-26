# Política de Privacidade — The GALAXIE

**Última atualização:** ‹DATA›
**Controlador:** Galaxie Works — ‹razão social / CNPJ / endereço›
**Contato:** wagner@galaxie.works · Encarregado (DPO): ‹nome/e-mail›

> Placeholders entre ‹…› precisam ser preenchidos antes da publicação.

The GALAXIE é uma **suite desktop** de produtividade Microsoft 365 da Galaxie
Works. Esta política explica que dados o aplicativo acessa, onde ficam, o que é
enviado para a Galaxie e quais são os seus direitos. O princípio de fundo é
simples: **o app é um condutor entre a sua máquina e os seus próprios serviços
(Microsoft/Google); a Galaxie não guarda a sua caixa de e-mail, seus arquivos
ou seus contatos em servidores próprios.**

## 1. Quem é o controlador

Para os **dados de telemetria** coletados pela Galaxie (seção 5), o controlador é
a **Galaxie Works**.

Para os **dados da organização** (e-mail, arquivos, contatos, agenda acessados
via a conta corporativa do utilizador), quando o app é fornecido a uma
organização cliente, a **organização é a controladora** e a Galaxie atua como
**operadora**, nos termos do contrato com cada cliente e da LGPD (Lei nº
13.709/2018). O app apenas **acessa**, sob a credencial do próprio utilizador, os
dados que ele já tem acesso — não os copia para a Galaxie.

## 2. Que dados o app acessa

O dado vem por **três caminhos**, todos sob a autorização do próprio utilizador:

- **Microsoft Graph (delegado, `/me`)** — em contas Microsoft 365/pessoais: e-mail,
  agenda, contatos, tarefas, arquivos do OneDrive/SharePoint e dados de diretório
  da organização (quando aplicável). O app é **Graph-only** (sem IMAP/EWS/EAS).
- **Google (Drive/appData)** — em contas pessoais Google: armazenamento de
  configuração e nuvem, na área `appDataFolder` da própria conta do utilizador.
- **Sistema de arquivos local** — o Explorer de Arquivos lê e opera arquivos na
  máquina do utilizador, localmente.

Esses dados trafegam entre a **máquina do utilizador** e a **Microsoft/Google**,
sob a credencial do próprio utilizador. A Galaxie **não os intermedia nem os
armazena** em seus servidores.

## 3. Autenticação e credenciais

O login usa **Authorization Code + PKCE**. **O app nunca vê a sua senha**: quem
coleta credenciais e MFA é a página oficial da Microsoft (ou do Google), no
navegador. O que retorna ao app é um código de autorização, trocado por tokens.

O **refresh token** é gravado **localmente**, em `%LOCALAPPDATA%\GALAXIE\`,
**cifrado com DPAPI** do Windows — a chave deriva da credencial do utilizador do
Windows, de modo que outro utilizador da máquina não o decifra e o arquivo
copiado para outro computador é inútil. Tokens **não** são enviados à Galaxie.

## 4. Onde os dados ficam

- **Na sua máquina:** sessão cifrada (DPAPI), cache local, arquivos locais.
- **Na sua própria nuvem:** as configurações do app sincronizam num arquivo de
  settings (`toolbox.json`) guardado **no seu OneDrive/Google Drive**, na área de
  dados do app — é a **sua** nuvem, não a da Galaxie.
- **Servidores da Galaxie:** apenas os dados de telemetria da seção 5, quando
  consentidos.

## 5. Telemetria (o que a Galaxie coleta)

O app coleta **diagnóstico/observabilidade** com uma política *privacy-first*:

- **Consentimento por categoria** — o utilizador escolhe o que compartilhar.
- **Sem PII** — os dados são *scrubbed* (limpos de informação pessoal) antes do
  envio.
- **Destino:** uma instância **self-hosted** de OpenObserve, operada pela Galaxie.
- **Finalidade:** entender uso para corrigir o que atrapalha e melhorar o produto.
  **Não** vendemos dados, **não** exibimos anúncios e **não** fazemos perfilamento
  publicitário.

Retenção da telemetria: ‹período›.

## 6. Suporte remoto (Remote)

O membro **Remote** permite sessões de suporte remoto **iniciadas pelo
utilizador**. A conexão é **par-a-par (WebRTC)**; um servidor de retransmissão
(TURN) só encaminha mídia **cifrada** quando a conexão direta não é possível, e
**não** decifra nem armazena o conteúdo da sessão. Sessões são efêmeras e exigem
consentimento explícito de quem recebe o suporte.

## 7. Terceiros

- **Microsoft** e **Google** — provedores dos seus próprios dados, sob as suas
  contas e políticas de privacidade deles.
- **Infraestrutura de retransmissão (TURN)** — encaminha mídia cifrada do Remote.
- **OpenObserve (self-hosted pela Galaxie)** — recebe a telemetria consentida.

A Galaxie **não compartilha nem vende** dados pessoais a terceiros para fins de
marketing.

## 8. Seus direitos (LGPD)

Você pode solicitar **acesso, correção, anonimização, portabilidade, eliminação**
e informações sobre o tratamento dos seus dados pessoais, além de **revogar
consentimento** a qualquer momento. Para exercê-los, escreva para
wagner@galaxie.works (ou ‹canal/DPO›). Para dados sob controle da sua
organização, o pedido pode ser encaminhado à organização controladora.

## 9. Segurança

Sessão cifrada em disco (DPAPI), tráfego sobre **TLS/HTTPS**, e **instaladores
assinados** (assinatura de código; distribuição pública e auto-atualização). O
`CLIENT_ID` do app é público por natureza (aplicação *public client*, sem secret;
o PKCE protege o fluxo).

## 10. Crianças

The GALAXIE é uma ferramenta corporativa, **não destinada a menores de ‹idade›**.
A Galaxie não coleta intencionalmente dados de crianças.

## 11. Alterações

Podemos atualizar esta política. Mudanças materiais serão comunicadas por ‹canal›
e refletidas na data de "Última atualização" no topo.

## 12. Contato

Dúvidas ou pedidos sobre privacidade: **wagner@galaxie.works** — Galaxie Works,
‹endereço›.
