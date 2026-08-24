import { createBrowserRouter, Navigate } from "react-router-dom";
import { LoginPage } from "@/pages/login";
import { ContaPage } from "@/pages/conta";

// Config de rotas do app web. Fica em módulo próprio (não em App.tsx) pra
// App.tsx exportar só o componente — Fast Refresh e o lint da casa
// (react/only-export-components) exigem um arquivo com componentes só.
//  • /login  (#1484) — login/onboarding.
//  • /conta  (#1489) — conta/perfil (/me): perfil, assinatura, dispositivos.
// A guarda de sessão real (redirect quando não logado) mora na própria página de
// conta: o /me devolve 401 sem sessão e a UI manda ao login. O wiring do login
// que ESTABELECE a sessão é o #1484 AC2/AC3 (depende do #1469 fatia 2).
export const rotas = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/conta", element: <ContaPage /> },
  { path: "*", element: <Navigate to="/login" replace /> },
]);
