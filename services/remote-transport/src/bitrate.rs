//! Controle de bitrate adaptativo — a camada PURA entre o estimador de banda
//! (o BWE/GCC do str0m) e o encoder. Recebe estimativas de banda e decide QUANDO
//! vale um comando de mudança pro encoder, com HISTERESE pra não oscilar a cada
//! amostra. NÃO depende de str0m/openh264 — 100% determinístico e testável, e por
//! isso fica no núcleo (o `cargo test` default do CI o exercita sem OpenSSL).
//!
//! Filosofia (assimetria proposital):
//! - **Descer é urgente** (o link estreitou → a fila estoura): aplica na hora.
//! - **Subir é cauteloso** (só com folga SUSTENTADA): exige N amostras seguidas
//!   de banda sobrando antes de UMA subida — senão um pico transiente empurraria
//!   o bitrate pra cima e a próxima perda derrubaria de novo (oscilação).

/// Numerador/denominador da histerese: só reage quando o alvo difere do atual em
/// pelo menos 10% (`atual/10`). Abaixo disso é micro-oscilação → ignora.
const HISTERESE_DEN: u32 = 10;

/// Amostras consecutivas de folga necessárias antes de UMA subida.
const AMOSTRAS_PARA_SUBIR: u32 = 3;

/// Decide o bitrate-alvo do encoder a partir das estimativas de banda do BWE.
/// Mantém o último valor comandado (`atual`) e só emite um novo comando quando a
/// mudança vale a pena (histerese + debounce de subida).
#[derive(Debug, Clone)]
pub struct AplicadorBitrate {
    min: u32,
    max: u32,
    atual: u32,
    /// Contador de amostras seguidas de folga (zera a cada não-folga).
    folga_consecutiva: u32,
}

impl AplicadorBitrate {
    /// Cria o aplicador. `inicial` é fixado (clamp) dentro de `[min, max]`; o
    /// encoder deve começar exatamente nesse valor (conservador) e o BWE sobe daí.
    #[must_use]
    pub fn novo(min: u32, max: u32, inicial: u32) -> Self {
        let min = min.max(1);
        let max = max.max(min);
        let atual = inicial.clamp(min, max);
        Self {
            min,
            max,
            atual,
            folga_consecutiva: 0,
        }
    }

    /// Bitrate atualmente comandado (bps).
    #[must_use]
    pub fn atual(&self) -> u32 {
        self.atual
    }

    /// Processa uma estimativa de banda (bps) e devolve `Some(novo_alvo)` SÓ se
    /// valer um comando pro encoder; `None` quando a mudança não passa a histerese
    /// (não oscila a cada amostra).
    pub fn aplicar(&mut self, estimativa_bps: u32) -> Option<u32> {
        let alvo = estimativa_bps.clamp(self.min, self.max);
        let margem = self.atual / HISTERESE_DEN; // 10% do atual

        // DESCIDA: queda > 10% OU precisamos alcançar o piso (`min`) mesmo com um
        // passo pequeno. Urgente → aplica já, sem debounce.
        if alvo + margem < self.atual || (alvo == self.min && self.atual > self.min) {
            self.folga_consecutiva = 0;
            if alvo != self.atual {
                self.atual = alvo;
                return Some(self.atual);
            }
            return None;
        }

        // FOLGA: banda sobrando (> 10% acima do atual). Exige N amostras seguidas
        // antes de subir UMA vez — prova a histerese: banda alta constante gera no
        // máximo 1 subida, não uma por amostra.
        if alvo > self.atual + margem {
            self.folga_consecutiva = self.folga_consecutiva.saturating_add(1);
            if self.folga_consecutiva >= AMOSTRAS_PARA_SUBIR {
                self.folga_consecutiva = 0;
                if alvo != self.atual {
                    self.atual = alvo;
                    return Some(self.atual);
                }
            }
            return None;
        }

        // Micro-oscilação dentro da margem: nada a fazer (e zera a folga, pra que
        // subidas exijam folga REALMENTE consecutiva).
        self.folga_consecutiva = 0;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: u32 = 300_000;
    const MAX: u32 = 12_000_000;

    // AC "link estreitando": estimativas decrescentes → a saída DESCE
    // monotonicamente até o `min`.
    #[test]
    fn link_estreitando_desce_monotonico_ate_o_min() {
        let mut ap = AplicadorBitrate::novo(MIN, MAX, 10_000_000);
        let estimativas = [5_000_000, 2_000_000, 800_000, 300_000, 100_000];
        let mut ultimo = ap.atual();
        for est in estimativas {
            if let Some(novo) = ap.aplicar(est) {
                assert!(novo < ultimo, "cada passo deve descer: {novo} < {ultimo}");
                ultimo = novo;
            }
        }
        assert_eq!(ap.atual(), MIN, "deve alcançar o piso");
    }

    // AC "folga sustentada não oscila": N amostras altas iguais geram NO MÁXIMO
    // 1 subida (prova o debounce/histerese), não N.
    #[test]
    fn folga_sustentada_sobe_uma_vez_so() {
        let mut ap = AplicadorBitrate::novo(MIN, MAX, 1_000_000);
        let mut subidas = 0;
        for _ in 0..5 {
            if ap.aplicar(4_000_000).is_some() {
                subidas += 1;
            }
        }
        assert_eq!(subidas, 1, "5 amostras altas iguais → 1 subida só");
        assert_eq!(ap.atual(), 4_000_000);
    }

    // AC clamp no teto e no piso.
    #[test]
    fn clampa_no_teto_e_no_piso() {
        // Teto: estimativa >> max, mesmo sustentada, nunca ultrapassa max.
        let mut ap = AplicadorBitrate::novo(MIN, MAX, 6_000_000);
        let mut ultimo_teto = None;
        for _ in 0..5 {
            if let Some(novo) = ap.aplicar(50_000_000) {
                assert!(novo <= MAX);
                ultimo_teto = Some(novo);
            }
        }
        assert_eq!(ultimo_teto, Some(MAX), "sobe até exatamente o teto");

        // Piso: estimativa << min → desce pro min na hora, nunca abaixo.
        let mut ap = AplicadorBitrate::novo(MIN, MAX, 6_000_000);
        assert_eq!(ap.aplicar(10).unwrap(), MIN);
        assert_eq!(ap.atual(), MIN);
    }

    // AC "não oscila": micro-flutuação em torno do atual → sempre None.
    #[test]
    fn micro_oscilacao_nao_emite_comando() {
        let mut ap = AplicadorBitrate::novo(MIN, MAX, 5_000_000);
        // ±2% em torno de 5 Mbps (histerese é 10%) → nenhum comando.
        for est in [5_100_000, 4_900_000, 5_050_000, 4_950_000, 5_000_000] {
            assert_eq!(ap.aplicar(est), None);
        }
        assert_eq!(ap.atual(), 5_000_000);
    }

    // Folga esporádica (não consecutiva) não acumula pra uma subida indevida.
    #[test]
    fn folga_intercalada_nao_sobe() {
        let mut ap = AplicadorBitrate::novo(MIN, MAX, 2_000_000);
        // alta, estável, alta, estável… a estável (dentro da margem) zera o contador.
        assert_eq!(ap.aplicar(8_000_000), None); // folga=1
        assert_eq!(ap.aplicar(2_000_000), None); // estável → zera
        assert_eq!(ap.aplicar(8_000_000), None); // folga=1
        assert_eq!(ap.aplicar(2_050_000), None); // estável → zera
        assert_eq!(ap.atual(), 2_000_000, "nunca subiu (folga nunca foi sustentada)");
    }
}
