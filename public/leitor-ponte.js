// Ponte de medicao do leitor de e-mail (#1034 SEC1 / #1278). Arquivo SERVIDO
// pela origem do app — nao `<script>` inline.
//
// POR QUE arquivo, e nao inline (a causa raiz do #1278): o `srcDoc` do leitor
// HERDA a CSP do app. A CSP entregue tem `script-src 'self' 'wasm-unsafe-eval'
// 'sha256-...'` — sem `unsafe-inline` e sem o NOSSO nonce. O `<script nonce>`
// que morava aqui satisfazia a CSP do proprio srcDoc e era barrado pela
// HERDADA: a ponte nunca rodava dentro do app, a altura nunca era postada e o
// leitor ficava preso nos 120px iniciais (medido no app buildado, 2026-08-19).
//
// Servido pela origem do app, ele passa nas DUAS politicas — e o e-mail
// continua sem executar script proprio (a CSP do srcDoc libera SO esta origem).
//
// O fator de zoom inicial (#76) chega por `data-fator` na tag do script; depois
// o pai empurra novos fatores por postMessage, sem recarregar o iframe.
(function () {
  var meuScript = document.currentScript;
  var FATOR = Number(meuScript && meuScript.dataset ? meuScript.dataset.fator : 1);
  if (!isFinite(FATOR) || FATOR <= 0) FATOR = 1;

  var PISO = 0.75, ultAltura = -1, ultLargura = -1, agendado = false;

  function medir() {
    var body = document.body;
    if (!body) return;
    // zoom=1 pra medir a largura natural do conteudo.
    body.style.zoom = "1";
    var conteudo = body.scrollWidth,
      disponivel = document.documentElement.clientWidth;
    var ideal = conteudo > disponivel && conteudo > 0 ? disponivel / conteudo : 1;
    // Piso 0.75 (#57): nunca encolher a ponto de virar ilegivel; excedente rola.
    var base = Math.max(PISO, ideal),
      efetivo = base * FATOR;
    body.style.zoom = String(efetivo);
    var rolaX = conteudo * efetivo > disponivel + 1;
    var h = Math.ceil(body.getBoundingClientRect().height) + 4 + (rolaX ? 16 : 0);
    // So posta se mudou de verdade — quebra o loop resize<->altura.
    if (Math.abs(h - ultAltura) > 1) {
      ultAltura = h;
      parent.postMessage({ tipo: "gt-reader-altura", altura: h }, "*");
    }
  }

  function agendar() {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(function () {
      agendado = false;
      medir();
    });
  }

  window.addEventListener("load", function () {
    medir();
    document.querySelectorAll("img").forEach(function (img) {
      if (!img.complete) img.addEventListener("load", agendar, { once: true });
    });
  });

  // So re-mede quando a LARGURA muda (arrastar o splitter); altura nao, pra nao
  // criar feedback (o pai reajusta a altura do iframe -> dispara resize).
  window.addEventListener("resize", function () {
    var w = document.documentElement.clientWidth;
    if (w !== ultLargura) {
      ultLargura = w;
      medir();
    }
  });

  // Dobra do citado (#92): abrir/fechar muda a altura. `toggle` nao borbulha.
  document.addEventListener("toggle", agendar, true);

  // Conteudo tardio (childList). NAO observa attributes: senao o nosso
  // body.style.zoom re-dispararia o observer num loop.
  new MutationObserver(agendar).observe(document.documentElement, {
    subtree: true,
    childList: true,
  });

  // Link-safety (#91): intercepta o clique e MANDA o destino pro pai decidir.
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a") : null;
    if (!a || !a.href) return;
    e.preventDefault();
    parent.postMessage(
      { tipo: "gt-reader-link", href: a.href, texto: a.textContent || "" },
      "*"
    );
  });

  // Zoom manual (#76): CTRL+roda / CTRL +/-/0 -> manda a INTENCAO pro pai, que e
  // o dono do clamp (ZOOM_MIN/MAX) e devolve o novo fator por postMessage.
  document.addEventListener(
    "wheel",
    function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      parent.postMessage(
        { tipo: "gt-reader-zoom", direcao: e.deltaY < 0 ? 1 : -1 },
        "*"
      );
    },
    { passive: false }
  );

  document.addEventListener("keydown", function (e) {
    if (!e.ctrlKey) return;
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      parent.postMessage({ tipo: "gt-reader-zoom", direcao: 1 }, "*");
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      parent.postMessage({ tipo: "gt-reader-zoom", direcao: -1 }, "*");
    } else if (e.key === "0") {
      e.preventDefault();
      parent.postMessage({ tipo: "gt-reader-zoom-reset" }, "*");
    }
  });

  // Fator vindo do pai (apos o clamp): aplica e re-mede, sem recarregar o srcDoc.
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (d && d.tipo === "gt-reader-set-fator" && typeof d.fator === "number") {
      FATOR = d.fator;
      medir();
    }
  });

  // O script fica no fim do <body>: o body ja existe, entao mede de largada.
  if (document.readyState !== "loading") medir();
})();
