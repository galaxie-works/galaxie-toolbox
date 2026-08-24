import { DICIONARIOS, idiomaAtual, type Idioma } from "@/i18n";

// Tela de login/onboarding (#1484). Auth = IDENTIDADE FEDERADA multi-provedor —
// os MESMOS provedores do app desktop (microsoft / microsoft-personal / google,
// `src/lib/api.ts:232`). Decisão do Altair (#1503): NEM e-mail/senha (o produto
// nunca guardou senha; senha = superfície nova de vazamento e de enumeração no
// "esqueci minha senha") NEM só M365-work (excluiria conta pessoal/Google que o
// produto já serve). A UI NÃO decide autorização — só INICIA o fluxo; o principal
// é resolvido pelo provedor (upstream) e a sessão nasce no `POST /api/v1/session`.
//
// O endpoint que INICIA o redirect OAuth ainda não está no contrato (§2 sendo
// atualizada p/ federado; auth M365-web sem card) — `iniciarLogin` aponta pro
// caminho assumido e é confirmado quando o fluxo landar.

type Provedor = "microsoft" | "microsoft-personal" | "google";
const PROVEDORES: Provedor[] = ["microsoft", "microsoft-personal", "google"];

function iniciarLogin(provedor: Provedor) {
  // Redirect iniciado pelo servidor (padrão OAuth): o servidor manda pro provedor,
  // este volta, o servidor resolve o principal e emite o cookie de sessão.
  window.location.assign(`/api/v1/session/${provedor}`);
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
