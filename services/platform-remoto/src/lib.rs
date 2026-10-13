//! Configuração do Remote guardada pela plataforma — #1683 (épico #1265), modelo da "VERSÃO ÚNICA"
//! (13/10: catálogo da @Mira + as decisões do @Altair). A especificação de referência é o RustDesk,
//! **build-not-copy** (AGPL, #1715): tira-se o modelo, nunca o código.
//!
//! ⚠️ **Guarda, não aplica.** Nada aqui chega às sessões Remote: quem aplica é a ponte #1729
//! (adiada até ao #1165). A UI do #1472 di-lo por escrito ("salvo, ainda não aplicado").
//!
//! Três superfícies, três donos (desenho do Altair; conflá-las é a armadilha):
//! - **Concessão** ([`ConcessaoDeAcesso`]): da ORG, quem pode ligar-se a que device e com que
//!   capacidades. Nasce VAZIA, e é aqui que vive o default-deny do que é permitido.
//! - **Teto da org** ([`PoliticaSessaoRemota`]): da ORG, o máximo que qualquer concessão pode dar, mais
//!   as regras da sessão. Default = "o mais fechado que ainda funciona" (regra única do Altair).
//! - **Restrição do device** ([`RestricaoDispositivo`]): do DONO, via `/me`. Só RESTRINGE, nunca alarga.
//!
//! **Capacidades efetivas** de uma ligação u→d ([`capacidades_efetivas`]) =
//! `(∪ das concessões ativas de u sobre d) ∩ teto da org ∩ restrição do dono de d ∩ pedido`.
//!
//! O OBJETO de uma concessão é um [`DeviceId`] OPACO, cuja existência e dono a plataforma **não**
//! verifica: não há registo de devices aqui (o `device_id` vive no `remote-net`). A conferência "o
//! device é da org da concessão" é da ponte, onde a matrícula liga device → dono → org (decisão do
//! Altair, #1683 comment 6137098546, com os ACs registados no #1729). Bónus: não verificar a
//! existência não cria um oráculo de enumeração de devices.

#![forbid(unsafe_code)]

use std::collections::HashMap;
use std::sync::Mutex;

pub use galaxie_remote_capabilities::Capabilities;
use galaxie_platform_identity::{OrgId, UserId};

// ---------------------------------------------------------------------------------------------------
// DeviceId
// ---------------------------------------------------------------------------------------------------

/// Identificador de um device do Remote — o MESMO `device_id` que o `remote-net` matricula, para a
/// ponte (#1729) casar sem tradução. Opaco: a plataforma não sabe se existe nem de quem é.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DeviceId(String);

/// O `device_id` não tem a forma aceite pelo `remote-net`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeviceIdInvalido;

impl DeviceId {
    /// Valida pela **mesma regra** do `remote-net` (`services/remote-net/src/authority.rs`, `fn
    /// validate_id`, @Altair): 1 a 128 BYTES, só alfanumérico ASCII e `- _ . : @`. Copiada, não
    /// importada (o `remote-net` puxa o stack de rede); se a fonte mudar, o teste de fronteira daqui
    /// tem de mudar junto — é o sinal de que as duas divergiram.
    pub fn novo(valor: &str) -> Result<Self, DeviceIdInvalido> {
        let forma_ok = (1..=128).contains(&valor.len())
            && valor
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':' | b'@'));
        if forma_ok {
            Ok(DeviceId(valor.to_string()))
        } else {
            Err(DeviceIdInvalido)
        }
    }

    #[must_use]
    pub fn como_str(&self) -> &str {
        &self.0
    }
}

// ---------------------------------------------------------------------------------------------------
// Capacidades — união/interseção com o vocabulário FECHADO
// ---------------------------------------------------------------------------------------------------

/// As 5 capacidades ligadas — o elemento neutro da interseção ("sem restrição adicional").
#[must_use]
pub fn todas() -> Capabilities {
    Capabilities { screen: true, input: true, file_transfer: true, clipboard: true, audio: true }
}

/// Nenhuma capacidade — o elemento neutro da união (e o ponto de partida de uma concessão).
#[must_use]
pub fn nenhuma() -> Capabilities {
    Capabilities::default()
}

