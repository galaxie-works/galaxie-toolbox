import { useEffect, useRef, useState } from "react";
import { telModuloAberto, telSessaoIniciada } from "@/lib/telemetria";
import { ErrorBoundary } from "@/components/error-boundary";
import { registrarHandlersGlobais } from "@/lib/log";
import { LoginScreen } from "@/screens/login";
import { SitesScreen } from "@/screens/sites";
import { AppsScreen } from "@/screens/apps";
import { AtomsScreen } from "@/screens/atoms";
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
import { CaminhosLongosScreen } from "@/screens/caminhos-longos";
import { ConfiguracoesScreen } from "@/screens/configuracoes";
import { EmBreveScreen } from "@/screens/em-breve";
import { AppSidebar } from "@/components/app-sidebar";
import { Atualizacao } from "@/components/atualizacao";
import { TelaBloqueio } from "@/components/tela-bloqueio";
import { BarraJanela, FaixaArrasto } from "@/components/barra-janela";
import { FundoApp } from "@/components/fundo-app";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { UniversalSearch } from "@/components/universal-search";
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
  SidebarTrigger,
} from "@/components/animate-ui/components/radix/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { TELAS, type Tela } from "@/lib/navegacao";
import { useAppStore } from "@/store";
import type { AppUser, Identidade, Site } from "@/lib/types";
import * as api from "@/lib/api";
import { limparFotos } from "@/lib/fotos";
import { useIdioma } from "@/lib/idioma";
import { cn, comLoginHint } from "@/lib/utils";
import type { AppM365 } from "@/lib/apps";
import {
  EVENTO_VIDEO_SPLASH,
  LONGSTOP_SPLASH_MS,
  revelarAppEFecharSplash,
} from "@/lib/splash";
import { KeyRound } from "lucide-react";

/**
 * Todo o app de verdade. Fica ABAIXO do ErrorBoundary (ver `App`): é esta árvore
 * que pode estourar num render, e o boundary a segura sem levar a tela toda pro
 * branco.
 */
