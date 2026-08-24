import { createBrowserRouter, Navigate } from "react-router-dom";
import { LoginPage } from "@/pages/login";
import { ContaPage } from "@/pages/conta";
import { ConfigPage } from "@/pages/config";

// Config de rotas do app web. Fica em módulo próprio (não em App.tsx) pra
// App.tsx exportar só o componente — Fast Refresh e o lint da casa
// (react/only-export-components) exigem um arquivo com componentes só.
//  • /login   (#1484) — login/onboarding.
//  • /conta   (#1489) — conta/perfil (/me): perfil, assinatura, dispositivos.
//  • /config  (#1491) — config do app: prefs da allowlist (/me/config).
// A guarda de sessão real (redirect quando não logado) mora em cada página: o
// /me* devolve 401 sem sessão e a UI manda ao login. O wiring do login que
// ESTABELECE a sessão é o #1484 AC2/AC3 (depende do #1469 fatia 3, borda HTTP).
export const rotas = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/conta", element: <ContaPage /> },
  { path: "/config", element: <ConfigPage /> },
  { path: "*", element: <Navigate to="/login" replace /> },
]);