/// Campo a campo `a ∩ b`. ⚠️ **Canário do vocabulário (AC6) no nível do TIPO:** desestrutura os 5
/// campos SEM `..`. Se o `Capabilities` ganhar um campo, isto deixa de compilar até alguém decidir o
/// que ele significa no teto e na concessão — o painel nunca expõe um campo que o ticket não aplica.
#[must_use]
pub fn intersecao(a: Capabilities, b: Capabilities) -> Capabilities {
    let Capabilities { screen, input, file_transfer, clipboard, audio } = a;
    Capabilities {
        screen: screen && b.screen,
        input: input && b.input,
        file_transfer: file_transfer && b.file_transfer,
        clipboard: clipboard && b.clipboard,
        audio: audio && b.audio,
    }
}

/// Campo a campo `a ∪ b` (as concessões só somam — axioma "só união" do `platform-concessao`).
/// Mesmo canário do [`intersecao`].
#[must_use]
pub fn uniao(a: Capabilities, b: Capabilities) -> Capabilities {
    let Capabilities { screen, input, file_transfer, clipboard, audio } = a;
    Capabilities {
        screen: screen || b.screen,
        input: input || b.input,
        file_transfer: file_transfer || b.file_transfer,
        clipboard: clipboard || b.clipboard,
        audio: audio || b.audio,
    }
}

// ---------------------------------------------------------------------------------------------------
// Tipos do modelo
// ---------------------------------------------------------------------------------------------------

/// Id de uma concessão, gerado pelo servidor (nunca vem do cliente).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConcessaoId(pub String);

/// QUEM recebe a concessão. Enum FECHADO: grupos de utilizadores (D2, decisão do PO) entram como
/// variante nova, e o `match` exaustivo obriga a decidir a sua pertença quando entrarem.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SujeitoRemoto {
    Utilizador(UserId),
}

/// SOBRE O QUÊ. Enum FECHADO: grupos de devices (D2) entram como variante nova.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ObjetoRemoto {
    Dispositivo(DeviceId),
}

/// Uma concessão de acesso remoto, org-scoped (§2 da versão única).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConcessaoDeAcesso {
    pub id: ConcessaoId,
    pub org: OrgId,
    pub sujeito: SujeitoRemoto,
    pub objeto: ObjetoRemoto,
    /// O que ESTA ligação pode fazer (menor privilégio: "o suporte só vê o PC da Ana").
    pub capacidades: Capabilities,
    pub concedida_por: UserId,
    pub concedida_em: u64,
    /// `Some` = revogada. Revogar é SEMPRE permitido (AC5) e é idempotente: o 1.º instante fica.
    pub revogada_em: Option<u64>,
}

impl ConcessaoDeAcesso {
    #[must_use]
    pub fn ativa(&self) -> bool {
        self.revogada_em.is_none()
    }
}

/// Os dados de uma concessão nova (o servidor acrescenta `id`, `org` e `revogada_em`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NovaConcessao {
    pub sujeito: SujeitoRemoto,
    pub objeto: ObjetoRemoto,
    pub capacidades: Capabilities,
    pub concedida_por: UserId,
    pub concedida_em: u64,
}

/// Como o dono do device aprova uma sessão (consentimento na app do host — o ponto de aplicação
/// existe: `session.request`/`accept`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModoAprovacao {
    Clique,
    Senha,
    SenhaOuClique,
}

/// O teto da org (session-policy, §3). Cada campo é uma RESTRIÇÃO: um campo que alargasse o que as
/// concessões dão não entra. `desligar_por_inatividade` e `expira_em` ficaram FORA do v1 (sem ponto de
/// aplicação / aditivos — D4/D5 do PO).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PoliticaSessaoRemota {
    /// O máximo que qualquer concessão pode dar. Aplicação: grant da matrícula → `CapabilityPolicy`
    /// do transporte (o aplicador existe; o que o alimenta é a ponte #1729).
    pub capacidades_maximas: Capabilities,
    /// Aplicação: consentimento na app do host (existe).
    pub modo_aprovacao: ModoAprovacao,
    /// Sessões não supervisionadas (senha permanente). Aplicação: `remote-net::UnattendedAuthority` +
    /// signaling v2 — o mecanismo existe, o check da política é da ponte #1729.
    pub permitir_nao_supervisionado: bool,
}

