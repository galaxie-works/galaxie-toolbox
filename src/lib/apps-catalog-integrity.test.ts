import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";

/**
 * #822: integridade dos DADOS do catálogo de apps (`src/assets/apps-catalog.json`,
 * que veio de um scrape). Blinda contra regressão do que o Polaris achou na
 * auditoria: URLs quebradas (subdomínio de tenant perdido → começam com "."),
 * apps do concorrente (Shift), http inseguro e URLs duplicadas.
 *
 * Lê o JSON por `fs` (não por import de alias `@/` nem import-assertion) pra rodar
 * no `node --test` do CI. Só depende do arquivo, não da app.
 */
const raw = readFileSync(
  new URL("../assets/apps-catalog.json", import.meta.url),
  "utf8",
);
const catalogo = JSON.parse(raw) as {
  id: string;
  name: string;
  url: string;
  icon: boolean;
  desc?: { "pt-BR"?: string; en?: string };
}[];

/** #827 SU4: diretório dos ícones estáticos (servidos de `public/app-icons`). */
const iconesDir = new URL("../../public/app-icons/", import.meta.url);

test("#822: nenhuma URL começa com '.' (subdomínio de tenant perdido no scrape)", () => {
  const ruins = catalogo.filter((a) => a.url.startsWith("."));
  assert.deepEqual(ruins.map((a) => `${a.name} ${a.url}`), []);
});

test("#822: nenhum app do Shift (concorrente) — tryshift/shiftium/shiftboard", () => {
  const shift = catalogo.filter((a) =>
    /tryshift\.com|shiftium\.com|shiftboard\.com/i.test(a.url),
  );
  assert.deepEqual(shift.map((a) => a.name), []);
});

