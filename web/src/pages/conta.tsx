import { useEffect, useId, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  atualizarPerfil,
  definirRestricaoRemota,
  ehNaoAutenticado,
  listarDispositivos,
  listarRestricoesRemotas,
  obterAssinatura,
  obterPerfil,
  removerRestricaoRemota,
  revogarDispositivo,
} from "@/lib/api-me";
import { Alerta, RegiaoDeStatus } from "@/components/alerta";
import { CaixasDeCapacidades } from "@/components/caixas-de-capacidades";
import {
  CAPACIDADES_DO_ATALHO,
  deviceIdValido,
  ligadas,
  type CapacidadesRemotas,
} from "@/lib/remoto";
import { useCarregar } from "@/lib/use-carregar";
import { DICIONARIOS, type Dicionario, type Idioma } from "@/i18n";
import { useIdiomaAtivo } from "@/idioma-contexto";

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

/**
 * #1756 — o membro limita o acesso remoto ao SEU device (a fatia do AC3 do #1472).
 *
 * Só reduz: o efetivo de uma sessão é concessão ∩ teto da org ∩ esta restrição
 * (#1683). O membro não vê o teto da org (não tem acesso a ele), por isso a
 * secção diz o que a restrição faz em vez de mostrar números que ele não tem.
 * Nada disto é aplicado às sessões até a ponte #1729: o aviso diz isso, como no
 * painel da org.
 *
 * Duas armadilhas já pagas noutras entregas, aqui evitadas de propósito:
 * - "Carregando…" só na PRIMEIRA carga. A releitura depois de uma escrita volta a
 *   `carregando`; se isso desmontasse o formulário, levaria o que o membro
 *   escreveu (#1752, #1472).
 * - O resultado vai para uma `RegiaoDeStatus` sempre montada, não para um
 *   `<span>` nem para uma região que nasce com o texto (gate da @Íris no #1752).
 */