impl Default for PoliticaSessaoRemota {
    /// **"O mais fechado que AINDA funciona sem configurar outra camada"** (regra única do Altair).
    /// `capacidades_maximas` = as 5 (neutro): fechá-las não acrescenta segurança, porque sem concessão
    /// nada passa — só obrigava o admin a configurar duas camadas antes de qualquer coisa funcionar.
    fn default() -> Self {
        PoliticaSessaoRemota {
            capacidades_maximas: todas(),
            modo_aprovacao: ModoAprovacao::Clique,
            permitir_nao_supervisionado: false,
        }
    }
}

/// A restrição que o DONO põe no seu device (via `/me`). Só restringe: entra por interseção.
///
/// ⚠️ **Chave = (dono, device)** — e a ponte TEM de a aplicar pela MESMA chave (AC do #1729, @Altair):
/// se a procurasse só pelo `device_id`, qualquer utilizador estrangulava o device de um colega (DoS por
/// restrição), porque o `device_id` não é verificado. Com a chave do dono, a restrição de quem não é
/// dono fica inerte.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestricaoDispositivo {
    pub dono: UserId,
    pub dispositivo: DeviceId,
    pub capacidades: Capabilities,
}

// ---------------------------------------------------------------------------------------------------
// Resolução
// ---------------------------------------------------------------------------------------------------

/// Capacidades EFETIVAS de uma ligação: `(∪ das concessões ATIVAS) ∩ teto ∩ restrição do dono ∩
/// pedido`. Sem concessão ativa ⇒ nenhuma (default-deny). Sem restrição ⇒ a do dono é neutra
/// ([`todas`]). Revogadas não contam. É a semântica que a ponte #1729 aplicará; aqui fica definida e
/// testada, para o painel mostrar o efeito sem a reinventar.
#[must_use]
pub fn capacidades_efetivas(
    concessoes: &[&ConcessaoDeAcesso],
    teto: &PoliticaSessaoRemota,
    restricao_do_dono: Option<&RestricaoDispositivo>,
    pedido: Capabilities,
) -> Capabilities {
    let concedido = concessoes
        .iter()
        .filter(|c| c.ativa())
        .fold(nenhuma(), |acc, c| uniao(acc, c.capacidades));
    let restricao = restricao_do_dono.map_or_else(todas, |r| r.capacidades);
    intersecao(intersecao(intersecao(concedido, teto.capacidades_maximas), restricao), pedido)
}

// ---------------------------------------------------------------------------------------------------
// Armazéns
// ---------------------------------------------------------------------------------------------------

/// Teto de concessões por org. O endpoint é de admin, mas um armazém sem teto é a família "buffer que
/// ninguém drena"; 10 000 sobra para qualquer org real.
pub const MAX_CONCESSOES_POR_ORG: usize = 10_000;
/// Teto de restrições por DONO. A rota `/me` está aberta a qualquer utilizador autenticado e o
/// `device_id` não é verificado — sem teto, um utilizador cresceria o mapa à vontade. Uma pessoa tem
/// poucos devices; 64 sobra.
pub const MAX_RESTRICOES_POR_DONO: usize = 64;

/// Falha de um armazém do Remote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErroRemoto {
    /// Infra fora do ar (a borda decide 404/500 pelo contexto, como no resto da plataforma).
    Indisponivel,
    /// O teto ([`MAX_CONCESSOES_POR_ORG`] / [`MAX_RESTRICOES_POR_DONO`]) foi atingido.
    LimiteAtingido,
}

/// O teto da org. `obter` de uma org sem teto gravado devolve o [`Default`] (a regra única).
pub trait ArmazemPoliticaRemota {
    fn obter(&self, org: &OrgId) -> Result<PoliticaSessaoRemota, ErroRemoto>;
    fn definir(&self, org: &OrgId, politica: PoliticaSessaoRemota) -> Result<(), ErroRemoto>;
}

/// As concessões, sempre por (org, id): uma concessão de outra org é "inexistente" (404 na borda).
pub trait ArmazemConcessoesRemotas {
    fn listar(&self, org: &OrgId) -> Result<Vec<ConcessaoDeAcesso>, ErroRemoto>;
    fn conceder(&self, org: &OrgId, nova: NovaConcessao) -> Result<ConcessaoDeAcesso, ErroRemoto>;
    /// `Ok(None)` = não existe NESTA org. Idempotente: revogar outra vez mantém o 1.º instante.
    fn revogar(
        &self,
        org: &OrgId,
        id: &ConcessaoId,
        agora: u64,
    ) -> Result<Option<ConcessaoDeAcesso>, ErroRemoto>;
}

