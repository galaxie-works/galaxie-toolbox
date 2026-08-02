mod auth;
mod bookmarks;
mod browser;
mod config;
mod estado;
mod favicon;
mod graph;
mod lock_screen;
mod system;
mod telemetry;

use std::sync::Arc;
use tauri::{Manager, State};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

use auth::{Account, TokenStore};

type Store = Arc<TokenStore>;

/// Garante que os cookies do navegador interno pertencem a conta ativa. Se a
/// conta mudou (ou e a primeira vez com este recurso), limpa os dados de
/// navegacao da WebView2 — assim Outlook/Teams/SharePoint reautenticam na conta
/// certa em vez de reaproveitar a sessao web de outra conta.
fn sincronizar_navegador(app: &tauri::AppHandle, upn: &str) {
    if upn.is_empty() {
        return;
    }
    if estado::ler_conta_navegador().as_deref() == Some(upn) {
        return; // mesma conta: mantem a sessao web (nao obriga relogar)
    }
    if let Some(win) = app.get_webview_window("main") {
        // Limpa o cookie jar compartilhado. Custo: perde prefs em localStorage e
        // sessoes web das apps internas — aceitavel, so acontece na troca de conta.
        if let Err(e) = win.clear_all_browsing_data() {
            log::warn!("[navegador] falha ao limpar dados de navegacao: {e}");
        } else {
            log::info!("[navegador] sessao web limpa (conta -> {upn})");
        }
    }
    estado::salvar_conta_navegador(upn);
}

/// Detecta o tenant pelo dominio do e-mail (sem logar).
#[tauri::command]
async fn detect_tenant(email: String) -> Result<auth::TenantInfo, String> {
    tauri::async_runtime::spawn_blocking(move || auth::detectar_tenant(&email))
        .await
        .map_err(|e| e.to_string())?
}

/// Login interativo: detecta o tenant pelo e-mail e abre a pagina oficial da
/// Microsoft (com o e-mail ja preenchido).
#[tauri::command]
async fn login(
    app: tauri::AppHandle,
    state: State<'_, Store>,
    email: String,
    idioma: String,
) -> Result<Account, String> {
    let store = state.inner().clone();
    let account = tauri::async_runtime::spawn_blocking(move || {
        let info = auth::detectar_tenant(&email)?;
        let tokens = auth::interactive_login(&info.tenant_id, &email, &idioma)?;
        let account = tokens.account.clone();
        *store.inner.lock().map_err(|_| "estado de token corrompido".to_string())? = Some(tokens);
        Ok::<Account, String>(account)
    })
    .await
    .map_err(|e| e.to_string())??;
    // Conta pode ter mudado: alinha o cookie jar do navegador interno.
    sincronizar_navegador(&app, &account.email);
    Ok(account)
}

#[tauri::command]
async fn logout(state: State<'_, Store>) -> Result<(), String> {
    let store = state.inner().clone();
    *store.inner.lock().map_err(|_| "estado de token corrompido".to_string())? = None;
    auth::limpar_refresh();
    estado::limpar_identidade();
    lock_screen::resetar()?;
    Ok(())
}

#[tauri::command]
async fn lock_status() -> Result<lock_screen::LockStatus, String> {
    Ok(lock_screen::status())
}

#[tauri::command]
async fn lock_set_pin(pin: String, current_pin: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || lock_screen::definir(&pin, current_pin.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn lock_disable_pin(pin: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || lock_screen::desabilitar(&pin))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn lock_verify_pin(pin: String) -> Result<lock_screen::PinResult, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(lock_screen::verificar(&pin)))
        .await
        .map_err(|e| e.to_string())?
}

/// Identidade em cache (foto/iniciais) pra pintar a tela de carregamento
/// antes de qualquer chamada de rede. Nao faz I/O de rede.
#[tauri::command]
async fn cached_identity() -> Result<Option<estado::Identidade>, String> {
    Ok(estado::ler_identidade())
}

/// Retoma a sessao guardada no cofre do Windows (sem abrir o navegador).
/// Devolve None quando nao ha sessao valida - ai a tela de login aparece.
#[tauri::command]
async fn restore_session(
    app: tauri::AppHandle,
    state: State<'_, Store>,
) -> Result<Option<Account>, String> {
    let store = state.inner().clone();
    let conta = tauri::async_runtime::spawn_blocking(move || {
        {
            let guard = store.inner.lock().map_err(|_| "estado de token corrompido".to_string())?;
            if let Some(t) = guard.as_ref() {
                return Ok::<Option<Account>, String>(Some(t.account.clone()));
            }
        }
        match auth::restaurar() {
            Ok(tokens) => {
                let account = tokens.account.clone();
                *store.inner.lock().map_err(|_| "estado de token corrompido".to_string())? = Some(tokens);
                Ok(Some(account))
            }
            Err(_) => Ok(None), // sem sessao salva ou expirada: login normal
        }
    })
    .await
    .map_err(|e| e.to_string())??;
    // Sessao retomada: se a conta dos cookies internos nao bate, limpa (uma vez).
    if let Some(acc) = conta.as_ref() {
        sincronizar_navegador(&app, &acc.email);
    }
    Ok(conta)
}

