import { RouterProvider } from "react-router-dom";
import { rotas } from "@/rotas";

// App web da plataforma (#1484) — só monta o roteador. A config de rotas vive em
// `@/rotas` pra este arquivo exportar apenas o componente.
export function App() {
  return <RouterProvider router={rotas} />;
}