/// As restrições, sempre por DONO (o utilizador da sessão).
pub trait ArmazemRestricoesDispositivo {
    fn do_dono(&self, dono: &UserId) -> Result<Vec<RestricaoDispositivo>, ErroRemoto>;
    fn definir(
        &self,
        dono: &UserId,
        dispositivo: DeviceId,
        capacidades: Capabilities,
    ) -> Result<RestricaoDispositivo, ErroRemoto>;
    /// `Ok(false)` = não havia restrição desse dono para esse device.
    fn remover(&self, dono: &UserId, dispositivo: &DeviceId) -> Result<bool, ErroRemoto>;
}

/// Teto em memória (como os outros armazéns da plataforma hoje).
#[derive(Debug, Default)]
pub struct PoliticaRemotaMemoria {
    mapa: Mutex<HashMap<OrgId, PoliticaSessaoRemota>>,
}

impl ArmazemPoliticaRemota for PoliticaRemotaMemoria {
    fn obter(&self, org: &OrgId) -> Result<PoliticaSessaoRemota, ErroRemoto> {
        let mapa = self.mapa.lock().map_err(|_| ErroRemoto::Indisponivel)?;
        Ok(mapa.get(org).copied().unwrap_or_default())
    }
    fn definir(&self, org: &OrgId, politica: PoliticaSessaoRemota) -> Result<(), ErroRemoto> {
        let mut mapa = self.mapa.lock().map_err(|_| ErroRemoto::Indisponivel)?;
        mapa.insert(org.clone(), politica);
        Ok(())
    }
}

/// Concessões em memória.
#[derive(Debug, Default)]
pub struct ConcessoesRemotasMemoria {
    estado: Mutex<EstadoConcessoes>,
}

#[derive(Debug, Default)]
struct EstadoConcessoes {
    por_org: HashMap<OrgId, Vec<ConcessaoDeAcesso>>,
    seq: u64,
}

impl ArmazemConcessoesRemotas for ConcessoesRemotasMemoria {
    fn listar(&self, org: &OrgId) -> Result<Vec<ConcessaoDeAcesso>, ErroRemoto> {
        let e = self.estado.lock().map_err(|_| ErroRemoto::Indisponivel)?;
        Ok(e.por_org.get(org).cloned().unwrap_or_default())
    }
    fn conceder(&self, org: &OrgId, nova: NovaConcessao) -> Result<ConcessaoDeAcesso, ErroRemoto> {
        let mut e = self.estado.lock().map_err(|_| ErroRemoto::Indisponivel)?;
        if e.por_org.get(org).map_or(0, Vec::len) >= MAX_CONCESSOES_POR_ORG {
            return Err(ErroRemoto::LimiteAtingido);
        }
        e.seq += 1;
        let c = ConcessaoDeAcesso {
            id: ConcessaoId(format!("cr-{}", e.seq)),
            org: org.clone(),
            sujeito: nova.sujeito,
            objeto: nova.objeto,
            capacidades: nova.capacidades,
            concedida_por: nova.concedida_por,
            concedida_em: nova.concedida_em,
            revogada_em: None,
        };
        e.por_org.entry(org.clone()).or_default().push(c.clone());
        Ok(c)
    }
    fn revogar(
        &self,
        org: &OrgId,
        id: &ConcessaoId,
        agora: u64,
    ) -> Result<Option<ConcessaoDeAcesso>, ErroRemoto> {
        let mut e = self.estado.lock().map_err(|_| ErroRemoto::Indisponivel)?;
        let Some(c) = e.por_org.get_mut(org).and_then(|v| v.iter_mut().find(|c| &c.id == id)) else {
            return Ok(None);
        };
        if c.revogada_em.is_none() {
            c.revogada_em = Some(agora);
        }
        Ok(Some(c.clone()))
    }
}

/// Restrições em memória.
#[derive(Debug, Default)]
pub struct RestricoesDispositivoMemoria {
    por_dono: Mutex<HashMap<UserId, Vec<RestricaoDispositivo>>>,
}