/// Conta atualmente logada, se houver (sessao vive so em memoria).
#[tauri::command]
async fn current_account(state: State<'_, Store>) -> Result<Option<Account>, String> {
    let store = state.inner().clone();
    let guard = store.inner.lock().map_err(|_| "estado de token corrompido".to_string())?;
    Ok(guard.as_ref().map(|t| t.account.clone()))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RequiredScopesStatus {
    missing_scopes: Vec<String>,
}

/// Compara o token atual com o pedido mínimo compilado nesta versão.
///
/// A detecção é proativa e não interpreta qualquer 403 como falta de escopo:
/// um usuário sem acesso a um objeto isolado não recebe um falso pedido de
/// reautenticação.
#[tauri::command]
async fn required_scopes_status(state: State<'_, Store>) -> Result<RequiredScopesStatus, String> {
    let store = state.inner().clone();
    let guard = store
        .inner
        .lock()
        .map_err(|_| "estado de token corrompido".to_string())?;
    let missing_scopes = guard
        .as_ref()
        .map(|tokens| auth::required_resource_scopes_missing(&tokens.scopes))
        .unwrap_or_default();
    Ok(RequiredScopesStatus { missing_scopes })
}

/// Sites do tenant que o usuario acessa, com status de conexao.
#[tauri::command]
async fn list_sites(state: State<'_, Store>) -> Result<Vec<graph::SiteDto>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::list_sites(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// Tamanho e contagens de uma biblioteca (chamado por site, depois da lista).
#[tauri::command]
async fn site_details(
    state: State<'_, Store>,
    site_id: String,
    web_url: String,
) -> Result<graph::SiteDetalhes, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::site_details(&store, &site_id, &web_url))
        .await
        .map_err(|e| e.to_string())?
}

/// Pastas de primeiro nivel do OneDrive do usuario logado.
#[tauri::command]
async fn onedrive_folders(state: State<'_, Store>) -> Result<Vec<graph::PastaOneDrive>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::onedrive_folders(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// Contagens de pastas/arquivos de uma pasta do OneDrive (por pasta, depois da lista).
#[tauri::command]
async fn onedrive_folder_details(
    state: State<'_, Store>,
    web_url: String,
) -> Result<graph::PastaDetalhes, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::onedrive_folder_details(&store, &web_url))
        .await
        .map_err(|e| e.to_string())?
}

/// Uso do OneDrive (usado/limite) do usuario logado.
#[tauri::command]
async fn onedrive_quota(state: State<'_, Store>) -> Result<graph::UsoOneDrive, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::onedrive_quota(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// Tipos de arquivo mais frequentes no OneDrive (por contagem).
#[tauri::command]
async fn onedrive_tipos(
    state: State<'_, Store>,
    web_url: String,
) -> Result<Vec<graph::TipoArquivo>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::onedrive_tipos(&store, &web_url))
        .await
        .map_err(|e| e.to_string())?
}

/// Control room: proximas reunioes do usuario.
#[tauri::command]
async fn cr_reunioes(state: State<'_, Store>) -> Result<Vec<graph::Reuniao>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_reunioes(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// Control room: caixa de entrada (nao-lidos + recentes).
#[tauri::command]
async fn cr_email(state: State<'_, Store>) -> Result<graph::CaixaEntrada, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_email(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// Control room: tarefas pendentes do To Do.
#[tauri::command]
async fn cr_tarefas(state: State<'_, Store>) -> Result<Vec<graph::Tarefa>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_tarefas(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// Control room: eventos da agenda no dia escolhido (limites ISO UTC).
#[tauri::command]
async fn cr_agenda(
    state: State<'_, Store>,
    inicio: String,
    fim: String,
) -> Result<Vec<graph::EventoAgenda>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_agenda(&store, &inicio, &fim))
        .await
        .map_err(|e| e.to_string())?
}

/// Agenda: lista os calendários do usuário (#233). Calendars.Read.
#[tauri::command]
async fn cr_calendarios(
    state: State<'_, Store>,
) -> Result<Vec<graph::Calendario>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_calendarios(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// Agenda: eventos de um calendário específico no intervalo (#233). Calendars.Read.
#[tauri::command]
async fn cr_agenda_calendario(
    state: State<'_, Store>,
    calendario_id: String,
    inicio: String,
    fim: String,
) -> Result<Vec<graph::EventoAgenda>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_agenda_calendario(&store, &calendario_id, &inicio, &fim)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: detalhe completo de um evento (corpo + convidados).
#[tauri::command]
async fn cr_evento_corpo(
    state: State<'_, Store>,
    id: String,
) -> Result<graph::EventoDetalhe, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_evento_corpo(&store, &id))
        .await
        .map_err(|e| e.to_string())?
}

/// Control room: e-mails recebidos no dia escolhido (limites ISO UTC).
#[tauri::command]
async fn cr_inbox_dia(
    state: State<'_, Store>,
    inicio: String,
    fim: String,
) -> Result<Vec<graph::EmailItem>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_inbox_dia(&store, &inicio, &fim))
        .await
        .map_err(|e| e.to_string())?
}

/// Control room: corpo completo de um e-mail.
#[tauri::command]
async fn cr_email_corpo(
    state: State<'_, Store>,
    id: String,
    mailbox: Option<String>,
) -> Result<graph::EmailDetalhe, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_email_corpo(&store, &id, mailbox.as_deref())
    })
        .await
        .map_err(|e| e.to_string())?
}

