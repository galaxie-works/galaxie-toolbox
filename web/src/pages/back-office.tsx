import { useEffect, useState } from "react";
import { DICIONARIOS, idiomaAtual, type Idioma } from "@/i18n";
import { listarOrgs, suspender, type Resultado } from "@/lib/back-office";

// Back-office (#1492) — UI de staff pra gerir orgs.
//
// ── Duas coisas mandam nesta tela ──────────────────────────────────────────
//
// **1. O 404 não pode ser explicado.** O contrato (§4.5) manda 404 pra
// não-staff "não revela o back-office". Se a UI dissesse "você não é staff",
// devolveria por texto o que o status recusou dizer. Então o estado `naoExiste`
// renderiza a MESMA coisa que uma rota inexistente renderizaria — sem motivo,
// sem menção a permissão, sem botão de tentar de novo.
//
// **2. Suspender é a operação mais destrutiva do produto** (palavras do
// contrato). A confirmação NOMEIA a org: "tem certeza?" genérico é clicado no
// automático, e o dano aqui é uma organização inteira fora do ar.
//
// ⚠️ O corpo do `GET /admin/orgs` ainda não está no contrato (perguntei ao
// @alcor). Por isso a lista ainda não é renderizada linha a linha: o que existe
// é a fronteira — pedir, reagir ao 404, e confirmar antes de suspender.

/** O que a tela sabe fazer com cada org, quando o shape chegar. */
type EstadoTela = "carregando" | "naoExiste" | "erro" | "pronto";

export function BackOfficePage({
  idioma = idiomaAtual(),
}: {
  idioma?: Idioma;
}) {
  const t = DICIONARIOS[idioma];
  const [estado, setEstado] = useState<EstadoTela>("carregando");
  const [aConfirmar, setAConfirmar] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void listarOrgs<unknown>().then((r: Resultado<unknown>) => {
      if (!vivo) return;
      setEstado(r.estado === "pronto" ? "pronto" : r.estado);
    });
    return () => {
      vivo = false;
    };
  }, []);

  // Igual a qualquer rota que não existe. NÃO dizer por quê: dizer desfaz o 404.
  if (estado === "naoExiste") return <NaoEncontrado idioma={idioma} />;

  return (
    <main className="min-h-screen bg-neutral-50 p-6">
      <header className="mx-auto max-w-4xl">
        <h1 className="text-xl font-semibold text-neutral-900">
          {t.backOffice}
        </h1>
      </header>

      <section className="mx-auto mt-4 max-w-4xl rounded-2xl border border-neutral-200 bg-white p-6 text-sm">
        {estado === "carregando" ? (
          <p>{t.carregando}</p>
        ) : estado === "erro" ? (
          <p>{t.erroCarregar}</p>
        ) : (
          <p className="text-neutral-500">{t.listaPendente}</p>
        )}
      </section>

      {aConfirmar ? (
        <ConfirmarSuspensao
          idioma={idioma}
          org={aConfirmar}
          aoCancelar={() => setAConfirmar(null)}
          aoConfirmar={() => {
            void suspender(aConfirmar);
            setAConfirmar(null);
          }}
        />
      ) : null}
    </main>
  );
}

/**
 * O que quem não é staff vê: exatamente o que veria numa URL inexistente.
 *
 * Sem "sem permissão", sem "você não é staff", sem "tentar de novo" — cada uma
 * dessas frases confirmaria que existe algo aqui.
 */
function NaoEncontrado({ idioma }: { idioma: Idioma }) {
  const t = DICIONARIOS[idioma];
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className="text-sm text-neutral-500">{t.naoEncontrado}</p>
    </main>
  );
}

/**
 * Confirmação de suspensão — **nomeia a org**.
 *
 * Um "tem certeza?" genérico é clicado no automático; o dano aqui é uma
 * organização inteira fora do ar, com auditoria própria no backend. Quem
 * confirma tem que ler o nome do que vai derrubar.
 */
function ConfirmarSuspensao({
  idioma,
  org,
  aoConfirmar,
  aoCancelar,
}: {
  idioma: Idioma;
  org: string;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  const t = DICIONARIOS[idioma];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.suspender}
      className="fixed inset-0 flex items-center justify-center bg-neutral-900/40 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-sm">
        <h2 className="font-medium text-neutral-900">{t.suspender}</h2>
        {/* O nome da org fica no corpo, não só no título: é o que a pessoa lê. */}
        <p className="mt-2 text-neutral-600">
          {t.suspenderConfirmacao} <strong>{org}</strong>
        </p>
        <p className="mt-1 text-neutral-500">{t.suspenderAviso}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={aoCancelar}
            className="rounded-lg px-3 py-1.5 text-neutral-600 hover:bg-neutral-100"
          >
            {t.cancelar}
          </button>
          <button
            type="button"
            onClick={aoConfirmar}
            className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700"
          >
            {t.suspender}
          </button>
        </div>
      </div>
    </div>
  );
}