impl ArmazemRestricoesDispositivo for RestricoesDispositivoMemoria {
    fn do_dono(&self, dono: &UserId) -> Result<Vec<RestricaoDispositivo>, ErroRemoto> {
        let m = self.por_dono.lock().map_err(|_| ErroRemoto::Indisponivel)?;
        Ok(m.get(dono).cloned().unwrap_or_default())
    }
    fn definir(
        &self,
        dono: &UserId,
        dispositivo: DeviceId,
        capacidades: Capabilities,
    ) -> Result<RestricaoDispositivo, ErroRemoto> {
        let mut m = self.por_dono.lock().map_err(|_| ErroRemoto::Indisponivel)?;
        let lista = m.entry(dono.clone()).or_default();
        if let Some(r) = lista.iter_mut().find(|r| r.dispositivo == dispositivo) {
            r.capacidades = capacidades;
            return Ok(r.clone());
        }
        if lista.len() >= MAX_RESTRICOES_POR_DONO {
            return Err(ErroRemoto::LimiteAtingido);
        }
        let r = RestricaoDispositivo { dono: dono.clone(), dispositivo, capacidades };
        lista.push(r.clone());
        Ok(r)
    }
    fn remover(&self, dono: &UserId, dispositivo: &DeviceId) -> Result<bool, ErroRemoto> {
        let mut m = self.por_dono.lock().map_err(|_| ErroRemoto::Indisponivel)?;
        let Some(lista) = m.get_mut(dono) else { return Ok(false) };
        let antes = lista.len();
        lista.retain(|r| &r.dispositivo != dispositivo);
        Ok(lista.len() != antes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev(s: &str) -> DeviceId {
        DeviceId::novo(s).expect("device id válido")
    }

    fn caps(screen: bool, input: bool, file_transfer: bool, clipboard: bool, audio: bool) -> Capabilities {
        Capabilities { screen, input, file_transfer, clipboard, audio }
    }

    fn concessao(capacidades: Capabilities, revogada: bool) -> ConcessaoDeAcesso {
        ConcessaoDeAcesso {
            id: ConcessaoId("cr-1".into()),
            org: OrgId("orgA".into()),
            sujeito: SujeitoRemoto::Utilizador(UserId("u1".into())),
            objeto: ObjetoRemoto::Dispositivo(dev("pc-ana")),
            capacidades,
            concedida_por: UserId("admin".into()),
            concedida_em: 1,
            revogada_em: revogada.then_some(2),
        }
    }

    #[test]
    fn device_id_segue_a_regra_do_remote_net_nas_fronteiras() {
        // A MESMA regra do `remote-net::authority::validate_id` (@Altair): 1..=128 bytes, alfanumérico
        // ASCII + `- _ . : @`. Fronteiras: vazio, 128, 129, e caracteres fora.
        assert_eq!(DeviceId::novo(""), Err(DeviceIdInvalido), "vazio");
        assert!(DeviceId::novo(&"a".repeat(128)).is_ok(), "128 bytes passa");
        assert_eq!(DeviceId::novo(&"a".repeat(129)), Err(DeviceIdInvalido), "129 bytes não");
        assert!(DeviceId::novo("pc-ana_01.lab:1@org").is_ok(), "todos os separadores permitidos");
        for fora in ["pc ana", "pc/ana", "pc#1", "pçana", "pc\nana", "pc%20"] {
            assert_eq!(DeviceId::novo(fora), Err(DeviceIdInvalido), "{fora:?} está fora do alfabeto");
        }
    }

    #[test]
    fn teto_por_omissao_e_o_mais_fechado_que_ainda_funciona() {
        let t = PoliticaSessaoRemota::default();
        assert_eq!(t.capacidades_maximas, todas(), "o teto nasce neutro (sem concessão nada passa)");
        assert_eq!(t.modo_aprovacao, ModoAprovacao::Clique);
        assert!(!t.permitir_nao_supervisionado);
    }

    #[test]
    fn sem_concessao_nada_passa_mesmo_com_teto_aberto() {
        let efetivas = capacidades_efetivas(&[], &PoliticaSessaoRemota::default(), None, todas());
        assert_eq!(efetivas, nenhuma(), "default-deny vive nas concessões");
    }

    #[test]
    fn efetivas_e_a_intersecao_das_camadas_e_o_device_so_restringe() {
        let c = concessao(caps(true, true, true, false, false), false); // screen+input+ficheiros
        let teto = PoliticaSessaoRemota { capacidades_maximas: caps(true, true, false, true, true), ..Default::default() };
        let restricao = RestricaoDispositivo {
            dono: UserId("ana".into()),
            dispositivo: dev("pc-ana"),
            capacidades: caps(true, false, true, true, true), // a Ana não deixa input
        };
        let e = capacidades_efetivas(&[&c], &teto, Some(&restricao), todas());
        assert_eq!(e, caps(true, false, false, false, false), "concessão ∩ teto ∩ restrição");
        // O device só RESTRINGE: uma restrição "toda aberta" não acrescenta o que a concessão não dá.
        let aberta = RestricaoDispositivo { capacidades: todas(), ..restricao };
        let e2 = capacidades_efetivas(&[&c], &PoliticaSessaoRemota::default(), Some(&aberta), todas());
        assert_eq!(e2, c.capacidades, "restrição aberta não alarga a concessão");
    }

    #[test]
    fn concessoes_somam_e_revogadas_nao_contam() {
        let so_ver = concessao(caps(true, false, false, false, false), false);
        let input = concessao(caps(false, true, false, false, false), false);
        let revogada = concessao(caps(false, false, true, true, true), true);
        let e = capacidades_efetivas(&[&so_ver, &input, &revogada], &PoliticaSessaoRemota::default(), None, todas());
        assert_eq!(e, caps(true, true, false, false, false), "união das ativas; a revogada não conta");
    }

    #[test]
    fn concessao_e_por_org_e_revogar_e_idempotente() {
        let a = ConcessoesRemotasMemoria::default();
        let org_a = OrgId("orgA".into());
        let org_b = OrgId("orgB".into());
        let c = a
            .conceder(
                &org_a,
                NovaConcessao {
                    sujeito: SujeitoRemoto::Utilizador(UserId("u1".into())),
                    objeto: ObjetoRemoto::Dispositivo(dev("pc-ana")),
                    capacidades: caps(true, false, false, false, false),
                    concedida_por: UserId("admin".into()),
                    concedida_em: 10,
                },
            )
            .unwrap();
        assert!(c.ativa());
        // Outra org não vê nem revoga a concessão (é "inexistente" para ela).
        assert!(a.listar(&org_b).unwrap().is_empty());
        assert_eq!(a.revogar(&org_b, &c.id, 20).unwrap(), None);
        // Revogar na própria org; revogar outra vez mantém o 1.º instante.
        assert_eq!(a.revogar(&org_a, &c.id, 20).unwrap().unwrap().revogada_em, Some(20));
        assert_eq!(a.revogar(&org_a, &c.id, 99).unwrap().unwrap().revogada_em, Some(20));
    }

    #[test]
    fn restricao_e_por_dono_e_tem_teto() {
        let r = RestricoesDispositivoMemoria::default();
        let ana = UserId("ana".into());
        let bruno = UserId("bruno".into());
        r.definir(&ana, dev("pc-ana"), caps(true, false, false, false, false)).unwrap();
        // O Bruno pôr uma restrição no MESMO device_id não toca na da Ana (chave = dono + device).
        r.definir(&bruno, dev("pc-ana"), nenhuma()).unwrap();
        assert_eq!(r.do_dono(&ana).unwrap()[0].capacidades, caps(true, false, false, false, false));
        // Redefinir o mesmo device atualiza, não duplica.
        r.definir(&ana, dev("pc-ana"), todas()).unwrap();
        assert_eq!(r.do_dono(&ana).unwrap().len(), 1);
        // Teto por dono: o 65.º device novo é recusado.
        for i in 1..MAX_RESTRICOES_POR_DONO {
            r.definir(&ana, dev(&format!("pc-{i}")), todas()).unwrap();
        }
        assert_eq!(r.do_dono(&ana).unwrap().len(), MAX_RESTRICOES_POR_DONO);
        assert_eq!(r.definir(&ana, dev("um-a-mais"), todas()), Err(ErroRemoto::LimiteAtingido));
        assert!(r.remover(&ana, &dev("pc-ana")).unwrap());
        assert!(!r.remover(&ana, &dev("pc-ana")).unwrap(), "remover outra vez = não havia");
    }

    #[test]
    fn teto_gravado_substitui_o_default_so_na_propria_org() {
        let p = PoliticaRemotaMemoria::default();
        let org_a = OrgId("orgA".into());
        let fechado = PoliticaSessaoRemota { capacidades_maximas: nenhuma(), ..Default::default() };
        p.definir(&org_a, fechado).unwrap();
        assert_eq!(p.obter(&org_a).unwrap(), fechado);
        assert_eq!(p.obter(&OrgId("orgB".into())).unwrap(), PoliticaSessaoRemota::default());
    }
}
