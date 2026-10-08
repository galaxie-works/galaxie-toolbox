# Política de Privacidade — The GALAXIE

**Última atualização:** ‹DATA›
**Controlador:** Galaxie Works — ‹razão social / CNPJ / endereço›
**Contato:** wagner@galaxie.works · Encarregado (DPO): ‹nome/e-mail›

> Placeholders entre ‹…› precisam ser preenchidos antes da publicação.

The GALAXIE é uma **suite desktop** de produtividade Microsoft 365 da Galaxie
Works. Esta política explica que dados o aplicativo acessa, onde ficam, e o que é
transmitido para a Galaxie ou para terceiros. O princípio de fundo: **a Galaxie
não guarda a sua caixa de e-mail, seus arquivos ou seus contatos em servidores
próprios** — o app acessa esses dados sob a sua credencial. Mas há **exceções
explícitas** (abaixo) em que dados saem da máquina: o membro **Navigator**
(navegação web), o membro **Remote** (plano de sinalização) e uploads que **você**
inicia (anexar/partilhar arquivo). Esta política descreve todos.

## 1. Quem é o controlador

Para os **dados de telemetria** (§6) e o **plano de sinalização do Remote** (§7)
operados pela Galaxie, o controlador é a **Galaxie Works**.

Para os **dados da organização** (e-mail, arquivos, contatos, agenda acessados
via a conta corporativa), quando o app é fornecido a uma organização cliente, a
**organização é a controladora** e a Galaxie atua como **operadora**, nos termos
do contrato e da LGPD (Lei nº 13.709/2018). O app apenas **acessa**, sob a
credencial do próprio utilizador, os dados que ele já tem acesso.

## 2. Que dados o app acessa e transmite

O dado circula por **quatro caminhos**:

- **Microsoft Graph (delegado, `/me`)** — em contas Microsoft 365/pessoais:
  e-mail, agenda, contatos, tarefas, arquivos OneDrive/SharePoint e diretório da
  org. Graph-only (sem IMAP/EWS/EAS). Tráfego entre a sua máquina e a Microsoft.
- **Google (Drive/appData)** — em contas Google pessoais: configuração e nuvem na
  área `appDataFolder` da própria conta. Tráfego entre a sua máquina e a Google.
- **Sistema de arquivos local** — o Explorer lê e opera arquivos na sua máquina,
  **localmente** (ver §5 para as exceções de upload que você inicia).
- **Navegação web (membro Navigator)** — quando você abre um endereço, o
  Navigator carrega-o num WebView2 e o tráfego vai **diretamente para o site que
  você visitou** e seus operadores — **terceiros que a Galaxie não controla nem
  intermedia**, sujeitos às políticas de privacidade deles. O app **guarda
  localmente** o histórico de navegação (endereço, título e data/hora) — ver §4.

Os dados do Graph/Google trafegam sob a **sua** credencial; a Galaxie **não os
armazena** em seus servidores.

## 3. Autenticação, credenciais e tokens

O login usa **Authorization Code + PKCE**. **A senha é coletada pela página
oficial da Microsoft/Google, no WebView — o app nunca a vê.** O que retorna é um
código de autorização.

Distinção importante:

- **O componente WebView** (onde você digita a senha) **não** entrega senha nem
  tokens à Galaxie.
