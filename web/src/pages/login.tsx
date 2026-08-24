import { useState } from "react";
import { DICIONARIOS, idiomaAtual, type Idioma } from "@/i18n";

// Tela de login/cadastro (#1484, AC1). É a rota que o scaffold precisa servir.
// IMPORTANTE (desenho do Altair #1265, (a)/(4)): esta UI NÃO decide autorização
// — ela só COLETA credenciais e reflete o que a sessão do backend (#1469) devolve.
// A barreira é server-side (default-deny). A integração real do submit (POST à
// fundação BE) é a fatia AC2/AC3, fiada quando o #1469 landar.
type Modo = "entrar" | "cadastrar";

export function LoginPage({ idioma = idiomaAtual() }: { idioma?: Idioma }) {
  const t = DICIONARIOS[idioma];
  const [modo, setModo] = useState<Modo>("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <section className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">{t.bemVindo}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t.subtitulo}</p>

        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={(e) => {
            // Sem wiring de auth ainda (#1469 não landou) — o submit é inerte de
            // propósito; AC2/AC3 fiam o POST à fundação BE. Ver comentário do topo.
            e.preventDefault();
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-700">{t.email}</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-700">{t.senha}</span>
            <input
              type="password"
              name="senha"
              autoComplete={modo === "entrar" ? "current-password" : "new-password"}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
            />
          </label>

          <button
            type="submit"
            className="mt-2 rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-700"
          >
            {modo === "entrar" ? t.entrar : t.cadastrar}
          </button>
        </form>

        <div className="mt-4 flex flex-col gap-2 text-sm text-neutral-500">
          <button type="button" className="self-start hover:text-neutral-900">
            {t.recuperarSenha}
          </button>
          <button
            type="button"
            className="self-start hover:text-neutral-900"
            onClick={() => setModo((m) => (m === "entrar" ? "cadastrar" : "entrar"))}
          >
            {modo === "entrar" ? t.semConta : t.jaTemConta}
          </button>
        </div>
      </section>
    </main>
  );
}
