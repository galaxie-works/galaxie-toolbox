import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Gate anti-regressão do #1017 (US-filha do épico #1007 · desenho do Altair).
 *
 * O #1017 trocou ~34 escritas de dado do Bridge que, fora do Tauri, FINGIAM
 * sucesso (mock mentiroso) por `mockEscritaBloqueada()` — que rejeita. O teste
 * `api-mock-escrita.component.test.tsx` prova o comportamento, mas listava as
 * funções À MÃO: quem adicionasse uma escrita nova amanhã, com mock mentiroso,
 * passava — o teste só olhava as que alguém lembrou de listar.
 *
 * Este gate é ESTRUTURAL e falha-fechado, no padrão dos gates da casa
 * (`lumen-botoes-ast`, `lumen-i18n-hardcoded`): enumera o `api.ts` inteiro.
 *
 * INVARIANTE: toda função exportada de `api.ts` que chama `invoke(...)` ou
 * **tem `mockEscritaBloqueada()`** (escrita de dado do Bridge — falha alto no
 * mock) **ou está na allowlist explícita abaixo** (leitura, afordância de
 * dev-state, ou fs_explorer — que legitimamente não fingem escrita de Graph).
 *
 * Por que allowlist de NÃO-escrita, e não lista de verbos de escrita: lista de
 * verbos (`criar|editar|excluir…`) ENVELHECE — verbo novo escapa calado. A
 * allowlist falha fechado: função nova sem guarda e sem entrada aqui QUEBRA o
 * gate, forçando uma decisão consciente. (Princípio: invariante fechado bate
 * heurística aberta.)
 */

const API = fileURLToPath(new URL("./api.ts", import.meta.url));

// Baseline medido no #1017 / v0.41.0 (`075d239`): 125 funções que chamam
// `invoke` sem `mockEscritaBloqueada()` — todas legítimas (leitura / dev-state /
// fs_explorer). Adicionar aqui é uma DECISÃO: "esta invoke-caller nova não é
// escrita de dado do Bridge". Se for escrita, ela ganha a guarda, não uma linha
// aqui.
const ALLOWLIST_NAO_ESCRITA = new Set<string>([
  // — Leitura / sessão / queries (mock devolve dado fake; é o valor do dev) —
  "login", "detectTenant", "logout", "currentAccount", "requiredScopesStatus",
  "cachedIdentity", "restoreSession", "onedriveSettingsRead", "gdriveSettingsRead",
  "lockStatus", "lockVerifyPin", "listSites", "siteDetails", "onedriveFolders",
  "onedriveFolderDetails", "onedriveQuota", "onedriveTipos", "crReunioes", "crEmail",
  "crAtomsEmail", "crTarefas", "atomsOnedriveSync", "crTeamsDisponivel", "crAgenda",
  "crCalendarios", "crAgendaCalendario", "crCategorias", "crEventoCorpo",
  "crEventoRecorrencia", "crInboxDia", "crEmailCorpo", "crEmailSeguranca",
  "crMailFolders", "crValidarCaixa", "crMailSharedDisponivel", "crMailSendSharedDisponivel",
  "crSubpastas", "crFotosContatos", "crPessoas", "crPeopleList", "crPeopleOrganization",
  "crPeopleDirectory", "crPeopleGroups", "crPeopleGroupMembers", "crContactFolders",
  "crFolderContacts", "crPeopleEnrichPreview", "crPeopleWriteAvailable",
  "crOrgAdminAvailable", "crOrgSettings", "crTenantApps", "resetSessionMemo",
  "crMultiTenant", "crPeopleInteractions", "crFolderMensagens", "crBuscar", "crFiltrar",
  "crContar", "crContadores", "crInsightsRemetente", "crBaixarAnexo", "crSalvarEmailEml",
  "crLerAnexo", "crAnexoParaPdf", "crLerAnexoEmail", "crAnexoLink", "crSalvarEmailPdf",
  "crImprimirEmail", "longPathsStatus", "importBrowserBookmarks", "fetchFavicon",
  "autostartEnabled", "telemetryStatus", "telemetryDebugDump",
  // — Remote signaling (#1104/#1129): lookup de endpoint de config + PoP de
  //   registro (assinatura no Rust) + ponte de log de diagnóstico. NÃO são
  //   escrita de dado do Bridge/Graph; a exemção fica EXPLÍCITA aqui (antes,
  //   `remoteSignalingEndpoint` passava por acidente de posição vizinha ao
  //   `mockEscritaBloqueada`, que o scaffold v2 desfez ao inserir vizinhos). —
  "remoteSignalingEndpoint", "remoteSignalingEndpointV2", "remoteSignRegister",
  "remoteLog",
  // — Afordâncias de dev-state (mock persiste de propósito p/ visualizar a UI) —
  "onedriveSettingsWrite", "gdriveSettingsWrite", "lockSetPin", "lockDisablePin",
  "setAutostartEnabled", "telemetryTrack", "telemetrySetConsent", "telemetryRevoke",
  "connectSite", "disconnectSite", "mapearNetworkDrive", "desconectarNetworkDrive",
  "enableLongPaths",
  // — Abrir/revelar (ação local do SO, não escrita de Graph) —
  "abrirCaminho", "revelarNoExplorer", "openInExplorer", "openUrl", "abrirAppInterno",
  "revelarCaminho", "abrirCaminhoFs",
  // — fs_explorer (subsistema de arquivos LOCAL via Tauri, não Bridge/Graph) —
  "listarDir", "statCaminho", "tamanhoDir", "listarDrives", "listarCloudLocations",
  "dirsConhecidos", "gerarThumbnail", "iniciarVerificacaoDominio", "verificarDominio",
  "configurarCacheThumbnail", "obterMetricasThumbnail", "resetarMetricasThumbnail",
  "lerArquivoBytes", "listarDirStreamed", "buscarArquivos", "criarPasta", "criarArquivo",
  "renomear", "paraLixeira", "excluirPermanente", "copiarComProgresso",
  "moverComProgresso", "copiarVariasComProgresso", "moverVariasComProgresso",
  "cancelarOp", "pausarOp", "resumirOp", "previewUndo", "desfazerOp", "checarConflitos",
  "observarPasta",
]);

