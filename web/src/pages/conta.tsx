import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  atualizarPerfil,
  listarDispositivos,
  obterAssinatura,
  obterPerfil,
  revogarDispositivo,
} from "@/lib/api-me";
import { useCarregar } from "@/lib/use-carregar";
import { DICIONARIOS, idiomaAtual, type Dicionario, type Idioma } from "@/i18n";

// #1489 — UI de conta/perfil (/me). Roda sobre o scaffold #1484, consome o
// #1473-BE. Doutrina: a UI REFLETE a sessão, não decide autorização; nada é
// endereçado por id de dono (o cliente `api-me` só fala `/me/*`).

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{titulo}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function BlocoPerfil({ t }: { t: Dicionario }) {
  const perfil = useCarregar(obterPerfil);
  const [nome, setNome] = useState("");
  const [salvo, setSalvo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (perfil.dados) setNome(perfil.dados.nome);
  }, [perfil.dados]);

  // A não-autenticação do /me é o sinal de sessão do app inteiro → manda ao login.
  if (perfil.estado === "nao-autenticado") return <Navigate to="/login" replace />;

  return (
    <Secao titulo={t.perfil}>
      {perfil.estado === "carregando" && <p className="text-sm text-neutral-500">{t.carregando}</p>}
      {perfil.estado === "erro" && (
        <button className="text-sm text-red-600 underline" onClick={perfil.recarregar}>
          {t.erroCarregar} — {t.tentarNovamente}
        </button>
      )}
      {perfil.estado === "ok" && perfil.dados && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSalvando(true);
            setSalvo(false);
            atualizarPerfil({ nome })
              .then(() => setSalvo(true))
              .finally(() => setSalvando(false));
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-700">{t.nome}</span>
            <input
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setSalvo(false);
              }}
              className="rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-700">{t.email}</span>
            {/* E-mail é read: identidade, não editável nesta tela. */}
            <input
              value={perfil.dados.email}
              readOnly
              className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-neutral-500"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={salvando}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {t.salvar}
            </button>
            {salvo && <span className="text-sm text-green-600">{t.salvo}</span>}
          </div>
        </form>
      )}
    </Secao>
  );
}

function BlocoAssinatura({ t }: { t: Dicionario }) {
  const ass = useCarregar(obterAssinatura);
  return (
    <Secao titulo={t.assinatura}>
      {ass.estado === "carregando" && <p className="text-sm text-neutral-500">{t.carregando}</p>}
      {ass.estado === "erro" && (
        <button className="text-sm text-red-600 underline" onClick={ass.recarregar}>
          {t.erroCarregar} — {t.tentarNovamente}
        </button>
      )}
      {ass.estado === "ok" && ass.dados && (
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-500">{t.plano}</dt>
            <dd className="font-medium text-neutral-900">
              {ass.dados.status === "nenhuma" ? t.semAssinatura : `${ass.dados.plano} (${ass.dados.status})`}
            </dd>
          </div>
          {ass.dados.consumo && (
            <div className="flex justify-between">
              <dt className="text-neutral-500">{t.consumo}</dt>
              <dd className="font-medium text-neutral-900">
                {ass.dados.consumo.usado}
                {ass.dados.consumo.limite != null ? ` / ${ass.dados.consumo.limite}` : ""} {ass.dados.consumo.unidade}
              </dd>
            </div>
          )}
        </dl>
      )}
    </Secao>
  );
}

function BlocoDispositivos({ t, idioma }: { t: Dicionario; idioma: Idioma }) {
  const disp = useCarregar(listarDispositivos);
  const [revogando, setRevogando] = useState<string | null>(null);

  return (
    <Secao titulo={t.dispositivos}>
      {disp.estado === "carregando" && <p className="text-sm text-neutral-500">{t.carregando}</p>}
      {disp.estado === "erro" && (
        <button className="text-sm text-red-600 underline" onClick={disp.recarregar}>
          {t.erroCarregar} — {t.tentarNovamente}
        </button>
      )}
      {disp.estado === "ok" && disp.dados && (
        <ul className="flex flex-col divide-y divide-neutral-100">
          {disp.dados.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">
                  {d.nome}
                  {d.sessaoAtual && (
                    <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs font-normal text-green-700">
                      {t.sessaoAtual}
                    </span>
                  )}
                </p>
                <p className="text-xs text-neutral-500">
                  {t.ultimoAcesso}: {new Date(d.ultimoAcesso).toLocaleString(idioma)}
                </p>
              </div>
              <button
                type="button"
                disabled={revogando === d.id}
                onClick={() => {
                  setRevogando(d.id);
                  revogarDispositivo(d.id)
                    .then(() => disp.recarregar())
                    .finally(() => setRevogando(null));
                }}
                className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:border-red-400 hover:text-red-600 disabled:opacity-50"
              >
                {t.revogar}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

export function ContaPage({ idioma = idiomaAtual() }: { idioma?: Idioma }) {
  const t = DICIONARIOS[idioma];
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 bg-neutral-50 p-6">
      <h1 className="text-2xl font-semibold text-neutral-900">{t.minhaConta}</h1>
      <BlocoPerfil t={t} />
      <BlocoAssinatura t={t} />
      <BlocoDispositivos t={t} idioma={idioma} />
    </main>
  );
}