/// Control room: dados de segurança de um e-mail (#91) — Reply-To + headers de
/// autenticação (SPF/DKIM/DMARC via internetMessageHeaders).
#[tauri::command]
async fn cr_email_seguranca(
    state: State<'_, Store>,
    id: String,
    mailbox: Option<String>,
) -> Result<graph::SegurancaEmail, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_email_seguranca(&store, &id, mailbox.as_deref())
    })
        .await
        .map_err(|e| e.to_string())?
}

/// Control room: categorias mestras do usuário com a cor (hex) de cada uma.
#[tauri::command]
async fn cr_categorias(
    state: State<'_, Store>,
) -> Result<Vec<graph::CategoriaCor>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_categorias(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// Agenda: cria uma categoria mestra (#211). MailboxSettings.ReadWrite.
#[tauri::command]
async fn cr_criar_categoria(
    state: State<'_, Store>,
    nome: String,
    preset: String,
) -> Result<graph::CategoriaCor, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_criar_categoria(&store, &nome, &preset))
        .await
        .map_err(|e| e.to_string())?
}

/// Agenda: cria um evento no calendário do usuário (#211). Calendars.ReadWrite.
/// Devolve o id do evento criado (o front troca o id otimista pelo real).
#[tauri::command]
async fn cr_criar_evento(
    state: State<'_, Store>,
    input: graph::EventoInput,
) -> Result<String, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_criar_evento(&store, input))
        .await
        .map_err(|e| e.to_string())?
}

/// Agenda: edita um evento existente (#211). Calendars.ReadWrite.
#[tauri::command]
async fn cr_editar_evento(
    state: State<'_, Store>,
    id: String,
    input: graph::EventoInput,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_editar_evento(&store, &id, input))
        .await
        .map_err(|e| e.to_string())?
}

/// Agenda: exclui um evento (#211). Calendars.ReadWrite.
#[tauri::command]
async fn cr_excluir_evento(
    state: State<'_, Store>,
    id: String,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_excluir_evento(&store, &id))
        .await
        .map_err(|e| e.to_string())?
}

/// Agenda: cancela um evento organizado pelo usuário (#260), enviando o
/// cancelamento aos convidados (POST /me/events/{id}/cancel). Distinto de
/// excluir (silencioso). Calendars.ReadWrite.
#[tauri::command]
async fn cr_cancelar_evento(
    state: State<'_, Store>,
    id: String,
    comentario: String,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_cancelar_evento(&store, &id, &comentario))
        .await
        .map_err(|e| e.to_string())?
}

/// Agenda: responde a um convite de reunião (#287) — RSVP Aceitar/Talvez/Recusar
/// via POST /me/events/{id}/{accept|tentativelyAccept|decline}. Calendars.ReadWrite.
#[tauri::command]
async fn cr_responder_evento(
    state: State<'_, Store>,
    id: String,
    resposta: String,
    enviar_resposta: bool,
    comentario: String,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_responder_evento(&store, &id, &resposta, enviar_resposta, &comentario)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: fotos (avatar) de remetentes internos, em lote. User.Read.All.
#[tauri::command]
async fn cr_fotos_contatos(
    state: State<'_, Store>,
    emails: Vec<String>,
) -> Result<Vec<graph::FotoContato>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_fotos_contatos(&store, emails))
        .await
        .map_err(|e| e.to_string())?
}

/// Compositor: busca de pessoas para o autocomplete (People.Read + diretorio).
#[tauri::command]
async fn cr_pessoas(
    state: State<'_, Store>,
    query: String,
) -> Result<Vec<graph::Pessoa>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_pessoas(&store, &query))
        .await
        .map_err(|e| e.to_string())?
}

/// People: contatos explicitos + pessoas relevantes, com falhas por fonte.
#[tauri::command]
async fn cr_people_list(
    state: State<'_, Store>,
    next_links: Option<Vec<String>>,
) -> Result<graph::PeopleListResult, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_people_list(&store, next_links.unwrap_or_default())
    })
        .await
        .map_err(|e| e.to_string())?
}

