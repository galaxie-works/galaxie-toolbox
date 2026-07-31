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
import {
  loadNavigatorSearch,
  persistNavigatorSearch,
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
