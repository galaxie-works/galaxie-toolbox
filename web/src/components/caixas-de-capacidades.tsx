import type { Dicionario } from "@/i18n";
import { CAPACIDADES, type CapacidadesRemotas } from "@/lib/remoto";

/**
 * As 5 capacidades do Remote como caixas de marcar, no padrão de controle bool
 * do `config.tsx`.
 *
 * Nasceu no painel da org (#1472) e mudou-se para cá quando a `/conta` precisou
 * dela (#1756): duas cópias das mesmas 5 caixas divergiriam na primeira
 * capacidade nova, e a lista fechada (`CAPACIDADES`) é o canário do AC6 do #1683.
 */
export function CaixasDeCapacidades({
  t,
  valor,
  aoMudar,
}: {
  t: Dicionario;
  valor: CapacidadesRemotas;
  aoMudar: (c: CapacidadesRemotas) => void;
}) {
  return (
    <div className="flex flex-col">
      {CAPACIDADES.map((k) => (
        <label key={k} className="flex items-center justify-between gap-4 py-1">
          <span className="text-neutral-700">{t.remotoCapacidade[k]}</span>
          <input
            type="checkbox"
            checked={valor[k]}
            onChange={(e) => aoMudar({ ...valor, [k]: e.target.checked })}
            className="size-4"
          />
        </label>
      ))}
    </div>
  );
}
