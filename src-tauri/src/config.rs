//! Configuracao do app cliente (registro no Entra ID).
//!
//! O GALAXIE Toolbox atende varios clientes, entao o tenant NAO e fixo: ele e
//! descoberto a partir do dominio do e-mail que a pessoa digita (ver
//! auth::detectar_tenant). O que e fixo e o CLIENT_ID do app registrado.
//!
//! IMPORTANTE: para atender clientes de outros tenants, o registro no Entra
//! precisa ser MULTI-TENANT ("Accounts in any organizational directory") e o
//! admin de cada cliente precisa dar consent. Com registro single-tenant so
//! entram contas do tenant de origem.

/// GUID do app registrado (Application/client ID).
pub const CLIENT_ID: &str = "a8f61189-4fb0-45e8-8c0e-4a352a64e1af";

/// Escopos delegados. offline_access garante refresh_token.
pub const SCOPES: &str =
    "openid profile offline_access User.Read Files.ReadWrite Sites.Read.All";

pub fn client_id() -> String {
    std::env::var("VOAZ_CLIENT_ID").unwrap_or_else(|_| CLIENT_ID.to_string())
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
