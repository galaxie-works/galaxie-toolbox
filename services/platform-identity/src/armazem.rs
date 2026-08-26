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

use std::sync::Mutex;

use crate::{Org, OrgId, Papel, UserId};

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

/// Um membro de uma org, como o contrato §4.3 (`GET /orgs/{org}/membros`) o projeta:
/// `{ uid, nome, email, papel }`. É a PROJEÇÃO que sai no fio — sem claims de tenant, sem segredo.
/// O `papel` decide o que a UI mostra, jamais o que o servidor permite (a autz é da sessão).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Membro {
    pub uid: UserId,
    pub nome: String,
    pub email: String,
    pub papel: Papel,
}

/// Desfecho de uma mutação de membro que PRESERVA uma invariante de papel — decidido e aplicado sob
/// o MESMO lock/transação (atômico) — ver [`ArmazemMembro::remover_preservando`] e
/// [`ArmazemMembro::mudar_papel_preservando`] (#1620, enforço ratificado pelo @Altair). A invariante
/// "org não fica órfã de `OrgAdmin`" NÃO pode viver na borda: a borda lê o snapshot e muta em locks
/// SEPARADOS = TOCTOU (dois `DELETE`/`PATCH` concorrentes veem ambos 2 admins, passam a guarda, e
/// mutam ⇒ org com ZERO admin). Só a camada que DETÉM o lock enforça de facto — a decisão pode viver
/// na autz, o enforço vive aqui (correção da regra do @Altair sobre o #1620).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MutacaoMembro {
    /// A mutação aconteceu. Carrega o [`Membro`] no estado FINAL — o `mudar_papel_preservando`
    /// devolve-o no `200`; o `remover_preservando` ignora o valor (o tipo é uniforme de propósito).
    Feita(Membro),
    /// `uid` não era membro da org — nada mutou (a borda ⇒ `404`; só chega admin autorizado, que
    /// PODE ver os membros, logo não é oráculo).
    NaoEraMembro,
    /// RECUSADA porque a mutação deixaria a org com ZERO membros de `papel_esvaziado` (nada mutou; a
    /// borda ⇒ `409 ultimo_admin`). **Struct-variante de propósito** (@Altair): hoje há um só motivo,
    /// mas quando o 2º aparecer o `match` do caller parte na COMPILAÇÃO em vez de os dois se fundirem
    /// num `409` mudo — o campo é a barreira contra a conflação futura.
    Recusada { papel_esvaziado: Papel },
}

/// Armazém de membros por org. `listar` serve `GET /orgs/{org}/membros`. Mesma doutrina do
/// [`ArmazemOrg`]: mora no domínio, `Result` desde já, `ErroArmazem` só pra falha de infra.
///
/// Org sem membros (ou inexistente) devolve `Ok(vec![])` — a EXISTÊNCIA/visibilidade da org é
/// decidida ANTES, por `autorizar_acao_admin` sobre o `Org` carregado (org alheia ⇒ 404); aqui já
/// se sabe que o solicitante pode ver. `listar` não reintroduz essa checagem (seria dois donos da
/// verdade), só devolve os membros.
///
/// 🔒 **As MUTAÇÕES (`*_preservando`) enforçam a invariante ATOMICAMENTE** (#1620): não há um
/// `remover`/`mudar_papel` NUS na trait de propósito — uma mutação de membro sem a guarda seria o
/// footgun que orfaniza a org (a borda não consegue guardar: lê e muta em locks separados). Ver
/// [`MutacaoMembro`].
pub trait ArmazemMembro {
    /// Os membros da org `org`. `Result` porque o backing real pode falhar; lista vazia = zero
    /// membros (não erro).
    fn listar(&self, org: &OrgId) -> Result<Vec<Membro>, ErroArmazem>;

    /// As orgs a que `uid` pertence, com o papel dele em cada uma (`GET /me/orgs`, contrato v1.3).
    /// É a leitura pela qual o principal DESCOBRE suas orgs — sem ela, a UI não tem o `{org}` pra
    /// alcançar as outras rotas. `uid` vem SEMPRE da sessão (invariante 6): não há como pedir as
    /// orgs de outro usuário. Lista vazia = pertence a nenhuma org (não erro).
    fn orgs_do_usuario(&self, uid: &UserId) -> Result<Vec<(OrgId, Papel)>, ErroArmazem>;

