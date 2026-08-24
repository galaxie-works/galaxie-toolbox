import { createBrowserRouter, Navigate } from "react-router-dom";
import { LoginPage } from "@/pages/login";

// Config de rotas do app web (#1484). Fica em módulo próprio (não em App.tsx) pra
// App.tsx exportar só o componente — Fast Refresh e o lint da casa
// (react/only-export-components) exigem um arquivo com componentes só.
// Por ora só a rota de login/onboarding (AC1); as rotas autenticadas (dashboard,
// conta, admin) entram nas fatias-irmãs (#1473/#1475/…) após a fundação BE (#1469).
export const rotas = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "*", element: <Navigate to="/login" replace /> },
]);
