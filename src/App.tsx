import { useEffect, useState } from "react";
import { LoginScreen } from "@/screens/login";
import { SitesScreen } from "@/screens/sites";
import { Avatar } from "@/components/ui/avatar";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";
import type { AppUser, Identidade, Site } from "@/lib/types";
import * as api from "@/lib/api";

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loadingSites, setLoadingSites] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // enquanto tenta retomar a sessao guardada, nao mostra o login (evita piscar)
  const [restoring, setRestoring] = useState(true);
  // identidade em cache: pinta a tela de carregamento sem esperar a rede
  const [cache, setCache] = useState<Identidade | null>(null);

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
          setSites(await api.listSites());
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
      setSites(await api.listSites());
    } catch (e) {
      setError(String(e));
      setUser(null);
    } finally {
      setLoginLoading(false);
      setLoadingSites(false);
    }
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

  function connectAll() {
    sites
      .filter((s) => s.status === "available")
      .forEach((s, i) => setTimeout(() => connect(s), i * 250));
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

  async function logout() {
    await api.logout();
    setUser(null);
    setSites([]);
    setError(null);
  }

  if (restoring) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-4 animate-[fade-in_0.3s_ease]">
          <Avatar
            photo={cache?.photo}
            initials={cache?.initials ?? "·"}
            size={72}
            className="logo-in ring-2 ring-border"
          />
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

  return (
    <SitesScreen
      user={user}
      sites={sites}
      loading={loadingSites}
      error={error}
      onConnect={connect}
      onOpen={openSite}
      onDisconnect={disconnect}
      onConnectAll={connectAll}
      onLogout={logout}
    />
  );
}