test("#822: nenhuma URL http:// (inseguro) — só https", () => {
  const http = catalogo.filter((a) => /^http:\/\//i.test(a.url));
  assert.deepEqual(http.map((a) => `${a.name} ${a.url}`), []);
});

test("#822: nenhuma URL duplicada (normalizada por barra final + caixa)", () => {
  const porUrl = new Map<string, string[]>();
  for (const a of catalogo) {
    const chave = a.url.replace(/\/+$/, "").toLowerCase();
    porUrl.set(chave, [...(porUrl.get(chave) ?? []), a.name]);
  }
  const dups = [...porUrl.entries()].filter(([, nomes]) => nomes.length > 1);
  assert.deepEqual(dups, []);
});

test("#822: nenhum nome com espaço nas pontas ou duplo (normalização do scrape)", () => {
  const ruins = catalogo.filter(
    (a) => a.name !== a.name.trim() || /\s{2,}/.test(a.name),
  );
  assert.deepEqual(ruins.map((a) => JSON.stringify(a.name)), []);
});

test("#822: todos os ids do catálogo são únicos", () => {
  const vistos = new Set<string>();
  const repetidos: string[] = [];
  for (const a of catalogo) {
    if (vistos.has(a.id)) repetidos.push(a.id);
    vistos.add(a.id);
  }
  assert.deepEqual(repetidos, []);
});

test("#827 SU4: nenhum ícone SVG 0-byte em public/app-icons (asset quebrado)", () => {
  const zeros = readdirSync(iconesDir)
    .filter((f) => f.endsWith(".svg"))
    .filter((f) => statSync(new URL(f, iconesDir)).size === 0);
  assert.deepEqual(zeros, []);
});

test("#827 SU4: todo app com icon:true tem arquivo de ícone não-vazio", () => {
  // #1153: o ícone deixou de ser sempre `.svg`. 26 arquivos do catálogo eram
  // JPEG/PNG com extensão `.svg` — o browser não os renderizava e ESTE teste
  // passava mesmo assim, porque só olhava nome e tamanho. Agora ele procura nas
  // extensões que o `AppIcon` sabe resolver; quem verifica o CONTEÚDO (magic
  // bytes) é o `apps-catalog-icones.test.ts`.
  const quebrados = catalogo
    .filter((a) => a.icon)
    .filter((a) => {
      const achado = ["svg", "png", "jpg", "webp"]
        .map((ext) => new URL(`${a.id}.${ext}`, iconesDir))
        .find((p) => existsSync(p) && statSync(p).size > 0);
      return achado === undefined;
    })
    .map((a) => a.id);
  assert.deepEqual(quebrados, []);
});

// ─────────────────────── #1196: o catálogo curado ───────────────────────
// A curadoria do épico #1155 aplicou 7 vereditos num write só e adicionou a
// `desc` de cada sobrevivente. Estes gates existem para que a próxima entrada no
// catálogo NASÇA completa — sem descrição o render volta a mostrar só o nome, e
// sem ícone decodificável mostra a inicial. Os dois defeitos são silenciosos.

test("#1196: todo app tem desc em pt-BR E en, não vazia", () => {
  const semDesc = catalogo
    .filter((a) => {
      const pt = a.desc?.["pt-BR"]?.trim();
      const en = a.desc?.en?.trim();
      return !pt || !en;
    })
    .map((a) => a.id);
  assert.deepEqual(
    semDesc,
    [],
    "app sem descrição nos dois idiomas — o render mostra só o nome (#1196)",
  );
});

test("#1196: descrição diz o que o app FAZ, não repete o nome", () => {
  const iguais = catalogo
    .filter((a) => {
      const pt = a.desc?.["pt-BR"]?.trim().toLowerCase() ?? "";
      return pt === a.name.trim().toLowerCase();
    })
    .map((a) => a.id);
  assert.deepEqual(iguais, [], "desc pt-BR é só o nome repetido — não informa nada");
});

test("#1196/#1153: o ícone de todo app existe, é DECODIFICÁVEL e a extensão não mente", () => {
  // O `icon: true` do JSON é afirmação do gerador. Aqui o arquivo é ABERTO — foi
  // assim que a curadoria achou os JPEG/PNG com extensão `.svg` (#1153).
  //
  // #1153 (fatia 2, `pollux`): a dívida foi RESOLVIDA pelo caminho (b) do card —
  // *"renomeado para a extensão correta com o `AppIcon` sabendo resolver"*. Os 26
  // sobreviventes com ícone raster passaram a ter a extensão VERDADEIRA (`.png`/
  // `.jpg`) e o `AppIcon` tenta `svg → png → jpg → webp`. Por isso o ratchet
  // `RASTER_HERDADO` sumiu: a lista chegou a zero, que era a condição dele.
  //
  // O que este gate afirma agora, e é mais forte que antes: o arquivo existe em
  // ALGUMA extensão suportada, o conteúdo é imagem reconhecível, e a extensão
  // BATE com o conteúdo. Extensão que mente é o defeito original — o browser
  // recebe `image/svg+xml`, falha ao parsear e cai na inicial.
  const EXTENSOES = ["svg", "png", "jpg", "webp"] as const;

  /** Formato REAL pelos primeiros bytes — nunca pela extensão. */
  const formatoReal = (buf: Buffer): string | null => {
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
      return "png";
    if (
      buf.subarray(0, 4).toString("latin1") === "RIFF" &&
      buf.subarray(8, 12).toString("latin1") === "WEBP"
    )
      return "webp";
    const texto = buf.toString("utf8").trimStart().toLowerCase();
    if (texto.startsWith("<svg") || texto.startsWith("<?xml")) return "svg";
    return null;
  };

  const semArquivo: string[] = [];
  const ilegivel: string[] = [];
  const mentirosos: string[] = [];

  for (const a of catalogo) {
    if (!a.icon) continue;
    const achado = EXTENSOES.map((ext) => ({
      ext,
      url: new URL(`${a.id}.${ext}`, iconesDir),
    })).find(({ url }) => existsSync(url));
    if (!achado) {
      semArquivo.push(a.id);
      continue;
    }
    const real = formatoReal(readFileSync(achado.url).subarray(0, 64));
    if (real === null) {
      ilegivel.push(`${a.id} (.${achado.ext})`);
    } else if (real !== achado.ext) {
      mentirosos.push(`${a.id}: extensão .${achado.ext} mas conteúdo ${real}`);
    }
  }

  assert.deepEqual(semArquivo, [], "`icon: true` sem arquivo em public/app-icons");
  assert.deepEqual(ilegivel, [], "arquivo que não é imagem reconhecível");
  assert.deepEqual(
    mentirosos,
    [],
    "extensão que mente sobre o conteúdo — o browser não renderiza (#1153)",
  );
});

test("#1153: SVG do catálogo não pode ser branco-fixo (some no tema claro)", () => {
  // Os brancos eram o segundo defeito do card: SVG válido, mas com `fill="white"`
  // fixo e sem `currentColor`. O app abre no tema CLARO por padrão, então o ícone
  // existia e ninguém via. Consertados via `currentColor` (`midjourney` precisou
  // da raiz, porque as `path` herdavam `fill="none"` e não pintavam nada).
  const invisiveis: string[] = [];
  for (const a of catalogo) {
    if (!a.icon) continue;
    const url = new URL(`${a.id}.svg`, iconesDir);
    if (!existsSync(url)) continue;
    const texto = readFileSync(url, "utf8");
    if (/currentColor/i.test(texto)) continue;
    const temBranco = /fill\s*=\s*"(#fff(fff)?|white)"/i.test(texto);
    const temOutraCor = /fill\s*=\s*"(?!#fff|#ffffff|white|none)[^"]+"/i.test(texto);
    if (temBranco && !temOutraCor) invisiveis.push(a.id);
  }
  assert.deepEqual(
    invisiveis,
    [],
    "SVG só-branco fica invisível no tema claro (#1153)",
  );
});

