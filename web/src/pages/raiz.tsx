import { Navigate, useLocation } from "react-router-dom";
import { BUSCA_LOGIN_FALHOU, lerLoginFalhou } from "@/lib/login-falhou";

// `/` é o destino do callback OAuth (contrato #1734, Alcor): sucesso → `/`, falha
// → `/?login=falhou`. Antes, `/` caía no catch-all (`*` → `/login`), que DESCARTA
// a query: o sinal morria antes de a tela de login o ler, e o usuário recém-logado
// voltava pro `/login`. Aqui:
//  • falha → `/login` levando SÓ o sinal canônico, nunca a query crua;
//  • o resto → `/conta`, a casa autenticada — que, sem sessão, manda sozinha ao
//    `/login` (o `/me` devolve 401 e a página navega). Quem barra é o backend.
export function RaizPage() {
  const { search } = useLocation();
  return lerLoginFalhou(search) ? (
    <Navigate to={{ pathname: "/login", search: BUSCA_LOGIN_FALHOU }} replace />
  ) : (
    <Navigate to="/conta" replace />
  );
}
