# Curadoria do catalogo - Social + Entertainment + News and Weather

US **#1161** - epico **#1155**. Raia: **Altair** (redistribuida da `Lumen II`). Base: `feat` `81d789d`.

## Contagem antes/depois

| Categoria | Antes | Manter | Remover | Corte |
|---|---:|---:|---:|---:|
| Social | 94 | 21 | 73 | 77% |
| Entertainment | 100 | 8 | 92 | 92% |
| News and Weather | 34 | 7 | 27 | 79% |
| **TOTAL** | **228** | **36** | **192** | **84%** |

## ⚠️ LEIA ISTO ANTES DA TABELA: o corte aqui e de **84%**, e isso e uma decisao de PRODUTO

Na minha fatia anterior (#1160) o corte foi de 58%. Aqui e **84%**, e **Entertainment sozinha perde 92%**. Nao e a regua ficando mais severa - e a fatia sendo de outra natureza.

A regua do epico diz, textualmente: *"um usuario B2B brasileiro de PME plausivelmente usa **no trabalho**"*. **Entertainment e, por definicao, o que nao e trabalho.** Aplicada honestamente, ela esvazia a categoria: sobram 8 de 100, e os que sobram sao os que nao sao entretenimento de verdade (video corporativo, publicacao, evento).

**Eu apliquei a regua como esta escrita.** Mas cortar 92% de uma categoria inteira nao e curadoria, e mudanca de escopo do produto - e essa decisao nao e minha. Deixo a alavanca explicita:

| Se o GALAXIE Toolbox e... | Entao... |
|---|---|
| uma **ferramenta de trabalho** (regua atual) | este corte esta certo. Netflix e Spotify nao competem por espaco com o app que a pessoa procura as 9h |
| um **lancador geral de web apps** | este corte esta errado, e a regua precisa mudar - nao a minha aplicacao dela |

Se for a segunda, me diz e eu re-rodo a fatia inteira com a regua nova. O trabalho de re-rodar e pequeno; o de descobrir tarde e que nao e.

## Saude dos icones - medida abrindo o arquivo, nao pelo campo `icon`

| Formato real | Qtd | Renderiza? |
|---|---:|---|
| SVG | 187 | sim |
| PNG | 16 | **nao** |
| JPEG | 22 | **nao** |
| WEBP | 1 | **nao** |
| SO_BRANCO | 2 | parcial |

**41 de 228 (17%) nao aparecem.** O #1153 mediu 12% no catalogo inteiro e a minha fatia anterior deu 27% - esta fica no meio. Confirma que o problema e do gerador de icone, nao de uma categoria especifica.

Medicao por magic bytes do blob **no ref** (`git cat-file`), nao pelo working tree.

## Social (94)

| id | veredito | motivo | desc_ptBR | desc_en | icone_ok |
|---|---|---|---|---|---|
| `bitly` | **manter** | lider em encurtador com metrica de campanha | Encurta links e mede cliques de campanha | Short links with campaign click tracking | sim |
| `buffer` | **manter** | top-3 em agendamento de post | Agendamento de posts em varias redes | Post scheduling across social networks | sim |
| `facebook` | **manter** | pagina de empresa ainda e base para PME | Rede social e pagina de empresa | Social network and business page | sim |
| `facebook-business` | **manter** | gestor de paginas e anuncios da Meta | Gestor de paginas e anuncios da Meta | Meta business pages and ads manager | sim |
| `feedly` | **manter** | lider em leitor RSS; monitoramento de mercado | Leitor de RSS para acompanhar fontes | RSS reader to follow sources | sim |
| `google-chat` | **manter** | chat corporativo do Workspace | Chat corporativo do Google Workspace | Google Workspace team chat | sim |
| `google-meet` | **manter** | padrao de videoconferencia no Workspace | Videoconferencia do Google Workspace | Google Workspace video conferencing | sim |
| `hootsuite` | **manter** | lider em gestao de midia social | Agenda e monitora varias redes sociais | Schedule and monitor multiple social networks | sim |
| `instagram` | **manter** | canal de marca essencial para PME brasileira | Rede social de imagem e video para marcas | Image and video social network for brands | sim |
| `later` | **manter** | lider em agendamento visual de Instagram | Agendamento visual para Instagram e TikTok | Visual scheduling for Instagram and TikTok | sim |
| `linkedin` | **manter** | rede profissional padrao para prospeccao B2B | Rede profissional e prospeccao B2B | Professional network and B2B prospecting | sim |
| `pinterest` | **manter** | descoberta visual usada por e-commerce e varejo | Descoberta visual e catalogo de produto | Visual discovery and product boards | sim |
| `reddit` | **manter** | top-10 global; pesquisa tecnica e de mercado | Foruns por tema e pesquisa de mercado | Topic forums and market research | sim |
| `sprout-social` | **manter** | top-3 em gestao social corporativa | Gestao e relatorio de midia social | Social media management and reporting | sim |
| `substack` | **manter** | lider em newsletter paga e conteudo proprio | Publica newsletter e cobra assinatura | Publish newsletters and charge subscriptions | **NAO** - PNG renomeado .svg |
| `telegram` | **manter** | top-3 em mensageiro com grupos e canais | Mensageiro com grupos, canais e arquivos | Messenger with groups, channels and files | sim |
| `tiktok` | **manter** | canal de marca com forte adocao no Brasil | Rede social de video curto | Short-form video social network | sim |
| `twitter` | **manter** | rede aberta de alcance, usada por marca | Rede social de posts curtos | Short-post social network | sim |
| `twitter-ads` | **manter** | console de anuncio da plataforma que mantivemos | Gestor de campanhas de anuncio no X | Ad campaign manager for X | sim |
| `whatsapp` | **manter** | canal de atendimento dominante no Brasil | Mensagens e atendimento pelo WhatsApp Web | WhatsApp Web messaging and customer chat | sim |
| `zoom` | **manter** | lider em videoconferencia | Videoconferencia e webinar | Video conferencing and webinars | sim |
| `agorapulse` | **remover** | gestao social tier-2; hootsuite/buffer cobrem | - | - | - |
| `airmessage` | **remover** | ponte iMessage, nicho e so Apple | - | - | - |
| `amazon-chime` | **remover** | tier-3; Teams, Meet e Zoom dominam | - | - | - |
| `android-messages` | **remover** | DUPLICATA: renomeado para google-messages | - | - | - |
| `apphi` | **remover** | agendamento tier-3 | - | - | - |
| `bluesky` | **remover** | tier-2 sem base de marca | - | - | - |
| `brand24` | **remover** | monitoramento de marca tier-2 | - | - | - |
| `bumble` | **remover** | relacionamento, nao e uso profissional | - | - | - |
| `circle` | **remover** | comunidade tier-2 | - | - | - |
| `contentstudio` | **remover** | gestao social tier-2 | - | - | - |
| `crowdfire` | **remover** | gestao social tier-2 | - | - | - |
| `emochi` | **remover** | obscuro sem base instalada | - | - | - |
| `flick` | **remover** | hashtag de Instagram, nicho | - | - | - |
| `giphy` | **remover** | biblioteca de GIF, nao e ferramenta | - | - | - |
| `gitter` | **remover** | praticamente descontinuado apos Matrix | - | - | - |
| `glowing-bear` | **remover** | cliente IRC de nicho tecnico | - | - | - |
| `google-currents` | **remover** | produto ENCERRADO pelo Google em 2023 | - | - | - |
| `google-duo` | **remover** | ENCERRADO: fundido no Google Meet | - | - | - |
| `google-groups` | **remover** | nicho de administracao de lista | - | - | - |
| `google-messages` | **remover** | SMS pessoal, nao e ferramenta de trabalho | - | - | - |
| `google-voice` | **remover** | telefonia so nos EUA, mercado que nao atendemos | - | - | - |
| `groupme` | **remover** | grupo pessoal, so EUA | - | - | - |
| `guilded` | **remover** | chat de comunidade de games | - | - | - |
| `happyfox-chat` | **remover** | chat de suporte tier-2 | - | - | - |
| `hey` | **remover** | e-mail pago tier-2; e categoria errada | - | - | - |
| `iconosquare` | **remover** | analytics de Instagram tier-2 | - | - | - |
| `irccloud` | **remover** | IRC hospedado, nicho tecnico | - | - | - |
| `julius` | **remover** | obscuro sem base instalada | - | - | - |
| `leaddyno` | **remover** | programa de afiliado de nicho | - | - | - |
| `lingo` | **remover** | obscuro sem base instalada | - | - | - |
| `mastodon` | **remover** | tier-2 fragmentado, sem uso comercial | - | - | - |
| `meetup` | **remover** | eventos comunitarios, nicho | - | - | - |
| `messenger` | **remover** | consumer; o facebook-business cobre o lado empresa | - | - | - |
| `nextdoor` | **remover** | rede de vizinhanca, so EUA | - | - | - |
| `office-365-people` | **remover** | DUPLICATA da tela People do proprio app | - | - | - |
| `official-black-wall-street` | **remover** | diretorio regional dos EUA | - | - | - |
| `planable` | **remover** | aprovacao de post tier-2 | - | - | - |
| `planoly` | **remover** | agendamento visual tier-2; later cobre | - | - | - |
| `plurk` | **remover** | rede regional asiatica em desuso | - | - | - |
| `postly` | **remover** | agendamento tier-3 | - | - | - |
| `preview` | **remover** | previa de feed tier-3 | - | - | - |
| `qq-messenger` | **remover** | regional chines, mercado que nao atendemos | - | - | - |
| `quora` | **remover** | forum generico sem uso de trabalho | - | - | - |
| `restream` | **remover** | nicho de criador de conteudo | - | - | - |
| `ripl` | **remover** | criacao de post tier-3 | - | - | - |
| `sendible` | **remover** | gestao social tier-2 | - | - | - |
| `skool` | **remover** | comunidade paga de nicho | - | - | - |
| `skype` | **remover** | produto ENCERRADO pela Microsoft em 2025 | - | - | - |
| `smmcpan` | **remover** | painel de revenda de metrica social | - | - | - |
| `snapchat` | **remover** | consumer adolescente, fora do perfil B2B | - | - | - |
| `social-champ` | **remover** | gestao social tier-3 | - | - | - |
| `social-news-desk` | **remover** | nicho de redacao jornalistica | - | - | - |
| `socialbee` | **remover** | gestao social tier-2 | - | - | - |
| `socialpilot` | **remover** | gestao social tier-2 | - | - | - |
| `socialplanner` | **remover** | gestao social tier-3 | - | - | - |
| `sociamonials` | **remover** | gestao social tier-3 | - | - | - |
| `steam-chat` | **remover** | chat de plataforma de games | - | - | - |
| `stencil` | **remover** | criacao de imagem tier-3; canva domina | - | - | - |
| `storrito` | **remover** | stories agendados, nicho | - | - | - |
| `tailwind` | **remover** | agendamento de Pinterest tier-2 | - | - | - |
| `teamsnap` | **remover** | gestao de time esportivo amador | - | - | - |
| `textexpander` | **remover** | expansor de texto, categoria errada e nicho | - | - | - |
| `textnow-web-messaging` | **remover** | telefonia gratuita, so EUA | - | - | - |
| `threads` | **remover** | tier-2; o instagram ja cobre o publico | - | - | - |
| `tinder` | **remover** | relacionamento, nao e uso profissional | - | - | - |
| `topia` | **remover** | mundo virtual, nao e ferramenta de trabalho | - | - | - |
| `tumblr` | **remover** | em declinio, sem uso comercial | - | - | - |
| `unum` | **remover** | previa de feed tier-3 | - | - | - |
| `vista-social` | **remover** | gestao social tier-2 | - | - | - |
| `vk-messenger` | **remover** | regional russo, mercado que nao atendemos | - | - | - |
| `voxer` | **remover** | walkie-talkie de nicho | - | - | - |
| `zalo` | **remover** | regional vietnamita, mercado que nao atendemos | - | - | - |
| `zoosk` | **remover** | relacionamento, nao e uso profissional | - | - | - |

## Entertainment (100)

| id | veredito | motivo | desc_ptBR | desc_en | icone_ok |
|---|---|---|---|---|---|
| `brightcove` | **manter** | plataforma de video corporativa de referencia | Plataforma de video corporativo e transmissao | Enterprise video platform and streaming | sim |
| `eventbrite` | **manter** | lider em inscricao e venda de evento | Cria eventos e vende inscricao | Create events and sell registrations | sim |
| `frameio` | **manter** | padrao de revisao e aprovacao de video | Revisao e aprovacao de video com o cliente | Video review and approval with clients | sim |
| `issuu` | **manter** | padrao de catalogo e revista digital | Publica catalogos e revistas digitais | Publish digital catalogs and magazines | sim |
| `medium` | **manter** | publicacao de conteudo tecnico e institucional | Publicacao de artigos e conteudo de marca | Publish articles and brand content | sim |
| `spotify` | **manter** | lider absoluto; musica no ambiente de trabalho | Streaming de musica e podcast | Music and podcast streaming | sim |
| `vimeo` | **manter** | padrao de hospedagem de video corporativo | Hospedagem de video profissional sem anuncio | Ad-free professional video hosting | sim |
| `youtube` | **manter** | universal; treinamento e tutorial no trabalho | Videos, tutoriais e canal da empresa | Videos, tutorials and company channel | sim |
| `all-out` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `amazon-music` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `amazon-prime-video` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `anghami` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `animaker` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `apple-music` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `apple-photos` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `aternos` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `audible` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `audiomack` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `az-games` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `bandcamp` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `bbc-podcasts` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `best-buy` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `blubrry` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `brainfm` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `brawldle` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `castbox` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `chesscom` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `chunk-base` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `coolmath-games` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `crave` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `crazygames` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `crunchyroll` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `cygnus-music` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `dd-beyond` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `deezer` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `difm` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `discogs` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `disneyplus` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `distrokid` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `dronedeploy` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `epic-games` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `espn` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `eventimus-sso` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `evoworld` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `fancode` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `feedbin` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `fireside` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `focus-at-will` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `freegamehost-panel` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `hulu` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `i-miss-my-cafe` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `icloud` | **remover** | DUPLICATA do icloud-drive ja mantido | - | - | - |
| `iheartradio` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `imgur` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `itunes-connect` | **remover** | DUPLICATA do app-store-connect ja mantido | - | - | - |
| `kindle-for-web` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `lifehacker` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `liveone` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `mixcloud` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `mynoise` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `netflix` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `noisli` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `npr-podcasts` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `overcast` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `pandora` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `peacock` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `pocket` | **remover** | produto ENCERRADO pela Mozilla em 2025 | - | - | - |
| `pocket-casts` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `pokemon-showdown` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `readwise` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `refind` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `roblox` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `simplecast` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `sina-weibo` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `siriusxm` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `soundcloud` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `spext` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `spreaker` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `stack-exchange` | **remover** | quase duplicata do stack-overflow ja mantido | - | - | - |
| `star-trek-fleet-command` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `statmuse` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `stitcher` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `streamlabs` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `streamxtvnet` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `the-athletic` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `ticketmaster` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `tickettailor` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `tidal` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `trebel-accounts` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `tubi` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `tunein` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `twitch` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `viz-media` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `wakelet` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `webtoon` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `xbox` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `youtube-kids` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `youtube-music` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `youtube-tv` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `zee5` | **remover** | streaming regional indiano | - | - | - |

## News and Weather (34)

| id | veredito | motivo | desc_ptBR | desc_en | icone_ok |
|---|---|---|---|---|---|
| `bloomberg-businessweek` | **manter** | referencia global em noticia de negocio | Noticias de mercado, economia e negocios | Business, markets and economy news | sim |
| `financial-times` | **manter** | referencia global em economia | Jornal global de economia e negocios | Global business and economics newspaper | sim |
| `forbes` | **manter** | referencia em negocio e empreendedorismo | Noticias de negocios e empreendedorismo | Business and entrepreneurship news | sim |
| `harvard-business-review` | **manter** | referencia em gestao e estrategia | Artigos de gestao, lideranca e estrategia | Management, leadership and strategy articles | sim |
| `techcrunch` | **manter** | referencia em tecnologia e startup | Noticias de tecnologia, startup e investimento | Technology, startup and funding news | sim |
| `the-economist` | **manter** | referencia em analise economica e geopolitica | Analise semanal de economia e politica | Weekly economics and politics analysis | sim |
| `the-wall-street-journal` | **manter** | referencia global em negocio e mercado | Jornal de negocios, mercado e economia | Business, markets and economy newspaper | sim |
| `abc7ny` | **remover** | afiliada LOCAL de Nova York | - | - | - |
| `aol` | **remover** | portal legacy sem relevancia atual | - | - | - |
| `ap-news` | **remover** | agencia de noticia geral, so EUA | - | - | - |
| `barrons` | **remover** | investimento de nicho, mercado dos EUA | - | - | - |
| `buzzfeed` | **remover** | entretenimento, sem uso de trabalho | - | - | - |
| `cbc` | **remover** | emissora publica do Canada | - | - | - |
| `cbs-news` | **remover** | emissora dos EUA | - | - | - |
| `cnet` | **remover** | analise de produto consumer | - | - | - |
| `duckduckgo-search` | **remover** | buscador, categoria errada e nao e noticia | - | - | - |
| `financial-post` | **remover** | economia do Canada, mercado que nao atendemos | - | - | - |
| `flipboard` | **remover** | agregador tier-2; feedly ja mantido | - | - | - |
| `inc` | **remover** | tier-2; forbes e HBR cobrem | - | - | - |
| `inoreader` | **remover** | leitor RSS tier-2; feedly ja mantido | - | - | - |
| `instapaper` | **remover** | consumo pessoal, sem uso no trabalho | - | - | - |
| `investors-business-daily` | **remover** | investimento de nicho, mercado dos EUA | - | - | - |
| `mobilesyrup` | **remover** | tecnologia do Canada, nicho | - | - | - |
| `new-york-times` | **remover** | jornal geral dos EUA, sem foco de negocio | - | - | - |
| `newsweek` | **remover** | revista geral dos EUA | - | - | - |
| `qq` | **remover** | portal regional chines | - | - | - |
| `sportsnet` | **remover** | esporte do Canada | - | - | - |
| `the-new-yorker` | **remover** | revista de cultura, sem uso de trabalho | - | - | - |
| `the-times` | **remover** | jornal geral do Reino Unido | - | - | - |
| `the-verge` | **remover** | tecnologia consumer; techcrunch cobre o lado negocio | - | - | - |
| `the-weather-network` | **remover** | clima do Canada, mercado que nao atendemos | - | - | - |
| `time` | **remover** | revista geral dos EUA | - | - | - |
| `usa-today` | **remover** | jornal geral dos EUA | - | - | - |
| `washington-post` | **remover** | jornal geral dos EUA | - | - | - |

## Achados que nao sao curadoria

**1. Produtos encerrados que ainda estao no catalogo.** Nao sao "pouco usados" - nao existem mais:

| id | Estado |
|---|---|
| `skype` | encerrado pela Microsoft em 2025 |
| `google-currents` | encerrado pelo Google em 2023 |
| `google-duo` | encerrado; fundido no Google Meet |
| `pocket` | encerrado pela Mozilla em 2025 |

**2. Quatro duplicatas, duas delas do proprio app:**

- `android-messages` = `google-messages` (renomeado);
- `icloud` = `icloud-drive`, que eu mantive na fatia #1160;
- `itunes-connect` = `app-store-connect`, que eu mantive na #1160;
- **`office-365-people` e a tela People do NOSSO proprio app.** O catalogo oferece ao usuario um atalho de web para uma funcionalidade que o Toolbox ja tem nativa.

**3. Cauda longa de gestao de midia social: 28 ferramentas para o mesmo trabalho.** Mantive 4 lideres (`hootsuite`, `buffer`, `sprout-social`, `later`) e cortei 24 tier-2/tier-3. E o exemplo mais limpo do vies que registrei na #1160 - o catalogo entrou por disponibilidade de integracao, nao por lideranca.

**4. 🔴 ZERO veiculo de imprensa brasileiro.** Repete exatamente o achado dos ERPs (comentario no #1155): 34 titulos em `News and Weather`, todos EUA/Canada/Reino Unido. Ausentes: `valor-economico`, `exame`, `infomoney`, `estadao`, `folha`, `g1`, `neofeed`.

Mantive 7, **todos estrangeiros**, porque foi o que existia para manter. Um usuario B2B brasileiro que quer ler noticia de negocio antes de abrir o e-mail nao encontra **nada em portugues**. E o mesmo padrao: **o catalogo foi montado com um usuario dos EUA na cabeca.**

## Adicoes recomendadas nesta fatia

Conferidas contra o catalogo INTEIRO antes de propor. URLs sao **proposta, nao medicao** - o passo do patch deve fazer HEAD antes de gravar.

| Categoria | id sugerido | Nome | URL | Por que entra |
|---|---|---|---|---|
| News and Weather | `valor-economico` | Valor Economico | https://valor.globo.com | principal jornal de economia e negocios do Brasil |
| News and Weather | `infomoney` | InfoMoney | https://www.infomoney.com.br | referencia em mercado e financas no Brasil |
| News and Weather | `exame` | Exame | https://exame.com | referencia em negocios e gestao no Brasil |
| News and Weather | `neofeed` | NeoFeed | https://neofeed.com.br | jornalismo de negocios brasileiro voltado a decisor |
| Social | `google-business-profile` | Perfil da Empresa no Google | https://business.google.com | presenca local; e o primeiro canal de PME brasileira |
| Social | `whatsapp-business` | WhatsApp Business | https://business.whatsapp.com | o canal de venda de PME no Brasil; so o WhatsApp pessoal esta no catalogo |
| Entertainment | `youtube-studio` | YouTube Studio | https://studio.youtube.com | lado PRODUTOR do YouTube, que mantivemos so no lado consumidor |

## Nota de metodo

O `icone_ok` nao pode sair do campo `icon` do JSON - ele e afirmacao do gerador, nao verificacao (#1153). Cada linha aqui saiu de leitura de magic bytes do arquivo real.
