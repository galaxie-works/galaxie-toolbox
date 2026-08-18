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
  const quebrados = catalogo
    .filter((a) => a.icon)
    .filter((a) => {
      const p = new URL(`${a.id}.svg`, iconesDir);
      return !existsSync(p) || statSync(p).size === 0;
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

test("#1196: o ícone de todo app existe em disco e NÃO é raster renomeado .svg", () => {
  // O `icon: true` do JSON é afirmação do gerador. Aqui o arquivo é ABERTO — foi
  // assim que a curadoria achou 220 JPEG/PNG com extensão .svg (#1153).
  const semArquivo: string[] = [];
  const raster: string[] = [];
  for (const a of catalogo) {
    if (!a.icon) continue;
    const arq = new URL(`${a.id}.svg`, iconesDir);
    if (!existsSync(arq)) {
      semArquivo.push(a.id);
      continue;
    }
    const buf = readFileSync(arq);
    const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const png =
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const webp =
      buf.subarray(0, 4).toString("latin1") === "RIFF" &&
      buf.subarray(8, 12).toString("latin1") === "WEBP";
    if (jpeg || png || webp) raster.push(a.id);
  }

  assert.deepEqual(semArquivo, [], "`icon: true` sem arquivo em public/app-icons");

  // Ratchet: os 30 sobreviventes com ícone raster são dívida CONHECIDA, herdada do
  // scrape e escopo da fatia 2 do #1153. A lista só pode ENCOLHER — app novo com
  // raster reprova na hora, e app que sair daqui sem sair da lista também.
  const conhecidos = new Set(RASTER_HERDADO);
  const novos = raster.filter((id) => !conhecidos.has(id));
  const resolvidos = RASTER_HERDADO.filter((id) => !raster.includes(id));
  assert.deepEqual(
    [
      ...novos.map((id) => `NOVO raster: ${id}`),
      ...resolvidos.map((id) => `RESOLVIDO, tire da lista: ${id}`),
    ],
    [],
    "ícone raster renomeado .svg — renderiza a inicial, não o ícone (#1153 fatia 2)",
  );
});

/**
 * Os 30 sobreviventes da curadoria cujo ícone ainda é raster renomeado `.svg`.
 * Medido em `7a5c3e5`. É o escopo REAL da fatia 2 do #1153: a baseline global
 * tinha 237, mas 207 eram de apps que a curadoria removeu.
 */
const RASTER_HERDADO = [
  "brevo", "claude", "copyai", "cursor", "deepseek", "elevenlabs", "framer",
  "gamma", "gemini", "github-copilot", "google-ai-studio", "google-notebooklm",
  "google-tasks", "grok", "heygen", "jasper", "jenkins", "microsoft-copilot",
  "namecheap", "perplexity", "power-bi", "runway", "substack", "supabase",
  "unifi", "veeam",
];
