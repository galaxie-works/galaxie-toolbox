import { useEffect, useState } from "react";
import { DICIONARIOS, idiomaAtual, type Idioma } from "@/i18n";
import { buscar, CAMINHOS, type Membro } from "@/lib/org";

// Admin da org (#1490) — UI de membros / domínios / settings / assinatura.
//
// ── A UI reflete; quem autoriza é o backend ────────────────────────────────
// Mesma doutrina da tela de login (#1484) e do delta do @Altair no #1475:
// esconder um botão é conforto, não autorização. Por isso esta tela **não
// consulta um papel local para liberar-se**: ela PEDE o recurso e reage ao que
// o backend responder. Se o backend nega (403/404), aparece o aviso de sem
// permissão — e nada de dados da org.
//
// A diferença é sutil e é o coração do AC2: uma tela que decidisse "sou admin,
// então mostro" continuaria mostrando se o papel local mentisse. Esta pergunta
// primeiro e mostra depois.
//
// ⚠️ ESCOPO DESTA FATIA: o par #1475-BE não existe ainda (Ready, sem dono).
// Portanto o AC2 e o AC3 **não estão provados de ponta a ponta** — o que está
// provado aqui é a metade do cliente (a UI reage à negativa e nunca endereça
// org alheia). A outra metade nasce com o BE.

type Aba = "membros" | "dominios" | "settings" | "assinatura";

const ABAS: readonly Aba[] = ["membros", "dominios", "settings", "assinatura"];

/** Rótulo de cada aba — `settings` reusa `configuracoes` do dicionário. */
const ROTULO: Record<Aba, keyof typeof DICIONARIOS["pt-BR"]> = {
  membros: "membros",
  dominios: "dominios",
  settings: "configuracoes",
  assinatura: "assinatura",
};

/**
 * `org` é o identificador da organização, exigido pelo contrato (`/orgs/{org}`).
 *
 * É opcional porque **ainda não existe fonte pra ele**: `GET /me` não devolve a
 * org e não há `GET /me/orgs`. Levantei a lacuna com o @alcor/@Altair. Enquanto
 * não fecha, a tela DIZ que não sabe qual org — em vez de eu escolher um lugar
 * de onde tirar o valor, que é o que o invariante 6 do contrato impede.
 */
export function AdminOrgPage({
  idioma = idiomaAtual(),
  org,
}: {
  idioma?: Idioma;
  org?: string;
}) {
  const t = DICIONARIOS[idioma];
  const [aba, setAba] = useState<Aba>("membros");

  return (
    <main className="min-h-screen bg-neutral-50 p-6">
      <header className="mx-auto max-w-4xl">
        <h1 className="text-xl font-semibold text-neutral-900">{t.adminOrg}</h1>
      </header>

      <nav className="mx-auto mt-6 flex max-w-4xl gap-1" aria-label={t.adminOrg}>
        {ABAS.map((chave) => (
          <button
            key={chave}
            type="button"
            aria-current={aba === chave ? "page" : undefined}
            onClick={() => setAba(chave)}
            className={
              aba === chave
                ? "rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-white"
                : "rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200"
            }
          >
            {t[ROTULO[chave]]}
          </button>
        ))}
      </nav>

      <section className="mx-auto mt-4 max-w-4xl rounded-2xl border border-neutral-200 bg-white p-6">
        {!org ? (
          <Aviso titulo={t.orgIndefinida} detalhe={t.orgIndefinidaDetalhe} />
        ) : aba === "membros" ? (
          <PainelMembros idioma={idioma} org={org} />
        ) : (
          <PainelPendente
            titulo={t[ROTULO[aba]]}
            idioma={idioma}
            caminho={CAMINHOS[aba](org)}
          />
        )}
      </section>
    </main>
  );
}

/**
 * Membros — o painel que já fala com a porta de rede. Os outros três esperam o
 * formato do #1475-BE; ver `PainelPendente`.
 */
function PainelMembros({ idioma, org }: { idioma: Idioma; org: string }) {
  const t = DICIONARIOS[idioma];
  const [estado, setEstado] = useState<
    "carregando" | "naoEhAdmin" | "naoEhSuaOrg" | "erro" | "pronto"
  >("carregando");
  const [membros, setMembros] = useState<Membro[]>([]);

  useEffect(() => {
    let vivo = true;
    void buscar<Membro[]>(CAMINHOS.membros(org)).then((r) => {
      if (!vivo) return;
      setEstado(r.estado === "pronto" ? "pronto" : r.estado);
      if (r.estado === "pronto") setMembros(r.dados);
    });
    return () => {
      vivo = false;
    };
  }, [org]);

  if (estado === "carregando") return <p>{t.carregando}</p>;
  // Duas negativas, duas mensagens. Ver `lib/org.ts`: quem leva 403 já é da org
  // e a instrução "peça a um admin" é acionável; quem leva 404 não pertence, e a
  // mensagem não pode confirmar que a org existe.
  if (estado === "naoEhAdmin")
    return <Aviso titulo={t.semPermissao} detalhe={t.semPermissaoDetalhe} />;
  if (estado === "naoEhSuaOrg")
    return <Aviso titulo={t.naoEhSuaOrg} detalhe={t.naoEhSuaOrgDetalhe} />;
  if (estado === "erro") return <p>{t.erroCarregar}</p>;

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-neutral-500">
          <th className="pb-2 font-medium">{t.email}</th>
          <th className="pb-2 font-medium">{t.papel}</th>
        </tr>
      </thead>
      <tbody>
        {membros.map((m) => (
          <tr key={m.id} className="border-t border-neutral-100">
            <td className="py-2 text-neutral-900">{m.email}</td>
            <td className="py-2 text-neutral-600">
              {m.papel === "org_admin" ? t.papelAdmin : t.papelMembro}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Painel cujo formato depende do #1475-BE.
 *
 * Deixa o caminho VISÍVEL na tela de propósito: enquanto o BE não existe, o que
 * esta fatia entrega de verdade é o endereço escopado que a integração vai usar
 * — e um placeholder que finge dados seria pior que um que declara o que falta.
 */
function PainelPendente({
  titulo,
  idioma,
  caminho,
}: {
  titulo: string;
  idioma: Idioma;
  caminho: string;
}) {
  const t = DICIONARIOS[idioma];
  return (
    <div className="text-sm text-neutral-500">
      <h2 className="font-medium text-neutral-900">{titulo}</h2>
      <p className="mt-1">
        {t.carregando} <code className="text-neutral-400">{caminho}</code>
      </p>
    </div>
  );
}

/** Aviso de negativa. O texto vem de fora porque 403 e 404 dizem coisas diferentes. */
function Aviso({ titulo, detalhe }: { titulo: string; detalhe: string }) {
  return (
    <div role="status" className="text-sm">
      <p className="font-medium text-neutral-900">{titulo}</p>
      <p className="mt-1 text-neutral-500">{detalhe}</p>
    </div>
  );
}
