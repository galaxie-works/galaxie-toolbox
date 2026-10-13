import { useState } from "react";
import { Navigate } from "react-router-dom";
import { obterConfig, salvarConfig, type ItemConfig, type ValorConfig, type ResultadoSalvar } from "@/lib/api-config";
import { ehNaoAutenticado } from "@/lib/http";
import { useCarregar } from "@/lib/use-carregar";
import { DICIONARIOS, type Idioma } from "@/i18n";
import { rotuloDaChave, rotuloDaOpcao } from "@/lib/rotulos-config";
import { useIdiomaAtivo } from "@/idioma-contexto";
import { RegiaoDeStatus } from "@/components/alerta";

// #1491 — UI de config do app. DATA-DRIVEN: renderiza só as chaves que o BE
// devolve (a allowlist do #1471); a UI não inventa chave. A barreira é
// server-side (chave fora da allowlist o BE recusa); esconder controle é conforto.

function Controle({
  item,
  valor,
  onChange,
  idioma,
}: {
  item: ItemConfig;
  valor: ValorConfig;
  onChange: (v: ValorConfig) => void;
  idioma: Idioma;
}) {
  // #1749: o rótulo vem do dicionário (o BE não manda texto de UI). Nunca a chave crua.
  const t = DICIONARIOS[idioma];
  const rotulo = rotuloDaChave(t, item.chave);
  if (item.tipo === "bool") {
    return (
      <label className="flex items-center justify-between gap-4 py-2 text-sm">
        <span className="text-neutral-700">{rotulo}</span>
        <input
          type="checkbox"
          checked={valor === true}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4"
        />
      </label>
    );
  }
  if (item.tipo === "opcao") {
    return (
      <label className="flex items-center justify-between gap-4 py-2 text-sm">
        <span className="text-neutral-700">{rotulo}</span>
        <select
          value={String(valor)}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-neutral-300 px-3 py-1.5"
        >
          {(item.opcoes ?? []).map((o) => (
            <option key={o} value={o}>
              {rotuloDaOpcao(t, o)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 py-2 text-sm">
      <span className="text-neutral-700">{rotulo}</span>
      <input
        value={String(valor)}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
      />
    </label>
  );
}

export function ConfigPage({ idioma: explicito }: { idioma?: Idioma }) {
  const idioma = useIdiomaAtivo(explicito);
  const t = DICIONARIOS[idioma];
  const cfg = useCarregar(obterConfig);
  // Patch local das edições (só as chaves tocadas); o valor exibido é o do
  // patch quando existe, senão o do servidor.
  const [patch, setPatch] = useState<Record<string, ValorConfig>>({});
  // Resultado POR CHAVE do último save (nunca um "salvo" booleano global — a
  // escrita é por chave e pode ficar parcial; mandato do @Altair no #1588).
  const [resultado, setResultado] = useState<ResultadoSalvar | null>(null);
  const [salvando, setSalvando] = useState(false);
  // 401 a meio de um save = sessão morta → login (sinal do app inteiro).
  const [sessaoMorta, setSessaoMorta] = useState(false);

  if (cfg.estado === "nao-autenticado" || sessaoMorta) return <Navigate to="/login" replace />;

  const valorDe = (item: ItemConfig): ValorConfig =>
    item.chave in patch ? patch[item.chave] : item.valor;

  // #1752: "Carregando…" só na PRIMEIRA carga. O salvar dispara uma releitura, e o
  // `recarregar` volta a `carregando`: antes isto desmontava o formulário inteiro,
  // com a região viva do resultado dentro, e ela voltava já com o texto, que é o
  // padrão que anuncia de forma inconsistente. Medido no runtime (a região deixava
  // de ser o mesmo nó); o mock instantâneo do teste não o via. Numa releitura fica
  // o que o servidor devolveu da última vez, até chegar o novo (não é otimismo).
  const pronto = cfg.estado === "ok" || (cfg.estado === "carregando" && cfg.dados !== null);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 bg-neutral-50 p-6">
      <h1 className="text-2xl font-semibold text-neutral-900">{t.configuracoes}</h1>
      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        {cfg.estado === "carregando" && cfg.dados === null && (
          <p className="text-sm text-neutral-500">{t.carregando}</p>
        )}
        {cfg.estado === "erro" && (
          <button className="text-sm text-red-600 underline" onClick={cfg.recarregar}>
            {t.erroCarregar} — {t.tentarNovamente}
          </button>
        )}
        {pronto && cfg.dados && cfg.dados.length === 0 && (
          <p className="text-sm text-neutral-500">{t.semConfig}</p>
        )}
        {pronto && cfg.dados && cfg.dados.length > 0 && (
          <form
            className="flex flex-col divide-y divide-neutral-100"
            onSubmit={(e) => {
              e.preventDefault();
              setSalvando(true);
              setResultado(null);
              salvarConfig(patch)
                .then((r) => {
                  setResultado(r);
                  // Só as chaves GRAVADAS saem do patch; as que falharam FICAM
                  // (o usuário retenta sem re-editar). O recarregar reflete o
                  // que o servidor guardou de fato.
                  setPatch((p) =>
                    Object.fromEntries(Object.entries(p).filter(([k]) => !r.ok.includes(k))),
                  );
                  if (r.ok.length > 0) cfg.recarregar();
                })
                .catch((err) => {
                  if (ehNaoAutenticado(err)) setSessaoMorta(true);
                  // salvarConfig só lança em 401 (falha de chave vira `falhas`);
                  // qualquer outra coisa é inesperada — não engulo o estado.
                })
                .finally(() => setSalvando(false));
            }}
          >
            {cfg.dados.map((item) => (
              <Controle
                key={item.chave}
                item={item}
                valor={valorDe(item)}
                idioma={idioma}
                onChange={(v) => {
                  setPatch((p) => ({ ...p, [item.chave]: v }));
                  setResultado(null);
                }}
              />
            ))}
            <div className="flex items-center gap-3 pt-4">
              <button
                type="submit"
                disabled={salvando || Object.keys(patch).length === 0}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                {t.salvar}
              </button>
              {/* Reporte POR CHAVE — nunca "salvo" global quando uma ficou pra trás.
                  #1752: numa região viva SEMPRE MONTADA, com nome estável, e só o
                  conteúdo a mudar (o submit limpa-o, o resultado volta a pô-lo).
                  Num `<span>` o leitor de ecrã não anunciava nada (WCAG 4.1.3); e
                  uma região que nascesse já com o texto anunciaria de forma
                  inconsistente (achado da @Íris no gate). */}
              <RegiaoDeStatus
                rotulo={t.resultadoSalvar}
                aviso={
                  resultado && resultado.falhas.length > 0
                    ? {
                        tom: "erro",
                        titulo: `${t.naoGuardado}: ${resultado.falhas.map((f) => rotuloDaChave(t, f.chave)).join(", ")}`,
                      }
                    : resultado && resultado.ok.length > 0
                      ? { tom: "simples", titulo: t.salvo }
                      : null
                }
              />
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