- **O cliente nativo do app** (Rust/Tauri) **recebe** um **access token** (mantido
  em memória) e um **refresh token**, que é **gravado localmente** em
  `%LOCALAPPDATA%\GALAXIE\`, **cifrado com DPAPI** do Windows (chave derivada da
  credencial do utilizador do Windows: outro utilizador da máquina não decifra; o
  arquivo copiado para outra máquina é inútil).

**Esses tokens não são enviados à Galaxie** — ficam entre a sua máquina e o
provedor (Microsoft/Google). Mas o app **recebe e persiste** o refresh token
localmente, como descrito.

## 4. Onde os dados ficam

- **Na sua máquina:** sessão cifrada (DPAPI), cache local, arquivos locais, e o
  **histórico do Navigator** (endereço/título/data-hora em `localStorage`).
- **Na sua própria nuvem:** as configurações do app sincronizam num arquivo
  (`toolbox.json`) no **seu** OneDrive/Google Drive — a sua nuvem, não a da Galaxie.
- **Servidores da Galaxie:** apenas telemetria consentida (§6) e a sinalização do
  Remote (§7).

## 5. Arquivos locais — quando ficam e quando saem

Navegar, listar e **pré-visualizar** arquivos no Explorer é **local**: os bytes
não saem da máquina.

**Exceções que VOCÊ inicia:** ao **anexar um arquivo local a um e-mail** ou usar
**"Compartilhar via OneDrive"**, o app **lê os bytes do arquivo e envia-os ao
Microsoft Graph** (anexo em `/messages/{id}/attachments` ou upload ao OneDrive).
Nesses fluxos, o conteúdo do arquivo **sai da máquina** — para a Microsoft, sob a
sua conta, por ação sua.

## 6. Telemetria (o que a Galaxie coleta)

Diagnóstico/observabilidade *privacy-first*: **consentimento por categoria**,
**sem PII** (dados *scrubbed* antes do envio), destino **OpenObserve self-hosted**
pela Galaxie. Finalidade: melhorar o produto. **Não** vendemos dados, **não**
exibimos anúncios, **não** fazemos perfilamento. Retenção: ‹período›.

## 7. Suporte remoto (Remote) — mídia P2P + sinalização da Galaxie

O membro **Remote** permite sessões de suporte **iniciadas pelo utilizador**. A
**mídia** (tela/áudio/input) é **par-a-par (WebRTC)**; um servidor **TURN** só
encaminha mídia **cifrada** quando a conexão direta falha, e não a decifra.

**Mas o estabelecimento da sessão passa por um serviço de sinalização operado
pela Galaxie** (`wss://telemetry.thegalaxie.cloud/remote/v1/ws`). Esse serviço
recebe e retransmite os **metadados de conexão**: identificadores de device,
chaves públicas, mensagens de criação/resgate de sessão e a sinalização
**SDP/ICE** (que inclui endereços de rede candidatos). **Finalidade:** intermediar
o encontro entre os dois pares para abrir a sessão P2P. Não transporta o conteúdo
da tela. Retenção da sinalização: ‹período›. Sessões são efêmeras e exigem
consentimento de quem recebe o suporte.

## 8. Terceiros

- **Microsoft** e **Google** — provedores dos seus próprios dados, sob as suas
  contas e as políticas deles.
- **Operadores dos sites que você visita no Navigator** — recebem o seu tráfego
  de navegação diretamente; a Galaxie não os controla.
- **Serviço de sinalização do Remote** (Galaxie) — metadados de conexão (§7).
- **Infraestrutura TURN** — encaminha mídia cifrada do Remote.
- **OpenObserve (self-hosted pela Galaxie)** — telemetria consentida.

A Galaxie **não vende** dados pessoais e **não** os compartilha para marketing.

## 9. Segurança

Sessão cifrada em disco (**DPAPI**), tráfego sobre **TLS/HTTPS**. Os **updates**
são assinados com a chave do atualizador (Tauri updater / minisign), verificada
pelo app antes de aplicar. **Assinatura de código do instalador (Authenticode),
via SignPath Foundation, está em processo de adoção e ainda não é operacional** —
esta política será atualizada quando estiver ativa. O `CLIENT_ID` do app é público
por natureza (*public client*, sem secret; o PKCE protege o fluxo).

## 10. Seus direitos (LGPD)

Você pode solicitar **acesso, correção, anonimização, portabilidade, eliminação**
e informações sobre o tratamento, além de **revogar consentimento** a qualquer
momento (inclusive o de telemetria). Escreva para wagner@galaxie.works (ou
‹canal/DPO›). Para dados sob controle da sua organização, o pedido pode ser
encaminhado à organização controladora.

## 11. Crianças

Ferramenta corporativa, **não destinada a menores de ‹idade›**. A Galaxie não
coleta intencionalmente dados de crianças.

## 12. Alterações

Podemos atualizar esta política. Mudanças materiais serão comunicadas por ‹canal›
e refletidas na data de "Última atualização".

## 13. Contato

Privacidade: **wagner@galaxie.works** — Galaxie Works, ‹endereço›.
