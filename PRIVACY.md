# Política de Privacidade — GALAXIE

> **RASCUNHO para revisão jurídica.** Redigido a partir dos fluxos de dados documentados no repositório. **Não é aconselhamento jurídico** — revise com um advogado (LGPD/GDPR) antes de publicar como política oficial. Preencha os campos marcados com `‹…›`.

**Última atualização:** ‹data› · **Responsável:** Galaxie Works (`galaxie.works`) · **Contato de privacidade:** ‹privacy@galaxie.works›

O GALAXIE é um aplicativo desktop de produtividade para Microsoft 365, distribuído pela **Galaxie Works**, que dá a usuários de organizações clientes acesso aos arquivos da empresa (SharePoint/OneDrive), ferramentas de e-mail, agenda, contatos, arquivos locais, acesso remoto e recursos de IA. Esta política explica **que dados o app acessa, por quê, e o que fazemos (e não fazemos) com eles**.

## 1. Princípio: acesso delegado, coleta mínima

O GALAXIE opera majoritariamente com **acesso delegado** — você se autentica na página oficial do seu provedor (Microsoft ou Google) e o app age **em seu nome**, com as permissões que você concede. **Não pedimos nem armazenamos sua senha.** Coletamos o mínimo necessário para entregar a função que você aciona, e não vendemos dados pessoais a ninguém.

## 2. Que dados são acessados e por quê

| Origem | O que é acessado | Finalidade |
|---|---|---|
| **Microsoft Graph (delegado, contas M365)** | Perfil (`/me`), arquivos do SharePoint/OneDrive, e-mail/agenda/contatos conforme o recurso usado. **Sem IMAP.** | Prover o workspace (arquivos, e-mail, agenda) que você abre. |
| **Google (contas pessoais)** | Google Drive e `appData` (dados do próprio app). | Prover acesso a arquivos e configuração nas contas pessoais. |
| **Filesystem local** | Arquivos e pastas que você navega no Explorer de Arquivos do app. | Função de gerenciador de arquivos local — os dados **não saem da sua máquina**. |
| **Suporte remoto (Remote)** | Tela, teclado/mouse e a mídia da sessão de suporte, quando você **inicia ou autoriza** uma sessão. | Permitir atendimento remoto ponto a ponto. A mídia trafega criptografada; quando a rede exige, passa por um **servidor de relay TURN** da Galaxie (apenas encaminha pacotes, não os inspeciona). |
| **Plataforma (contas corporativas / créditos de IA)** | Identidade federada `(provedor, subject)`, vínculo com a organização, e uso de créditos de IA. | Administração da conta, cobrança e alocação de créditos. |
| **Astro (IA em reuniões)** | O conteúdo que você submete à IA (ex.: transcrição/ata de reunião). | Gerar o resultado de IA que você pediu. Processado por provedor de modelo (ver §4). |
| **Telemetria/auditoria operacional** | Eventos técnicos e de autorização (sem conteúdo de arquivos), para segurança e diagnóstico. | Manter o serviço seguro e auditável. |

## 3. O que **não** fazemos

- **Não armazenamos sua senha** — a autenticação é feita na página do provedor; o backend troca o código de autorização, e o cliente nunca retém o token do provedor.
- **Não vendemos** dados pessoais nem os usamos para publicidade de terceiros.
- **Não inspecionamos** o conteúdo dos arquivos locais (eles não saem da sua máquina) nem o payload que trafega pelo relay de suporte.
- **Não coletamos** mais do que o recurso acionado exige.

## 4. Subprocessadores (terceiros que processam dados a nosso mando)

| Terceiro | Papel | Dado envolvido |
|---|---|---|
| **Microsoft** | Provedor de identidade e dados M365 (Graph) | Autenticação e o que você acessa no M365 |
| **Google** | Provedor de identidade e dados (contas pessoais) | Autenticação e Drive/appData |
| **Anthropic** | Provedor do modelo de IA do Astro | O conteúdo que você submete à IA |
| **Stripe** | Processador de pagamento (compra de créditos) | Dados de cobrança (não guardamos número de cartão) |
| **Hostinger (VPS)** | Hospedagem do relay de suporte e da telemetria | Encaminhamento de mídia de suporte; eventos operacionais |
| **SignPath Foundation** | Assinatura de código do instalador | **Nenhum dado de usuário** — apenas assina os binários |

‹Confirmar esta lista e adicionar termos/DPAs de cada um conforme a operação real.›

## 5. Armazenamento, retenção e localização

- **Local (sua máquina):** cache de sessão e configuração do app ficam no seu dispositivo. O botão **"Recomeçar"** limpa esse estado local.
- **Servidores (VPS):** o relay de suporte **não persiste** a mídia (só encaminha); a telemetria/auditoria é retida por ‹período› para segurança e diagnóstico.
- **Plataforma:** dados de conta, organização e saldo de créditos são retidos enquanto a conta existir. Ao encerrar (ex.: saída do último administrador), a organização é **marcada para exclusão em até 30 dias**.
- **Sessões:** expiram por inatividade (‹30 min›) e têm teto absoluto (‹12 h›).
- Localização dos servidores: ‹informar região do VPS›.

## 6. Seus direitos

Conforme a LGPD (Brasil) e, quando aplicável, o GDPR (UE), você pode solicitar **acesso, correção, portabilidade ou exclusão** dos seus dados pessoais, e revogar consentimentos. Para exercer, escreva a ‹privacy@galaxie.works›. Usuários corporativos: alguns dados são controlados pela **sua organização** (o administrador do M365 dela), que é o controlador nesses casos; a Galaxie atua como operadora.

## 7. Segurança

Instaladores são **assinados** (Authenticode via SignPath Foundation + minisign) e o app **se auto-atualiza** a partir do repositório de distribuição oficial. A autenticação é **federada** (o cliente nunca recebe o token do provedor). O acesso a recursos é **imposto no servidor**, não só escondido na interface.

## 8. Alterações e contato

Podemos atualizar esta política; mudanças relevantes serão comunicadas em ‹canal›. Dúvidas ou solicitações: **‹privacy@galaxie.works›** · Galaxie Works · ‹endereço/CNPJ, se aplicável›.
