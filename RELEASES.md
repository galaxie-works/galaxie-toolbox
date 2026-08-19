# GALAXIE Toolbox — Histórico de Releases
Ledger "o que está no ar" (seed). Fonte: backfill 18/08/2026 a partir do `git log` entre tags. Mais recente no topo.
> Doravante o **Deploy Manager** mantém isto: nenhuma tag sai sem uma linha aqui (spec-release-branches-deploy-manager §4).

| Versão | Resumo |
|---|---|
| **v0.47.0** | 📬 Leitor do Bridge: corpo inteiro de novo (regressão dos 120px) + tema escuro; aviso de update com notas formatadas/roláveis e data legível; Atoms/Comms/Pulsar removidos (decisão do PO); Remote: PoP no registro (flag off), matrícula por ticket de enrollment, autorização por-frame no funil; pirata da aba privada pinado; CI clippy verde. |
| **v0.46.0** | 🔔 Aviso de atualização só com versão mais nova + mostra o changelog (copy nova); controles de janela (min/max/fechar) corrigidos; telemetria fora da thread do IPC e falha-alto; guarda de teste do funil de sessão; browser-tests do CI destravados; notas de release versionadas (`docs/releases/`). |
| **v0.45.1** | 🌌 Release inaugural do novo time: TEAM-CANON.md + RELEASES.md + docs/equipe no repo; branch de integração `feat/bridge-email-client` → `pre-prod`; `main` = produção. Sem mudança no app. |
| **v0.45.0** | 🔒 Release de segurança: vazamento de sessão entre contas fechado no núcleo (P0); escopo de leitura de arquivos; allowlist M365; Remote endurecido (rate-limit + PoP + capability gate); gate CI=release unificado. Sob o capô: tsc typecheca testes, clippy no CI, oxlint-ratchet corrigido, browser-tests em job próprio; Rust/Graph consolidado (erros não viram sucesso falso; código morto removido); DPAPI stub fail-closed. *Última release do time fundador.* |
| **v0.44.0** | Catálogo de apps curado (1.779→254); relay TURN operacional; erros de Contatos mais claros |
| **v0.43.0** | Remote com bitrate adaptativo + relay TURN; correção do relay aberto |
| **v0.42.0** | Rail sob demanda; Remote mais robusto (TURN/STUN); reforços de segurança |
| **v0.41.1** | Sino na title bar; instalador all/just-me; boot mais rápido; isolamento seguro do e-mail |
| **v0.41.0** | GALAXIE Remote no instalador; i18n e acessibilidade do Bridge; correções de segurança |
| **v0.40.2** | Previews ricas (PDF/DOCX/XLSX/CSV); filtro no Files; sino de atividades |
| **v0.40.1** | Files: ribbon Win11, drives cloud/rede, busca recursiva, preview; title bar estilo navegador |
| **v0.40.0** | Novo GALAXIE Files; login em etapas (Microsoft/Google); suporte Google |
| **v0.39.0** | Módulo Apps por categoria; tela Windows; imprimir / Salvar como no Bridge |
| **v0.38.8** | Correções do Bridge: campos To/Cc/Bcc, lista auto-atualiza, clique no toast |
| **v0.38.7** | Grupos de contato pessoais; barra lateral de Configurações colapsável |
| **v0.38.6** | Renome para GALAXIE; sync de config na nuvem; People enxuto; Termos de uso |
| **v0.38.5** | Agenda: reagendar arrastando, visão por sala, avatar do organizador; To Do org-wide |
| **v0.38.4** | Chips de evento na Agenda; atalhos Outlook; confirmação ao esvaziar a lixeira |
| **v0.38.3** | Correção do preview xlsx em branco; foto no hover de membro da org |
| **v0.38.2** | Correção P0: vazamento de dados entre contas; telemetria live no binário |
| **v0.38.1** | Org Admin multi-tenant; logo do tenant; correções de avatares e atalhos |
| **v0.38.0** | Nova identidade do Bridge; migração pra animate-ui; assinatura no compositor; fundos animados |
| **v0.37.0** | Atoms (painel inicial + widgets); previews de anexos (imagem/áudio/vídeo/CSV/docx/xlsx/pptx); i18n |
| **v0.36.0** | Eventos recorrentes completos; categorias do Outlook; preview PDF/TXT; fundação de telemetria |
| **v0.35.0** | Execução do merge de contatos; galeria de fundos em Settings |
| **v0.34.0** | Merge de contatos; RSVP + menu de contexto na Agenda; tema Glacial Drift; correção P0 webview |
| **v0.33.0** | Atalhos de navegador; abas privadas; restaurar sessão; grupos M365 |
| **v0.32.0** | Contacts + Organizations (mestre-detalhe); ações em massa; Navigator (Ctrl+K, histórico, favoritos); Agenda CRUD |
| **v0.31.0** | Sleeping tabs; navbar E-mail/Pessoas/Agenda; detalhe de contato redesenhado |
| **v0.30.0** | Módulo Pessoas: edição no CRM + revisão de interações; hover cards de contato |
| **v0.29.0** | Novo módulo People (contatos MVP): lista, enriquecimento e visualizações |
| **v0.28.0** | Splash animada no boot; tempo de undo-send configurável; correção do flash branco |
| **v0.27.0** | Melhoria interna: estado de carregamento centralizado |
| **v0.26.0** | Pass dedicado de acessibilidade: tooltips e nomes acessíveis por todo o Bridge |
| **v0.25.0** | Iniciar com o sistema (Configurações › Sistema › Inicialização) |
| **v0.24.0** | Melhoria interna: estado de composição centralizado (encerra épico Zustand) |
| **v0.23.0** | Melhoria interna: estado do leitor e da agenda centralizado |
| **v0.22.0** | Melhoria interna: filtros e seleção de mensagens centralizados |
| **v0.21.0** | Desfazer envio (undo-send com Caixa de saída); assinatura padrão automática |
| **v0.20.0** | Conversas por thread no Bridge (visualização por conversa) |
| **v0.19.0** | ErrorBoundary + log robusto de erros; correção da tela branca em templates |
| **v0.18.0** | Correção: editor de assinatura/template travava com corpo vazio |
| **v0.17.0** | Enviar como caixa compartilhada; gerenciar caixas; toggle de assinatura em respostas |
| **v0.16.0** | Caixa compartilhada somente-leitura; gerenciamento do PIN (4-8 dígitos) |
| **v0.15.0** | Assinaturas & Templates; bloqueio no boot por PIN; alto contraste |
| **v0.14.0** | Tela de Configurações; temas persistidos; menção @; caixas compartilhadas; sons; base do PIN |
| **v0.13.0** | Leitor seguro (links/auth/Reply-To); insights do remetente; atalhos; zoom; filtro multi-campo |
| **v0.12.0** | Autocomplete de destinatários; menu de contexto na lista; filtros estilo Outlook; avatares |
| **v0.11.0** | Marco inicial — cliente de e-mail Bridge, navegador embutido, agenda |
| **v0.9.6** | Correção: nome do instalador no manifesto de atualização |
| **v0.9.4** | Melhoria: instalador com identificador de pacote e metadados ajustados |
