import { createBrowserRouter, Navigate } from "react-router-dom";
import { LoginPage } from "@/pages/login";
import { ContaPage } from "@/pages/conta";
import { ConfigPage } from "@/pages/config";
import { AdminOrgPage } from "@/pages/admin-org";
import { BackOfficePage } from "@/pages/back-office";

// Config de rotas do app web. Fica em módulo próprio (não em App.tsx) pra
// App.tsx exportar só o componente — Fast Refresh e o lint da casa
// (react/only-export-components) exigem um arquivo com componentes só.
//  • /login      (#1484) — login/onboarding.
//  • /conta      (#1489) — conta/perfil (/me): perfil, assinatura, dispositivos.
//  • /config     (#1491) — config do app: prefs da allowlist (/me/config).
//  • /admin/org  (#1490) — admin da org: membros, domínios, settings, assinatura.
//
// A guarda de sessão real (redirect quando não logado) mora em cada página: o
// /me* devolve 401 sem sessão e a UI manda ao login. O wiring do login que
// ESTABELECE a sessão é o #1484 AC2/AC3 (depende do #1469 fatia 3, borda HTTP).
//
// Nenhuma destas rotas é protegida NO CLIENTE, e é de propósito: quem barra é o
// backend (default-deny). Um "guard de rota" local daria a impressão de proteção
// que o cliente não pode oferecer — qualquer um edita o próprio JS. As páginas
// pedem o recurso e refletem a negativa. Ver o cabeçalho de `admin-org.tsx`.
export const rotas = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/conta", element: <ContaPage /> },
  { path: "/config", element: <ConfigPage /> },
  { path: "/admin/org", element: <AdminOrgPage /> },
  // #1492: back-office de staff. A rota EXISTE pra todo mundo de propósito —
  // esconder no cliente seria conforto, não proteção (qualquer um lê o JS), e o
  // backend responde 404 pra não-staff. Ver o cabeçalho de `back-office.tsx`.
  { path: "/admin/back-office", element: <BackOfficePage /> },
  { path: "*", element: <Navigate to="/login" replace /> },
]);
