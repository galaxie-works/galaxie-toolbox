import { useState } from "react";

import { FramePanel } from "@/components/reui/frame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  loadNavigatorMemorySettings,
  loadNavigatorSearch,
  persistNavigatorMemorySettings,
  persistNavigatorSearch,
  type NavigatorMemorySettings,
  type NavigatorSearchProvider,
  type NavigatorSearchSettings,
} from "@/lib/navigator-tabs";

/**
 * Settings > Galaxie Apps > Navigator — grupo **Search** (#305). Provedor de
 * pesquisa padrão do omnibox (`browser.interpretar`). Persiste em localStorage
 * (padrão legado do Navigator). Mesmo padrão dos painéis do Bridge (FramePanel +
 * Select), sem inventar UI.
 */
export function NavigatorSearchPanel() {
  const [settings, setSettings] =
    useState<NavigatorSearchSettings>(loadNavigatorSearch);

  const atualizar = (patch: Partial<NavigatorSearchSettings>) =>
    setSettings((prev) => {
      const proximo = { ...prev, ...patch };
      persistNavigatorSearch(proximo);
      return proximo;
    });

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Default search engine</h3>
          <p className="text-sm text-muted-foreground">
            Used by the address bar when you type a search instead of a URL.
          </p>
        </div>
        <Select
          value={settings.provider}
          onValueChange={(valor) =>
            atualizar({ provider: valor as NavigatorSearchProvider })
          }
        >
          <SelectTrigger
            aria-label="Default search engine"
            className="w-56 shrink-0"
          >
            <SelectValue placeholder="Select a provider" />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              <SelectItem value="bing">Bing</SelectItem>
              <SelectItem value="google">Google</SelectItem>
              <SelectItem value="duckduckgo">DuckDuckGo</SelectItem>
              <SelectItem value="custom">Custom…</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {settings.provider === "custom" && (
        <div className="mt-3 flex flex-col gap-1.5">
          <Label htmlFor="nav-search-custom">Custom search URL</Label>
          <Input
            id="nav-search-custom"
            value={settings.customUrl}
            onChange={(event) => atualizar({ customUrl: event.target.value })}
            placeholder="https://example.com/search?q=%s"
          />
          <p className="text-xs text-muted-foreground">
            Use <code>%s</code> where the search term should go.
          </p>
        </div>
      )}
    </FramePanel>
  );
}

/**
 * Settings > Galaxie Apps > Navigator — grupo **Tabs/Sleeping** (#306, liga #173).
 * Sleeping on/off + tempo ocioso + máx. de abas ativas. Persiste no localStorage
 * (NAVIGATOR_MEMORY_SETTINGS); o eviction do App relê e respeita. EN hardcoded
 * como o resto do Settings.
 */
export function NavigatorTabsPanel() {
  const [settings, setSettings] =
    useState<NavigatorMemorySettings>(loadNavigatorMemorySettings);

  const atualizar = (patch: Partial<NavigatorMemorySettings>) =>
    setSettings((prev) => {
      const proximo = { ...prev, ...patch };
      persistNavigatorMemorySettings(proximo);
      return proximo;
    });

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Sleeping tabs</h3>
          <p className="text-sm text-muted-foreground">
            Free memory by putting idle background tabs to sleep. Active and
            pinned tabs never sleep.
          </p>
        </div>
        <Switch
          checked={settings.ativo}
          onCheckedChange={(valor) => atualizar({ ativo: valor })}
          aria-label="Sleeping tabs"
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Idle time before sleeping</h3>
          <p className="text-sm text-muted-foreground">
            How long a background tab stays idle before it sleeps.
          </p>
        </div>
        <Select
          value={String(settings.idleMinutes)}
          onValueChange={(valor) => atualizar({ idleMinutes: Number(valor) })}
          disabled={!settings.ativo}
        >
          <SelectTrigger aria-label="Idle time" className="w-44 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              <SelectItem value="15">15 minutes</SelectItem>
              <SelectItem value="30">30 minutes</SelectItem>
              <SelectItem value="60">60 minutes</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Max active tabs</h3>
          <p className="text-sm text-muted-foreground">
            Beyond this, the least recently used background tab goes to sleep.
          </p>
        </div>
        <Select
          value={String(settings.maxLive)}
          onValueChange={(valor) => atualizar({ maxLive: Number(valor) })}
          disabled={!settings.ativo}
        >
          <SelectTrigger aria-label="Max active tabs" className="w-44 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              <SelectItem value="3">3 tabs</SelectItem>
              <SelectItem value="5">5 tabs</SelectItem>
              <SelectItem value="10">10 tabs</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </FramePanel>
  );
}
