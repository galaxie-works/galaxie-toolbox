//! Contrato HTTP web↔`platform-*` em CÓDIGO — #1503 (costura vertical 1/3 do #1265).
//!
//! A forma humana está em `docs/plataforma/contrato-http-v1.md`; esta é a mesma verdade
//! numa tabela que a borda (#1505) implementa contra, e cujos INVARIANTES (as 6 condições
//! do @Altair) os testes abaixo amarram. Doc e tabela não podem divergir — quem editar uma
//! edita a outra; os testes pegam as violações estruturais (ex.: um GET que muda estado).

/// Verbo HTTP. Só o que o contrato usa.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Metodo {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

/// Uma rota do contrato. Campos que os invariantes checam ficam explícitos (não inferidos).
#[derive(Debug, Clone, Copy)]
pub struct Rota {
    pub metodo: Metodo,
    pub caminho: &'static str,
    /// Muda estado no servidor? (invariante 3: mutação nunca é GET.)
    pub muta: bool,
    /// Código de sucesso (2xx).
    pub sucesso: u16,
    /// Exige sessão viva (senão 401). As de sessão (login) são as exceções.
    pub autenticada: bool,
    /// Só staff (back-office #1474); não-staff recebe 404 (invariante 1: não se anuncia).
    pub so_staff: bool,
    /// Registrada no sink de auditoria (invariante 4: toda ação de staff é auditada).
    pub auditada: bool,
    /// #1503 v1.2: `true` SÓ pro callback OAuth — o único GET que muda estado no contrato, e só
    /// porque o anti-CSRF ali é o `state` uso-único + PKCE (não o método). Exceção consciente ao
    /// invariante 3, marcada no tipo pra o teste permitir exatamente ESTA e nenhuma outra.
    pub csrf_por_state: bool,
}

