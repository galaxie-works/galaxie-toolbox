# Curadoria do catalogo - Developer Tools + AI Tools + Cloud Storage

US **#1160** - epico **#1155**. Raia: Altair. Base: `feat` `26a61e9`.

## Contagem antes/depois

| Categoria | Antes | Manter | Remover | Corte |
|---|---:|---:|---:|---:|
| Developer Tools | 94 | 37 | 57 | 60% |
| AI Tools | 56 | 25 | 31 | 55% |
| Cloud Storage | 35 | 15 | 20 | 57% |
| **TOTAL** | **185** | **77** | **108** | **58%** |

Corte de **58%**. A regua do epico e explicita - *"na duvida, corta"*, *"remover e barato; manter e que custa"* - e AI Tools e onde o hype morto se concentra: **31 dos 56** sairam.

## Saude dos icones - medida abrindo o arquivo, nao pelo campo `icon`

| Formato real | Qtd | Renderiza? |
|---|---:|---|
| SVG | 135 | sim |
| PNG | 23 | **nao** |
| JPEG | 19 | **nao** |
| WEBP | 2 | **nao** |
| SO_BRANCO | 6 | parcial |

**50 de 185 (27%) nao aparecem** - contra os 12% do catalogo inteiro (#1153). A fatia esta **mais que 2x pior** que a media, porque AI Tools foi raspada em bloco: dos 56, **35 tem icone quebrado**.

Os dois que o PO citou estao aqui e a causa e a mesma: `deepseek` e JPEG e `base44` e PNG, os dois com extensao `.svg`.

Medicao feita lendo os magic bytes do blob **no ref** (`git cat-file`), nao o working tree.

## Developer Tools (94)

| id | veredito | motivo | desc_ptBR | desc_en | icone_ok |
|---|---|---|---|---|---|
| `algolia` | **manter** | lider em busca como servico | Busca hospedada para site e aplicacao | Hosted search for sites and applications | sim |
| `app-store-connect` | **manter** | obrigatorio para publicar na App Store | Publicacao e metricas na App Store | App Store publishing and metrics | sim |
| `apple-developer` | **manter** | obrigatorio para quem publica app Apple | Portal de desenvolvedor da Apple | Apple developer portal | sim |
| `atera` | **manter** | RMM/PSA desenhado para prestador de TI | Monitoramento e helpdesk para prestador de TI | Monitoring and helpdesk for IT providers | sim |
| `azure-devops` | **manter** | forte no corporativo BR e integra ao tenant | Repositorios, board e pipeline da Microsoft | Microsoft repos, boards and pipelines | sim |
| `bitbucket` | **manter** | top-3, comum em casa com Jira | Repositorios Git integrados ao Jira | Git repositories integrated with Jira | sim |
| `browserstack` | **manter** | lider em teste cross-browser | Teste em navegadores e dispositivos reais | Testing on real browsers and devices | sim |
| `circleci` | **manter** | top-3 em CI hospedado | Integracao e entrega continua na nuvem | Cloud continuous integration and delivery | sim |
| `codepen` | **manter** | padrao de sandbox front-end | Editor e vitrine de codigo front-end | Front-end code playground and showcase | sim |
| `cursor` | **manter** | lider em editor com IA | Editor de codigo com IA integrada | Code editor with built-in AI | **NAO** - JPEG renomeado .svg |
| `datadog` | **manter** | lider em observabilidade | Observabilidade de infra e aplicacao | Infrastructure and application observability | sim |
| `docker` | **manter** | padrao de mercado em conteiner | Conteineres e imagens de aplicacao | Application containers and images | sim |
| `endpoint-central` | **manter** | ManageEngine tem presenca real no Brasil | Gestao unificada de endpoint e patch | Unified endpoint and patch management | sim |
| `firebase` | **manter** | backend padrao para app movel em PME | Backend, banco e autenticacao do Google | Google backend, database and authentication | sim |
| `framer` | **manter** | forte em site e prototipo de alta fidelidade | Criacao e publicacao de sites com design | Design-driven website builder and publishing | **NAO** - JPEG renomeado .svg |
| `github` | **manter** | padrao de mercado em repositorio | Repositorios Git, issues e pull requests | Git repositories, issues and pull requests | sim |
| `github-copilot` | **manter** | padrao de mercado em assistente de codigo | Assistente de codigo por IA dentro do editor | AI coding assistant inside your editor | **NAO** - JPEG renomeado .svg |
| `gitlab` | **manter** | top-3, forte em DevOps integrado | Repositorios Git com CI/CD integrado | Git repositories with built-in CI/CD | sim |
| `heroku` | **manter** | PaaS ainda top-of-mind em PME | Hospedagem de aplicacao gerenciada | Managed application hosting | sim |
| `it-glue` | **manter** | padrao de documentacao para MSP | Documentacao de TI para prestador de servico | IT documentation for service providers | sim |
| `jenkins` | **manter** | padrao de CI on-premise | Automacao de build e integracao continua | Build automation and continuous integration | **NAO** - JPEG renomeado .svg |
| `linear` | **manter** | lider em gestao de produto moderna | Gestao de issues e roadmap de produto | Issue tracking and product roadmap | sim |
| `mailgun` | **manter** | top-3 em API de e-mail | API de envio de e-mail em escala | Email sending API at scale | sim |
| `netlify` | **manter** | top-3 em deploy de front-end | Deploy e hospedagem de sites estaticos | Static site deployment and hosting | sim |
| `new-relic` | **manter** | top-3 em APM | Monitoramento de performance de aplicacao | Application performance monitoring | sim |
| `outsystems` | **manter** | low-code com presenca forte no Brasil | Plataforma low-code corporativa | Enterprise low-code platform | sim |
| `posthog` | **manter** | forte em PME/startup, analytics de produto | Analytics de produto e replay de sessao | Product analytics and session replay | sim |
| `postman` | **manter** | padrao de mercado em teste de API | Testes e documentacao de API | API testing and documentation | sim |
| `postmark` | **manter** | top-3 em e-mail transacional | Envio de e-mail transacional com entregabilidade | Transactional email with high deliverability | sim |
| `redis-labs` | **manter** | Redis gerenciado, padrao de cache | Redis gerenciado na nuvem | Managed Redis in the cloud | sim |
| `retool` | **manter** | lider em ferramenta interna, util em PME | Monta ferramentas internas sobre os seus dados | Build internal tools over your own data | sim |
| `sentry` | **manter** | lider em monitoramento de erro | Monitoramento de erros e performance | Error and performance monitoring | sim |
| `stack-overflow` | **manter** | referencia universal de duvida tecnica | Perguntas e respostas de programacao | Programming questions and answers | sim |
| `statuspageio` | **manter** | padrao de pagina de status publica | Pagina publica de status de servico | Public service status page | sim |
| `supabase` | **manter** | alternativa Postgres lider e em alta | Backend Postgres com autenticacao e storage | Postgres backend with auth and storage | **NAO** - PNG renomeado .svg |
| `teamviewer` | **manter** | padrao de acesso remoto em TI brasileira | Acesso e suporte remoto a computadores | Remote computer access and support | sim |
| `vercel` | **manter** | lider em deploy de front-end | Deploy e hospedagem de aplicacoes web | Web application deployment and hosting | **parcial** - so-branco, some no tema claro |
| `adalo` | **remover** | no-code tier-2 | - | - | - |
| `appy-pie` | **remover** | no-code de baixa reputacao | - | - | - |
| `audioeye` | **remover** | acessibilidade de nicho | - | - | - |
| `better-stack` | **remover** | tier-2 em log e uptime | - | - | - |
| `bitnami` | **remover** | em declinio apos Broadcom | - | - | - |
| `bluehost` | **remover** | hospedagem compartilhada consumer | - | - | - |
| `boost-note` | **remover** | praticamente descontinuado | - | - | - |
| `bugsnag` | **remover** | tier-2; sentry domina | - | - | - |
| `builtwith` | **remover** | consulta de tecnologia, nicho de marketing | - | - | - |
| `chromatic` | **remover** | teste visual de Storybook, nicho | - | - | - |
| `chromium-search` | **remover** | ultra-nicho de quem desenvolve o Chromium | - | - | - |
| `codacy` | **remover** | qualidade de codigo tier-2 | - | - | - |
| `code-project` | **remover** | site legacy de artigo, nao ferramenta | - | - | - |
| `codecov` | **remover** | cobertura de teste, nicho estreito | - | - | - |
| `codeship` | **remover** | descontinuado pela CloudBees | - | - | - |
| `contactcloud` | **remover** | obscuro sem base instalada | - | - | - |
| `convex` | **remover** | backend tier-2 recente sem base instalada | - | - | - |
| `databricks` | **remover** | dados enterprise, fora do perfil PME | - | - | - |
| `devdocs` | **remover** | utilitario de nicho para desenvolvedor | - | - | - |
| `embrace` | **remover** | observabilidade movel, nicho | - | - | - |
| `engine-yard` | **remover** | PaaS legacy sem base instalada | - | - | - |
| `fogbugz` | **remover** | issue tracker legacy sem lideranca | - | - | - |
| `genuitec` | **remover** | ENTRADA QUEBRADA: URL e um wp-login.php | - | - | - |
| `hackerone` | **remover** | bug bounty, enterprise/seguranca | - | - | - |
| `instabug` | **remover** | bug report movel, nicho | - | - | - |
| `keen` | **remover** | produto morto | - | - | - |
| `levelblue` | **remover** | seguranca enterprise, fora do perfil PME | - | - | - |
| `lottiefiles` | **remover** | animacao de nicho | - | - | - |
| `lowes` | **remover** | LIXO: loja de material de construcao em dev tools | - | - | - |
| `mattermost` | **remover** | chat on-premise; Teams domina no nosso publico | - | - | - |
| `mintlify` | **remover** | documentacao de nicho | - | - | - |
| `neo4j-aura` | **remover** | banco de grafo, nicho estreito | - | - | - |
| `nightwatch` | **remover** | monitoramento so para Laravel, nicho | - | - | - |
| `opsgenie` | **remover** | em fim de vida, migrado para Jira Service Mgmt | - | - | - |
| `papertrail` | **remover** | log legacy da SolarWinds | - | - | - |
| `pastel` | **remover** | feedback em site, nicho | - | - | - |
| `pingdom` | **remover** | uptime tier-2 | - | - | - |
| `pivotal-tracker` | **remover** | produto encerrado | - | - | - |
| `playbookux` | **remover** | pesquisa com usuario, nicho | - | - | - |
| `pulseway` | **remover** | RMM tier-2 | - | - | - |
| `rainforest` | **remover** | QA por multidao, nicho | - | - | - |
| `realvnc` | **remover** | tier-2; teamviewer domina | - | - | - |
| `resend` | **remover** | tier-2; postmark/mailgun cobrem | - | - | - |
| `rollbar` | **remover** | tier-2; sentry domina | - | - | - |
| `sauce-labs` | **remover** | tier-2; browserstack domina | - | - | - |
| `shift4shop` | **remover** | e-commerce (3dcart), categoria errada | - | - | - |
| `shortcut` | **remover** | tier-2; linear e jira cobrem | - | - | - |
| `statuscake` | **remover** | uptime tier-2 | - | - | - |
| `targetprocess` | **remover** | agile enterprise, fora do perfil PME | - | - | - |
| `travis-ci` | **remover** | dominio travis-ci.org morto; produto em declinio | - | - | - |
| `unity-cloud` | **remover** | games, fora do nosso publico B2B | - | - | - |
| `uxpin` | **remover** | design tier-2; figma domina | - | - | - |
| `websim` | **remover** | experimento de IA, nao ferramenta de trabalho | - | - | - |
| `wpmu-dev` | **remover** | fornecedor de plugin WordPress, nicho | - | - | - |
| `xmatters` | **remover** | alerta enterprise, fora do perfil PME | - | - | - |
| `zap-hosting` | **remover** | hospedagem de servidor de jogo | - | - | - |
| `zenhub` | **remover** | camada tier-2 sobre o GitHub | - | - | - |

## AI Tools (56)

| id | veredito | motivo | desc_ptBR | desc_en | icone_ok |
|---|---|---|---|---|---|
| `beautifulai` | **manter** | top-3 em apresentacao com IA | Apresentacoes com layout automatico por IA | Presentations with AI-driven automatic layout | sim |
| `chatfuel` | **manter** | bot de WhatsApp, forte no Brasil | Chatbot de vendas para WhatsApp e Instagram | Sales chatbot for WhatsApp and Instagram | sim |
| `chatgpt` | **manter** | lider absoluto da categoria | IA conversacional da OpenAI para texto e analise | OpenAI conversational AI for text and analysis | sim |
| `claude` | **manter** | top-3, forte em texto longo e codigo | IA conversacional da Anthropic para texto e codigo | Anthropic conversational AI for text and code | **NAO** - PNG renomeado .svg |
| `copyai` | **manter** | top-3 em copywriting B2B | Copywriting e conteudo de marketing por IA | AI copywriting and marketing content | **NAO** - JPEG renomeado .svg |
| `deepseek` | **manter** | top-3 aberto; PO citou explicitamente | IA conversacional de baixo custo com raciocinio | Low-cost reasoning-focused conversational AI | **NAO** - JPEG renomeado .svg |
| `descript` | **manter** | edicao de audio/video pelo texto, usado por PME | Edita audio e video editando a transcricao | Edit audio and video by editing the transcript | sim |
| `elevenlabs` | **manter** | lider em sintese de voz, suporta pt-BR | Sintese de voz e dublagem por IA | AI voice synthesis and dubbing | **NAO** - JPEG renomeado .svg |
| `fathom` | **manter** | notas de reuniao por IA, gratuito e adotado | Grava e resume reunioes automaticamente | Records and summarizes meetings automatically | sim |
| `fireflies` | **manter** | lider em transcricao de reuniao | Transcricao e resumo de reunioes por IA | AI meeting transcription and summaries | sim |
| `gamma` | **manter** | lider em apresentacao gerada por IA | Apresentacoes e documentos gerados por IA | AI-generated presentations and documents | **NAO** - PNG renomeado .svg |
| `gemini` | **manter** | top-3; integra com Google Workspace | IA do Google integrada ao Workspace | Google AI integrated with Workspace | **NAO** - PNG renomeado .svg |
| `google-ai-studio` | **manter** | console oficial de prototipagem Gemini | Console do Google para prototipar com Gemini | Google console for prototyping with Gemini | **NAO** - PNG renomeado .svg |
| `google-notebooklm` | **manter** | unico no nicho de pesquisa sobre docs proprios | Pesquisa e resumo sobre os seus documentos | Research and summaries over your own documents | **NAO** - JPEG renomeado .svg |
| `grok` | **manter** | top-5, integrado ao X | IA conversacional da xAI integrada ao X | xAI conversational AI integrated with X | **NAO** - JPEG renomeado .svg |
| `heygen` | **manter** | top-3 em avatar; dublagem multilingue | Avatar em video e dublagem multilingue por IA | AI video avatars and multilingual dubbing | **NAO** - PNG renomeado .svg |
| `ideogram` | **manter** | lider em tipografia dentro da imagem | Geracao de imagem com texto legivel | Image generation with legible embedded text | sim |
| `jasper` | **manter** | lider em copywriting corporativo | Plataforma de conteudo de marca por IA | AI brand content platform for marketing teams | **NAO** - JPEG renomeado .svg |
| `languagetool` | **manter** | gramatica com pt-BR de verdade | Corretor gramatical e de estilo multilingue | Multilingual grammar and style checker | sim |
| `microsoft-copilot` | **manter** | M365 e o tenant do nosso publico | IA da Microsoft dentro do Microsoft 365 | Microsoft AI built into Microsoft 365 | **NAO** - PNG renomeado .svg |
| `midjourney` | **manter** | lider em geracao de imagem | Geracao de imagem por IA a partir de texto | AI image generation from text prompts | **parcial** - so-branco, some no tema claro |
| `perplexity` | **manter** | lider em busca com IA e citacao de fonte | Busca com IA que cita as fontes | AI search engine that cites its sources | **NAO** - PNG renomeado .svg |
| `runway` | **manter** | lider em video generativo | Geracao e edicao de video por IA | AI video generation and editing | **NAO** - PNG renomeado .svg |
| `synthesia` | **manter** | lider em video corporativo com avatar | Video corporativo com avatar e narracao por IA | Corporate video with AI avatars and narration | **parcial** - so-branco, some no tema claro |
| `writesonic` | **manter** | top-3 em copywriting e SEO | Copywriting e conteudo de SEO por IA | AI copywriting and SEO content | sim |
| `abacus-ai` | **remover** | plataforma ML enterprise, fora do perfil PME | - | - | - |
| `agency-advanta` | **remover** | nicho de agencia, sem relevancia de mercado | - | - | - |
| `atria` | **remover** | produto obscuro sem base instalada | - | - | - |
| `base44` | **remover** | tier-2 de vibe-coding; REMOCAO CONFIRMADA pelo PO | - | - | - |
| `boosted` | **remover** | video consumer da Lightricks, nao B2B | - | - | - |
| `carousel-conversion-studio` | **remover** | obscuro, nicho de midia social | - | - | - |
| `characters` | **remover** | entretenimento/roleplay, nao uso profissional | - | - | - |
| `chorusai` | **remover** | descontinuado como produto avulso apos ZoomInfo | - | - | - |
| `cohere` | **remover** | plataforma de API, nao app de uso diario | - | - | - |
| `commslayer` | **remover** | helpdesk IA obscuro sem base instalada | - | - | - |
| `doubao` | **remover** | app regional chines, mercado que nao atendemos | - | - | - |
| `flowgpt` | **remover** | repositorio de prompts, nao ferramenta de trabalho | - | - | - |
| `frase` | **remover** | SEO tier-2 sem lideranca | - | - | - |
| `jarvis` | **remover** | DUPLICATA: renomeado para Jasper (ja na lista) | - | - | - |
| `leonardoai` | **remover** | tier-2 de imagem; midjourney/ideogram cobrem | - | - | - |
| `lightricks` | **remover** | portfolio consumer (Facetune), nao B2B | - | - | - |
| `looka` | **remover** | gerador de logo consumer/micro | - | - | - |
| `pictory` | **remover** | video tier-2 sem lideranca | - | - | - |
| `poe` | **remover** | agregador tier-2 sem lideranca | - | - | - |
| `rytr` | **remover** | duplicata funcional de copy.ai/jasper sem lideranca | - | - | - |
| `stability-ai` | **remover** | produto em forte declinio apos reestruturacao | - | - | - |
| `steve-ai` | **remover** | video tier-3 | - | - | - |
| `taja-ai` | **remover** | nicho de criador de YouTube, nao B2B | - | - | - |
| `temi` | **remover** | transcricao tier-2; fireflies domina | - | - | - |
| `thumbnailcreator` | **remover** | nicho de criador de conteudo | - | - | - |
| `toddle-ai` | **remover** | produto ambiguo e obscuro | - | - | - |
| `unlimitedaichat` | **remover** | generico sem marca nem lideranca | - | - | - |
| `wordtune` | **remover** | nicho de reescrita ja coberto pelo languagetool | - | - | - |
| `writer` | **remover** | enterprise; fora do perfil PME | - | - | - |
| `xai` | **remover** | DUPLICATA: e a empresa do Grok (ja na lista) | - | - | - |
| `you` | **remover** | tier-2 de busca; perplexity dominou | - | - | - |

## Cloud Storage (35)

| id | veredito | motivo | desc_ptBR | desc_en | icone_ok |
|---|---|---|---|---|---|
| `aws` | **manter** | lider de nuvem publica | Console da nuvem da Amazon Web Services | Amazon Web Services cloud console | sim |
| `backblaze` | **manter** | lider em backup e B2 para PME | Backup automatico e armazenamento de objetos | Automatic backup and object storage | sim |
| `dashlane` | **manter** | top-3 em gerenciador de senha corporativo | Gerenciador de senhas para equipes | Password manager for teams | sim |
| `dropbox` | **manter** | top-3, base instalada grande em PME | Armazenamento e sincronizacao de arquivos | Cloud file storage and sync | sim |
| `google-cloud` | **manter** | top-3 de nuvem publica | Console da nuvem do Google | Google Cloud console | sim |
| `google-drive` | **manter** | top-3 de armazenamento, onipresente em PME | Armazenamento e documentos na nuvem do Google | Google cloud storage and documents | sim |
| `icloud-drive` | **manter** | padrao para quem tem Mac/iPhone na empresa | Armazenamento em nuvem da Apple | Apple cloud storage | sim |
| `jumpcloud` | **manter** | diretorio e MDM desenhado para PME | Diretorio, SSO e gestao de dispositivos | Directory, SSO and device management | sim |
| `mega` | **manter** | top-5 conhecido, foco em criptografia | Armazenamento com criptografia ponta a ponta | End-to-end encrypted cloud storage | sim |
| `microsoft-azure` | **manter** | top-3 e integrado ao tenant M365 | Console da nuvem da Microsoft | Microsoft Azure cloud console | sim |
| `microsoft-sharepoint` | **manter** | biblioteca de documentos corporativa do M365 | Portal e biblioteca de documentos do M365 | Microsoft 365 document libraries and portals | sim |
| `n-able` | **manter** | RMM lider para prestador de servico de TI | Monitoramento e gestao remota para MSP | Remote monitoring and management for MSPs | sim |
| `okta` | **manter** | lider em identidade e SSO | Identidade e SSO corporativo | Enterprise identity and single sign-on | sim |
| `onedrive` | **manter** | nucleo do M365, o tenant do nosso publico | Armazenamento em nuvem do Microsoft 365 | Microsoft 365 cloud storage | sim |
| `synology` | **manter** | NAS e padrao de mercado em PME brasileira | Portal de gestao dos NAS Synology | Management portal for Synology NAS | sim |
| `apple-calendar` | **remover** | categoria errada e fraco fora do ecossistema Apple | - | - | - |
| `apple-mail` | **remover** | categoria errada; nosso app e Windows | - | - | - |
| `apple-notes` | **remover** | categoria errada; nosso app e Windows | - | - | - |
| `carbonite` | **remover** | backup legacy sem lideranca atual | - | - | - |
| `cloudhq` | **remover** | utilitario de migracao de nicho | - | - | - |
| `dear-systems` | **remover** | ERP de estoque, categoria errada e nicho | - | - | - |
| `degoo` | **remover** | consumer com distribuicao agressiva | - | - | - |
| `elasticio` | **remover** | iPaaS obscuro sem base instalada | - | - | - |
| `enpass` | **remover** | gerenciador de senha tier-2 | - | - | - |
| `fivetran` | **remover** | ELT enterprise, fora do perfil PME | - | - | - |
| `ghost-inspector` | **remover** | teste de QA de nicho, categoria errada | - | - | - |
| `it-portal` | **remover** | obscuro; it-glue cobre o nicho | - | - | - |
| `linode` | **remover** | VPS tier-2; PME BR usa outros | - | - | - |
| `nordpass` | **remover** | gerenciador de senha tier-2 | - | - | - |
| `onehub` | **remover** | compartilhamento B2B de nicho | - | - | - |
| `onelogin` | **remover** | tier-2; okta e entra dominam | - | - | - |
| `pcloud` | **remover** | armazenamento tier-2 sem lideranca | - | - | - |
| `sync` | **remover** | tier-2; backblaze/dropbox cobrem | - | - | - |
| `terabox` | **remover** | consumer regional asiatico | - | - | - |
| `zoho-vault` | **remover** | so faz sentido dentro da suite Zoho | - | - | - |

## Ressalvas para o PO

1. **`base44` sai, e o PO citou o nome.** Ele o citou como exemplo de icone que nao aparece (#1153), nao como endosso - mas como o nome saiu da boca dele, registro o veto facil: e plataforma de vibe-coding tier-2, e os lideres do nicho (Lovable, v0, Bolt) nao estao no catalogo. Se ele quiser manter, mantem-se sem discussao.
2. **`deepseek` fica.** Tambem citado por icone quebrado, mas passa na regua sozinho: top-3 em modelo aberto.
3. **Miscategorizacao pesada em Cloud Storage.** Dos 35, **15 nao sao armazenamento**: gerenciador de senha (4), identidade/SSO (3), RMM/MSP (3), ETL, iPaaS, QA, ERP de estoque e 3 apps iCloud. Mantive 6 deles por merito (`dashlane`, `okta`, `jumpcloud`, `n-able`, `it-glue`, e os 3 de nuvem publica) - mas **eles precisam de recategorizacao**, nao de permanencia em Cloud Storage. Isso e trabalho do passo de patch do JSON, nao desta US.
4. **`docker` tem URL errada.** O catalogo aponta `https://app.atomist.com` - Atomist foi comprada pela Docker e desligada; nao e o app do Docker. Mantive o app (padrao de mercado) mas **a URL precisa virar `https://hub.docker.com`** no patch.
5. **`genuitec` e `lowes` sao entrada quebrada, nao curadoria.** O primeiro aponta para um `wp-login.php`; o segundo e a rede de material de construcao Lowe's, catalogada em Developer Tools. Os dois saem, mas valem como sinal de que o gerador do catalogo aceitou lixo.

## Nota de metodo

O `icone_ok` **nao** pode ser respondido pelo campo `icon` do JSON - ele e afirmacao do gerador, nao verificacao (achado do #1153). Cada linha aqui saiu de leitura de magic bytes do arquivo real.

## Adicoes recomendadas - lideres de nicho AUSENTES do catalogo

Pedido direto do PO. **Conferi cada um contra o catalogo INTEIRO antes de propor** - varios que eu ia sugerir ja existem em outra categoria e por isso NAO estao aqui: `grammarly`, `deepl`, `figma`, `notion`, `jira`, `cloudflare`, `digitalocean`, `grafana`, `veeam`, `datto`, `1password`, `bitwarden`, `otter`, `replit`, `canva`.

| Categoria | id sugerido | Nome | URL | Por que entra |
|---|---|---|---|---|
| AI Tools | `lovable` | Lovable | https://lovable.dev | lider do nicho de vibe-coding que o base44 ocupava |
| AI Tools | `v0` | v0 | https://v0.app | top-3 de vibe-coding; e da Vercel, que ja mantemos |
| AI Tools | `bolt-new` | Bolt | https://bolt.new | top-3 de vibe-coding (StackBlitz) |
| AI Tools | `windsurf` | Windsurf | https://windsurf.com | top-2 de editor com IA junto do cursor, que mantivemos |
| AI Tools | `mistral` | Mistral Le Chat | https://chat.mistral.ai | top-5 de LLM; opcao europeia, argumento de LGPD/soberania |
| Developer Tools | `hostinger` | Hostinger | https://hpanel.hostinger.com | hospedagem com forte presenca em PME brasileira |
| Developer Tools | `render` | Render | https://dashboard.render.com | sucessor real do heroku, que mantivemos por inercia |
| Developer Tools | `railway` | Railway | https://railway.app | top-3 de PaaS moderno |
| Developer Tools | `sonarcloud` | SonarQube Cloud | https://sonarcloud.io | LIDER de qualidade de codigo - cortei o codacy tier-2 e o lider nao estava |
| Developer Tools | `anydesk` | AnyDesk | https://my.anydesk.com | acesso remoto top-2 e MUITO usado no Brasil |
| Developer Tools | `rustdesk` | RustDesk | https://rustdesk.com | acesso remoto aberto; concorrente direto do nosso GALAXIE Remote |
| Developer Tools | `zabbix` | Zabbix | https://www.zabbix.com | monitoramento dominante em infra brasileira |
| Developer Tools | `glpi` | GLPI | https://glpi-project.org | ITSM/inventario dominante em PME e setor publico BR |
| Developer Tools | `portainer` | Portainer | https://www.portainer.io | padrao de gestao de container para quem nao vive no terminal |
| Developer Tools | `proxmox` | Proxmox | https://www.proxmox.com | virtualizacao dominante em PME/MSP brasileiro |
| Cloud Storage | `box` | Box | https://app.box.com | top-5 de compartilhamento corporativo; ausencia e um buraco grande |
| Cloud Storage | `nextcloud` | Nextcloud | https://nextcloud.com | lider de nuvem auto-hospedada; relevante para quem nao quer SaaS |
| Cloud Storage | `acronis` | Acronis | https://cloud.acronis.com | backup forte no canal de MSP brasileiro |
| Cloud Storage | `wasabi` | Wasabi | https://console.wasabisys.com | armazenamento S3 compativel de baixo custo |

**As URLs acima sao proposta, nao medicao.** Nao resolvi nenhuma - o passo do patch deve fazer HEAD em cada uma antes de gravar, que e exatamente o gate que falta hoje (o `apps-catalog-integrity.test.ts` nunca resolve URL).

### O corte revelou um viés que o catalogo ja tinha

Tres remocoes minhas expoem a mesma falha de curadoria original: **entrou o tier-2 e faltou o lider.** Cortei `codacy` (qualidade de codigo) e o **SonarQube nao estava**; cortei `realvnc` e o **AnyDesk nao estava**; cortei `linode`/`carbonite` e **Render, Wasabi e Acronis nao estavam**. O catalogo nao foi montado por lideranca de categoria - foi montado por disponibilidade de integracao.

### 🔴 Buraco fora da minha fatia, e e o maior de todos

A regua do epico nomeia **contabil** como nicho que atendemos. Medi o catalogo inteiro: **nenhum ERP ou sistema contabil brasileiro existe nele.** Ausentes - `totvs`, `sankhya`, `senior`, `omie`, `conta-azul`, `bling`, `tiny`, `nibo`, `dominio-sistemas`.

Sao 1779 apps e **zero** software de gestao brasileiro, num produto cujo publico e PME brasileira. Isso nao e a minha fatia (cai em Work and Business / Banking and Finance), mas nenhuma fatia individual enxergaria - so aparece varrendo o catalogo inteiro. Fica registrado para quem for montar o patch.
