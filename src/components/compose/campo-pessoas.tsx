import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import * as api from "@/lib/api";
import type { Pessoa } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Campo de destinatários com autocomplete de pessoas. Renderiza um rótulo
 * curto ("Para"/"Cc"/"Cco"), os e-mails já escolhidos como chips removíveis e
 * um input no fim que sugere pessoas conforme se digita (debounce ~250ms).
 *
 * Aceita clique na sugestão, Enter, vírgula ou ponto-e-vírgula para adicionar;
 * Backspace no input vazio remove o último chip. E-mails crus são aceitos como
 * estão. Sem dependência de UI externa — dropdown posicionado no próprio campo.
 */
export interface CampoPessoasProps {
  rotulo: string;
  valor: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}

export function CampoPessoas({
  rotulo,
  valor,
  onChange,
  placeholder,
}: CampoPessoasProps) {
  const [texto, setTexto] = useState("");
  const [sugestoes, setSugestoes] = useState<Pessoa[]>([]);
  const [aberto, setAberto] = useState(false);
  const [destaque, setDestaque] = useState(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Marca o pedido em voo pra descartar respostas fora de ordem.
  const pedidoRef = useRef(0);

  // Debounce da busca, com guarda por ref cancelada no unmount.
  useEffect(() => {
    const q = texto.trim();
    if (timerRef.current) clearTimeout(timerRef.current);

    if (q.length < 1) {
      setSugestoes([]);
      setAberto(false);
      return;
    }

    timerRef.current = setTimeout(() => {
      const meu = ++pedidoRef.current;
      api
        .crPessoas(q)
        .then((res) => {
          if (meu !== pedidoRef.current) return; // resposta obsoleta
          setSugestoes(res);
          setDestaque(0);
          setAberto(res.length > 0);
        })
        .catch(() => {
          if (meu !== pedidoRef.current) return;
          setSugestoes([]);
          setAberto(false);
        });
    }, 250);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [texto]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      pedidoRef.current++; // invalida qualquer resposta pendente
    };
  }, []);

  function adicionar(email: string) {
    const limpo = email.trim().replace(/[,;]+$/, "").trim();
    if (!limpo) return;
    // Dedupe sem diferenciar maiúsculas.
    const existe = valor.some((v) => v.toLowerCase() === limpo.toLowerCase());
    if (!existe) onChange([...valor, limpo]);
    setTexto("");
    setSugestoes([]);
    setAberto(false);
    setDestaque(0);
  }

  function remover(idx: number) {
    onChange(valor.filter((_, i) => i !== idx));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && aberto) {
      e.preventDefault();
      setDestaque((d) => Math.min(d + 1, sugestoes.length - 1));
      return;
    }
    if (e.key === "ArrowUp" && aberto) {
      e.preventDefault();
      setDestaque((d) => Math.max(d - 1, 0));
      return;
    }
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      if (aberto && sugestoes[destaque]) {
        adicionar(sugestoes[destaque].email);
      } else if (texto.trim()) {
        adicionar(texto);
      }
      return;
    }
    if (e.key === "Escape") {
      setAberto(false);
      return;
    }
    if (e.key === "Backspace" && texto === "" && valor.length > 0) {
      e.preventDefault();
      remover(valor.length - 1);
    }
  }

  return (
    <div className="relative flex items-start gap-2 px-3 py-2">
      <span className="mt-1.5 shrink-0 select-none text-xs text-muted-foreground">
        {rotulo}
      </span>

      <div
        className="flex flex-1 flex-wrap items-center gap-1"
        onClick={() => inputRef.current?.focus()}
      >
        {valor.map((email, i) => (
          <span
            key={`${email}-${i}`}
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
          >
            {email}
            <button
              type="button"
              aria-label={`Remover ${email}`}
              className="inline-flex size-4 items-center justify-center rounded hover:bg-background"
              onClick={(e) => {
                e.stopPropagation();
                remover(i);
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          value={texto}
          placeholder={valor.length === 0 ? placeholder : undefined}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (sugestoes.length > 0) setAberto(true);
          }}
          onBlur={() => setAberto(false)}
          className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {aberto && sugestoes.length > 0 && (
        <ul className="absolute top-full left-0 z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
          {sugestoes.map((p, i) => (
            <li key={`${p.email}-${i}`}>
              <button
                type="button"
                // onMouseDown evita o blur do input antes do clique registrar.
                onMouseDown={(e) => {
                  e.preventDefault();
                  adicionar(p.email);
                }}
                onMouseEnter={() => setDestaque(i)}
                className={cn(
                  "flex w-full flex-col items-start px-3 py-1.5 text-left text-sm",
                  i === destaque ? "bg-accent text-accent-foreground" : ""
                )}
              >
                <span className="font-medium">{p.nome}</span>
                <span className="text-xs text-muted-foreground">{p.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