function funcoesQueChamamInvokeSemGuarda(src: string): string[] {
  const faltando: string[] = [];
  // mesma enumeração usada pra medir a allowlist: cada `export async function`
  const blocos = src.split(/(?=export async function )/);
  for (const b of blocos) {
    const m = b.match(/export async function (\w+)/);
    if (!m) continue;
    const nome = m[1];
    if (!/\binvoke[<(]/.test(b)) continue; // só quem fala com o backend
    if (b.includes("mockEscritaBloqueada")) continue; // escrita guardada — ok
    if (ALLOWLIST_NAO_ESCRITA.has(nome)) continue; // não-escrita consciente — ok
    faltando.push(nome);
  }
  return faltando;
}

test("#1017: toda invoke-caller de api.ts tem mockEscritaBloqueada() OU está na allowlist de não-escrita", () => {
  const src = readFileSync(API, "utf8");
  const faltando = funcoesQueChamamInvokeSemGuarda(src);
  assert.deepEqual(
    faltando,
    [],
    `Função(ões) de api.ts que chamam invoke() sem mockEscritaBloqueada() e fora da allowlist: ${faltando.join(", ")}.\n` +
      `Se for ESCRITA de dado do Bridge (mail/calendar/people/org/share), adicione 'if (!inTauri()) mockEscritaBloqueada();' — senão o mock finge sucesso (o bug do #1017).\n` +
      `Se for leitura / dev-state / fs_explorer, adicione o nome à ALLOWLIST_NAO_ESCRITA deste gate, conscientemente.`,
  );
});

test("#1017: a allowlist não apodrece — toda entrada ainda existe como função exportada em api.ts", () => {
  const src = readFileSync(API, "utf8");
  const exportadas = new Set(
    [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]),
  );
  const orfas = [...ALLOWLIST_NAO_ESCRITA].filter((n) => !exportadas.has(n));
  assert.deepEqual(
    orfas,
    [],
    `Entradas da allowlist que não existem mais em api.ts (remova-as): ${orfas.join(", ")}`,
  );
});
