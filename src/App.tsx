import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { telModuloAberto, telSessaoIniciada } from "@/lib/telemetria";
import { ErrorBoundary } from "@/components/error-boundary";
import { registrarHandlersGlobais } from "@/lib/log";
import { LoginScreen } from "@/screens/login";
import { TierProvider } from "@/lib/tier-context";
import { SitesScreen } from "@/screens/sites";
import { AppsScreen } from "@/screens/apps";
import { ControlRoomScreen } from "@/screens/control-room";
import { NavegadorScreen } from "@/screens/navegador";
import {
  loadNavigatorMemorySettings,
  loadNavigatorPrefs,
  persistNavigatorPrefs,
  loadPinnedNavigatorTabs,
  loadLastSession,
  orderPinnedFirst,
  persistPinnedNavigatorTabs,
  persistLastSession,
  tabsToSleep,
  type AbaBrowser,
  type TelaInterna,
} from "@/lib/navigator-tabs";
import {
  loadHistorico,
  persistHistorico,
  registrarVisita,
  limparHistorico,
  type HistoryEntry,
  type PeriodoLimpeza,
} from "@/lib/navigator-history";
import * as browser from "@/lib/browser";
import { ArquivosScreen } from "@/screens/arquivos";
import { ConfiguracoesScreen } from "@/screens/configuracoes";
import { AppSidebar } from "@/components/app-sidebar";
import { Atualizacao } from "@/components/atualizacao";
import { TelaBloqueio } from "@/components/tela-bloqueio";
import { BarraJanela, FaixaArrasto } from "@/components/barra-janela";
import { FundoApp } from "@/components/fundo-app";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { MenuUsuario } from "@/components/user-menu";
// #987: o sino do activity-dropdown vive na title bar (sempre visível). A máquina
// de `ops` está no `useOpsAtivas` (montado UMA vez aqui); as transferências
// seguem sendo disparadas pelo Explorer.
import { ActivityDropdown } from "@/components/explorer/activity-dropdown";
import { UndoPreviewDialog } from "@/components/explorer/undo-preview-dialog";
import { useOpsAtivas } from "@/components/explorer/use-ops-ativas";
// #1109: logo GALAXIE na title bar (clique = nova aba do Navigator).
import { GalaxieLogo } from "@/components/ui/icons/marca/galaxie-logo";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/animate-ui/components/radix/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TELAS, telaInicial, type Tela } from "@/lib/navegacao";
import {
  useAppStore,
  prepararConfiguracaoNuvem,
  reconciliarConfiguracaoNuvem,
  resetSessaoCompleta,
  suspenderConfiguracaoNuvem,
} from "@/store";
import type { AppUser, Identidade, Site } from "@/lib/types";
import * as api from "@/lib/api";
import { resolverOrgStatus } from "@/lib/organizations";
import { surfaceSuportada } from "@/lib/capabilities-surface";
import { useIdioma } from "@/lib/idioma";
import { cn, comLoginHint } from "@/lib/utils";
import type { AppM365 } from "@/lib/apps";
import {
  EVENTO_VIDEO_SPLASH,
  LONGSTOP_SPLASH_MS,
  revelarAppEFecharSplash,
} from "@/lib/splash";
import { KeyRound } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

// #1025 (FE11, parte B): code-split das telas de baixa frequência — saem do
// chunk `index` do boot e viram chunks próprios, carregados sob demanda quando o
// usuário navega até elas. Bridge (control-room, keep-alive), Navigator e Login
// seguem EAGER de propósito. Cada uso mora dentro de um <Suspense> (ver
// TelaFallback) que só suspende no lazy — telas eager passam direto.
const OnboardingEmpresaScreen = lazy(() =>
  import("@/screens/onboarding-empresa").then((m) => ({
    default: m.OnboardingEmpresaScreen,
  })),
);
const WindowsScreen = lazy(() =>
  import("@/screens/windows").then((m) => ({ default: m.WindowsScreen })),
);
const RemoteScreen = lazy(() =>
  import("@/screens/remote").then((m) => ({ default: m.RemoteScreen })),
);
const EmBreveScreen = lazy(() =>
  import("@/screens/em-breve").then((m) => ({ default: m.EmBreveScreen })),
);

/** Fallback centralizado enquanto o chunk da tela lazy chega (#1025). */
function TelaFallback() {
  return (
    <div className="grid h-full place-items-center">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  );
}

/**
 * Todo o app de verdade. Fica ABAIXO do ErrorBoundary (ver `App`): é esta árvore
 * que pode estourar num render, e o boundary a segura sem levar a tela toda pro
 * branco.
 */