function BlocoRemotoMeuDevice({ t }: { t: Dicionario }) {
  const ids = useId();
  const lista = useCarregar(listarRestricoesRemotas);
  const [dispositivo, setDispositivo] = useState("");
  // Parte de TUDO permitido, e o membro desmarca o que quer proibir: é a forma
  // de "só reduz" que se lê no próprio formulário.
  const [capacidades, setCapacidades] = useState<CapacidadesRemotas>(CAPACIDADES_DO_ATALHO.total);
  const [enviando, setEnviando] = useState(false);
  const [aRemover, setARemover] = useState<string | null>(null);
  const [resultado, setResultado] = useState<"salvo" | "falhou" | null>(null);
  const [sessaoMorta, setSessaoMorta] = useState(false);

  if (lista.estado === "nao-autenticado" || sessaoMorta) return <Navigate to="/login" replace />;

  // Validado CRU, sem `trim`: o servidor recusa o espaço, e apará-lo em silêncio
  // mandaria um id diferente do que o membro vê no campo.
  const dispositivoInvalido = dispositivo !== "" && !deviceIdValido(dispositivo);
  const podeEnviar = deviceIdValido(dispositivo) && !enviando && aRemover === null;

  /** Escreve, diz o resultado na região e relê SEMPRE do servidor (nada otimista). */
  async function escrever(acao: () => Promise<unknown>): Promise<boolean> {
    setResultado(null);
    let ok = false;
    try {
      await acao();
      ok = true;
      setResultado("salvo");
    } catch (e) {
      // 401 a meio = sessão morta → login, como no resto da `/conta`.
      if (ehNaoAutenticado(e)) {
        setSessaoMorta(true);
        return false;
      }
      setResultado("falhou");
    }
    lista.recarregar();
    return ok;
  }

  return (
    <Secao titulo={t.remotoMeTitulo}>
      <p className="text-sm text-neutral-600">{t.remotoMeExplica}</p>
      <Alerta tom="aviso" titulo={t.remotoNaoAplicado} className="mt-4" />
      <RegiaoDeStatus
        rotulo={t.resultadoSalvar}
        aviso={
          resultado === "salvo"
            ? { tom: "simples", titulo: t.salvo }
            : resultado === "falhou"
              ? { tom: "erro", titulo: t.remotoFalhou }
              : null
        }
        className="mt-4"
      />

      <div className="mt-4">
        {lista.estado === "carregando" && lista.dados === null && (
          <p className="text-sm text-neutral-500">{t.carregando}</p>
        )}
        {lista.estado === "erro" && (
          <button className="text-sm text-red-600 underline" onClick={lista.recarregar}>
            {t.erroCarregar} — {t.tentarNovamente}
          </button>
        )}
        {lista.estado !== "erro" && lista.dados && lista.dados.length === 0 && (
          <p className="text-sm text-neutral-500">{t.remotoMeVazio}</p>
        )}
        {lista.estado !== "erro" && lista.dados && lista.dados.length > 0 && (
          <ul className="flex flex-col divide-y divide-neutral-100">
            {lista.dados.map((r) => {
              const permitidas = ligadas(r.capacidades);
              return (
                <li key={r.dispositivo_id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    {/* "Dispositivo {id}": o id é DADO, e a tela não afirma que o
                        device existe nem que está online (sem registo até #1729). */}
                    <p className="truncate text-sm font-medium text-neutral-900">
                      {t.remotoDispositivo.replace("{id}", r.dispositivo_id)}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {permitidas.length > 0 ? permitidas.map((k) => t.remotoCapacidade[k]).join(", ") : "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={aRemover !== null || enviando}
                    onClick={() => {
                      setARemover(r.dispositivo_id);
                      void escrever(() => removerRestricaoRemota(r.dispositivo_id)).finally(() =>
                        setARemover(null),
                      );
                    }}
                    className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:border-red-400 hover:text-red-600 disabled:opacity-50"
                  >
                    {t.remotoMeRemover}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form
        className="mt-4 flex flex-col gap-3 rounded-xl border border-neutral-200 p-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!podeEnviar) return;
          setEnviando(true);
          void escrever(() => definirRestricaoRemota(dispositivo, capacidades))
            .then((ok) => {
              if (ok) {
                setDispositivo("");
                setCapacidades(CAPACIDADES_DO_ATALHO.total);
              }
            })
            .finally(() => setEnviando(false));
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-device`} className="text-neutral-700">
            {t.remotoDeviceId}
          </label>
          <input
            id={`${ids}-device`}
            value={dispositivo}
            onChange={(e) => {
              setDispositivo(e.target.value);
              setResultado(null);
            }}
            aria-invalid={dispositivoInvalido}
            aria-describedby={dispositivoInvalido ? `${ids}-device-erro` : undefined}
            maxLength={128}
            autoComplete="off"
            spellCheck={false}
            className="rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
          {dispositivoInvalido ? (
            <span id={`${ids}-device-erro`} className="text-red-800">
              {t.remotoDeviceIdInvalido}
            </span>
          ) : null}
        </div>
        <fieldset>
          <legend className="mb-1 text-neutral-700">{t.remotoAcesso}</legend>
          <CaixasDeCapacidades
            t={t}
            valor={capacidades}
            aoMudar={(c) => {
              setCapacidades(c);
              setResultado(null);
            }}
          />
        </fieldset>
        <div>
          <button
            type="submit"
            disabled={!podeEnviar}
            className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {t.remotoMeAdicionar}
          </button>
        </div>
      </form>
    </Secao>
  );
}

export function ContaPage({ idioma: explicito }: { idioma?: Idioma }) {
  const idioma = useIdiomaAtivo(explicito);
  const t = DICIONARIOS[idioma];
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 bg-neutral-50 p-6">
      <h1 className="text-2xl font-semibold text-neutral-900">{t.minhaConta}</h1>
      <BlocoPerfil t={t} />
      <BlocoAssinatura t={t} />
      <BlocoDispositivos t={t} idioma={idioma} />
      <BlocoRemotoMeuDevice t={t} />
    </main>
  );
}
