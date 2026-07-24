import { useEffect, useState } from "react";
import AnimatedToggle from "@/components/smoothui/animated-toggle";
import { useIdioma } from "@/lib/idioma";

const STORAGE_KEY = "galaxie-theme";

const SunIcon = () => (
  <svg
    aria-hidden="true"
    className="size-full"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
  >
    <circle cx="12" cy="12" r="5" />
    <line x1="12" x2="12" y1="1" y2="3" />
    <line x1="12" x2="12" y1="21" y2="23" />
    <line x1="4.22" x2="5.64" y1="4.22" y2="5.64" />
    <line x1="18.36" x2="19.78" y1="18.36" y2="19.78" />
    <line x1="1" x2="3" y1="12" y2="12" />
    <line x1="21" x2="23" y1="12" y2="12" />
    <line x1="4.22" x2="5.64" y1="19.78" y2="18.36" />
    <line x1="18.36" x2="19.78" y1="5.64" y2="4.22" />
  </svg>
);

const MoonIcon = () => (
  <svg
    aria-hidden="true"
    className="size-full"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

function initialDark(): boolean {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return saved === "dark";
  // sem preferencia salva: segue o que o documento ja tem (boot = dark)
  return document.documentElement.classList.contains("dark");
}

/** Alterna claro/escuro. Ligado = tema escuro. A escolha fica salva. */
export function ThemeToggle() {
  const { t } = useIdioma();
  const [dark, setDark] = useState(initialDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");

    // A barra de titulo e desenhada pelo Windows, nao pelo WebView: sem avisar
    // a janela, ela fica clara com o app escuro. setTheme liga o modo escuro
    // imersivo do Windows, e a moldura acompanha o tema escolhido.
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) =>
          getCurrentWindow().setTheme(dark ? "dark" : "light")
        )
        .catch(() => {
          // versao sem a API ou permissao ausente: fica a moldura padrao
        });
    }
  }, [dark]);

  return (
    <AnimatedToggle
      checked={dark}
      onChange={setDark}
      label={t.tema.alternar}
      icons={{ on: <MoonIcon />, off: <SunIcon /> }}
      size="lg"
      variant="icon"
    />
  );
}
