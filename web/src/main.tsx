import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { aplicarIdiomaNoDocumento, idiomaAtual } from "@/i18n";
import "./styles.css";

// WCAG 3.1.1 (#1484): o `<html lang>` acompanha o idioma que as páginas vão
// renderizar — o MESMO `idiomaAtual()` que elas usam de default. Antes do render.
aplicarIdiomaNoDocumento(idiomaAtual());

const raiz = document.getElementById("root");
if (!raiz) throw new Error("#root não encontrado no index.html");
createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
