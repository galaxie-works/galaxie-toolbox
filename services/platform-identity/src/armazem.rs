//! Persistência do domínio (fatia (a) do #1505, desenho do @Altair). As traits de armazém das
//! entidades moram AQUI, no crate de DOMÍNIO que possui a entidade — não na borda (`platform-http`).
//!
//! Motivo (@Altair): se a trait nascesse na borda, os crates de domínio dependeriam **para cima**,
//! da borda, pra acessar os próprios dados. A borda **serve**, não define o que uma `Org` é. É o
//! mesmo precedente de [`crate::sessao::ArmazemSessao`] + `ArmazemMemoria`.
//!
//! **`Result` desde o dia um.** A impl em memória ([`ArmazemOrgMemoria`]) nunca falha, mas as
//! assinaturas já devolvem `Result` — senão o Postgres depois não muda "uma linha na trait", muda
//! **toda assinatura e todo consumidor** (o apodrecimento que custou três fatias na expiração de
//! sessão). O backing real (Postgres) é fatia própria; o banco não entra de carona aqui.

use crate::{Org, OrgId};

/// Falha de INFRAESTRUTURA do armazém (conexão/IO caiu) — **não** "não encontrado", que é um
/// `Option` dentro do `Ok`. Genérico de propósito: a impl em memória nunca o produz, mas a
/// assinatura o carrega desde já.
///
/// ⚠️ **Em superfície OCULTA (`/admin/*`), a borda mapeia isto pro MESMO `404`**, nunca `500`: se
/// `/admin/orgs` respondesse `500` quando o store cai enquanto uma rota inexistente responde `404`,
/// aprendeu-se que a rota existe (invariante 1). Em superfície visível, `500` é aceitável.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroArmazem {
    /// O armazém está indisponível (infra). O chamador decide o código HTTP **pelo contexto**
    /// (oculto ⇒ 404; visível ⇒ 500) — a trait não conhece HTTP.
    Indisponivel,
}

/// Armazém de orgs. `listar` serve o back-office (`GET /admin/orgs`); `buscar` resolve o `Org`
/// completo (com `dominios`/claims) que `autorizar_acao_admin` precisa pra decidir visibilidade.
///
/// **`Ok(None)` em `buscar` = a org não existe** (não é erro — é o caso normal do 404 de recurso
/// alheio/inexistente). `Err(Indisponivel)` = a infra caiu. Os dois são coisas diferentes de
/// propósito: colapsá-los faria "banco fora do ar" virar "org não existe", que é mentira perigosa.
pub trait ArmazemOrg {
    /// Todas as orgs da base (uso: back-office staff). `Result` porque o backing real pode falhar.
    fn listar(&self) -> Result<Vec<Org>, ErroArmazem>;
    /// A org de `id`, ou `Ok(None)` se não existe. `Err` só pra falha de infra.
    fn buscar(&self, id: &OrgId) -> Result<Option<Org>, ErroArmazem>;
}

/// Primeira impl: em memória. Nunca falha — mas implementa a trait com `Result` pra a troca por
/// Postgres não tocar em nenhum consumidor. Mantém os testes de invariante baratos (sem subir banco).
#[derive(Debug, Default, Clone)]
pub struct ArmazemOrgMemoria {
    orgs: Vec<Org>,
}

impl ArmazemOrgMemoria {
    /// Armazém vazio (o estado honesto de hoje: zero orgs provisionadas).
    pub fn novo() -> Self {
        Self::default()
    }

    /// Semeia com orgs (uso: testes e, no futuro, um bootstrap). Consome pra não clonar à toa.
    pub fn com(orgs: Vec<Org>) -> Self {
        Self { orgs }
    }

    /// Insere/atualiza uma org (por `id`). Aqui é onde `provisionar`/`suspender` do back-office
    /// aterrissam quando existirem — a mutação é sempre por transição, nunca campo público solto.
    pub fn inserir(&mut self, org: Org) {
        if let Some(slot) = self.orgs.iter_mut().find(|o| o.id == org.id) {
            *slot = org;
        } else {
            self.orgs.push(org);
        }
    }
}

impl ArmazemOrg for ArmazemOrgMemoria {
    fn listar(&self) -> Result<Vec<Org>, ErroArmazem> {
        Ok(self.orgs.clone())
    }

    fn buscar(&self, id: &OrgId) -> Result<Option<Org>, ErroArmazem> {
        Ok(self.orgs.iter().find(|o| &o.id == id).cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn org(id: &str) -> Org {
        Org {
            id: OrgId(id.into()),
            dominios: BTreeSet::from([format!("{id}.com")]),
            tenant_m365: None,
        }
    }

    #[test]
    fn vazio_lista_nada_e_nao_acha() {
        let a = ArmazemOrgMemoria::novo();
        assert_eq!(a.listar().unwrap(), vec![], "sem store semeado, zero orgs (o [] honesto de hoje)");
        // `buscar` inexistente é `Ok(None)`, NÃO `Err` — "não existe" ≠ "infra caiu".
        assert_eq!(a.buscar(&OrgId("x".into())).unwrap(), None);
    }

    #[test]
    fn lista_e_busca_o_que_foi_inserido() {
        let mut a = ArmazemOrgMemoria::com(vec![org("acme")]);
        a.inserir(org("globex"));
        let ids: Vec<_> = a.listar().unwrap().into_iter().map(|o| o.id).collect();
        assert_eq!(ids, vec![OrgId("acme".into()), OrgId("globex".into())]);
        assert_eq!(a.buscar(&OrgId("acme".into())).unwrap().unwrap().id, OrgId("acme".into()));
        assert_eq!(a.buscar(&OrgId("nao".into())).unwrap(), None);
    }

    #[test]
    fn inserir_por_id_atualiza_nao_duplica() {
        let mut a = ArmazemOrgMemoria::com(vec![org("acme")]);
        // mesma id, dominios diferentes: substitui, não vira duas.
        let mut atualizada = org("acme");
        atualizada.dominios = BTreeSet::from(["novo.com".to_owned()]);
        a.inserir(atualizada);
        assert_eq!(a.listar().unwrap().len(), 1, "inserir por id existente atualiza, não duplica");
        assert_eq!(
            a.buscar(&OrgId("acme".into())).unwrap().unwrap().dominios,
            BTreeSet::from(["novo.com".to_owned()])
        );
    }

    // O `Result` é a exigência do @Altair: a assinatura carrega falha desde já mesmo a impl não
    // falhando. Este teste existe pra AMARRAR isso — se alguém "simplificar" pra devolver `Vec`
    // direto, ele para de compilar, e a regressão do apodrecimento aparece na hora.
    #[test]
    fn assinatura_carrega_result() {
        let a = ArmazemOrgMemoria::novo();
        let r: Result<Vec<Org>, ErroArmazem> = a.listar();
        assert!(r.is_ok());
        let b: Result<Option<Org>, ErroArmazem> = a.buscar(&OrgId("x".into()));
        assert!(b.is_ok());
    }
}