// ───────────────── #1172: o catálogo não pode perder o Brasil ─────────────────
// O scrape que originou o catálogo montou a lista por DISPONIBILIDADE DE
// INTEGRAÇÃO, não por liderança de categoria — e o resultado foi 1779 apps com
// ZERO software de gestão brasileiro (medido em `c84708c`, 18/08). A curadoria
// do #1155 não criou esse buraco, mas também não o fecharia: curar uma lista
// enviesada devolve uma lista enviesada menor.
//
// Este gate existe porque o defeito é SILENCIOSO: ninguém percebe uma categoria
// que nunca esteve lá. Se um próximo import regenerar o catálogo a partir da
// mesma fonte, ele reprova aqui em vez de passar verde com o Brasil de fora.

/** Gestão brasileira que uma PME abre todo dia (#1172). */
const GESTAO_BRASILEIRA = [
  // ERP e gestão
  "totvs", "sankhya", "senior", "linx", "omie", "bling", "tiny",
  // contábil, fiscal e financeiro
  "dominio", "alterdata", "questor", "contaazul", "nibo",
];

test("#1172: o catálogo tem software de gestão brasileiro", () => {
  const ids = new Set(catalogo.map((a) => a.id));
  const ausentes = GESTAO_BRASILEIRA.filter((id) => !ids.has(id));
  assert.deepEqual(
    ausentes,
    [],
    "categoria inteira faltando num produto para PME brasileira — ver #1172",
  );
});

test("#1172: líder de categoria que o scrape deixou de fora segue presente", () => {
  // Amostra do padrão, não a lista toda: a curadoria cortou `codacy` sem que
  // Sonar estivesse, e `realvnc` sem que AnyDesk estivesse. O catálogo NÃO é
  // fonte de verdade de liderança de categoria.
  const ids = new Set(catalogo.map((a) => a.id));
  const ausentes = ["sonarqube", "anydesk", "render", "wasabi", "acronis"].filter(
    (id) => !ids.has(id),
  );
  assert.deepEqual(ausentes, []);
});