    /// REMOVE `uid` da org `org` (`DELETE /orgs/{org}/membros/{uid}`, contrato §4.3), MAS recusa —
    /// sem mutar — se remover `uid` deixaria a org com ZERO membros de `papel_protegido`. O
    /// check-e-mutação ocorrem sob o MESMO lock (ATÓMICOS): é aqui, e não na borda, que a invariante
    /// org-não-órfã (#1620) é de facto garantida — dois `DELETE` concorrentes NÃO a furam. `&self`
    /// (não `&mut`): mutabilidade INTERIOR (o backing real muta por `&self`/pool). A POLÍTICA (qual
    /// papel proteger) fica no CALLER; o store só oferece o primitivo atómico "muta-a-menos-que-
    /// esvazie-o-papel-R". Desfechos ⇒ [`MutacaoMembro`] (`Feita`⇒204, `NaoEraMembro`⇒404,
    /// `Recusada`⇒409).
    ///
    /// ⚠️ **NÃO invalida a sessão do removido** — isso é o #1545 (a borda revoga após o `Feita`).
    fn remover_preservando(
        &self,
        org: &OrgId,
        uid: &UserId,
        papel_protegido: Papel,
    ) -> Result<MutacaoMembro, ErroArmazem>;

    /// Muda o papel de `uid` na org `org` (`PATCH /orgs/{org}/membros/{uid}`, contrato §4.3), MAS
    /// recusa — sem mutar — se rebaixar `uid` (papel novo ≠ `papel_protegido`) deixaria a org sem
    /// NENHUM membro de `papel_protegido`. Mesma atomicidade e doutrina do
    /// [`remover_preservando`](Self::remover_preservando): a guarda vive sob o lock, não na borda.
    /// `Feita` carrega o [`Membro`] atualizado (a borda devolve `200` com ele). Promover/manter o
    /// papel protegido nunca reduz a contagem ⇒ passa.
    fn mudar_papel_preservando(
        &self,
        org: &OrgId,
        uid: &UserId,
        papel_novo: Papel,
        papel_protegido: Papel,
    ) -> Result<MutacaoMembro, ErroArmazem>;
}

/// Primeira impl: em memória (por org). Nunca falha; carrega `Result` pra a troca por Postgres não
/// rippar os consumidores. `Mutex` = mutabilidade INTERIOR: as escritas (`remover`/`mudar_papel`) são
/// `&self` no trait (a borda compartilha por `Arc<dyn>`), então a concorrência mora AQUI — igual ao
/// que o backing real fará com o pool. Não é `Clone` (Mutex não é; e ninguém clona o armazém).
#[derive(Debug, Default)]
pub struct ArmazemMembroMemoria {
    /// (org, membro) — flat pra o teste semear fácil; a impl real indexa por org.
    membros: Mutex<Vec<(OrgId, Membro)>>,
}

impl ArmazemMembroMemoria {
    pub fn novo() -> Self {
        Self::default()
    }

    /// Semeia um membro numa org (dev-server / testes). `&mut self` (seed-time); as escritas de
    /// RUNTIME são `&self` no trait.
    pub fn inserir(&mut self, org: OrgId, membro: Membro) {
        self.membros.get_mut().expect("mutex de membros envenenado").push((org, membro));
    }
}

impl ArmazemMembro for ArmazemMembroMemoria {
    fn listar(&self, org: &OrgId) -> Result<Vec<Membro>, ErroArmazem> {
        let membros = self.membros.lock().expect("mutex de membros envenenado");
        Ok(membros.iter().filter(|(o, _)| o == org).map(|(_, m)| m.clone()).collect())
    }

    fn orgs_do_usuario(&self, uid: &UserId) -> Result<Vec<(OrgId, Papel)>, ErroArmazem> {
        let membros = self.membros.lock().expect("mutex de membros envenenado");
        Ok(membros.iter().filter(|(_, m)| &m.uid == uid).map(|(org, m)| (org.clone(), m.papel)).collect())
    }

