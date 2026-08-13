//! Configuracao do app cliente (registro no Entra ID).
//!
//! O GALAXIE atende varios clientes, entao o tenant NAO e fixo: ele e
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

/// Tenant "sintetico" das contas Microsoft PESSOAIS (live/hotmail/outlook). O
/// Entra usa este GUID fixo pra distinguir conta pessoal de conta de trabalho
/// (#693, App publico): tenant == este => accountKind personal. Ver
/// auth::classificar.
pub const MS_PERSONAL_TENANT: &str = "9188040d-6c67-4c5b-b112-36a304b66dad";

/// PS2: 2o app registration dedicado a conta PESSOAL Microsoft (AzureADandPersonalMicrosoftAccount).
/// O app escolhe este client_id quando accountKind=personal; a org continua no CLIENT_ID acima.
pub const CLIENT_ID_PESSOAL: &str = "53ddcae4-7368-4072-8ed2-8ee18daa8600";

/// PS3: OAuth client "Desktop app" do Google (scopes sensitive $0). Public client — o
/// secret nao e uma fronteira de confianca (PKCE protege), mas o token endpoint do
/// Google pede ele no exchange do fluxo desktop.
pub const GOOGLE_CLIENT_ID: &str = "672866388200-objaoko15r9on8jvrc64m991r3e2act2.apps.googleusercontent.com";
// #release: injetado em compile-time via `option_env!` (mesmo padrão dos secrets
// de telemetria — ver build.rs). Ausente no build de dev (`tauri dev`) => "" =>
// login Google desligado localmente (usa-se Microsoft no dev). No CI/release o
// Actions secret GOOGLE_CLIENT_SECRET preenche. NUNCA literal no source (repo publico).
pub const GOOGLE_CLIENT_SECRET: &str = match option_env!("GOOGLE_CLIENT_SECRET") {
    Some(s) => s,
    None => "",
};

/// Endpoints OAuth/OIDC do Google (PS3). Fixos — o Google não tem "tenant".
pub const GOOGLE_AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
/// UserInfo OIDC — email/nome/foto da conta logada (equivalente ao /me do Graph).
pub const GOOGLE_USERINFO: &str = "https://openidconnect.googleapis.com/v1/userinfo";

/// Sentinela de "tenant" pras sessões Google (o vault por (provider,conta) e o
/// refresh usam esta string; o Google ignora tenant, endpoint é fixo).
pub const GOOGLE_TENANT: &str = "google";

/// Scopes SENSITIVE/NON-SENSITIVE ($0, decisão do PO). NADA de restricted
/// (Gmail-read/Drive-browse ficam no PS8/CASA). `drive.file` (picker) substitui
/// o browse de Drive; `drive.appdata` (#697) autoriza a pasta OCULTA do app
/// (appDataFolder) onde a config sincroniza — ambos non-sensitive ($0).
/// openid/email/profile = identidade; offline via access_type=offline no
/// authorize (Google não usa o scope offline_access).
pub const GOOGLE_SCOPES: &str = "openid email profile \
     https://www.googleapis.com/auth/calendar \
     https://www.googleapis.com/auth/contacts \
     https://www.googleapis.com/auth/directory.readonly \
     https://www.googleapis.com/auth/gmail.send \
     https://www.googleapis.com/auth/gmail.labels \
     https://www.googleapis.com/auth/drive.file \
     https://www.googleapis.com/auth/drive.appdata";

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
//
// Contacts.ReadWrite.Shared / Calendars.ReadWrite.Shared (caixa compartilhada
// dirige Contacts + Calendar, #495): ler (e futuramente escrever) contatos e
// eventos de uma caixa compartilhada via /users/{addr}/contacts|events. Pedimos
// o superset ReadWrite.Shared (não só Read.Shared) espelhando Mail.ReadWrite.Shared
// — evita um 2º relogin quando formos criar evento / editar contato em caixa
// compartilhada. Admin consent do tenant JÁ concedido (Wagner é Global Admin); é
// escopo novo no pedido, então sessões anteriores precisam RE-LOGAR (até lá,
// caixa compartilhada em Contacts/Calendar dá 403 → empty state gracioso).
//
// Org Admin (#206/#424): MultiTenantOrganization.Read.All, Application.Read.All,
// ServicePrincipalEndpoint.Read.All e a família OrgSettings-* (AppsAndServices/
// Forms/Microsoft365Install/Todo) alimentam o painel Settings › Organization
// (governança org-wide do M365). Exigem admin consent do tenant (Wagner é Global
// Admin) e, como todo escopo novo no pedido, sessões anteriores precisam RE-LOGAR
// — até lá `cr_org_admin_available` = false → painel degrada gracioso (sem erro).
//
// OrganizationalBranding.Read.All (#541): logo do tenant (claro/escuro) do Entra
// branding pro header do sidebar. Admin consent do tenant JÁ concedido; escopo
// novo no pedido → entra no MESMO relogin pendente do Org Admin/#424 + shared/#495.
// #694 (App público PS1): SCOPES separados em BASE (user-consentable, sem admin —
// TODA conta pede) e ORG (admin-consent — só org contratada adiciona). A UNIÃO
// BASE+ORG é exatamente o pedido org de antes, então o fluxo org não regride.
//
// BASE: login pessoal/Google também consegue consentir sem admin do tenant.
pub const SCOPES_BASE: &str = "openid profile offline_access \
     User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite Tasks.ReadWrite Files.ReadWrite \
     People.Read Contacts.ReadWrite";