function AppInner() {
  const { idioma, t } = useIdioma();
  const bridgeView = useAppStore((state) => state.bridgeView);
  const reauthMissingScopes = useAppStore(
    (state) => state.reauthMissingScopes,
  );
  const reauthDismissed = useAppStore((state) => state.reauthDismissed);
  const setReauthMissingScopes = useAppStore(
    (state) => state.setReauthMissingScopes,
  );
  const dismissReauth = useAppStore((state) => state.dismissReauth);
  const clearReauth = useAppStore((state) => state.clearReauth);
  const hydratePeopleM365 = useAppStore(
    (state) => state.hydratePeopleM365,
  );
  const resetPeopleSession = useAppStore(
    (state) => state.resetPeopleSession,
  );
  const [user, setUser] = useState<AppUser | null>(null);
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
  // #183 (Atoms): a nova tela inicial. O usuário cai no dashboard Atoms ao
  // logar/restaurar; o Bridge segue keep-alive (montado/escondido) pra voltar
  // instantâneo.
  const [tela, setTela] = useState<Tela>("atoms");
  // Splash (#164): a animação tocou até o fim uma vez? Um dos dois gates da
  // revelação (o outro é `bootPronto`).
  const [videoPronto, setVideoPronto] = useState(false);
  // Abas do navegador embutido (cada uma vira um webview nativo no Rust).
  const [abas, setAbas] = useState<AbaBrowser[]>(loadPinnedNavigatorTabs);
  const [abaAtiva, setAbaAtiva] = useState<string | null>(null);
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
          setUser(u);
          void hydratePeopleM365({ force: true });
          const permissions = await api.requiredScopesStatus();
          if (!vivo) return;
          setReauthMissingScopes(permissions.missingScopes);
          setLoadingSites(true);
          const lista = await api.listSites();
          if (!vivo) return;
          setSites(lista);
          carregarDetalhes(lista);
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

  async function handleLogin(email: string) {
    setLoginLoading(true);
    setError(null);
    resetPeopleSession();
    try {
      const u = await api.login(email, idioma);
      // Login novo pode trazer o escopo de fotos (#39) recém-consentido: zera o
      // cache pra não herdar negative-cache de sessão sem permissão.
      limparFotos();
      setUser(u);
      void hydratePeopleM365({ force: true });
      const permissions = await api.requiredScopesStatus();
      setReauthMissingScopes(permissions.missingScopes);
      setLoadingSites(true);
      const lista = await api.listSites();
      setSites(lista);
      carregarDetalhes(lista);
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
    await api.logout();
    limparFotos(); // privacidade (#39): não deixa fotos no disco após sair
    clearReauth();
    resetPeopleSession();
    setUser(null);
    setSites([]);
    setError(null);
    setTela("onedrive");
  }

  async function recuperarBloqueio() {
    await api.logout();
    limparFotos();
    resetPeopleSession();
    setUser(null);
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

  // --- Aplicativo ---------------------------------------------------------
  const info = TELAS[tela];
  const abaAtivaObj = abas.find((a) => a.id === abaAtiva);
  const breadcrumbDetail =
    tela === "navegador" && abaAtivaObj
      ? abaAtivaObj.nome
      : tela === "control-room"
        ? {
            mail: t.controlRoom.grupoMail,
            people: t.controlRoom.peopleTitulo,
            agenda: t.controlRoom.agendaTitulo,
          }[bridgeView]
        : null;

  return (
    /* O wrapper do sidebar e min-h-svh: cresce com o conteudo. Numa pagina web
       quem rola e o documento, mas aqui o body e overflow:hidden (janela de
       app), entao ninguem rolava. Travando a altura em h-svh, quem passa a
       rolar e o <main> abaixo. */
    <SidebarProvider className="h-svh">
      <Atualizacao />
      <BarraJanela />
      <AppSidebar
        user={user}
        tela={tela}
        onNavegar={setTela}
        onLogout={logout}
        onAbrirUrl={abrirUrl}
      />
      <SidebarInset className="relative overflow-hidden">
        <FundoApp className="pointer-events-none" />

        <header
          data-tauri-drag-region
          className="relative z-10 flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12"
        >
          {/* pr-[150px]: os tres controles de janela ocupam o canto superior
              direito e o tema ficaria embaixo deles. */}
          <div data-tauri-drag-region className="flex flex-1 items-center gap-2 px-4 pr-[150px]">
            {/* Tooltip canônico (#160). O aria-label localizado sobrepõe o
                sr-only "Toggle Sidebar" fixo do primitivo compartilhado, sem
                editá-lo. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarTrigger
                  className="-ml-1"
                  aria-label={t.nav.alternarMenu}
                />
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t.nav.alternarMenu}
              </TooltipContent>
            </Tooltip>
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink asChild>
                    <span>{t.nav[info.secao]}</span>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  {/* Com detalhe ativo (aba do Navigator ou módulo do Bridge),
                      a tela deixa de ser a página final e vira o 2º nível. */}
                  {breadcrumbDetail ? (
                    <span className="text-muted-foreground">
                      {t.nav[info.titulo]}
                    </span>
                  ) : (
                    <BreadcrumbPage>{t.nav[info.titulo]}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {breadcrumbDetail && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage className="max-w-40 truncate">
                        {breadcrumbDetail}
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
            <div className="mx-auto min-w-24 flex-1 px-2 sm:max-w-sm lg:max-w-md">
              <UniversalSearch
                tela={tela}
                screenLabel={t.nav[info.titulo]}
                bridgeView={bridgeView}
              />
            </div>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>
        </header>

        {reauthMissingScopes.length > 0 && !reauthDismissed && (
          <div className="relative z-20 px-4 pb-3">
            <Alert variant="warning">
              <KeyRound />
              <AlertTitle>{t.reauth.titulo}</AlertTitle>
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
        {/* Control room = cliente de e-mail: fica SEMPRE montado (keep-alive) e
            apenas escondido quando não é a tela ativa. Antes ele desmontava ao
            trocar de área e remontava ao voltar, recarregando tudo do Graph (e
            vazando listeners/intervals a cada volta — "cada vez mais lento").
            Mantendo montado, o estado (pastas, mensagens, scroll, iframes)
            persiste e o retorno é instantâneo (#25). Fora do ScrollArea externo,
            altura cheia, cada painel rola por dentro (como o navegador). */}
        <div
          className={cn(
            "relative z-10 min-h-0 flex-1 p-4 pt-0",
            tela !== "control-room" && "hidden"
          )}
        >
          <ControlRoomScreen
            user={user}
            ativo={tela === "control-room"}
            onGrantPeopleAccess={() => {
              void handleLogin(user.email);
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
        </div>

        {tela === "navegador" ? (
          <div className="relative z-10 min-h-0 flex-1">
            <NavegadorScreen
              abas={abas}
              ativa={abaAtiva}
              launcherNonce={launcherNonce}
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
              onNovaAbaPrivada={novaAbaPrivada}
              onReabrirFechada={reabrirFechada}
              onNavegar={abrirUrlLivre}
              onRestaurarAbas={restaurarAbas}
              sessaoAnteriorQtd={sessaoDispensada ? 0 : sessaoAnterior.length}
              onRestaurarSessao={restaurarSessao}
              onDispensarSessao={dispensarSessao}
              historico={historico}
              onLimparHistorico={limparHistoricoPeriodo}
              modoPrivado={modoPrivado}
              onAlternarModoPrivado={() => setModoPrivado((v) => !v)}
            />
          </div>
        ) : tela === "configuracoes" ? (
          /* Fora do ScrollArea: altura cheia, sidebar 100% e a área de contexto
             rola por dentro — mesmo padrão do Bridge. */
          <div className="relative z-10 min-h-0 flex-1 p-4 pt-0">
            <ConfiguracoesScreen />
          </div>
        ) : tela === "control-room" ? null : (
        /* ScrollArea no lugar do overflow-y-auto: a barra passa a ser a do
            design system em vez da nativa do sistema.
            min-h-0: sem isso o flex-1 nao encolhe abaixo do conteudo e nao
            existe area rolavel nenhuma. */
        <ScrollArea className="relative z-10 min-h-0 flex-1">
          <main className="flex flex-col p-4 pt-0">
          {tela === "atoms" && (
            <AtomsScreen
              user={user}
              onNavegar={setTela}
              onAbrirUrl={abrirUrl}
              onAbrirApp={abrirAppAqui}
            />
          )}
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
          {tela === "apps" && (
            <AppsScreen
              onAbrirAqui={abrirAppAqui}
              onAbrirNavegador={(a) => abrirUrl(a.url)}
            />
          )}
          {tela === "comms" && (
            <EmBreveScreen
              titulo={t.nav.comms}
              icone={TELAS.comms.icone}
              descricao={t.emBreveComms.descricao}
            />
          )}
          {tela === "astro" && (
            <EmBreveScreen
              titulo={t.nav.astro}
              icone={TELAS.astro.icone}
              descricao={t.emBreveAstro.descricao}
            />
          )}
          {tela === "pulsar" && (
            <EmBreveScreen
              titulo={t.nav.pulsar}
              icone={TELAS.pulsar.icone}
              descricao={t.emBrevePulsar.descricao}
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
          {tela === "caminhos-longos" && <CaminhosLongosScreen />}
          </main>
        </ScrollArea>
        )}
      </SidebarInset>
    </SidebarProvider>
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