    fn remover_preservando(
        &self,
        org: &OrgId,
        uid: &UserId,
        papel_protegido: Papel,
    ) -> Result<MutacaoMembro, ErroArmazem> {
        // TUDO sob UM único lock (check-e-mutação atómicos): é o que a borda não conseguia garantir.
        let mut membros = self.membros.lock().expect("mutex de membros envenenado");
        let Some(i) = membros.iter().position(|(o, m)| o == org && &m.uid == uid) else {
            return Ok(MutacaoMembro::NaoEraMembro);
        };
        // Só orfaniza se o alvo É do papel protegido E é o ÚNICO desse papel na org. Tirar um
        // não-protegido (ou um protegido quando há OUTROS) nunca esvazia ⇒ passa.
        if membros[i].1.papel == papel_protegido
            && membros.iter().filter(|(o, m)| o == org && m.papel == papel_protegido).count() <= 1
        {
            return Ok(MutacaoMembro::Recusada { papel_esvaziado: papel_protegido });
        }
        let (_, membro) = membros.remove(i);
        Ok(MutacaoMembro::Feita(membro))
    }

    fn mudar_papel_preservando(
        &self,
        org: &OrgId,
        uid: &UserId,
        papel_novo: Papel,
        papel_protegido: Papel,
    ) -> Result<MutacaoMembro, ErroArmazem> {
        let mut membros = self.membros.lock().expect("mutex de membros envenenado");
        let Some(i) = membros.iter().position(|(o, m)| o == org && &m.uid == uid) else {
            return Ok(MutacaoMembro::NaoEraMembro);
        };
        // Rebaixa o protegido = papel ATUAL é o protegido E o novo NÃO é. Se além disso for o último
        // desse papel ⇒ recusa. Promover pra protegido, ou manter, não reduz a contagem ⇒ passa.
        if membros[i].1.papel == papel_protegido
            && papel_novo != papel_protegido
            && membros.iter().filter(|(o, m)| o == org && m.papel == papel_protegido).count() <= 1
        {
            return Ok(MutacaoMembro::Recusada { papel_esvaziado: papel_protegido });
        }
        membros[i].1.papel = papel_novo;
        Ok(MutacaoMembro::Feita(membros[i].1.clone()))
    }
}

/// Estado de VERIFICAÇÃO de um domínio (contrato §4.3): `pendente` até o DNS provar posse,
/// `verificado` depois. É o que separa "reivindiquei acme.com" de "controlo acme.com" — a guarda
/// contra o oráculo cross-tenant do #1503 é a VERIFICAÇÃO, não a reivindicação (que é livre).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EstadoDominio {
    Pendente,
    Verificado,
}

/// Um domínio de uma org, como o contrato §4.3 (`GET /orgs/{org}/dominios`) o projeta:
/// `{ dominio, estado: "pendente"|"verificado" }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dominio {
    pub dominio: String,
    pub estado: EstadoDominio,
}

/// Armazém de domínios por org. `listar` serve `GET /orgs/{org}/dominios`. Mesma doutrina do
/// [`ArmazemMembro`]: domínio, `Result` desde já, `ErroArmazem` só pra falha de infra. A
/// visibilidade da org é decidida ANTES (`autorizar_acao_admin` sobre o `Org` carregado); `listar`
/// não reintroduz a checagem.
pub trait ArmazemDominio {
    /// Os domínios da org `org` (com seu estado de verificação). Lista vazia = zero domínios.
    fn listar(&self, org: &OrgId) -> Result<Vec<Dominio>, ErroArmazem>;
}

/// Primeira impl: em memória (por org). `Result` pra a troca por Postgres não rippar consumidores.
#[derive(Debug, Default, Clone)]
pub struct ArmazemDominioMemoria {
    dominios: Vec<(OrgId, Dominio)>,
}

impl ArmazemDominioMemoria {
    pub fn novo() -> Self {
        Self::default()
    }

    pub fn inserir(&mut self, org: OrgId, dominio: Dominio) {
        self.dominios.push((org, dominio));
    }
}

