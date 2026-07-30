//! Configuracao do app cliente (registro no Entra ID).
//!
//! O GALAXIE Toolbox atende varios clientes, entao o tenant NAO e fixo: ele e
//! descoberto a partir do dominio do e-mail que a pessoa digita (ver
//! auth::detectar_tenant). O que e fixo e o CLIENT_ID do app registrado.
//!
//! O registro vive no tenant da GALAXIE (029575b8-d93d-49e3-8017-56a3eb414f48)
//! e e MULTI-TENANT: cada cliente ganha um service principal no tenant dele
//! quando o admin da consent, sem registro novo. Um CLIENT_ID atende todos.
//!
//! O consent do admin do cliente e obrigatorio porque Sites.Read.All exige
//! aprovacao administrativa:
//! https://login.microsoftonline.com/{tenant}/adminconsent?client_id={CLIENT_ID}

/// GUID do app registrado (Application/client ID). Publico por design: cliente
/// publico com PKCE, sem secret.
pub const CLIENT_ID: &str = "214d735e-eb9b-4052-8851-578d3bd91627";

/// Escopos delegados que o app PEDE no login. offline_access garante
/// refresh_token. So Microsoft Graph — o app tem muito mais permissao concedida
/// no registro, mas pedimos so o que cada feature usa (token enxuto, tela de
/// consentimento sana). Calendars/Mail/Tasks alimentam o Control room.
///
/// User.Read.All (foto de remetente interno, #39): admin consent JA concedido
/// pelo PO no registro. E escopo NOVO no pedido, entao sessoes logadas antes
/// dele so ganham a permissao ao re-logar (ate la, foto = 403 -> so iniciais).
///
/// Mail.Read.Shared / Mail.ReadWrite.Shared / Mail.Send.Shared (caixas
/// compartilhadas, #111-#114): JA GRANTED por admin consent do tenant (ver
/// AGENTS.md 1.1). Como sao escopos novos no pedido, sessoes anteriores precisam
/// RE-LOGAR para ler, gerir e enviar usando uma caixa compartilhada.
// Calendars.ReadWrite (Agenda #211): cobre leitura E escrita de eventos —
// substitui Calendars.Read (redundante). Sem ela, criar/editar/excluir evento
// dava 403 ("Couldn't save/delete the event").
//
// MailboxSettings.ReadWrite (Agenda #211): criar categoria mestra
// (POST /me/outlook/masterCategories) exige escrita de mailbox settings.
// Admin consent JÁ concedido no tenant; é escopo novo no pedido, então sessões
// logadas antes dele precisam RE-LOGAR para criar categorias.
pub const SCOPES: &str = "openid profile offline_access \
     User.Read User.Read.All Files.ReadWrite Sites.Read.All \
     Calendars.ReadWrite MailboxSettings.ReadWrite Mail.ReadWrite Mail.Read.Shared Mail.ReadWrite.Shared Mail.Send Mail.Send.Shared Tasks.ReadWrite \
     People.Read Contacts.ReadWrite";

pub fn client_id() -> String {
    // GALAXIE_CLIENT_ID permite apontar para outro registro sem recompilar
    // (teste). VOAZ_CLIENT_ID fica como alias do nome antigo.
    std::env::var("GALAXIE_CLIENT_ID")
        .or_else(|_| std::env::var("VOAZ_CLIENT_ID"))
        .unwrap_or_else(|_| CLIENT_ID.to_string())
}

pub fn authority(tenant: &str) -> String {
    format!("https://login.microsoftonline.com/{tenant}")
}

pub fn authorize_endpoint(tenant: &str) -> String {
    format!("{}/oauth2/v2.0/authorize", authority(tenant))
}

pub fn token_endpoint(tenant: &str) -> String {
    format!("{}/oauth2/v2.0/token", authority(tenant))
}

/// Documento OIDC do dominio: e ele que revela o tenant real.
pub fn discovery_url(dominio: &str) -> String {
    format!("https://login.microsoftonline.com/{dominio}/v2.0/.well-known/openid-configuration")
}