/// A tabela canônica. Espelha `docs/plataforma/contrato-http-v1.md §4`.
pub const CONTRATO: &[Rota] = &[
    // 4.1/§2 Sessão FEDERADA. Login = OAuth (start + callback); logout idempotente e não-autenticado.
    Rota { metodo: Metodo::Get,    caminho: "/api/v1/auth/{provedor}",                     muta: false, sucesso: 302, autenticada: false, so_staff: false, auditada: false, csrf_por_state: false },
    // Callback: ÚNICO GET mutante — anti-CSRF é o `state`+PKCE, não o método (exceção consciente).
    Rota { metodo: Metodo::Get,    caminho: "/api/v1/auth/{provedor}/callback",            muta: true,  sucesso: 302, autenticada: false, so_staff: false, auditada: false, csrf_por_state: true },
    Rota { metodo: Metodo::Delete, caminho: "/api/v1/session",                             muta: true,  sucesso: 204, autenticada: false, so_staff: false, auditada: false, csrf_por_state: false },
    // 4.2 Conta própria (/me) — shapes do FE (@Castor)
    Rota { metodo: Metodo::Get,    caminho: "/api/v1/me",                                  muta: false, sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Patch,  caminho: "/api/v1/me",                                  muta: true,  sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Get,    caminho: "/api/v1/me/orgs",                             muta: false, sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Get,    caminho: "/api/v1/me/assinatura",                       muta: false, sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Get,    caminho: "/api/v1/me/dispositivos",                     muta: false, sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Delete, caminho: "/api/v1/me/dispositivos/{id}",                muta: true,  sucesso: 204, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    // 4.3 Admin da org (AcaoAdminOrg)
    Rota { metodo: Metodo::Get,    caminho: "/api/v1/orgs/{org}/membros",                  muta: false, sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Post,   caminho: "/api/v1/orgs/{org}/membros",                  muta: true,  sucesso: 201, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Delete, caminho: "/api/v1/orgs/{org}/membros/{uid}",            muta: true,  sucesso: 204, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Patch,  caminho: "/api/v1/orgs/{org}/membros/{uid}",            muta: true,  sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    // Leitura de cada recurso ANTES da escrita (v1.3, lacuna do @Pollux #1490): "não se gere o que
    // não se vê" — sobretudo settings, cujo PATCH sem GET obriga o cliente a SUPOR o estado atual.
    // Cada GET é autorizado igual à sua escrita (mesmo {org} conferido contra a sessão); org alheia ⇒ 404.
    Rota { metodo: Metodo::Get,    caminho: "/api/v1/orgs/{org}/dominios",                 muta: false, sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    // Reivindicar é livre/pendente (201) — SEM 409 cross-tenant (era oráculo); a guarda é a verificação.
    Rota { metodo: Metodo::Post,   caminho: "/api/v1/orgs/{org}/dominios",                 muta: true,  sucesso: 201, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Post,   caminho: "/api/v1/orgs/{org}/dominios/{dom}/verificacao", muta: true, sucesso: 200, autenticada: true, so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Get,    caminho: "/api/v1/orgs/{org}/settings",                 muta: false, sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Patch,  caminho: "/api/v1/orgs/{org}/settings",                 muta: true,  sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Get,    caminho: "/api/v1/orgs/{org}/assinatura",               muta: false, sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Put,    caminho: "/api/v1/orgs/{org}/assinatura",               muta: true,  sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    // 4.4 Config do app — user-scoped (/me/config), NÃO org (fix @Castor)
    Rota { metodo: Metodo::Get,    caminho: "/api/v1/me/config",                           muta: false, sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    Rota { metodo: Metodo::Patch,  caminho: "/api/v1/me/config",                           muta: true,  sucesso: 200, autenticada: true,  so_staff: false, auditada: false, csrf_por_state: false },
    // 4.5 Back-office (staff, auditado). Provisionar e suspender SEPARADOS (fix @Altair; suspender é destrutivo).
    Rota { metodo: Metodo::Get,    caminho: "/api/v1/admin/orgs",                          muta: false, sucesso: 200, autenticada: true,  so_staff: true,  auditada: true,  csrf_por_state: false },
    Rota { metodo: Metodo::Post,   caminho: "/api/v1/admin/orgs/{org}/provisionamento",    muta: true,  sucesso: 202, autenticada: true,  so_staff: true,  auditada: true,  csrf_por_state: false },
    Rota { metodo: Metodo::Post,   caminho: "/api/v1/admin/orgs/{org}/suspensao",          muta: true,  sucesso: 202, autenticada: true,  so_staff: true,  auditada: true,  csrf_por_state: false },
];

/// Códigos de erro do contrato (§3). O 404 é IDÊNTICO para inexistente e cross-tenant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodigoErro {
    /// 401
    NaoAutenticado,
    /// 404 — inexistente OU de outro tenant (invariante 1, não vaza a razão).
    NaoEncontrado,
    /// 403 — recurso da própria org, papel insuficiente.
    Negado,
    /// 400
    PayloadInvalido,
    /// 409
    Conflito,
}

impl CodigoErro {
    pub fn http(self) -> u16 {
        match self {
            CodigoErro::NaoAutenticado => 401,
            CodigoErro::NaoEncontrado => 404,
            CodigoErro::Negado => 403,
            CodigoErro::PayloadInvalido => 400,
            CodigoErro::Conflito => 409,
        }
    }
    /// O slug que vai no corpo `{ "erro": "<slug>" }`.
    pub fn slug(self) -> &'static str {
        match self {
            CodigoErro::NaoAutenticado => "nao_autenticado",
            CodigoErro::NaoEncontrado => "nao_encontrado",
            CodigoErro::Negado => "negado",
            CodigoErro::PayloadInvalido => "payload_invalido",
            CodigoErro::Conflito => "conflito",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Invariante 3: GET não muda estado — com UMA exceção consciente (o callback OAuth, cujo
    // anti-CSRF é o `state`+PKCE, não o método). Um GET mutante só é aceito se marcado
    // `csrf_por_state`, e tem de haver EXATAMENTE UM (senão alguém abriu um GET mutante novo
    // sem o guarda de CSRF certo, disfarçado de exceção).
    #[test]
    fn get_muda_estado_so_o_callback_oauth() {
        let mut gets_mutantes = 0;
        for r in CONTRATO {
            if r.metodo == Metodo::Get && r.muta {
                assert!(
                    r.csrf_por_state,
                    "GET mutante sem o guarda de CSRF por `state`: {} — não é a exceção, é furo",
                    r.caminho
                );
                gets_mutantes += 1;
            }
            // `csrf_por_state` só faz sentido num GET mutante (o callback). Em qualquer outra
            // rota é bandeira solta.
            if r.csrf_por_state {
                assert!(r.metodo == Metodo::Get && r.muta, "csrf_por_state só no callback: {}", r.caminho);
            }
        }
        assert_eq!(gets_mutantes, 1, "só o callback OAuth pode ser um GET mutante");
    }

    // Invariante 4: toda rota de staff (back-office) é auditada.
    #[test]
    fn toda_rota_de_staff_e_auditada() {
        for r in CONTRATO {
            if r.so_staff {
                assert!(r.auditada, "rota de staff sem auditoria: {}", r.caminho);
            }
        }
    }

    // Códigos de sucesso são 2xx válidos do contrato.
    #[test]
    fn sucesso_e_2xx_conhecido() {
        for r in CONTRATO {
            assert!(
                matches!(r.sucesso, 200 | 201 | 202 | 204 | 302),
                "código de sucesso fora do contrato: {} em {} (302 só nas rotas OAuth)",
                r.sucesso,
                r.caminho
            );
        }
    }

    // Só as rotas de SESSÃO são não-autenticadas: o fluxo federado de login (`/auth/{provedor}`
    // + callback) e o logout (`DELETE /session`, idempotente). Todo o resto exige sessão
    // (invariante 6: principal/escopo vêm da sessão). NENHUMA rota `/me`, `/orgs`, `/admin` pode
    // ser não-autenticada.
    #[test]
    fn so_sessao_e_nao_autenticada() {
        for r in CONTRATO {
            if !r.autenticada {
                let e_de_sessao = r.caminho.starts_with("/api/v1/auth/") || r.caminho == "/api/v1/session";
                assert!(e_de_sessao, "rota não-autenticada fora do fluxo de sessão: {}", r.caminho);
            }
        }
    }

    // O 404 e o 403 do contrato: NaoEncontrado é 404 (cross-tenant não enumera), Negado é 403.
    // Amarra a distinção do invariante 1 no tipo.
    #[test]
    fn codigos_de_erro_mapeiam_certo() {
        assert_eq!(CodigoErro::NaoEncontrado.http(), 404);
        assert_eq!(CodigoErro::Negado.http(), 403);
        assert_eq!(CodigoErro::NaoAutenticado.http(), 401);
        // o slug do 404 não distingue a razão (invariante 1 — não vaza).
        assert_eq!(CodigoErro::NaoEncontrado.slug(), "nao_encontrado");
    }

    // Toda rota vive sob o prefixo versionado /api/v1 (§5).
    #[test]
    fn tudo_sob_api_v1() {
        for r in CONTRATO {
            assert!(r.caminho.starts_with("/api/v1/"), "rota fora do prefixo: {}", r.caminho);
        }
    }
}
