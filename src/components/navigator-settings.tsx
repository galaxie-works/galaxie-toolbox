import { useState } from "react";

import { FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
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
  loadNavigatorPrefs,
  loadNavigatorSearch,
  persistNavigatorMemorySettings,
  persistNavigatorPrefs,
  persistNavigatorSearch,
  type NavigatorMemorySettings,
  type NavigatorPrefs,
  type NavigatorSearchProvider,
  type NavigatorSearchSettings,
} from "@/lib/navigator-tabs";
import { persistHistorico } from "@/lib/navigator-history";
import { useIdioma } from "@/lib/idioma";

/**
 * Settings > Galaxie Apps > Navigator — grupo **Search** (#305). Provedor de
 * pesquisa padrão do omnibox (`browser.interpretar`). Persiste em localStorage
 * (padrão legado do Navigator). Mesmo padrão dos painéis do Bridge (FramePanel +
 * Select), sem inventar UI.
 */
export function NavigatorSearchPanel() {
  const { t } = useIdioma();
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
          <h3 className="text-sm font-semibold">
            {t.settings.navigatorSearchTitulo}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.navigatorSearchDesc}
          </p>
        </div>
        <Select
          value={settings.provider}
          onValueChange={(valor) =>
            atualizar({ provider: valor as NavigatorSearchProvider })
          }
        >
          <SelectTrigger
            aria-label={t.settings.navigatorSearchTitulo}
            className="w-56 shrink-0"
          >
            <SelectValue placeholder={t.settings.navigatorSearchPlaceholder} />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              <SelectItem value="bing">Bing</SelectItem>
              <SelectItem value="google">Google</SelectItem>
              <SelectItem value="duckduckgo">DuckDuckGo</SelectItem>
              <SelectItem value="custom">
                {t.settings.navigatorSearchCustomOpcao}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {settings.provider === "custom" && (
        <div className="mt-3 flex flex-col gap-1.5">
          <Label htmlFor="nav-search-custom">
            {t.settings.navigatorSearchCustomLabel}
          </Label>
          <Input
            id="nav-search-custom"
            value={settings.customUrl}
            onChange={(event) => atualizar({ customUrl: event.target.value })}
            placeholder={t.settings.navigatorSearchCustomPlaceholder}
          />
          <p className="text-xs text-muted-foreground">
            {/* #1058: chave única com token {placeholder} (não mais 2 fragmentos).
                Preservo o <code> monospace do %s — é token de URL de busca, não
                ênfase; comDestaque renderiza <strong>, então faço o split local. */}
            {(() => {
              const partes =
                t.settings.navigatorSearchCustomDica.split("{placeholder}");
              return (
                <>
                  {partes[0]}
                  <code>%s</code>
                  {partes.slice(1).join("{placeholder}")}
                </>
              );
            })()}
          </p>
        </div>
      )}
    </FramePanel>
  );
}

/**
 * Settings > Galaxie Apps > Navigator — grupo **Tabs/Sleeping** (#306, liga #173).
 * Sleeping on/off + tempo ocioso + máx. de abas ativas. Persiste no localStorage
 * (NAVIGATOR_MEMORY_SETTINGS); o eviction do App relê e respeita. Textos via
 * i18n (`t.settings.navigator*`), como o resto do Settings.
 */
export function NavigatorTabsPanel() {
  const { t } = useIdioma();
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
          <h3 className="text-sm font-semibold">
            {t.settings.navigatorTabsSleepTitulo}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.navigatorTabsSleepDesc}
          </p>
        </div>
        <Switch
          checked={settings.ativo}
          onCheckedChange={(valor) => atualizar({ ativo: valor })}
          aria-label={t.settings.navigatorTabsSleepTitulo}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {t.settings.navigatorTabsIdleTitulo}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.navigatorTabsIdleDesc}
          </p>
        </div>
        <Select
          value={String(settings.idleMinutes)}
          onValueChange={(valor) => atualizar({ idleMinutes: Number(valor) })}
          disabled={!settings.ativo}
        >
          <SelectTrigger
            aria-label={t.settings.navigatorTabsIdleAria}
            className="w-44 shrink-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              <SelectItem value="15">
                {t.settings.navigatorTabsIdle15}
              </SelectItem>
              <SelectItem value="30">
                {t.settings.navigatorTabsIdle30}
              </SelectItem>
              <SelectItem value="60">
                {t.settings.navigatorTabsIdle60}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {t.settings.navigatorTabsMaxTitulo}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.navigatorTabsMaxDesc}
          </p>
        </div>
        <Select
          value={String(settings.maxLive)}
          onValueChange={(valor) => atualizar({ maxLive: Number(valor) })}
          disabled={!settings.ativo}
        >
          <SelectTrigger
            aria-label={t.settings.navigatorTabsMaxTitulo}
            className="w-44 shrink-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              <SelectItem value="3">{t.settings.navigatorTabsMax3}</SelectItem>
              <SelectItem value="5">{t.settings.navigatorTabsMax5}</SelectItem>
              <SelectItem value="10">
                {t.settings.navigatorTabsMax10}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </FramePanel>
  );
}

