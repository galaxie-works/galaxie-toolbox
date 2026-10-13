import { RouterProvider } from "react-router-dom";
import { rotas } from "@/rotas";
import { IdiomaProvider } from "@/components/idioma-provider";

// App web da plataforma (#1484) — só monta o roteador. A config de rotas vive em
// `@/rotas` pra este arquivo exportar apenas o componente.
export function App() {
  return (
    <IdiomaProvider>
      <RouterProvider router={rotas} />
    </IdiomaProvider>
  );
}
