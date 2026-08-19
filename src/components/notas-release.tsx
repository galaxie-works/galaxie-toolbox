import { blocosDeNotas, type Trecho } from "@/lib/markdown-notas";
import { openUrl } from "@/lib/api";

/**
 * Notas de release do feed, renderizadas (#1321).
 *
 * O changelog do `atlas` é Markdown; até a v0.46.0 este bloco mostrava o FONTE
 * (`##`, `**` literais na cara do usuário). Aqui ele vira elemento.
 *
 * **Negar HTML é estrutural:** o parser devolve dados e isto devolve elementos
 * React — não existe `dangerouslySetInnerHTML` no caminho. `<script>` vindo do
 * feed aparece como texto, porque texto é a única coisa que sabemos produzir.
 *
 * Link só existe com `http(s)` (o parser derruba o resto) e abre no navegador
 * do sistema via `openUrl` — nunca dentro da webview.
 */
function Linha({ trechos }: { trechos: Trecho[] }) {
  return (
    <>
      {trechos.map((t, i) =>
        t.href ? (
          <a
            key={i}
            href={t.href}
            onClick={(e) => {
              e.preventDefault();
              void openUrl(t.href!);
            }}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {t.texto}
          </a>
        ) : t.forte ? (
          <strong key={i} className="font-medium text-foreground">
            {t.texto}
          </strong>
        ) : (
          <span key={i}>{t.texto}</span>
        )
      )}
    </>
  );
}

export function NotasRelease({ markdown }: { markdown: string }) {
  const blocos = blocosDeNotas(markdown);
  if (!blocos.length) return null;
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      {blocos.map((b, i) =>
        b.tipo === "titulo" ? (
          <h3
            key={i}
            className="pt-1 text-xs font-semibold text-foreground first:pt-0"
          >
            <Linha trechos={b.trechos} />
          </h3>
        ) : b.tipo === "lista" ? (
          <ul key={i} className="list-disc space-y-1 pl-4">
            {b.itens.map((item, j) => (
              <li key={j}>
                <Linha trechos={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <Linha trechos={b.trechos} />
          </p>
        )
      )}
    </div>
  );
}