// ORG: exigem admin consent (Sites/Directory/*.Shared/MultiTenant/OrgSettings/…).
// Admin consent do tenant JÁ concedido (ver comentários acima); só entram no
// pedido de conta org contratada.
pub const SCOPES_ORG: &str = "User.Read.All Directory.Read.All Sites.Read.All OrganizationalBranding.Read.All \
     Calendars.ReadWrite.Shared MailboxSettings.ReadWrite Mail.Read.Shared Mail.ReadWrite.Shared Mail.Send.Shared \
     Contacts.ReadWrite.Shared \
     MultiTenantOrganization.Read.All Application.Read.All ServicePrincipalEndpoint.Read.All \
     OrgSettings-AppsAndServices.Read.All OrgSettings-Forms.Read.All OrgSettings-Microsoft365Install.Read.All \
     OrgSettings-Todo.Read.All OrgSettings-Todo.ReadWrite.All";

/// Authority de conta pessoal/roteamento genérico (MS não-org). `common` aceita
/// org E pessoal; `consumers` é só pessoal. Distinto de um tenant GUID (org).
pub const COMMON_AUTHORITY: &str = "common";

/// A authority `tenant` representa uma ORG (tenant GUID) — não o caminho comum
/// (`common`/`consumers`) do pessoal? Decide o conjunto de scopes e o endpoint.
pub fn eh_org(tenant: &str) -> bool {
    // #695: o tenant SINTÉTICO das contas Microsoft pessoais (MSA) é um GUID, mas
    // NÃO é uma org — não pode receber os scopes exclusivos de organização.
    !tenant.eq_ignore_ascii_case("common")
        && !tenant.eq_ignore_ascii_case("consumers")
        && !tenant.eq_ignore_ascii_case(MS_PERSONAL_TENANT)
}

/// Scopes a pedir por authority: só BASE no caminho comum (pessoal), BASE+ORG na
/// org contratada (tenant). Ordem não importa pro Entra.
pub fn scopes_para(tenant: &str) -> String {
    if eh_org(tenant) {
        format!("{SCOPES_BASE} {SCOPES_ORG}")
    } else {
        SCOPES_BASE.to_string()
    }
}

/// Override de client_id por env (teste, aponta pra outro registro sem
/// recompilar). `GALAXIE_CLIENT_ID`, com `VOAZ_CLIENT_ID` como alias antigo.
fn client_id_override() -> Option<String> {
    std::env::var("GALAXIE_CLIENT_ID")
        .or_else(|_| std::env::var("VOAZ_CLIENT_ID"))
        .ok()
}

pub fn client_id() -> String {
    client_id_override().unwrap_or_else(|| CLIENT_ID.to_string())
}

/// Conta PESSOAL (MSA) pro roteamento de registration: caminho comum
/// (`common`/`consumers`, não-org) OU o tenant GUID reservado do MSA. Pura —
/// sem env, testável.
fn eh_conta_pessoal(tenant: &str) -> bool {
    !eh_org(tenant) || tenant.eq_ignore_ascii_case(MS_PERSONAL_TENANT)
}

/// Client ID do registration a usar para este tenant (#695, PS2). Conta pessoal
/// usa o 2º registration (`CLIENT_ID_PESSOAL`, `AzureADandPersonalMicrosoftAccount`);
/// a org contratada segue no registration de produção (`CLIENT_ID`). O override
/// por env vence sempre (teste). Espelha o padrão do `scopes_para(tenant)`.
pub fn client_id_para(tenant: &str) -> String {
    if let Some(v) = client_id_override() {
        return v;
    }
    if eh_conta_pessoal(tenant) {
        CLIENT_ID_PESSOAL.to_string()
    } else {
        CLIENT_ID.to_string()
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conta_pessoal_no_caminho_comum_e_no_guid_msa() {
        // Caminho comum (pessoal/genérico) e o tenant GUID reservado do MSA.
        assert!(eh_conta_pessoal("common"));
        assert!(eh_conta_pessoal("consumers"));
        assert!(eh_conta_pessoal(MS_PERSONAL_TENANT));
        // Org contratada (tenant GUID real) NÃO é pessoal.
        assert!(!eh_conta_pessoal("1fd6544e-0000-0000-0000-000000000000"));
    }

    #[test]
    fn client_id_para_roteia_pessoal_vs_org() {
        // Sem env override, o roteamento segue o tipo de conta. (Se o ambiente
        // de teste tiver GALAXIE_CLIENT_ID setado, ele vence — então só afirmo
        // o mapeamento quando não há override.)
        if client_id_override().is_none() {
            assert_eq!(client_id_para("common"), CLIENT_ID_PESSOAL);
            assert_eq!(client_id_para(MS_PERSONAL_TENANT), CLIENT_ID_PESSOAL);
            assert_eq!(
                client_id_para("1fd6544e-0000-0000-0000-000000000000"),
                CLIENT_ID
            );
            // Registrations são distintos (pessoal ≠ org).
            assert_ne!(CLIENT_ID, CLIENT_ID_PESSOAL);
        }
    }

    #[test]
    fn tenant_msa_nao_recebe_scopes_de_organizacao() {
        let scopes = scopes_para(MS_PERSONAL_TENANT);

        assert!(
            scopes.contains("Mail.ReadWrite"),
            "a conta pessoal perdeu os scopes base"
        );
        assert!(
            !scopes.contains("Sites.Read.All") && !scopes.contains("OrgSettings"),
            "a conta pessoal recebeu scopes exclusivos de organizacao: {scopes}"
        );
    }

    #[test]
    fn google_scopes_autorizam_a_pasta_de_dados_do_app() {
        assert!(
            GOOGLE_SCOPES
                .split_ascii_whitespace()
                .any(|scope| scope == "https://www.googleapis.com/auth/drive.appdata"),
            "o backend usa appDataFolder, mas o fluxo Google nao pede drive.appdata"
        );
    }
}