function AppInner() {
  const { idioma, t } = useIdioma();
  // #987: assina o progresso das transferências (Tauri) UMA vez e expõe a fila +
  // handlers pro sino da title bar e pro preview de undo (ambos app-level agora).
  const atividade = useOpsAtivas();
  const setBridgeView = useAppStore((state) => state.setBridgeView);
  const reauthMissingScopes = useAppStore(
    (state) => state.reauthMissingScopes,
  );
  const reauthDismissed = useAppStore((state) => state.reauthDismissed);
  const setReauthMissingScopes = useAppStore(
    (state) => state.setReauthMissingScopes,
  );
  const dismissReauth = useAppStore((state) => state.dismissReauth);
  // #498 rework: o composer sem assinatura pede pra abrir a config (Bridge >
  // Envio). A ação de store seta item/frame + bumpa este nonce; aqui só falta
  // trocar a tela (App-level).
  const navConfigNonce = useAppStore((state) => state.navConfigNonce);
  const hydratePeopleM365 = useAppStore(
    (state) => state.hydratePeopleM365,
  );
  const resetPeopleSession = useAppStore(
    (state) => state.resetPeopleSession,
  );
  // #700 2b (parte 2): registro de orgs (fonte da flag `contratada` +
  // `dominiosVerificados`) — alimenta a derivação reativa do OrgStatus abaixo.
  const organizations = useAppStore((state) => state.organizations);
  const [user, setUser] = useState<AppUser | null>(null);
  // #698 (PS5): funcionário de empresa não-cliente (orgStatus "uncontracted") vê o
  // onboarding de lead-gen; ao "entrar assim mesmo", segue no tier pessoal.
  const [entrarComoPessoal, setEntrarComoPessoal] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loadingSites, setLoadingSites] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [lockState, setLockState] = useState<
    "checking" | "locked" | "unlocked" | "error"
  >("checking");
  const [lockCheck, setLockCheck] = useState(0);
  const [cache, setCache] = useState<Identidade | null>(null);
  // #718 (SH0): o app abre no Navigator. (Havia um dashboard Atoms como tela
  // inicial — #183 —; Atoms foi REMOVIDO do app em #1320, decisão do PO 19/08.)
  // O Bridge segue keep-alive (montado/escondido) pra voltar instantâneo.
  // #1299: quem decide é `telaInicial()` (funil único em `navegacao.ts`), que em
  // DEV honra `?tela=<id>` pra QA/script alcançarem telas ocultas por flag. Aqui
  // não se lê `location.search` — de propósito.
  const [tela, setTela] = useState<Tela>(telaInicial);
  // #498 rework: quando o composer pede a config de assinaturas (bumpa o nonce),
  // troca pra tela de Settings (a ação de store já selecionou Bridge > Envio).
  useEffect(() => {
    if (navConfigNonce > 0) setTela("configuracoes");
  }, [navConfigNonce]);
  // Splash (#164): a animação tocou até o fim uma vez? Um dos dois gates da
  // revelação (o outro é `bootPronto`).
  const [videoPronto, setVideoPronto] = useState(false);
  // Abas do navegador embutido (cada uma vira um webview nativo no Rust).
  const [abas, setAbas] = useState<AbaBrowser[]>(loadPinnedNavigatorTabs);
  const [abaAtiva, setAbaAtiva] = useState<string | null>(null);
  // #876: alvo (na title bar) pro portal da tab strip do Navigator. Callback-ref
  // por estado pra o NavegadorScreen re-renderizar quando o nó existir e então
  // teleportar a strip pra cá. Null enquanto o header não montou (ou telas sem
  // title bar) → a strip cai no fallback inline.
  const [tabSlot, setTabSlot] = useState<HTMLElement | null>(null);
  // #1290: 2º slot da title bar, logo DEPOIS do sino. O Navigator teleporta
  // seus ícones (favoritos/histórico/paleta) pra cá, e é ESTE arquivo que
  // decide a ordem da fileira — antes ela era um acidente de quem portalizava
  // primeiro, e o sino acabava à direita dos três.
  const [chromeSlot, setChromeSlot] = useState<HTMLElement | null>(null);
  // #454: bump a cada nova aba pra REMONTAR o Launcher (key) e re-focar o command
  // mesmo quando já estávamos na aba vazia (setAbaAtiva(null) seria no-op).
  const [launcherNonce, setLauncherNonce] = useState(0);
  // Pilha de abas fechadas recentemente (#272 · Ctrl+Shift+T). Só url/nome; teto
  // de 25 pra não crescer sem limite.
  const [fechadas, setFechadas] = useState<{ url: string; nome: string }[]>([]);
  const [navigatorClock, setNavigatorClock] = useState(0);
  // Historico de navegacao (Story 5): capturado nos pontos onde o app commita
  // uma URL num webview (abrir app / omnibox / favorito). Persistido em
  // localStorage, igual aos pins/grupos/favoritos.
  const [historico, setHistorico] = useState<HistoryEntry[]>(loadHistorico);
  // Modo privado: enquanto ligado, novas abas nao gravam historico e ganham
  // tratamento visual distinto (aba "privada"). Nasce do "Private mode only"
  // (#326): com a pref ligada, o app já abre em modo privado por padrão.
  const [modoPrivado, setModoPrivado] = useState(
    () => loadNavigatorPrefs().semprePrivado,
  );
  // Sessão anterior (#274): capturado UMA vez no mount (antes do persist effect
  // sobrescrever), pra oferecer restaurar. `dispensada` esconde o oferecimento.
  const [sessaoAnterior] = useState(loadLastSession);
  const [sessaoDispensada, setSessaoDispensada] = useState(false);

  useEffect(() => {
    persistPinnedNavigatorTabs(abas);
  }, [abas]);

  // Telemetria (#390, S4). Só emite após autenticar; a policy (consent/sampling)
  // é do Rust — aqui só descrevemos o QUÊ, via a fachada tipada.
  const sessaoEmitida = useRef(false);
  useEffect(() => {
    if (user && !sessaoEmitida.current) {
      sessaoEmitida.current = true;
      telSessaoIniciada();
    }
  }, [user]);
  // `module_opened` a cada troca de módulo (e no primeiro, ao autenticar).
  useEffect(() => {
    if (user) telModuloAberto(tela);
  }, [tela, user]);

  // Snapshot da sessão a cada mudança (não pinadas, não privadas). No próximo
  // boot vira a "sessão anterior" a oferecer.
  useEffect(() => {
    persistLastSession(abas);
  }, [abas]);

  useEffect(() => {
    persistHistorico(historico);
  }, [historico]);

  // #307: poda o histórico pela retenção configurada (0 = sempre). Roda no tick
  // do navigatorClock → aplica mudança de retenção e envelhecimento em ≤60s.
  useEffect(() => {
    const dias = loadNavigatorPrefs().retencaoDias;
    if (dias <= 0) return;
    const corte = Date.now() - dias * 86_400_000;
    setHistorico((prev) => {
      const podado = prev.filter((e) => e.ts >= corte);
      return podado.length === prev.length ? prev : podado;
    });
  }, [navigatorClock]);

  // #307: "Limpar histórico" no Settings dispara este evento; relemos do disco.
  useEffect(() => {
    const onLimpo = () => setHistorico(loadHistorico());
    window.addEventListener("galaxie:historico-limpo", onLimpo);
    return () => window.removeEventListener("galaxie:historico-limpo", onLimpo);
  }, []);

  // #326: o atalho "Turn off" no hero da aba privada desliga o "Private mode
  // only" — persiste a pref e sai do modo privado na hora.
  useEffect(() => {
    const onDesligar = () => {
      persistNavigatorPrefs({
        ...loadNavigatorPrefs(),
        semprePrivado: false,
      });
      setModoPrivado(false);
    };
    window.addEventListener("galaxie:private-only-off", onDesligar);
    return () =>
      window.removeEventListener("galaxie:private-only-off", onDesligar);
  }, []);

  // Ponto unico de captura: so grava fora do modo privado, com "salvar histórico"
  // ligado (#307) e so http(s).
  // `privadoOverride` (#340): ações originadas do histórico/sessão passam o
  // contexto explícito (normal) em vez de herdar o `modoPrivado` ad-hoc da aba
  // de origem — o setState de modoPrivado só valeria no próximo tick.
  function registrarHistorico(
    url: string,
    nome: string,
    privadoOverride?: boolean,
  ) {
    const privado = privadoOverride ?? modoPrivado;
    if (privado || !loadNavigatorPrefs().salvarHistorico) return;
    setHistorico((prev) => registrarVisita(prev, { url, nome }));
  }

  function limparHistoricoPeriodo(periodo: PeriodoLimpeza) {
    setHistorico((prev) => limparHistorico(prev, periodo));
  }

  useEffect(() => {
    const timer = window.setInterval(
      () => setNavigatorClock((current) => current + 1),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  // #310: no boot, destrói webviews-filhas órfãs que sobrevivem a um reload do
  // app inteiro (o ghost que pintava por cima da Mailbox). Pins voltam dormindo,
  // recriados no clique — nada se perde.
  useEffect(() => {
    void browser.fecharTodas();
  }, []);

  useEffect(() => {
    // Lê fresh do localStorage (#306): o painel Settings>Navigator>Tabs altera as
    // prefs e o eviction reage no próximo tick/interação. Off → nada dorme.
    const settings = loadNavigatorMemorySettings();
    if (!settings.ativo) return;
    const ids = tabsToSleep(abas, abaAtiva, settings, Date.now());
    if (ids.length === 0) return;
    const selected = new Set(ids);
    for (const id of ids) void browser.fechar(id);
    setAbas((current) =>
      current.map((tab) =>
        selected.has(tab.id)
          ? { ...tab, estado: "dormindo", reativando: false }
          : tab,
      ),
    );
  }, [abaAtiva, abas, navigatorClock]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        api.cachedIdentity().then((id) => vivo && setCache(id));
        const status = await api.lockStatus();
        if (vivo) setLockState(status.enabled ? "locked" : "unlocked");
      } catch {
        // Falha fechada: nenhum conteúdo protegido é restaurado enquanto não
        // conseguirmos confirmar se existe um PIN.
        if (vivo) setLockState("error");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [lockCheck]);

  useEffect(() => {
    if (lockState !== "unlocked") return;
    let vivo = true;
    setRestoring(true);
    (async () => {
      try {
        const u = await api.restoreSession();
        if (!vivo) return;
        if (u) {
          resetPeopleSession();
          prepararConfiguracaoNuvem(u.email, u.provider);
          setUser(u);
          void reconciliarConfiguracaoNuvem().catch(() => {
            // Offline/Graph indisponível: mantém o cache local desta conta.
          });
          // #783: conta Google não fala MS Graph. A nuvem do Google é Drive/appData
          // (reconciliar acima). Mail/Calendar/Contacts/OneDrive pessoal existem no
          // MS pessoal, então People+scopes seguem pra qualquer conta MS.
          if (u.provider !== "google") {
            void hydratePeopleM365({ force: true });
            const permissions = await api.requiredScopesStatus();
            if (!vivo) return;
            setReauthMissingScopes(permissions.missingScopes);
            // #802 (P0): /sites (+sonda children+expand) é ORG-ONLY — conta MS
            // PESSOAL não tem SharePoint. Só chama em conta work; e um 400/403 aqui
            // NÃO é falha de auth → degrada (sites vazio), NUNCA desloga.
            if (u.accountKind === "work") {
              setLoadingSites(true);
              try {
                const lista = await api.listSites();
                if (!vivo) return;
                setSites(lista);
                carregarDetalhes(lista);
              } catch (e) {
                console.warn("[boot] listSites falhou — degradando sem deslogar:", e);
                setSites([]);
              }
            }
          }
        }
      } catch {
        // sessao invalida: cai no login normal
      } finally {
        if (vivo) {
          setRestoring(false);
          setLoadingSites(false);
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, [
    hydratePeopleM365,
    lockState,
    resetPeopleSession,
    setReauthMissingScopes,
  ]);

  // #700 2b (parte 2): deriva o OrgStatus canônico (#698/PS5) do REGISTRO DE ORGS
  // assim que ele assenta. As orgs (CHAVES_CONFIG_NUVEM #560) hidratam ASSÍNCRONO
  // — depois do setUser, pela reconciliação de nuvem — então a derivação tem que
  // ser REATIVA, não inline no login: inline veria orgs vazias e daria
  // none/uncontracted errado. Refina o provisório que o PS0 dá do token:
  // work-cliente→contracted, work-não-cliente→uncontracted, personal do domínio
  // do cliente→contracted (absorção JIT), resto→none. Só no app real (Tauri);
  // no mock/web o tier vem do ?mockOrg de QA (não sobrescreve).
  useEffect(() => {
    if (!api.inTauri() || !user) return;
    const derivado = resolverOrgStatus(user, organizations);
    if (derivado !== user.orgStatus) {
      setUser((atual) => (atual ? { ...atual, orgStatus: derivado } : atual));
    }
  }, [user, organizations]);

  // --- Splash de boot (#164) ---------------------------------------------
  // Dois gates para revelar a main: o app só aparece depois que a animação
  // tocou inteira (`videoPronto`) E o boot terminou (`bootPronto`) — o que vier
  // por último.
  //
  // "bootPronto" = já dá para mostrar uma tela de verdade na main window: o
  // bloqueio (#122), o login ou o app. Enquanto sonda o PIN (`checking`) ou
  // restaura a sessão (`restoring`), a main segue oculta e vê-se só o splash.
  const bootPronto =
    lockState === "locked" ||
    lockState === "error" ||
    (lockState === "unlocked" && !restoring);

  // "videoPronto" vem da OUTRA janela (a `splashscreen`), que emite
  // EVENTO_VIDEO_SPLASH quando o vídeo termina. Fora do Tauri (dev no browser)
  // não há splash nem evento: libera o gate para não bloquear o render.
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      setVideoPronto(true);
      return;
    }
    let vivo = true;
    let desescutar: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen(EVENTO_VIDEO_SPLASH, () => setVideoPronto(true));
        if (vivo) desescutar = off;
        else off();
      } catch {
        // Sem API de evento: libera o gate (o longstop também cobre) para não
        // deixar a main presa atrás do splash.
        setVideoPronto(true);
      }
    })();
    return () => {
      vivo = false;
      desescutar?.();
    };
  }, []);

  useEffect(() => {
    // Revela quando OS DOIS estiverem prontos — o que vier por último. Sem
    // mínimo artificial: a própria animação (que roda inteira) é o piso.
    if (!bootPronto || !videoPronto) return;
    void revelarAppEFecharSplash();
  }, [bootPronto, videoPronto]);

  // #821 (P0): a fronteira de conta (resetSessaoCompleta) zera o STORE
  // tenant-scoped, mas as abas do Navigator vivem em useState LOCAL do App — que
  // NÃO desmonta no logout→login. Sem isto a conta nova herda as abas da anterior
  // (a aba Bridge que vazou pra conta Google). Zera o estado in-memory do
  // Navegador: abas, aba ativa e a pilha de fechadas (senão Ctrl+Shift+T
  // reabriria aba da conta anterior). O disco é purgado pelo resetSessaoNavegador
  // (dentro do resetSessaoCompleta, parte do #821); as abas internas
  // (Bridge/Files/Remote) reabrem sob demanda pelo rail, já gateadas pela
  // capability da conta nova.
  //
  // #821 deeper: o HISTÓRICO de navegação também é tenant-scoped (privacidade — a
  // conta nova não pode ver os sites que a anterior visitou). Ele vive em useState
  // + localStorage (`galaxie.navigator.history.v1`), fora do store, então escapava
  // do reset. Zera in-memory E no disco (explícito, não confia na ordem do effect).
  function resetNavegadorSessao() {
    setAbas([]);
    setAbaAtiva(null);
    setFechadas([]);
    setHistorico([]);
    persistHistorico([]);
  }

  async function handleLogin(provider: api.AuthProvider, hint: string) {
    setLoginLoading(true);
    setError(null);
    // #555 (P0): fronteira de conta — zera TODO o estado tenant-scoped (mailbox,
    // agenda, organizations, branding, memos Rust, fotos…) antes de trocar de
    // conta, pra a conta nova não herdar dado do tenant anterior.
    await resetSessaoCompleta();
    resetNavegadorSessao(); // #821: zera as abas in-memory da conta anterior
    try {
      // #695: `hint` = login_hint OPCIONAL; `provider` escolhe a porta (o backend
      // PS0/PS1 mapeia pro registration certo — org de produção vs pessoal).
      const u = await api.login(hint, idioma, provider);
      prepararConfiguracaoNuvem(u.email, u.provider);
      setUser(u);
      void reconciliarConfiguracaoNuvem().catch(() => {
        // Login não falha por indisponibilidade temporária da configuração.
      });
      // #718 (SH0): home = Navigator. Login (nova conta ou re-login) nunca herda
      // o último módulo (o resetSessaoCompleta já zerou o nav).
      //
      // #1299 (achado da Íris): aqui era `setTela("navegador")` LITERAL, e ele
      // anulava a porta `?tela=` — fora do Tauri não existe sessão persistida,
      // então TODO acesso pelo navegador passa por este caminho, que é
      // exatamente o ambiente que o AC nomeia (`pnpm dev`). O #718 fica intacto:
      // sem `?tela=`, `telaInicial()` devolve `TELA_PADRAO` = "navegador".
      // Chamar o funil em vez do literal mantém UM lugar decidindo tela inicial.
      setTela(telaInicial());
      // #783: Google não fala MS Graph (nuvem = Drive/appData). Mail/Cal/Contacts/
      // OneDrive pessoal existem no MS pessoal → People+scopes seguem pra qualquer MS.
      if (u.provider !== "google") {
        void hydratePeopleM365({ force: true });
        const permissions = await api.requiredScopesStatus();
        setReauthMissingScopes(permissions.missingScopes);
        // #802 (P0): /sites é ORG-ONLY — conta MS PESSOAL não tem SharePoint. Só em
        // conta work; e um 400/403 aqui NÃO é falha de auth → degrada, NUNCA desloga
        // (era o catch abaixo com setUser(null) chutando o usuário pro login).
        if (u.accountKind === "work") {
          setLoadingSites(true);
          try {
            const lista = await api.listSites();
            setSites(lista);
            carregarDetalhes(lista);
          } catch (e) {
            console.warn("[login] listSites falhou — degradando sem deslogar:", e);
            setSites([]);
          }
        }
      }
    } catch (e) {
      setError(String(e));
      setUser(null);
    } finally {
      setLoginLoading(false);
      setLoadingSites(false);
    }
  }

  /**
   * Numeros das bibliotecas, buscados depois que a lista ja apareceu.
   * Fila com pouca concorrencia de proposito: sao 3 requisicoes por site e o
   * Graph devolve 429 se dispararmos todos os sites de uma vez.
   */
  async function carregarDetalhes(lista: Site[]) {
    const fila = lista.filter((s) => s.status !== "noaccess");
    const naFila = new Set(fila.map((s) => s.key));
    setSites((prev) =>
      prev.map((s) => (naFila.has(s.key) ? { ...s, detalhes: "carregando" } : s))
    );

    let i = 0;
    const worker = async () => {
      while (i < fila.length) {
        const alvo = fila[i++];
        let det: Partial<Site> = {};
        try {
          det = await api.siteDetails(alvo);
        } catch {
          // sem numeros: aquele chip some, em vez de girar pra sempre
        }
        setSites((prev) =>
          prev.map((s) =>
            s.key === alvo.key ? { ...s, ...det, detalhes: "pronto" } : s
          )
        );
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  function patch(key: string, status: Site["status"]) {
    setSites((prev) => prev.map((s) => (s.key === key ? { ...s, status } : s)));
  }

  async function connect(target: Site) {
    if (target.status === "connected" || target.status === "connecting") return;
    setError(null);
    patch(target.key, "connecting");
    try {
      await api.connectSite(target);
      patch(target.key, "connected");
    } catch (e) {
      setError(String(e));
      patch(target.key, "available");
    }
  }

  async function disconnect(target: Site) {
    if (target.status !== "connected") return;
    setError(null);
    patch(target.key, "connecting");
    try {
      await api.disconnectSite(target);
      patch(target.key, "available");
    } catch (e) {
      setError(String(e));
      patch(target.key, "connected");
    }
  }

  async function openSite(target: Site) {
    try {
      await api.openInExplorer(target.name);
    } catch (e) {
      setError(String(e));
    }
  }

  /** Abre o app como ABA do navegador embutido e vai para a tela dele. */
  function abrirAppAqui(app: AppM365) {
    const url = comLoginHint(app.url, user?.email);
    const now = Date.now();
    setAbas((prev) => {
      const existing = prev.find((tab) => tab.id === app.id);
      const next = prev.map((tab) =>
        tab.id === app.id
          ? {
              ...tab,
              nome: app.nome,
              url,
              estado: "ativa" as const,
              ultimoAcesso: now,
              reativando: tab.estado === "dormindo",
            }
          : tab.estado === "dormindo"
            ? tab
            : { ...tab, estado: "fundo" as const },
      );
      if (existing) return orderPinnedFirst(next);
      return orderPinnedFirst([
        ...next,
        {
          id: app.id,
          nome: app.nome,
          url,
          estado: "ativa",
          ultimoAcesso: now,
          privada: modoPrivado,
        },
      ]);
    });
    registrarHistorico(url, app.nome);
    setAbaAtiva(app.id);
    setTela("navegador");
  }

  /** Abre uma URL/busca livre (da omnibox do Cruiser) como aba própria. */
  function abrirUrlLivre(url: string, nome: string, privadoOverride?: boolean) {
    const privado = privadoOverride ?? modoPrivado;
    const id = `web-${Date.now()}`;
    const now = Date.now();
    setAbas((prev) =>
      orderPinnedFirst([
        ...prev.map((tab) =>
          tab.estado === "dormindo"
            ? tab
            : { ...tab, estado: "fundo" as const },
        ),
        { id, nome, url, estado: "ativa", ultimoAcesso: now, privada: privado },
      ]),
    );
    registrarHistorico(url, nome, privado);
    setAbaAtiva(id);
    setTela("navegador");
  }

  /**
   * #719 (SH1): abre (ou foca, se já aberta) a tela interna Bridge/Files/Remote
   * como ABA do Navigator. Foca-se-já-aberto por `tela` (não duplica). Sempre
   * aterrissa no Navigator (é onde a aba vive). A tela React é montada dentro do
   * slot de conteúdo do Navigator (keep-alive), não é webview.
   */
  function abrirTelaInterna(telaInterna: TelaInterna) {
    // #821 (P0) parte 2: gate de capability por SUPERFÍCIE. O Bridge (control-room)
    // bate em MS mail — conta sem essa superfície (Google, ou MS sem mail) NÃO pode
    // abri-lo. Backstop AUTORITATIVO: o rail já esconde o botão, mas command/atalho/
    // deep-link (#657) também funilam aqui, então o gate mora no choke-point. Files/
    // Remote são universais (locais), seguem livres.
    if (telaInterna === "control-room" && !surfaceSuportada(user, "mail")) {
      return;
    }
    const now = Date.now();
    const nome =
      telaInterna === "control-room"
        ? t.sidebar.bridge
        : telaInterna === "arquivos"
          ? t.sidebar.files
          : t.sidebar.remote;
    const existente = abas.find(
      (a) => a.tipo === "interna" && a.tela === telaInterna,
    );
    const id = existente ? existente.id : `interna-${telaInterna}-${now}`;
    setAbas((prev) => {
      const rebaixadas = prev.map((tab) =>
        tab.estado === "dormindo"
          ? tab
          : { ...tab, estado: "fundo" as const, reativando: false },
      );
      // Foca a existente (não duplica) ou anexa a nova aba interna.
      if (prev.some((a) => a.id === id)) {
        return orderPinnedFirst(
          rebaixadas.map((tab) =>
            tab.id === id
              ? { ...tab, estado: "ativa" as const, ultimoAcesso: now }
              : tab,
          ),
        );
      }
      return orderPinnedFirst([
        ...rebaixadas,
        {
          id,
          nome,
          url: `galaxie://tela/${telaInterna}`,
          estado: "ativa",
          ultimoAcesso: now,
          tipo: "interna",
          tela: telaInterna,
        },
      ]);
    });
    setAbaAtiva(id);
    setTela("navegador");
  }

  // #872 parte 2: "Nova guia do Files" — SEMPRE abre uma aba de Files NOVA (ao
  // contrário do `abrirTelaInterna`, que é singleton e foca a existente). Cada
  // aba é uma instância própria do ExplorerShell (key por id no Navigator) e
  // nasce no This PC (#870). Id com sufixo aleatório pra nunca colidir com uma
  // aba criada no mesmo ms.
  function novaAbaFiles() {
    const now = Date.now();
    const id = `interna-arquivos-${now}-${Math.floor(Math.random() * 1e6)}`;
    setAbas((prev) => {
      const rebaixadas = prev.map((tab) =>
        tab.estado === "dormindo"
          ? tab
          : { ...tab, estado: "fundo" as const, reativando: false },
      );
      return orderPinnedFirst([
        ...rebaixadas,
        {
          id,
          nome: t.sidebar.files,
          url: `galaxie://tela/arquivos`,
          estado: "ativa",
          ultimoAcesso: now,
          tipo: "interna",
          tela: "arquivos",
        },
      ]);
    });
    setAbaAtiva(id);
    setTela("navegador");
  }

  /**
   * #719 (SH1): roteia navegação de tela. Bridge/Files/Remote viram ABAS do
   * Navigator (foca-se-aberto); todo o resto continua troca de tela top-level.
   * Ponto único usado pelo rail (SH0) e pelo command "Ir para".
   */
  function navegarPara(destino: Tela) {
    if (
      destino === "control-room" ||
      destino === "arquivos" ||
      destino === "remote"
    ) {
      abrirTelaInterna(destino);
    } else {
      setTela(destino);
    }
  }

  /** Restaura várias entradas de histórico como abas novas (#177). Ids únicos
   *  (Date.now pode repetir num mesmo tick); a última vira ativa. */
  function restaurarAbas(entradas: { url: string; nome: string }[]) {
    if (entradas.length === 0) return;
    // #340: restaurar do histórico/sessão SEMPRE abre em contexto NORMAL — nunca
    // herda o modo privado ad-hoc da aba de onde a ação foi disparada. Privado
    // não persiste histórico; restaurar em privado perderia o histórico dessas
    // abas silenciosamente. Alinha o contexto global pras próximas navegações.
    setModoPrivado(false);
    const base = Date.now();
    const novas: AbaBrowser[] = entradas.map((entrada, i) => ({
      id: `web-${base}-${i}`,
      nome: entrada.nome,
      url: entrada.url,
      estado: i === entradas.length - 1 ? "ativa" : "fundo",
      ultimoAcesso: base + i,
      privada: false,
    }));
    setAbas((prev) =>
      orderPinnedFirst([
        ...prev.map((tab) =>
          tab.estado === "dormindo" ? tab : { ...tab, estado: "fundo" as const },
        ),
        ...novas,
      ]),
    );
    for (const entrada of entradas)
      registrarHistorico(entrada.url, entrada.nome, false);
    setAbaAtiva(novas[novas.length - 1].id);
    setTela("navegador");
  }

  /** Restaura as abas da sessão anterior (#274) e dispensa o oferecimento. */
  function restaurarSessao() {
    restaurarAbas(sessaoAnterior);
    setSessaoDispensada(true);
  }

  function dispensarSessao() {
    setSessaoDispensada(true);
  }

  function trocarAba(id: string) {
    const now = Date.now();
    setAbas((prev) =>
      prev.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              estado: "ativa",
              ultimoAcesso: now,
              reativando: tab.estado === "dormindo",
            }
          : tab.estado === "dormindo"
            ? tab
            : { ...tab, estado: "fundo", reativando: false },
      ),
    );
    setAbaAtiva(id);
  }

  // #872: a aba de Files reporta seu local atual (via ExplorerShell → renderTela
  // Interna) e aqui viramos "Files - <local>" no nome + guardamos o caminho
  // completo pro tooltip do chip. GUARD de no-op (retorna o mesmo array quando
  // nada mudou) — o callback do shell é recriado a cada render, então sem o guard
  // isso entraria em loop de setstate.
  function atualizarLocalAba(
    abaId: string,
    info: { rotulo: string; caminho: string },
  ) {
    const nome = `${t.sidebar.files} - ${info.rotulo}`;
    setAbas((prev) => {
      const alvo = prev.find((a) => a.id === abaId);
      if (
        !alvo ||
        (alvo.nome === nome && alvo.caminhoLocal === info.caminho)
      ) {
        return prev;
      }
      return prev.map((a) =>
        a.id === abaId ? { ...a, nome, caminhoLocal: info.caminho } : a,
      );
    });
  }

  function abrirAbaVazia() {
    setAbas((prev) =>
      prev.map((tab) =>
        tab.estado === "dormindo"
          ? tab
          : { ...tab, estado: "fundo", reativando: false },
      ),
    );
    setAbaAtiva(null);
    // #454 (regressão): quando o Launcher já está na tela, `setAbaAtiva(null)` é
    // no-op e o Launcher não remonta → o command não re-recebe foco (o clique no
    // "+" o deixou no botão). Bump do nonce força o REMOUNT do Launcher (key), o
    // que re-dispara o foco-ao-montar do command.
    setLauncherNonce((n) => n + 1);
  }

  // Nova aba normal sai do modo privado; nova aba privada entra (#273). O
  // `modoPrivado` é herdado pela próxima navegação (`privada` da aba). Com
  // "Private mode only" (#326) ligado, a aba "normal" também nasce privada.
  function novaAba() {
    setModoPrivado(loadNavigatorPrefs().semprePrivado);
    abrirAbaVazia();
  }

  function novaAbaPrivada() {
    setModoPrivado(true);
    abrirAbaVazia();
  }

  function fecharAba(id: string) {
    void browser.fechar(id);
    const alvo = abas.find((a) => a.id === id);
    if (alvo) {
      // Empilha pra reabrir com Ctrl+Shift+T (#272), teto de 25.
      setFechadas((prev) =>
        [{ url: alvo.url, nome: alvo.nome }, ...prev].slice(0, 25),
      );
    }
    const resto = abas.filter((a) => a.id !== id);
    setAbas(resto);
    if (abaAtiva === id) {
      const prox = [...resto].sort(
        (left, right) => right.ultimoAcesso - left.ultimoAcesso,
      )[0];
      if (prox) trocarAba(prox.id);
      else setAbaAtiva(null);
      // Sem abas: permanece no Navigator com a aba em branco (Launcher), em vez
      // de chutar o usuário para a lista de Apps (#24).
    }
  }

  /** Reabre a última aba fechada (#272 · Ctrl+Shift+T). #340: reabrir também não
   *  herda o privado ad-hoc — volta em contexto normal (senão perderia histórico
   *  da aba reaberta pela mesma razão do restaurar). */
  function reabrirFechada() {
    const ultima = fechadas[0];
    if (!ultima) return;
    setFechadas((prev) => prev.slice(1));
    setModoPrivado(false);
    abrirUrlLivre(ultima.url, ultima.nome, false);
  }

  /** Fecha todas as abas menos a clicada (e as fixadas), deixando-a ativa (#275). */
  function fecharOutras(id: string) {
    const manter = new Set(
      abas.filter((a) => a.id === id || a.fixada).map((a) => a.id),
    );
    for (const aba of abas) {
      if (!manter.has(aba.id)) void browser.fechar(aba.id);
    }
    const now = Date.now();
    setAbas((prev) =>
      prev
        .filter((a) => manter.has(a.id))
        .map((a) =>
          a.id === id
            ? { ...a, estado: "ativa", ultimoAcesso: now, reativando: false }
            : a.estado === "ativa"
              ? { ...a, estado: "fundo" }
              : a,
        ),
    );
    setAbaAtiva(id);
  }

  function dormirAba(id: string) {
    const target = abas.find((tab) => tab.id === id);
    if (
      !target ||
      target.id === abaAtiva ||
      target.fixada ||
      target.manterAcordada
    ) {
      return;
    }
    void browser.fechar(id);
    setAbas((prev) =>
      prev.map((tab) =>
        tab.id === id
          ? { ...tab, estado: "dormindo", reativando: false }
          : tab,
      ),
    );
  }

  function dormirOutras(id: string) {
    const ids = abas
      .filter(
        (tab) =>
          tab.id !== id &&
          tab.id !== abaAtiva &&
          tab.estado === "fundo" &&
          !tab.fixada &&
          !tab.manterAcordada,
      )
      .map((tab) => tab.id);
    if (ids.length === 0) return;
    const selected = new Set(ids);
    for (const tabId of ids) void browser.fechar(tabId);
    setAbas((prev) =>
      prev.map((tab) =>
        selected.has(tab.id)
          ? { ...tab, estado: "dormindo", reativando: false }
          : tab,
      ),
    );
  }

  function alternarFixada(id: string) {
    setAbas((prev) =>
      orderPinnedFirst(
        prev.map((tab) =>
          tab.id === id ? { ...tab, fixada: !tab.fixada } : tab,
        ),
      ),
    );
  }

  function alternarManterAcordada(id: string) {
    setAbas((prev) =>
      prev.map((tab) =>
        tab.id === id
          ? { ...tab, manterAcordada: !tab.manterAcordada }
          : tab,
      ),
    );
  }

  function concluirReativacao(id: string) {
    setAbas((prev) =>
      prev.map((tab) =>
        tab.id === id ? { ...tab, reativando: false } : tab,
      ),
    );
  }

  /**
   * Reordena as abas conforme a ordem de ids vinda da strip (drag de grupo/lane,
   * Story 3). Ordem de chip pura: não toca em `abaAtiva`/url, então nenhuma
   * webview reposiciona (spec §5.1). Os grupos vivem desacoplados no
   * `navegador.tsx`; aqui só aplicamos a permutação sobre `abas`.
   */
  function reordenarAbas(ids: string[]) {
    setAbas((prev) => {
      const porId = new Map(prev.map((tab) => [tab.id, tab]));
      const reordenadas = ids
        .map((id) => porId.get(id))
        .filter((tab): tab is AbaBrowser => tab != null);
      // Fallback: preserva qualquer aba ausente da lista (não deve ocorrer, mas
      // evita perder abas se a strip mandar uma ordem parcial).
      const enviadas = new Set(ids);
      const faltantes = prev.filter((tab) => !enviadas.has(tab.id));
      return [...reordenadas, ...faltantes];
    });
  }

  async function abrirUrl(url: string) {
    try {
      await api.openUrl(url);
    } catch (e) {
      setError(String(e));
    }
  }


  async function logout() {
    suspenderConfiguracaoNuvem();
    await api.logout();
    // #555 (P0): fronteira de conta — reset completo de sessão (inclui fotos,
    // reauth, mailbox, agenda, organizations, branding, memos Rust…).
    await resetSessaoCompleta();
    resetNavegadorSessao(); // #821: zera as abas in-memory da conta que saiu
    setUser(null);
    setEntrarComoPessoal(false); // #698: não herda o "entrar assim mesmo" pra próxima conta
    setSites([]);
    setError(null);
    // #718 (SH0): home = Navigator — não deixa o módulo anterior ativo pro próximo login.
    setTela("navegador");
  }

  async function recuperarBloqueio() {
    suspenderConfiguracaoNuvem();
    await api.logout();
    // #555 (P0): recuperação de bloqueio também sai da conta → reset completo.
    await resetSessaoCompleta();
    resetNavegadorSessao(); // #821: zera as abas in-memory da conta que saiu
    setUser(null);
    setEntrarComoPessoal(false); // #698: idem — reset da fronteira de conta
    setSites([]);
    setError(null);
    setCache(null);
    setRestoring(true);
    setLockState("unlocked");
  }

  if (lockState === "locked" || lockState === "error") {
    return (
      <TelaBloqueio
        identidade={cache}
        statusIndisponivel={lockState === "error"}
        onDesbloquear={() => setLockState("unlocked")}
        onRecuperar={recuperarBloqueio}
        onTentarStatusNovamente={() => {
          setLockState("checking");
          setLockCheck((atual) => atual + 1);
        }}
      />
    );
  }

  // --- Retomando a sessao -------------------------------------------------
  if (lockState === "checking" || restoring) {
    return (
      <div className="relative grid h-full place-items-center overflow-hidden">
        <FaixaArrasto />
        <BarraJanela />
        <FundoApp />
        <div className="relative flex flex-col items-center gap-4">
          <Avatar className="logo-in size-18 ring-2 ring-border">
            {cache?.photo && <AvatarImage src={cache.photo} alt="" />}
            <AvatarFallback className="text-xl">
              {cache?.initials ?? "·"}
            </AvatarFallback>
          </Avatar>
          <div className="text-center">
            {cache?.displayName && (
              <SoftBlurIn className="text-[17px] font-medium" delay={220}>
                {cache.displayName}
              </SoftBlurIn>
            )}
            <SoftBlurIn
              className="mt-1 block text-sm text-muted-foreground"
              delay={cache?.displayName ? 520 : 220}
              stagger={16}
            >
              {t.carregando.preparando}
            </SoftBlurIn>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} loading={loginLoading} error={error} />;
  }

  // #698 (PS5): roteamento dos 3 estados por `orgStatus` (canônico do PS0, vindo do
  // login real). `none` (pessoal) e `contracted` (org) caem no app; `uncontracted`
  // — funcionário de empresa NÃO contratada — vê o onboarding de lead-gen, mas não
  // bloqueia: "entrar assim mesmo" segue no tier pessoal. A degradação graciosa das
  // features org p/ conta pessoal é o follow-on do PS2, gated no accountKind (já no
  // AppUser do PS0).
  if (user.orgStatus === "uncontracted" && !entrarComoPessoal) {
    return (
      <Suspense fallback={<TelaFallback />}>
        <OnboardingEmpresaScreen
          user={user}
          onContinuar={() => setEntrarComoPessoal(true)}
          onSair={() => void logout()}
        />
      </Suspense>
    );
  }

  // --- Aplicativo ---------------------------------------------------------

  // #719 (SH1): renderiza a tela interna (Bridge/Files/Remote) de uma aba do
  // Navigator. `user` já está estreitado a não-nulo aqui (passou o gate de auth).
  // O App é dono das telas + props + keep-alive; o Navigator só encaixa o
  // elemento no slot da aba. `ativa` = a aba é a atual (dá foco/polling à tela).
  const renderTelaInterna = (
    telaInterna: TelaInterna,
    ativaTela: boolean,
    abaId: string,
  ): ReactNode => {
    switch (telaInterna) {
      case "control-room":
        return (
          <ControlRoomScreen
            // #555 (P0): key por conta — remonta a subárvore na troca de tenant,
            // zerando estado local (preview/scroll/pastas). Só na troca de conta.
            key={user.email}
            user={user}
            ativo={ativaTela}
            // #868: renderizado aqui = hospedado numa aba interna do Navigator →
            // esconde o hero redundante (a aba já identifica o Bridge).
            emAba
            onGrantPeopleAccess={() => {
              // #695: re-login da MESMA conta pra conceder People (org/pessoal).
              void handleLogin("microsoft", user.email);
            }}
            onReauthenticate={() => {
              void logout();
            }}
            onAbrirLink={(url) => {
              let nome = url;
              try {
                nome = new URL(url).hostname || url;
              } catch {
                /* url estranha: usa a própria string */
              }
              abrirUrlLivre(url, nome);
            }}
          />
        );
      case "arquivos":
        // #872: a aba mostra "Files - <local>" — o shell reporta o local atual e
        // o App atualiza o nome/caminho DESTA aba (por id).
        return (
          <ArquivosScreen
            onLocalChange={(info) => atualizarLocalAba(abaId, info)}
          />
        );
      case "remote":
        // #1025: só o Remote é lazy aqui; o Bridge (control-room) segue eager e
        // keep-alive, sem passar por Suspense — não suspende, não remonta.
        return (
          <Suspense fallback={<TelaFallback />}>
            <RemoteScreen />
          </Suspense>
        );
    }
  };

  return (
    /* #699 (PS6): TierProvider expõe o tier da conta (capabilities/orgStatus do
       PS0) pra qualquer feature checar sem prop-drill. O wrapper do sidebar é
       min-h-svh: cresce com o conteudo. Numa pagina web quem rola e o documento,
       mas aqui o body e overflow:hidden (janela de app), entao ninguem rolava.
       Travando a altura em h-svh, quem passa a rolar e o <main> abaixo. */
    <TierProvider user={user}>
    {/* #718 (SH0): rail SEMPRE colapsado — sidebar controlado em `open={false}` e
        `onOpenChange` no-op, então nem o atalho (Ctrl/Cmd+B) nem trigger algum
        expandem. O toggle do header foi removido. */}
    <SidebarProvider className="h-svh" open={false} onOpenChange={() => {}}>
      <Atualizacao />
      <BarraJanela />
      <AppSidebar
        onAbrirApp={abrirUrlLivre}
        // #1152: app fixado que é tela interna (Bridge/Files/Remote, ou os M365
        // que o app faz nativo) roteia como o command roteia — não abre aba web
        // com `url` vazia.
        onAbrirNativo={(app) => {
          if (app.nativo === "agenda" || app.nativo === "people") {
            setBridgeView(app.nativo);
            abrirTelaInterna("control-room");
            return;
          }
          if (app.nativo) abrirTelaInterna(app.nativo);
        }}
      />
      <SidebarInset className="relative overflow-hidden">
        {/* #1017: fora do Tauri (browser/pnpm dev) o app roda em MODO MOCK — as
            leituras devolvem dado fake e as escrituras REJEITAM. Faixa fixa e não
            dispensável avisa que NADA aqui é real, pra ninguém confundir o dev do
            browser com o app de verdade (o mecanismo do "VERDE ≠ PRONTO"). */}
        {!api.inTauri() && (
          <div
            role="status"
            className="relative z-30 flex h-7 shrink-0 items-center justify-center bg-amber-500 px-4 text-center text-xs font-semibold text-amber-950"
          >
            {t.mockBanner.aviso}
          </div>
        )}
        <FundoApp className="pointer-events-none" />

        {/* #876: title bar estilo browser em UMA linha — sem breadcrumb nem busca
            global. As tabs do Navigator entram no `tabSlot` (portal, ver
            navegador.tsx); à direita ficam o switcher (menor) + o avatar/menu do
            usuário; os controles de janela seguem fixos (BarraJanela) no canto,
            daí o `pr-[140px]`. A faixa vazia entre as tabs e o cluster é
            arrastável (data-tauri-drag-region) sem tirar o clique de tabs/avatar. */}
        <header
          data-tauri-drag-region
          className="relative z-10 flex h-11 shrink-0 items-stretch border-b border-border"
        >
          {/* #1109 (AC do Wagner na #876): a marca GALAXIE mora aqui, no canto
              esquerdo junto das tabs, em tamanho compatível com a altura de uma
              tab (não mais ocupando a largura do rail). Clique = ABRE UMA ABA NOVA
              com a home do Navigator ("Time to set sail" + command) — reusa o
              `novaAba` do "+"/Ctrl+T; `setTela("navegador")` garante pousar no
              Navigator mesmo vindo de outra tela. O botão é clicável apesar do
              `data-tauri-drag-region` do pai (mesmo padrão do avatar/tabs). */}
          <div
            data-tauri-drag-region
            className="flex shrink-0 items-center pr-1 pl-2.5"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t.sidebar.abrirNavegador}
                  onClick={() => {
                    setTela("navegador");
                    novaAba();
                  }}
                  className="grid size-7 place-items-center rounded-lg transition-colors hover:bg-accent"
                >
                  <GalaxieLogo className="size-6" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start">
                {t.sidebar.abrirNavegador}
              </TooltipContent>
            </Tooltip>
          </div>
          <div
            ref={setTabSlot}
            data-tauri-drag-region
            className="flex min-w-0 flex-1 items-stretch"
          />
          <div
            data-tauri-drag-region
            className="flex shrink-0 items-center gap-1.5 pr-[140px] pl-2"
          >
            {/* #987/#1290: sino do activity-dropdown — PRIMEIRO da fileira de
                chrome, como o PO pediu. Some quando não há atividade; como o
                cluster é `shrink-0` colado na direita e o sino é o item mais à
                esquerda, sumir/voltar não desloca os vizinhos (medido, ver o
                teste `pollux-1290-ordem-chrome`). Abre o dropdown ANCORADO. */}
            <ActivityDropdown
              ops={atividade.ops}
              agoraMs={atividade.agoraMs}
              onCancelar={atividade.onCancelar}
              onPausar={atividade.onPausar}
              onResumir={atividade.onResumir}
              onDispensar={atividade.onDispensar}
              onDesfazer={atividade.onDesfazer}
              desfeitos={atividade.desfeitos}
              onLimparConcluidas={atividade.onLimparConcluidas}
            />
            {/* #1290: aqui pousam os ícones do Navigator (favoritos/histórico/
                paleta), por portal. Vazio nas outras telas — o `gap` do pai não
                abre buraco porque um div sem filhos não ocupa largura. */}
            <div ref={setChromeSlot} className="flex items-center" />
            <ThemeToggle size="md" />
            <MenuUsuario
              user={user}
              onNavegar={navegarPara}
              onLogout={logout}
              onAbrirUrl={abrirUrl}
            />
          </div>
        </header>

        {/* #987: preview de undo de transferência — app-level porque o "Desfazer"
            é disparado pelo sino da title bar (visível em qualquer tela). */}
        <UndoPreviewDialog
          aberto={atividade.undoPreview !== null}
          plan={atividade.undoPreview?.plan ?? null}
          onConfirmar={atividade.confirmarUndo}
          onCancelar={atividade.fecharUndoPreview}
        />

        {reauthMissingScopes.length > 0 && !reauthDismissed && (
          <div className="relative z-20 px-4 pb-3">
            <Alert variant="warning">
              <KeyRound />
              <AlertTitle>
                <SoftBlurIn delay={80} stagger={18}>
                  {t.reauth.titulo}
                </SoftBlurIn>
              </AlertTitle>
              <AlertDescription>{t.reauth.descricao}</AlertDescription>
              <AlertAction className="flex-wrap">
                <Button variant="ghost" size="sm" onClick={dismissReauth}>
                  {t.reauth.agoraNao}
                </Button>
                <Button size="sm" onClick={() => void logout()}>
                  {t.reauth.entrarNovamente}
                </Button>
              </AlertAction>
            </Alert>
          </div>
        )}

        {/* O navegador fica FORA do ScrollArea, em tela cheia e sem padding: o
            webview nativo ocupa toda a area medida, e quem rola e a propria
            pagina web, nao o nosso ScrollArea. */}
        {/* #719 (SH1): o Navigator é o SHELL keep-alive — SEMPRE montado, só
            escondido quando outra tela top-level (Settings/Apps/…) está ativa.
            Bridge/Files/Remote agora vivem como ABAS INTERNAS aqui dentro; o
            control-room mantém o keep-alive (#25) dentro do slot da aba (montado
            enquanto a aba existir; retorno instantâneo entre trocas de aba). Fora
            do ScrollArea: tela cheia, a webview/o conteúdo da aba ocupa a área
            medida. `visivel=false` esconde todas as webviews (P0). */}
        <div
          className={cn(
            "relative z-10 min-h-0 flex-1",
            tela !== "navegador" && "hidden",
          )}
        >
          <NavegadorScreen
            abas={abas}
            ativa={abaAtiva}
            launcherNonce={launcherNonce}
            visivel={tela === "navegador"}
            user={user}
            // #876: a barra de abas só ocupa a title bar quando o Navigator é a
            // tela ativa; em Settings/Apps ela cai inline (dentro do Navigator
            // escondido) → nenhuma aba na title bar dessas telas, e clicar aba
            // não fica dessincronizado com a tela mostrada.
            tabStripSlot={tela === "navegador" ? tabSlot : null}
            chromeSlot={tela === "navegador" ? chromeSlot : null}
            renderTelaInterna={renderTelaInterna}
            onTrocar={trocarAba}
            onFechar={fecharAba}
            onFecharOutras={fecharOutras}
            onDormir={dormirAba}
            onDormirOutras={dormirOutras}
            onAlternarFixada={alternarFixada}
            onAlternarManterAcordada={alternarManterAcordada}
            onReativada={concluirReativacao}
            onReordenar={reordenarAbas}
            onAbrir={abrirAppAqui}
            onNovaAba={novaAba}
            onNovaAbaFiles={novaAbaFiles}
            onNovaAbaPrivada={novaAbaPrivada}
            onReabrirFechada={reabrirFechada}
            onNavegar={abrirUrlLivre}
            onNavegarTela={navegarPara}
            onIrParaBridgeView={(view) => {
              // #657: deep-link — seta a sub-view do Bridge e abre a ABA do
              // Bridge no Navigator (#719: era setTela("control-room")).
              setBridgeView(view);
              abrirTelaInterna("control-room");
            }}
            onRestaurarAbas={restaurarAbas}
            sessaoAnteriorQtd={sessaoDispensada ? 0 : sessaoAnterior.length}
            onRestaurarSessao={restaurarSessao}
            onDispensarSessao={dispensarSessao}
            historico={historico}
            onLimparHistorico={limparHistoricoPeriodo}
            modoPrivado={modoPrivado}
          />
        </div>

        {tela === "configuracoes" ? (
          /* Fora do ScrollArea: altura cheia, sidebar 100% e a área de contexto
             rola por dentro — mesmo padrão do Bridge. */
          <div className="relative z-10 min-h-0 flex-1 p-4 pt-0">
            <ConfiguracoesScreen />
          </div>
        ) : tela === "apps" ? (
          /* Fora do ScrollArea: altura cheia, sidebar do Apps 100% e o grid de
             conteúdo rola por dentro — mesmo padrão do Bridge/Configurações. */
          <div className="relative z-10 min-h-0 flex-1 p-4 pt-0">
            <AppsScreen
              onAbrirAqui={abrirAppAqui}
              onAbrirNavegador={(a) => abrirUrl(a.url)}
            />
          </div>
        ) : tela === "navegador" ||
          tela === "control-room" ||
          tela === "arquivos" ||
          tela === "remote" ? null : (
        /* ScrollArea no lugar do overflow-y-auto: a barra passa a ser a do
            design system em vez da nativa do sistema.
            min-h-0: sem isso o flex-1 nao encolhe abaixo do conteudo e nao
            existe area rolavel nenhuma. */
        <ScrollArea className="relative z-10 min-h-0 flex-1">
          {/* #1025: um único Suspense de nível alto cobre as telas lazy deste
              bloco (EmBreve, Windows). Sites é eager e passa direto —
              Suspense só suspende no lazy. */}
          <Suspense fallback={<TelaFallback />}>
          <main className="flex flex-col p-4 pt-0">
          {tela === "onedrive" && (
            <SitesScreen
              sites={sites}
              loading={loadingSites}
              error={error}
              onConnect={connect}
              onOpen={openSite}
              onDisconnect={disconnect}
              onAbrirUrl={abrirUrl}
            />
          )}
          {/* #719 (SH1): Remote virou ABA INTERNA do Navigator (renderTelaInterna);
              o placeholder #682 é renderizado lá dentro, não mais como tela top-level. */}
          {tela === "astro" && (
            <EmBreveScreen
              titulo={t.emBreveAstro.titulo}
              icone={TELAS.astro.icone}
              descricao={t.emBreveAstro.descricao}
            />
          )}
          {tela === "outlook" && (
            <EmBreveScreen
              titulo={t.nav.outlook}
              icone={TELAS.outlook.icone}
              descricao={t.emBreveOutlook.descricao}
              itens={[
                t.emBreveOutlook.item1,
                t.emBreveOutlook.item2,
                t.emBreveOutlook.item3,
              ]}
            />
          )}
          {tela === "performance" && (
            <EmBreveScreen
              titulo={t.nav.performance}
              icone={TELAS.performance.icone}
              descricao={t.emBrevePerformance.descricao}
              itens={[
                t.emBrevePerformance.item1,
                t.emBrevePerformance.item2,
                t.emBrevePerformance.item3,
              ]}
            />
          )}
          {/* #665: a antiga CaminhosLongosScreen virou a tela Windows (página de
              opções estilo Settings>System); o slot de nav "caminhos-longos"
              segue (label/rota são do S2/Vega). */}
          {tela === "caminhos-longos" && <WindowsScreen />}
          </main>
          </Suspense>
        </ScrollArea>
        )}
      </SidebarInset>
    </SidebarProvider>
    </TierProvider>
  );
}

/**
 * Raiz do app (#148). O ErrorBoundary envolve TODA a árvore e fica FORA dela, de
 * modo que qualquer crash de render (ex.: o editor Plate deserializando um corpo
 * ruim — #144/#147) cai no fallback e é logado, em vez de desmontar pra uma tela
 * branca silenciosa. Aqui também registramos, o mais cedo possível, os
 * captadores globais de erro/rejeição não tratados — mesmo canal de log.
 */
export default function App() {
  useEffect(() => {
    registrarHandlersGlobais();
    // Longstop do splash (#164): mesmo que o boot trave, ou o sinal de fim-de-
    // vídeo se perca, ou a árvore estoure de um jeito que os efeitos de gate não
    // rodem, a main window aparece (e a splash fecha) depois deste teto.
    // LONGSTOP_SPLASH_MS (20s) é MAIOR que a duração do vídeo (~10s) + folga,
    // para nunca cortar a animação no meio. revelarAppEFecharSplash é idempotente.
    const id = setTimeout(() => void revelarAppEFecharSplash(), LONGSTOP_SPLASH_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
