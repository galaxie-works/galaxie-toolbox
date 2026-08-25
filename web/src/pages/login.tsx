import { DICIONARIOS, idiomaAtual, type Idioma } from "@/i18n";

// Tela de login/onboarding (#1484). Auth = IDENTIDADE FEDERADA multi-provedor —
// os MESMOS provedores do app desktop (microsoft / microsoft-personal / google,
// `src/lib/api.ts:232`). Decisão do Altair (#1503): NEM e-mail/senha (o produto
// nunca guardou senha; senha = superfície nova de vazamento e de enumeração no
// "esqueci minha senha") NEM só M365-work (excluiria conta pessoal/Google que o
// produto já serve). A UI NÃO decide autorização — só INICIA o fluxo.
//
// Rota do contrato v1.2 §2 (federada, aprovada Altair #1514): o início é
// **`GET /api/v1/auth/{provedor}`** — o servidor grava state+PKCE e responde 302
// pro provedor; o provedor volta em `/auth/{provedor}/callback`, onde o servidor
// resolve `(provedor, subject)` e emite o cookie de sessão. **NÃO existe `POST
// /session`**: o cliente entregar token/credencial é o padrão proibido — o login
// nasce do callback verificado pelo backend. O cliente só navega pro início.

type Provedor = "microsoft" | "microsoft-personal" | "google";
const PROVEDORES: Provedor[] = ["microsoft", "microsoft-personal", "google"];

function iniciarLogin(provedor: Provedor) {
  // Navegação de topo pro início do fluxo OAuth (não passa pela porta `chamar` —
  // é redirect, não fetch; por isso o prefixo `/api/v1` vai explícito aqui).
  window.location.assign(`/api/v1/auth/${provedor}`);
}

export function LoginPage({ idioma = idiomaAtual() }: { idioma?: Idioma }) {
  const t = DICIONARIOS[idioma];
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <section className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">{t.bemVindo}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t.subtitulo}</p>

        <div className="mt-6 flex flex-col gap-3">
          {PROVEDORES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => iniciarLogin(p)}
              className="rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-800 hover:border-neutral-900 hover:bg-neutral-50"
            >
              {t.entrarCom[p]}
            </button>
          ))}
        </div>

        <p className="mt-6 text-xs text-neutral-400">{t.semSenha}</p>
      </section>
    </main>
  );
}