/**
 * Settings > Galaxie Apps > Navigator — grupo **Favoritos** (#307). Visibilidade
 * da barra de favoritos (liga #176). Persiste no localStorage (NavigatorPrefs).
 */
export function NavigatorFavoritosPanel() {
  const { t } = useIdioma();
  const [prefs, setPrefs] = useState<NavigatorPrefs>(loadNavigatorPrefs);
  const atualizar = (patch: Partial<NavigatorPrefs>) =>
    setPrefs((prev) => {
      const proximo = { ...prev, ...patch };
      persistNavigatorPrefs(proximo);
      return proximo;
    });

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {t.settings.navigatorFavTitulo}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.navigatorFavDesc}
          </p>
        </div>
        <Switch
          checked={prefs.mostrarBarraFav}
          onCheckedChange={(valor) => atualizar({ mostrarBarraFav: valor })}
          aria-label={t.settings.navigatorFavTitulo}
        />
      </div>
    </FramePanel>
  );
}

/**
 * Settings > Galaxie Apps > Navigator — grupo **History & privacy** (#307, liga
 * #177). Salvar histórico on/off + retenção + limpar tudo. Persiste no
 * localStorage; "Clear all" dispara evento pro App reler o histórico do disco.
 */
export function NavigatorHistoryPanel() {
  const { t } = useIdioma();
  const [prefs, setPrefs] = useState<NavigatorPrefs>(loadNavigatorPrefs);
  const atualizar = (patch: Partial<NavigatorPrefs>) =>
    setPrefs((prev) => {
      const proximo = { ...prev, ...patch };
      persistNavigatorPrefs(proximo);
      return proximo;
    });

  const limparTudo = () => {
    persistHistorico([]);
    window.dispatchEvent(new Event("galaxie:historico-limpo"));
  };

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {t.settings.navigatorHistPrivadoTitulo}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.navigatorHistPrivadoDesc}
          </p>
        </div>
        <Switch
          checked={prefs.semprePrivado}
          onCheckedChange={(valor) => atualizar({ semprePrivado: valor })}
          aria-label={t.settings.navigatorHistPrivadoTitulo}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {t.settings.navigatorHistSalvarTitulo}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.navigatorHistSalvarDesc}
          </p>
        </div>
        <Switch
          checked={prefs.salvarHistorico}
          onCheckedChange={(valor) => atualizar({ salvarHistorico: valor })}
          aria-label={t.settings.navigatorHistSalvarTitulo}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {t.settings.navigatorHistRetencaoTitulo}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.navigatorHistRetencaoDesc}
          </p>
        </div>
        <Select
          value={String(prefs.retencaoDias)}
          onValueChange={(valor) => atualizar({ retencaoDias: Number(valor) })}
          disabled={!prefs.salvarHistorico}
        >
          <SelectTrigger
            aria-label={t.settings.navigatorHistRetencaoTitulo}
            className="w-44 shrink-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              <SelectItem value="7">{t.settings.navigatorHistRet7}</SelectItem>
              <SelectItem value="30">
                {t.settings.navigatorHistRet30}
              </SelectItem>
              <SelectItem value="90">
                {t.settings.navigatorHistRet90}
              </SelectItem>
              <SelectItem value="0">
                {t.settings.navigatorHistRetForever}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {t.settings.navigatorHistLimparTitulo}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.navigatorHistLimparDesc}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 text-destructive hover:text-destructive"
          onClick={limparTudo}
        >
          {t.settings.navigatorHistLimparBotao}
        </Button>
      </div>
    </FramePanel>
  );
}
