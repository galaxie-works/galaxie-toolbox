// Modo escuro do render de e-mail em iframe — SEM script (#1034, SEC1).
//
// ANTES: o Dark Reader (bundle UMD) era injetado como <script> no srcDoc e o
// iframe precisava de `allow-scripts` no tema escuro. Isso, somado ao
// `allow-same-origin`, anulava o sandbox: um e-mail malicioso podia rodar
// script na origem do app.
//
// AGORA: o iframe é opaque origin (sandbox sem allow-same-origin) e NÃO roda
// script do e-mail (CSP `script-src 'nonce-…'` só libera a nossa ponte de
// medição). A inversão de cores vira CSS PURO — abordagem filter-based, no
// espírito do que o Dark Reader gera, mas sem nenhum JavaScript:
//   - `filter:invert(1) hue-rotate(180deg)` no <html> inverte a página inteira
//     (o baseline é claro, então vira escuro);
//   - o mesmo filtro re-aplicado em mídia (img/vídeo/etc.) as desinverte, pra
//     fotos/logos não ficarem em negativo.
// O ajuste fino do tom é responsabilidade do runtime-QA (é visual).

/**
 * CSS de inversão do tema escuro, injetado como <style> no <head> do srcDoc.
 *
 * O documento é SEMPRE autorado em claro; o escuro nasce só desta inversão —
 * inclusive o botão de dobra (#92), que por isso é autorado claro em
 * `estiloDobra()` e escurece ao ser invertido junto com o resto.
 */
export function estiloInversaoEscuro(): string {
  return (
    // Fundo levemente claro pra, invertido, virar um cinza-escuro de "letterbox"
    // (o body claro do baseline vira preto; o html vira o cinza ao redor).
    `html{filter:invert(1) hue-rotate(180deg);background:#dcdcdc}` +
    // Re-inverte a mídia pra ela voltar às cores reais (dupla inversão = neutro).
    `img,video,picture,svg,canvas,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}`
  );
}
