// Sonda #1278: faz o papel da ponte de medicao, carregada como ARQUIVO EXTERNO
// da origem do app. Se este script executar dentro do iframe opaque-origin,
// a via (B) e viavel.
parent.parent.postMessage({ tipo: "gt-ponte-externa-ok" }, "*");
