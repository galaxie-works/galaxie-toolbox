import { useEffect, useState } from "react";
import { LoginScreen } from "@/screens/login";
import { SitesScreen } from "@/screens/sites";
import { CaminhosLongosScreen } from "@/screens/caminhos-longos";
import { EmBreveScreen } from "@/screens/em-breve";
import { AppSidebar } from "@/components/app-sidebar";
import { Estrelas } from "@/components/estrelas";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/animate-ui/components/radix/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { TELAS, type Tela } from "@/lib/navegacao";
import type { AppUser, Identidade, Site } from "@/lib/types";
import * as api from "@/lib/api";

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loadingSites, setLoadingSites] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [cache, setCache] = useState<Identidade | null>(null);
  const [tela, setTela] = useState<Tela>("onedrive");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        api.cachedIdentity().then((id) => vivo && setCache(id));
        const u = await api.restoreSession();
        if (!vivo) return;
        if (u) {
          setUser(u);
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
  }, []);

  async function handleLogin(email: string) {
    setLoginLoading(true);
    setError(null);
    try {
      const u = await api.login(email);
      setUser(u);
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

  async function abrirUrl(url: string) {
    try {
      await api.openUrl(url);
    } catch (e) {
      setError(String(e));
    }
  }

  async function logout() {
    await api.logout();
    setUser(null);
    setSites([]);
    setError(null);
    setTela("onedrive");
  }

  // --- Retomando a sessao -------------------------------------------------
  if (restoring) {
    return (
      <div className="relative grid h-full place-items-center overflow-hidden">
        <Estrelas />
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
              Preparando o seu universo...
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

  return (
    /* O wrapper do sidebar e min-h-svh: cresce com o conteudo. Numa pagina web
       quem rola e o documento, mas aqui o body e overflow:hidden (janela de
       app), entao ninguem rolava. Travando a altura em h-svh, quem passa a
       rolar e o <main> abaixo. */
    <SidebarProvider className="h-svh">
      <AppSidebar
        user={user}
        tela={tela}
        onNavegar={setTela}
        onLogout={logout}
        onAbrirUrl={abrirUrl}
      />
      <SidebarInset className="relative overflow-hidden">
        <Estrelas className="pointer-events-none" />

        <header className="relative z-10 flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex flex-1 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink asChild>
                    <span>{info.secao}</span>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{info.titulo}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* min-h-0: sem isso o flex-1 nao encolhe abaixo do conteudo e o
            overflow-y-auto nunca chega a valer. */}
        <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pt-0">
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
          {tela === "outlook" && (
            <EmBreveScreen
              titulo="Outlook"
              icone={TELAS.outlook.icone}
              descricao="Ferramentas de diagnóstico do e-mail vão aparecer aqui."
              itens={[
                "Verificar regras e encaminhamentos",
                "Tamanho da caixa e limpeza",
                "Reparar perfil do Outlook",
              ]}
            />
          )}
          {tela === "performance" && (
            <EmBreveScreen
              titulo="Performance"
              icone={TELAS.performance.icone}
              descricao="Diagnóstico e ajustes de desempenho da máquina."
              itens={[
                "Espaço em disco e arquivos temporários",
                "Programas que iniciam com o Windows",
                "Estado da sincronização do OneDrive",
              ]}
            />
          )}
          {tela === "caminhos-longos" && <CaminhosLongosScreen />}
          {tela === "configuracoes" && (
            <EmBreveScreen
              titulo="Configurações"
              icone={TELAS.configuracoes.icone}
              descricao="Preferências do aplicativo e da sua conta."
            />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
