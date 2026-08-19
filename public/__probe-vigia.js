// Sonda #1278: roda no documento PAI (same-origin, com a CSP do app) e captura
// a violacao LITERAL de CSP, repassando pro teste.
document.addEventListener("securitypolicyviolation", function (e) {
  parent.postMessage({
    tipo: "csp-violation",
    directive: e.violatedDirective,
    blockedURI: e.blockedURI,
    policy: e.originalPolicy ? e.originalPolicy.slice(0, 120) : "",
  }, "*");
});