impl ArmazemDominio for ArmazemDominioMemoria {
    fn listar(&self, org: &OrgId) -> Result<Vec<Dominio>, ErroArmazem> {
        Ok(self
            .dominios
            .iter()
            .filter(|(o, _)| o == org)
            .map(|(_, d)| d.clone())
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn org(id: &str) -> Org {
        Org::nova(OrgId(id.into()), BTreeSet::from([format!("{id}.com")]), None)
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

    fn membro(uid: &str, papel: Papel) -> Membro {
        Membro {
            uid: UserId(uid.into()),
            nome: format!("Nome {uid}"),
            email: format!("{uid}@acme.com"),
            papel,
        }
    }

    #[test]
    fn membros_lista_por_org_e_isola_entre_orgs() {
        let mut a = ArmazemMembroMemoria::novo();
        a.inserir(OrgId("acme".into()), membro("u1", Papel::OrgAdmin));
        a.inserir(OrgId("acme".into()), membro("u2", Papel::Member));
        a.inserir(OrgId("globex".into()), membro("u3", Papel::Member));

        let acme: Vec<_> = a.listar(&OrgId("acme".into())).unwrap().into_iter().map(|m| m.uid).collect();
        assert_eq!(acme, vec![UserId("u1".into()), UserId("u2".into())]);
        // ISOLAMENTO: listar uma org não vaza membros de outra (base do 404 de recurso alheio).
        let globex: Vec<_> = a.listar(&OrgId("globex".into())).unwrap().into_iter().map(|m| m.uid).collect();
        assert_eq!(globex, vec![UserId("u3".into())]);
    }

    #[test]
    fn org_sem_membros_e_vec_vazio_nao_erro() {
        let a = ArmazemMembroMemoria::novo();
        // Org sem membros (ou cuja visibilidade já foi decidida antes) ⇒ lista vazia, NÃO Err.
        assert_eq!(a.listar(&OrgId("nao".into())).unwrap(), vec![]);
    }

    // Mesma amarra do `Result` pro ArmazemMembro (exigência @Altair).
    #[test]
    fn membro_assinatura_carrega_result() {
        let a = ArmazemMembroMemoria::novo();
        let r: Result<Vec<Membro>, ErroArmazem> = a.listar(&OrgId("x".into()));
        assert!(r.is_ok());
    }

    #[test]
    fn orgs_do_usuario_lista_pertencimento_com_papel() {
        let mut a = ArmazemMembroMemoria::novo();
        a.inserir(OrgId("acme".into()), membro("u1", Papel::OrgAdmin));
        a.inserir(OrgId("globex".into()), membro("u1", Papel::Member)); // mesmo user, outra org
        a.inserir(OrgId("acme".into()), membro("u2", Papel::Member)); // outro user

        let orgs = a.orgs_do_usuario(&UserId("u1".into())).unwrap();
        assert_eq!(
            orgs,
            vec![
                (OrgId("acme".into()), Papel::OrgAdmin),
                (OrgId("globex".into()), Papel::Member)
            ],
            "u1 pertence a acme (admin) e globex (member); não vaza a org do u2"
        );
        // Usuário sem pertencimento ⇒ vazio, não erro.
        assert_eq!(a.orgs_do_usuario(&UserId("ninguem".into())).unwrap(), vec![]);
    }

    // #1505/#1620 — `remover_preservando`: tira o membro certo (por org+uid), é escopado, e reporta
    // o desfecho. Aqui os alvos NÃO são o papel protegido ⇒ a guarda não dispara (mecânica de remoção).
    #[test]
    fn remover_tira_o_membro_certo_e_reporta() {
        let mut a = ArmazemMembroMemoria::novo();
        a.inserir(OrgId("acme".into()), membro("u1", Papel::Member));
        a.inserir(OrgId("acme".into()), membro("u2", Papel::Member));
        a.inserir(OrgId("globex".into()), membro("u1", Papel::Member)); // mesmo uid, outra org

        let d = a.remover_preservando(&OrgId("acme".into()), &UserId("u1".into()), Papel::OrgAdmin).unwrap();
        assert!(matches!(d, MutacaoMembro::Feita(m) if m.uid == UserId("u1".into())), "removeu u1 de acme");
        // u1 saiu de acme MAS continua em globex (escopo por org).
        let acme: Vec<_> = a.listar(&OrgId("acme".into())).unwrap().into_iter().map(|m| m.uid.0).collect();
        assert_eq!(acme, vec!["u2".to_string()], "só u2 fica em acme");
        assert_eq!(a.listar(&OrgId("globex".into())).unwrap().len(), 1, "u1 continua em globex");
        // remover de novo ⇒ NaoEraMembro (já não estava).
        let d2 = a.remover_preservando(&OrgId("acme".into()), &UserId("u1".into()), Papel::OrgAdmin).unwrap();
        assert_eq!(d2, MutacaoMembro::NaoEraMembro, "não removeu (já saíra)");
    }

    // #1505/#1620 — `mudar_papel_preservando`: muda e devolve o membro; não-membro ⇒ NaoEraMembro.
    // Promover Member→OrgAdmin não reduz a contagem de admin ⇒ a guarda passa.
    #[test]
    fn mudar_papel_muda_e_reporta_ausente() {
        let mut a = ArmazemMembroMemoria::novo();
        a.inserir(OrgId("acme".into()), membro("u1", Papel::Member));

        let d = a
            .mudar_papel_preservando(&OrgId("acme".into()), &UserId("u1".into()), Papel::OrgAdmin, Papel::OrgAdmin)
            .unwrap();
        assert!(matches!(d, MutacaoMembro::Feita(m) if m.papel == Papel::OrgAdmin), "devolve o membro com papel novo");
        assert_eq!(a.listar(&OrgId("acme".into())).unwrap()[0].papel, Papel::OrgAdmin, "persistiu");
        // não-membro ⇒ NaoEraMembro (o handler ⇒ 404).
        let d2 = a
            .mudar_papel_preservando(&OrgId("acme".into()), &UserId("fantasma".into()), Papel::Member, Papel::OrgAdmin)
            .unwrap();
        assert_eq!(d2, MutacaoMembro::NaoEraMembro);
    }

    // #1620 — a GUARDA org-não-órfã, ATÓMICA, no store: recusa remover/rebaixar o ÚLTIMO do papel
    // protegido; passa quando há OUTROS. O `papel_esvaziado` volta na variante (barreira à conflação).
    #[test]
    fn guarda_recusa_o_ultimo_do_papel_protegido() {
        let mut a = ArmazemMembroMemoria::novo();
        a.inserir(OrgId("acme".into()), membro("chefe", Papel::OrgAdmin)); // único admin
        a.inserir(OrgId("acme".into()), membro("ze", Papel::Member));

        // remover o último admin ⇒ Recusada { OrgAdmin }, e NADA muta.
        let d = a.remover_preservando(&OrgId("acme".into()), &UserId("chefe".into()), Papel::OrgAdmin).unwrap();
        assert_eq!(d, MutacaoMembro::Recusada { papel_esvaziado: Papel::OrgAdmin });
        assert_eq!(a.listar(&OrgId("acme".into())).unwrap().len(), 2, "recusa não muta");
        // rebaixar o último admin ⇒ idem.
        let d = a
            .mudar_papel_preservando(&OrgId("acme".into()), &UserId("chefe".into()), Papel::Member, Papel::OrgAdmin)
            .unwrap();
        assert_eq!(d, MutacaoMembro::Recusada { papel_esvaziado: Papel::OrgAdmin });
        assert_eq!(a.listar(&OrgId("acme".into())).unwrap()[0].papel, Papel::OrgAdmin, "recusa não rebaixa");

        // com DOIS admins, remover um passa (sobra um) — senão a guarda seria "recusa sempre".
        a.inserir(OrgId("acme".into()), membro("vice", Papel::OrgAdmin));
        let d = a.remover_preservando(&OrgId("acme".into()), &UserId("chefe".into()), Papel::OrgAdmin).unwrap();
        assert!(matches!(d, MutacaoMembro::Feita(_)), "com dois admins, remover um passa");
    }

    // #1620 DoD (exigência do @Altair): o teste que prova a ATOMICIDADE — chama o STORE DIRETAMENTE
    // (sem passar pela autz), com DUAS remoções concorrentes do MESMO org de 2 admins. A invariante
    // exige que NO MÁXIMO uma vença: a org NUNCA fica com zero admin. É o teste que falha se alguém
    // apagar o primitivo `_preservando` "redundante" daqui a 3 meses (a guarda só na borda passaria).
    #[test]
    fn duas_remocoes_concorrentes_nao_orfanam_a_org() {
        use std::sync::Arc;
        use std::thread;

        // Muitas repetições: a corrida é probabilística; uma janela aberta aparece com N tentativas.
        for _ in 0..500 {
            let mut seed = ArmazemMembroMemoria::novo();
            seed.inserir(OrgId("acme".into()), membro("a1", Papel::OrgAdmin));
            seed.inserir(OrgId("acme".into()), membro("a2", Papel::OrgAdmin));
            let store = Arc::new(seed);

            // Duas threads removem admins DIFERENTES ao mesmo tempo (o pior caso: cada uma vê 2 admins).
            let s1 = Arc::clone(&store);
            let s2 = Arc::clone(&store);
            let t1 = thread::spawn(move || {
                s1.remover_preservando(&OrgId("acme".into()), &UserId("a1".into()), Papel::OrgAdmin).unwrap()
            });
            let t2 = thread::spawn(move || {
                s2.remover_preservando(&OrgId("acme".into()), &UserId("a2".into()), Papel::OrgAdmin).unwrap()
            });
            let (r1, r2) = (t1.join().unwrap(), t2.join().unwrap());

            // A INVARIANTE: sobra ≥ 1 admin, sempre. Exatamente uma remoção vence; a outra é Recusada.
            let admins = store
                .listar(&OrgId("acme".into()))
                .unwrap()
                .iter()
                .filter(|m| m.papel == Papel::OrgAdmin)
                .count();
            assert!(admins >= 1, "a org NUNCA pode ficar sem admin (r1={r1:?}, r2={r2:?})");
            let recusadas = [&r1, &r2]
                .iter()
                .filter(|d| matches!(d, MutacaoMembro::Recusada { .. }))
                .count();
            // 0 recusadas só é válido se as duas não competiam — mas aqui competem (2 admins, tira 2):
            // uma TEM de ser recusada, senão as duas mutaram e orfanaram.
            assert_eq!(recusadas, 1, "sob corrida real, exatamente uma vence (r1={r1:?}, r2={r2:?})");
        }
    }

    fn dom(nome: &str, estado: EstadoDominio) -> Dominio {
        Dominio { dominio: nome.into(), estado }
    }

    #[test]
    fn dominios_lista_por_org_com_estado_e_isola() {
        let mut a = ArmazemDominioMemoria::novo();
        a.inserir(OrgId("acme".into()), dom("acme.com", EstadoDominio::Verificado));
        a.inserir(OrgId("acme".into()), dom("acme.io", EstadoDominio::Pendente));
        a.inserir(OrgId("globex".into()), dom("globex.com", EstadoDominio::Verificado));

        let acme = a.listar(&OrgId("acme".into())).unwrap();
        assert_eq!(acme.len(), 2);
        assert_eq!(acme[0], dom("acme.com", EstadoDominio::Verificado));
        assert_eq!(acme[1].estado, EstadoDominio::Pendente);
        // ISOLAMENTO entre orgs (base do 404 de recurso alheio).
        let globex = a.listar(&OrgId("globex".into())).unwrap();
        assert_eq!(globex.len(), 1);
    }

    #[test]
    fn org_sem_dominios_e_vec_vazio() {
        let a = ArmazemDominioMemoria::novo();
        assert_eq!(a.listar(&OrgId("x".into())).unwrap(), vec![]);
    }

    #[test]
    fn dominio_assinatura_carrega_result() {
        let a = ArmazemDominioMemoria::novo();
        let r: Result<Vec<Dominio>, ErroArmazem> = a.listar(&OrgId("x".into()));
        assert!(r.is_ok());
    }
}