/// People: organização canônica do tenant atual.
#[tauri::command]
async fn cr_organizacao(
    state: State<'_, Store>,
) -> Result<graph::PeopleOrganizationResult, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_organizacao(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// People: snapshot paginado completo do diretório do tenant.
#[tauri::command]
async fn cr_people_directory(
    state: State<'_, Store>,
) -> Result<graph::PeopleDirectoryResult, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_people_directory(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// People: grupos M365 diretos do usuário atual.
#[tauri::command]
async fn cr_grupos(state: State<'_, Store>) -> Result<graph::PeopleGroupsResult, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_grupos(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// People: membros usuários de um grupo M365, carregados sob demanda.
#[tauri::command]
async fn cr_grupo_membros(
    state: State<'_, Store>,
    group_id: String,
) -> Result<graph::PeopleGroupMembersResult, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_grupo_membros(&store, &group_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// People Enrich: monta o preview sem alterar o contato.
#[tauri::command]
async fn cr_people_enrich_preview(
    state: State<'_, Store>,
    contact_id: Option<String>,
    email: String,
    directory_user: Option<bool>,
) -> Result<graph::PeopleEnrichPreview, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_people_enrich_preview(
            &store,
            contact_id.as_deref(),
            &email,
            directory_user.unwrap_or(false),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// People Enrich: persiste somente os campos confirmados e somente com escopo.
#[tauri::command]
async fn cr_people_enrich_apply(
    state: State<'_, Store>,
    contact_id: String,
    fields: Vec<graph::PeopleEnrichField>,
) -> Result<graph::PeopleEnrichApplyResult, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_people_enrich_apply(&store, &contact_id, fields)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Compositor: envia um e-mail novo (do zero). Mail.Send.
#[tauri::command]
async fn cr_enviar_novo(
    state: State<'_, Store>,
    para: Vec<String>,
    cc: Vec<String>,
    cco: Vec<String>,
    assunto: String,
    corpo: String,
    anexos: Vec<graph::AnexoUp>,
    mailbox: Option<String>,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_enviar_novo(
            &store,
            para,
            cc,
            cco,
            &assunto,
            &corpo,
            anexos,
            mailbox.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Compositor: sobe um arquivo pro OneDrive e devolve um link de
/// compartilhamento (view/organization). Files.ReadWrite.
#[tauri::command]
async fn cr_compartilhar_onedrive(
    state: State<'_, Store>,
    nome: String,
    conteudo_b64: String,
) -> Result<String, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_compartilhar_onedrive(&store, &nome, &conteudo_b64)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Compositor: salva contatos pessoais (sem duplicar). Retorna quantos criou.
#[tauri::command]
async fn cr_salvar_contatos(
    state: State<'_, Store>,
    pessoas: Vec<graph::Pessoa>,
) -> Result<u64, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_salvar_contatos(&store, pessoas))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cr_people_write_available(state: State<'_, Store>) -> Result<bool, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_people_write_available(&store))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cr_people_contact_update(
    state: State<'_, Store>,
    contact_id: String,
    input: graph::PeopleContactEdit,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_people_contact_update(&store, &contact_id, input)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cr_people_contact_create(
    state: State<'_, Store>,
    input: graph::PeopleContactEdit,
) -> Result<String, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_people_contact_create(&store, input)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cr_people_contact_delete(
    state: State<'_, Store>,
    contact_id: String,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_people_contact_delete(&store, &contact_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cr_people_company_write(
    state: State<'_, Store>,
    contact_ids: Vec<String>,
    company_name: String,
) -> Result<graph::PeopleCompanyWriteResult, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_people_company_write(&store, contact_ids, &company_name)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cr_people_details_write(
    state: State<'_, Store>,
    contact_ids: Vec<String>,
    changes: Vec<graph::PeopleBulkDetailsChange>,
) -> Result<graph::PeopleBulkDetailsWriteResult, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_people_details_write(&store, contact_ids, changes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cr_people_interactions(
    state: State<'_, Store>,
    email: String,
) -> Result<Vec<graph::PeopleInteraction>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_people_interactions(&store, &email)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Cliente de e-mail: subpastas de uma pasta (para a arvore de pastas).
#[tauri::command]
async fn cr_subpastas(
    state: State<'_, Store>,
    folder_id: String,
    mailbox: Option<String>,
) -> Result<Vec<graph::PastaEmail>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_subpastas(&store, &folder_id, mailbox.as_deref())
    })
        .await
        .map_err(|e| e.to_string())?
}

/// Control room: pastas de e-mail padrão (com contagens).
#[tauri::command]
async fn cr_mail_folders(
    state: State<'_, Store>,
    mailbox: Option<String>,
) -> Result<Vec<graph::PastaEmail>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_mail_folders(&store, mailbox.as_deref())
    })
        .await
        .map_err(|e| e.to_string())?
}

/// Bridge / caixas compartilhadas (#111): valida acesso a uma caixa por
/// endereço (GET /users/{addr}/mailFolders/inbox). Não lista conteúdo (isso é a
/// #112) — só devolve 200/403/404 pro seletor decidir se adiciona.
#[tauri::command]
async fn cr_validar_caixa(
    state: State<'_, Store>,
    endereco: String,
) -> Result<graph::ValidacaoCaixa, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::cr_validar_caixa(&store, &endereco))
        .await
        .map_err(|e| e.to_string())?
}

/// Bridge / caixas compartilhadas (#111): o token atual traz Mail.Read.Shared?
/// Falso ⇒ o app sinaliza "faça login novamente" (escopo novo, sem consent
/// admin — já concedido). Ver AGENTS.md §1.1.
#[tauri::command]
async fn cr_mail_shared_disponivel(state: State<'_, Store>) -> Result<bool, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::mail_shared_disponivel(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// Bridge / caixas compartilhadas (#114): o token atual traz Mail.Send.Shared?
/// Mantido separado dos escopos de leitura/escrita para orientar o relogin sem
/// bloquear o conteúdo já disponível da caixa.
#[tauri::command]
async fn cr_mail_send_shared_disponivel(state: State<'_, Store>) -> Result<bool, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::mail_send_shared_disponivel(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// Control room: mensagens de uma pasta.
#[tauri::command]
async fn cr_folder_mensagens(
    state: State<'_, Store>,
    folder_id: String,
    skip: u32,
    ordenar: String,
    descendente: bool,
    mailbox: Option<String>,
) -> Result<Vec<graph::EmailItem>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_folder_mensagens(
            &store,
            &folder_id,
            skip,
            &ordenar,
            descendente,
            mailbox.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: responde um e-mail (responder / responder a todos).
#[tauri::command]
async fn cr_responder(
    state: State<'_, Store>,
    id: String,
    corpo: String,
    todos: bool,
    anexos: Vec<graph::AnexoUp>,
    mailbox: Option<String>,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_responder(&store, &id, &corpo, todos, anexos, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: encaminha um e-mail para os destinatarios informados.
#[tauri::command]
async fn cr_encaminhar(
    state: State<'_, Store>,
    id: String,
    corpo: String,
    para: Vec<String>,
    anexos: Vec<graph::AnexoUp>,
    mailbox: Option<String>,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_encaminhar(&store, &id, &corpo, para, anexos, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: exclui um e-mail (move para a Lixeira).
#[tauri::command]
async fn cr_excluir_email(
    state: State<'_, Store>,
    id: String,
    mailbox: Option<String>,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_excluir_email(&store, &id, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: exclui vários e-mails em série (com retry no 429). Retorna os
/// ids que foram realmente excluídos.
#[tauri::command]
async fn cr_excluir_emails(
    state: State<'_, Store>,
    ids: Vec<String>,
    permanente: bool,
    mailbox: Option<String>,
) -> Result<Vec<String>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_excluir_emails(&store, ids, permanente, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: move vários e-mails para uma pasta (com retry no 429).
/// `destino` é o id (well-known ou real) da pasta de destino. Retorna os ids
/// que foram realmente movidos.
#[tauri::command]
async fn cr_mover_emails(
    state: State<'_, Store>,
    ids: Vec<String>,
    destino: String,
    mailbox: Option<String>,
) -> Result<Vec<String>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_mover_emails(&store, ids, destino, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: sinaliza ou remove a sinalizacao de um e-mail.
#[tauri::command]
async fn cr_marcar_email(
    state: State<'_, Store>,
    id: String,
    sinalizado: bool,
    mailbox: Option<String>,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_marcar_email(&store, &id, sinalizado, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: marca um e-mail como lido ou não lido (com retry no 429).
#[tauri::command]
async fn cr_marcar_lido(
    state: State<'_, Store>,
    id: String,
    lido: bool,
    mailbox: Option<String>,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_marcar_lido(&store, &id, lido, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: busca mensagens numa pasta pelo termo (busca no servidor).
#[tauri::command]
async fn cr_buscar(
    state: State<'_, Store>,
    folder_id: String,
    termo: String,
    next_link: Option<String>,
    mailbox: Option<String>,
) -> Result<graph::BuscaPagina, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_buscar(&store, &folder_id, &termo, next_link, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: filtra a pasta pelos filtros que exigem o servidor
/// ("tome" | "mentions" | "invites"), paginando pela continuação (nextLink).
#[tauri::command]
async fn cr_filtrar(
    state: State<'_, Store>,
    folder_id: String,
    filtro: String,
    next_link: Option<String>,
    mailbox: Option<String>,
) -> Result<graph::BuscaPagina, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_filtrar(&store, &folder_id, &filtro, next_link, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: conta na pasta inteira as mensagens que batem com um filtro
/// ("flagged" | "anexos"), via endpoint /$count do Graph.
#[tauri::command]
async fn cr_contar(
    state: State<'_, Store>,
    folder_id: String,
    filtro: String,
    mailbox: Option<String>,
) -> Result<u64, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_contar(&store, &folder_id, &filtro, mailbox.as_deref())
    })
        .await
        .map_err(|e| e.to_string())?
}

/// Control room: os dois contadores por-pasta das abas (Sinalizados / Com anexos)
/// numa ÚNICA chamada $batch — substitui as duas `cr_contar` em paralelo (#87).
#[tauri::command]
async fn cr_contadores(
    state: State<'_, Store>,
    folder_id: String,
    mailbox: Option<String>,
) -> Result<graph::Contadores, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_contadores(&store, &folder_id, mailbox.as_deref())
    })
        .await
        .map_err(|e| e.to_string())?
}

/// Control room: insights do remetente (#94) — recebidos/enviados + data do 1º e
/// do último e-mail deste endereço. Ver o custo de chamadas em
/// `graph::cr_insights_remetente`.
#[tauri::command]
async fn cr_insights_remetente(
    state: State<'_, Store>,
    endereco: String,
) -> Result<graph::InsightsRemetente, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_insights_remetente(&store, &endereco)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: esvazia uma pasta (Lixeira / Lixo Eletrônico), apagando cada
/// mensagem. Retorna a contagem do que saiu.
#[tauri::command]
async fn cr_esvaziar_pasta(
    state: State<'_, Store>,
    folder_id: String,
    mailbox: Option<String>,
) -> Result<u64, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_esvaziar_pasta(&store, &folder_id, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: marca como lidas todas as mensagens não lidas de uma pasta
/// (#89). Retorna quantas foram marcadas.
#[tauri::command]
async fn cr_marcar_pasta_lida(
    state: State<'_, Store>,
    folder_id: String,
    mailbox: Option<String>,
) -> Result<u64, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_marcar_pasta_lida(&store, &folder_id, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: cria uma subpasta dentro de `pai_id` (#90). Retorna a pasta
/// criada.
#[tauri::command]
async fn cr_criar_subpasta(
    state: State<'_, Store>,
    pai_id: String,
    nome: String,
    mailbox: Option<String>,
) -> Result<graph::PastaEmail, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_criar_subpasta(&store, &pai_id, &nome, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: renomeia uma pasta (#90). Retorna a pasta com o nome novo.
#[tauri::command]
async fn cr_renomear_pasta(
    state: State<'_, Store>,
    id: String,
    nome: String,
    mailbox: Option<String>,
) -> Result<graph::PastaEmail, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_renomear_pasta(&store, &id, &nome, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: exclui uma pasta (#90) — MOVE para a Lixeira (reversível,
/// decisão do PO na #71/D3). `true` = foi pra lixeira; `false` = caiu no
/// fallback DELETE (definitivo).
#[tauri::command]
async fn cr_excluir_pasta(
    state: State<'_, Store>,
    id: String,
    mailbox: Option<String>,
) -> Result<bool, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_excluir_pasta(&store, &id, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: move uma pasta para dentro de outra (#90).
#[tauri::command]
async fn cr_mover_pasta(
    state: State<'_, Store>,
    id: String,
    novo_pai: String,
    mailbox: Option<String>,
) -> Result<graph::PastaEmail, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_mover_pasta(&store, &id, &novo_pai, mailbox.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Control room: baixa um anexo para a pasta Downloads. Retorna o caminho.
#[tauri::command]
async fn cr_baixar_anexo(
    state: State<'_, Store>,
    message_id: String,
    attachment_id: String,
    mailbox: Option<String>,
) -> Result<String, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::cr_baixar_anexo(
            &store,
            &message_id,
            &attachment_id,
            mailbox.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Abre um arquivo local com o aplicativo padrao do Windows.
#[tauri::command]
async fn abrir_caminho(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || system::abrir_caminho(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Abre o Explorer com o arquivo selecionado.
#[tauri::command]
async fn revelar_no_explorer(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || system::revelar_no_explorer(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Cria o atalho da biblioteca no OneDrive do usuario (idempotente).
#[tauri::command]
async fn connect_site(
    state: State<'_, Store>,
    site_id: String,
    name: String,
    web_url: String,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::connect_site(&store, &site_id, &name, &web_url)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Remove o atalho do OneDrive (usa o id guardado na criacao).
#[tauri::command]
async fn disconnect_site(state: State<'_, Store>, site_id: String) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::disconnect_site(&store, &site_id))
        .await
        .map_err(|e| e.to_string())?
}

/// Abre a biblioteca conectada no Explorer, na pasta da conta logada
/// (importante quando ha mais de um OneDrive corporativo na maquina).
#[tauri::command]
async fn open_in_explorer(state: State<'_, Store>, name: String) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (email, tenant) = {
            let g = store.inner.lock().map_err(|_| "estado de token corrompido".to_string())?;
            match g.as_ref() {
                Some(t) => (t.account.email.clone(), t.tenant.clone()),
                None => (String::new(), String::new()),
            }
        };
        system::open_in_explorer(&name, &email, &tenant)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Abre uma URL no navegador padrao (menu do usuario: Microsoft 365, SharePoint).
#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    // So http(s): evita abrir esquemas arbitrarios vindos da interface.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("endereco invalido".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        open::that(&url).map_err(|e| format!("falha ao abrir o navegador: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Abre um app do M365 numa janela interna do proprio Toolbox.
///
/// A sessao NAO vem do login do app: o que temos e token OAuth para a API do
/// Graph, e nao cookie de navegador — nao existe conversao entre os dois. O que
/// acontece e que esta janela usa o mesmo perfil do WebView2 do aplicativo,
/// entao a pessoa entra uma vez aqui dentro e a sessao fica guardada para as
/// proximas. Em maquina ingressada no Entra, o SSO do Windows costuma resolver
/// sozinho.
#[tauri::command]
async fn abrir_app_interno(
    app: tauri::AppHandle,
    id: String,
    url: String,
    titulo: String,
) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("endereco invalido".into());
    }
    // Rotulo de janela so aceita [a-zA-Z0-9-_/:#]; o id vem do catalogo, mas
    // filtrar aqui evita que um id novo derrube a criacao da janela.
    let rotulo = format!(
        "app-{}",
        id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect::<String>()
    );

    // Ja aberto: traz para frente em vez de abrir outra.
    if let Some(j) = app.get_webview_window(&rotulo) {
        let _ = j.show();
        let _ = j.unminimize();
        let _ = j.set_focus();
        return Ok(());
    }

    let destino = url.parse().map_err(|_| "endereco invalido".to_string())?;
    tauri::WebviewWindowBuilder::new(&app, &rotulo, tauri::WebviewUrl::External(destino))
        .title(titulo)
        .inner_size(1280.0, 860.0)
        .build()
        .map(|_| ())
        .map_err(|e| format!("falha ao abrir a janela: {e}"))
}

/// Liga LongPathsEnabled (>260 caracteres) via UAC.
#[tauri::command]
async fn enable_long_paths() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(system::enable_long_paths)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn long_paths_status() -> Result<bool, String> {
    Ok(system::long_paths_enabled())
}

/// Recebe uma linha de erro do front-end (ErrorBoundary raiz e captadores
/// globais — #148) e a grava no MESMO log do backend (`tauri-plugin-log`), com o
/// alvo `app_lib`. Assim um crash de render (a "tela branca") deixa rastro no
/// console de dev (`[app_lib] [frontend] ...`) e no arquivo de log, em vez de
/// sumir sem deixar pista. É `sync` de propósito: só formata e loga, sem I/O.
#[tauri::command]
fn log_frontend_error(msg: String) {
    log::error!("[frontend] {msg}");
}

// --- Telemetria (#388, S2): TelemetryPolicy Rust-owned. Comandos sync,
// fire-and-forget (como o log_frontend_error). A telemetria nunca deve quebrar o
// app, então tudo é best-effort. Sem rede antes do opt-in + transporte (S1).
#[tauri::command]
fn telemetry_track(state: State<'_, telemetry::TelemetryState>, envelope: telemetry::EnvelopeEntrada) {
    state.track(envelope);
}

#[tauri::command]
fn telemetry_set_consent(
    state: State<'_, telemetry::TelemetryState>,
    consent: telemetry::Consentimento,
) {
    state.definir_consent(consent);
}

#[tauri::command]
fn telemetry_revoke(state: State<'_, telemetry::TelemetryState>) {
    state.revogar();
}

#[tauri::command]
fn telemetry_status(state: State<'_, telemetry::TelemetryState>) -> telemetry::StatusDto {
    state.status()
}

/// Navigator (#176): importa favoritos do Chrome/Edge lendo SOMENTE o arquivo
/// `Bookmarks` (JSON) de cada perfil. Nunca le `Login Data`/credenciais. Devolve
/// a arvore por navegador+perfil; ausencia degrada em lista vazia (sem panico).
#[tauri::command]
async fn import_browser_bookmarks() -> Result<bookmarks::ImportarResultado, String> {
    tauri::async_runtime::spawn_blocking(bookmarks::importar)
        .await
        .map_err(|e| e.to_string())
}

/// Favicon do PROPRIO dominio de uma URL (#276). HTTP so no site pedido — jamais
/// servico de terceiros (privacidade). Devolve data URI ou `None`. Cache por
/// origem no modulo. Reutilizavel pelo Contacts (#289).
#[tauri::command]
async fn fetch_favicon(url: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || favicon::buscar(&url))
        .await
        .map_err(|e| e.to_string())
}

/// Startup (#123): o app esta configurado para iniciar junto com o sistema?
/// Le do autostart do SO via tauri-plugin-autostart (registro no Windows).
#[tauri::command]
async fn autostart_status(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Startup (#123): liga/desliga o autostart do SO (tauri-plugin-autostart).
#[tauri::command]
async fn autostart_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // #391 (S5): captura de panic do Rust como breadcrumb (drenado no boot
    // seguinte pela TelemetryPolicy). Cedo, antes de tudo.
    telemetry::registrar_panic_hook();
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Iniciar com o sistema (#123): autostart do SO via LaunchAgent no macOS
        // e registro Run no Windows. Ligado/desligado pelos comandos autostart_*.
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        // Anexos e "compartilhar via OneDrive": seletor de arquivo (dialog) e
        // leitura dos bytes (fs), ambos chamados pelo front (compor-mensagem).
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Lembra tamanho e posicao da janela entre execucoes (salva ao fechar,
        // restaura ao abrir).
        //
        // Boot #164: TIRAMOS a flag VISIBLE. Por padrao o plugin salva/restaura a
        // visibilidade e, como a `main` fica visivel em uso, ele a mostraria logo
        // no launch da proxima vez — furando o splash. Sem VISIBLE, a `main`
        // respeita o visible:false da config e so aparece quando o frontend
        // revela. A `splashscreen` e transiente: fica fora do plugin (denylist).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .with_denylist(&["splashscreen"])
                .build(),
        )
        .manage(Arc::new(TokenStore::default()))
        .manage(telemetry::TelemetryState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Primeira vez (sem estado salvo): abre com 50% da resolucao do
            // monitor, centralizado. Nas proximas, o plugin acima restaura o
            // tamanho que o usuario deixou. A janela `main` nasce invisivel
            // (visible:false na config) e e dimensionada aqui, ainda oculta.
            //
            // Boot #164: quem MOSTRA a `main` e o frontend, quando o boot termina
            // (App.tsx -> revelarAppEFecharSplash), fechando junto a janela
            // circular `splashscreen`. Por isso NAO chamamos win.show() aqui — do
            // contrario a main apareceria por baixo do splash logo no launch. Ha
            // um longstop no frontend que revela a main mesmo se o boot travar.
            if let Some(win) = app.get_webview_window("main") {
                let ja_tem_estado = app
                    .path()
                    .app_config_dir()
                    .map(|d| d.join(".window-state.json").exists())
                    .unwrap_or(false);

                if !ja_tem_estado {
                    if let Ok(Some(mon)) = win.primary_monitor() {
                        let escala = mon.scale_factor();
                        let fis = mon.size();
                        let w = (fis.width as f64 / escala) * 0.5;
                        let h = (fis.height as f64 / escala) * 0.5;
                        let _ = win.set_size(tauri::LogicalSize::new(w, h));
                        let _ = win.center();
                    }
                }
            }

            // Splash circular (#164) — recorte de REGIAO no nivel do OS.
            //
            // WINDOWS (implementado): a transparencia de janela do Tauri e
            // NAO-confiavel no Windows (renderiza um quadrado opaco; o
            // window-vibrancy so trocava o quadrado opaco por um quadrado
            // frostado). A forma nativa e confiavel e recortar a janela num
            // circulo com `SetWindowRgn(CreateEllipticRgn(...))`: o OS clipa a
            // janela, os cantos deixam de existir e ve-se o desktop atras — sem
            // transparencia, sem frost, sem quadrado. A regiao e em PIXELS
            // FISICOS, entao o diametro e 400 * scale_factor. Sem panico: se o
            // HWND/scale/recorte falhar, loga e segue (o boot nao pode cair pela
            // estetica do splash; no pior caso ele fica quadrado).
            //
            // macOS (futuro — NAO implementado, so a nota): NAO usar SetWindowRgn
            // (Win32-only). No macOS a transparencia de janela FUNCIONA: basta
            // `transparent: true` na config + a div do circulo com
            // `border-radius:50%` + body/#root transparentes — o macOS composita
            // os cantos transparentes corretamente. Opcionalmente, via NSWindow:
            // `isOpaque=false`, `backgroundColor=.clear` e
            // `contentView.layer.cornerRadius = raio` + `masksToBounds=true`; ou
            // `window-vibrancy::apply_vibrancy(NSVisualEffectMaterial::...)` para
            // blur/vibrancy nativo.
            #[cfg(target_os = "windows")]
            {
                use windows::Win32::Graphics::Gdi::{CreateEllipticRgn, SetWindowRgn};

                if let Some(splash) = app.get_webview_window("splashscreen") {
                    match (splash.hwnd(), splash.scale_factor()) {
                        (Ok(hwnd), Ok(escala)) => {
                            // 400 logico -> pixels fisicos (ex.: 600 em 150%).
                            let d = (400.0 * escala).round() as i32;
                            // SAFETY: HWND valido (janela recem-criada pelo Tauri);
                            // a regiao passa a ser POSSE da janela apos SetWindowRgn
                            // com sucesso, entao nao a deletamos aqui.
                            let ok = unsafe {
                                let rgn = CreateEllipticRgn(0, 0, d, d);
                                SetWindowRgn(hwnd, Some(rgn), true)
                            };
                            if ok == 0 {
                                log::warn!(
                                    "splash #164: SetWindowRgn falhou; a janela do \
                                     splash pode aparecer quadrada"
                                );
                            }
                        }
                        _ => log::warn!(
                            "splash #164: sem HWND/scale_factor da janela splashscreen; \
                             recorte circular ignorado"
                        ),
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login,
            logout,
            current_account,
            required_scopes_status,
            restore_session,
            detect_tenant,
            cached_identity,
            lock_status,
            lock_set_pin,
            lock_disable_pin,
            lock_verify_pin,
            list_sites,
            site_details,
            onedrive_folders,
            onedrive_folder_details,
            onedrive_quota,
            onedrive_tipos,
            cr_reunioes,
            cr_email,
            cr_tarefas,
            cr_agenda,
            cr_calendarios,
            cr_agenda_calendario,
            cr_evento_corpo,
            cr_inbox_dia,
            cr_email_corpo,
            cr_email_seguranca,
            cr_categorias,
            cr_criar_categoria,
            cr_criar_evento,
            cr_editar_evento,
            cr_excluir_evento,
            cr_cancelar_evento,
            cr_responder_evento,
            cr_fotos_contatos,
            cr_pessoas,
            cr_people_list,
            cr_organizacao,
            cr_people_directory,
            cr_grupos,
            cr_grupo_membros,
            cr_people_enrich_preview,
            cr_people_enrich_apply,
            cr_people_write_available,
            cr_people_contact_update,
            cr_people_contact_create,
            cr_people_contact_delete,
            cr_people_company_write,
            cr_people_details_write,
            cr_people_interactions,
            cr_enviar_novo,
            cr_compartilhar_onedrive,
            cr_salvar_contatos,
            cr_subpastas,
            cr_mail_folders,
            cr_validar_caixa,
            cr_mail_shared_disponivel,
            cr_mail_send_shared_disponivel,
            cr_folder_mensagens,
            cr_responder,
            cr_encaminhar,
            cr_excluir_email,
            cr_excluir_emails,
            cr_mover_emails,
            cr_marcar_email,
            cr_marcar_lido,
            cr_buscar,
            cr_filtrar,
            cr_contar,
            cr_contadores,
            cr_insights_remetente,
            cr_esvaziar_pasta,
            cr_marcar_pasta_lida,
            cr_criar_subpasta,
            cr_renomear_pasta,
            cr_excluir_pasta,
            cr_mover_pasta,
            cr_baixar_anexo,
            abrir_caminho,
            revelar_no_explorer,
            connect_site,
            disconnect_site,
            open_in_explorer,
            open_url,
            abrir_app_interno,
            browser::browser_abrir,
            browser::browser_trocar,
            browser::browser_layout,
            browser::browser_fechar,
            browser::browser_esconder_todas,
            browser::browser_recarregar,
            browser::browser_fechar_todas,
            browser::browser_snapshot,
            enable_long_paths,
            long_paths_status,
            log_frontend_error,
            telemetry_track,
            telemetry_set_consent,
            telemetry_revoke,
            telemetry_status,
            import_browser_bookmarks,
            fetch_favicon,
            autostart_status,
            autostart_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
