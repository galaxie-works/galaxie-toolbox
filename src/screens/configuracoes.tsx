import {
  Building2,
  ChevronRight,
  MonitorCog,
  Palette,
  Settings,
  UserRound,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { BridgeIcon, NavigatorIcon } from "@/components/ui/icons/marca-anim";
import { CopilotIcon } from "@/components/ui/icons/marca/copilot";
import { GalaxieSymbol } from "@/components/brand";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { useAppStore } from "@/store";
import type { SettingsItemId } from "@/store/settings-ui-slice";
import { cn } from "@/lib/utils";
import { useIdioma, preencher } from "@/lib/idioma";
import type { Dicionario } from "@/lib/strings";
import { NotificacoesPanels } from "@/components/notificacoes-settings";
import { BackgroundSettings } from "@/components/background-settings";
import {
  NavigatorFavoritosPanel,
  NavigatorHistoryPanel,
  NavigatorSearchPanel,
  NavigatorTabsPanel,
} from "@/components/navigator-settings";
import { LockScreenSettings } from "@/components/lock-screen-settings";
import { LanguageSettings } from "@/components/language-settings";
import { StartupSettings } from "@/components/startup-settings";
import { TelemetrySettings } from "@/components/telemetry-settings";
import { OrganizationSettings } from "@/components/organization-settings";
import {
  AccessibilitySettings,
  MoodSettings,
  StyleSettings,
} from "@/components/theme-settings";
import {
  ConversationViewPanel,
  ReadingPreferencesPanel,
  SignaturesPanel,
  EmailTemplatesPanel,
  UndoSendPanel,
  SyncPreferencesPanel,
} from "@/components/bridge-settings";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { NodesIllustration } from "@/components/examples/c-empty-19";

/**
 * Um frame colapsável = UMA sub-opção configurável do item do menu (c-frame-5
 * literal): título + subtítulo no header e, dentro, os controles direto — SEM
 * frame-dentro-de-frame. `node` é o conteúdo real (interino) quando já existe;
 * senão fica um placeholder até a história filha entregar.
 */
interface SettingsFrame {
  key: string;
  title: string;
  subtitle: string;
  /** Conteúdo real (já vem em FramePanels); ausente = placeholder até a filha. */
  node?: ReactNode;
  /** Nº da issue filha que entrega/reestiliza esta sub-opção (placeholder). */
  pending?: number;
}

interface SettingsItem {
  id: SettingsItemId;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  /** Sub-opções configuráveis (frames). Item sem frames = só título/descrição. */
  frames?: SettingsFrame[];
  /** Subitens aninhados no sidebar (ex.: Galaxie Apps é agrupador do Bridge). */
  children?: SettingsItem[];
  /**
   * Empty state próprio (c-empty-19 literal). Quando presente, o item NÃO
   * renderiza o header de contexto nem o placeholder — só este empty.
   */
  emptyState?: ReactNode;
}

interface SettingsSection {
  label: string;
  items: SettingsItem[];
}

/**
 * Cards empilhados do frame "Appearance": Mood, Style e Accessibility (#136).
 * Lê `altoContraste` do store para desabilitar o Mood quando o alto contraste
 * está ligado (o preset high-contrast sobrepõe o Mood).
 */
function AppearancePanels() {
  const altoContraste = useAppStore((state) => state.altoContraste);
  return (
    <>
      <MoodSettings disabled={altoContraste} />
      <StyleSettings />
      <AccessibilitySettings />
      {/* #474: Background (fundos animados) passou a viver aqui, junto de
          Mood/Style/Accessibility — deixou de ser frame próprio. */}
      <BackgroundSettings />
    </>
  );
}

/**
 * Monta as seções da Settings a partir do dicionário ativo (`t`). Precisa ser
 * função — e não const de módulo — porque o `t` só existe em runtime, dentro do
 * componente (o hook `useIdioma` não roda em escopo de módulo). Os componentes
 * de `node` seguem sendo JSX estático (não têm string pra traduzir aqui).
 */
function settingsSections(t: Dicionario): SettingsSection[] {
  const s = t.settings;
  return [
    {
      label: s.cfgGeneralLabel,
      items: [
        {
          id: "accounts",
          label: s.cfgAccountsLabel,
          description: s.cfgAccountsDesc,
          icon: UserRound,
          // c-empty-19 literal (radix-nova), sem botões: só header + ilustração.
          emptyState: (
            <div className="flex items-center justify-center p-4">
              <Empty className="py-12">
                <EmptyHeader>
                  <EmptyMedia>
                    <NodesIllustration />
                  </EmptyMedia>
                  <EmptyTitle>{s.cfgAccountsEmptyTitulo}</EmptyTitle>
                  <EmptyDescription>{s.cfgAccountsEmptyDesc}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          ),
        },
        {
          id: "personalization",
          label: s.cfgPersonalizationLabel,
          description: s.cfgPersonalizationDesc,
          icon: Palette,
          frames: [
            {
              key: "sound-notifications",
              title: s.cfgSoundTitulo,
              subtitle: s.cfgSoundSubtitulo,
              // Interino (AC5): os controles do #48 vão DIRETO aqui (sem moldura
              // própria); #119 realoca/reestiliza depois.
              node: <NotificacoesPanels />,
            },
            {
              key: "appearance",
              title: s.cfgAppearanceTitulo,
              subtitle: s.cfgAppearanceSubtitulo,
              // Frame with stacked cards (c-frame-3 dentro do c-frame-5): Mood,
              // Style e Accessibility são FramePanels empilhados NUM frame só, igual
              // ao Sound & notifications. Cada card traz label+descrição + controle.
              node: <AppearancePanels />,
            },
            {
              key: "lock-screen",
              title: s.cfgLockScreenTitulo,
              subtitle: s.cfgLockScreenSubtitulo,
              node: <LockScreenSettings />,
            },
          ],
        },
        {
          // #580: a seção "Privacy" morreu — só continha o painel de telemetria,
          // que foi movido pra System (junto do Startup).
          id: "system",
          label: s.cfgSystemLabel,
          description: s.cfgSystemDesc,
          icon: MonitorCog,
          frames: [
            {
              key: "language",
              title: s.cfgLanguageTitulo,
              subtitle: s.cfgLanguageSubtitulo,
              node: <LanguageSettings />,
            },
            {
              key: "startup",
              title: s.cfgStartupTitulo,
              subtitle: s.cfgStartupSubtitulo,
              node: <StartupSettings />,
            },
            {
              // #580: telemetria agora vive em System.
              key: "telemetry",
              title: s.cfgTelemetryTitulo,
              subtitle: s.cfgTelemetrySubtitulo,
              node: <TelemetrySettings />,
            },
          ],
        },
      ],
    },
    {
      label: s.cfgAppsLabel,
      items: [
        {
          id: "galaxie-apps",
          label: s.cfgGalaxieAppsLabel,
          description: s.cfgGalaxieAppsDesc,
          icon: GalaxieSymbol,
          // Agrupador: a configuração real vive no subitem Bridge.
          children: [
            {
              id: "bridge",
              label: s.cfgBridgeLabel,
              description: s.cfgBridgeDesc,
              icon: BridgeIcon,
              frames: [
                {
                  key: "reading",
                  title: s.cfgReadingTitulo,
                  subtitle: s.cfgReadingSubtitulo,
                  // Frame with stacked cards (c-frame-3 dentro do c-frame-5): os
                  // controles de leitura empilhados num frame só (igual ao
                  // Appearance). O "Mark as read" (#227) migrou da toolbar do leitor.
                  node: (
                    <>
                      <ConversationViewPanel />
                      <ReadingPreferencesPanel />
                    </>
                  ),
                },
                {
                  key: "sending",
                  title: s.cfgSendingTitulo,
                  subtitle: s.cfgSendingSubtitulo,
                  // Signature & Templates + Undo send, empilhados num frame só.
                  node: (
                    <>
                      <SignaturesPanel />
                      <EmailTemplatesPanel />
                      <UndoSendPanel />
                    </>
                  ),
                },
                {
                  key: "sync",
                  title: s.cfgSyncTitulo,
                  subtitle: s.cfgSyncSubtitulo,
                  node: <SyncPreferencesPanel />,
                },
              ],
            },
            {
              id: "navigator",
              label: s.cfgNavigatorLabel,
              description: s.cfgNavigatorDesc,
              icon: NavigatorIcon,
              frames: [
                {
                  key: "search",
                  title: s.cfgSearchTitulo,
                  subtitle: s.cfgSearchSubtitulo,
                  node: <NavigatorSearchPanel />,
                },
                {
                  key: "tabs",
                  title: s.cfgTabsTitulo,
                  subtitle: s.cfgTabsSubtitulo,
                  node: <NavigatorTabsPanel />,
                },
                {
                  key: "favorites",
                  title: s.cfgFavoritesTitulo,
                  subtitle: s.cfgFavoritesSubtitulo,
                  node: <NavigatorFavoritosPanel />,
                },
                {
                  key: "history",
                  title: s.cfgHistoryTitulo,
                  subtitle: s.cfgHistorySubtitulo,
                  node: <NavigatorHistoryPanel />,
                },
              ],
            },
          ],
        },
        {
          id: "microsoft-365-copilot",
          label: s.cfgCopilotLabel,
          description: s.cfgCopilotDesc,
          icon: CopilotIcon,
        },
        {
          // #206 Org Admin S1: governança org-wide do M365. Gated por escopo admin
          // (degrada gracioso). Cartões OrgSettings (S2) + multi-tenant (S3) vêm depois.
          id: "organization",
          label: s.cfgOrganizationLabel,
          description: s.cfgOrganizationDesc,
          icon: Building2,
          frames: [
            {
              key: "org-governance",
              title: s.cfgOrgGovernanceTitulo,
              subtitle: s.cfgOrgGovernanceSubtitulo,
              node: <OrganizationSettings />,
            },
          ],
        },
        {
          id: "windows",
          label: s.cfgWindowsLabel,
          description: s.cfgWindowsDesc,
          icon: MonitorCog,
        },
      ],
    },
  ];
}

/** Achata itens + subitens (children) num mapa id → item, pra lookup do contexto. */
function mapaSettingsPorId(
  sections: SettingsSection[]
): Map<SettingsItemId, SettingsItem> {
  const mapa = new Map<SettingsItemId, SettingsItem>();
  for (const section of sections) {
    for (const item of section.items) {
      mapa.set(item.id, item);
      for (const child of item.children ?? []) {
        mapa.set(child.id, child);
      }
    }
  }
  return mapa;
}

function NavButton({
  item,
  active,
  nested,
  onSelect,
}: {
  item: SettingsItem;
  active: boolean;
  nested?: boolean;
  onSelect: (item: SettingsItemId) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(item.id)}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
        nested && "pl-8",
        active
          ? "bg-secondary font-medium text-secondary-foreground"
          : "hover:bg-accent/50"
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </button>
  );
}

function SettingsNavigation({
  sections,
  selected,
  onSelect,
}: {
  sections: SettingsSection[];
  selected: SettingsItemId;
  onSelect: (item: SettingsItemId) => void;
}) {
  const { t } = useIdioma();
  return (
    <aside
      aria-label={t.settings.cfgNavAriaLabel}
      className="w-full shrink-0 overflow-y-auto rounded-xl border bg-card p-2 md:h-full md:w-64"
    >
      {sections.map((section) => (
        <Collapsible key={section.label} defaultOpen className="group/settings-section">
          <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent/50">
            <span className="flex-1">{section.label}</span>
            <ChevronRight className="size-4 transition-transform duration-200 group-data-[state=open]/settings-section:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1 pb-2">
            {section.items.map((item) => (
              <div key={item.id} className="space-y-1">
                <NavButton item={item} active={selected === item.id} onSelect={onSelect} />
                {item.children?.map((child) => (
                  <NavButton
                    key={child.id}
                    item={child}
                    nested
                    active={selected === child.id}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </aside>
  );
}

/**
 * Uma sub-opção configurável = UM frame (c-frame-5 literal), fechado por padrão:
 * header com título + subtítulo; conteúdo (controles) direto dentro, sem outra
 * moldura.
 */
function OptionFrame({
  owner,
  frame,
}: {
  owner: SettingsItemId;
  frame: SettingsFrame;
}) {
  const { t } = useIdioma();
  const frameId = `${owner}:${frame.key}`;
  const aberto = useAppStore(
    (state) => state.settingsFramesAbertos[frameId] ?? false
  );
  const setSettingsFrameAberto = useAppStore(
    (state) => state.setSettingsFrameAberto
  );

  return (
    <Frame className="w-full" stacked>
      <Collapsible
        open={aberto}
        onOpenChange={(open) => setSettingsFrameAberto(frameId, open)}
        className="group/collapsible"
      >
        <CollapsibleTrigger className="w-full text-left">
          <FrameHeader className="flex grow flex-row items-center justify-between gap-2">
            <div className="min-w-0">
              <FrameTitle>{frame.title}</FrameTitle>
              <FrameDescription>{frame.subtitle}</FrameDescription>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </FrameHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {frame.node ?? (
            <FramePanel>
              <FrameDescription>
                {frame.pending
                  ? preencher(t.settings.cfgFramePendingPlaceholder, {
                      issue: frame.pending,
                    })
                  : t.settings.cfgFrameEmptyPlaceholder}
              </FrameDescription>
            </FramePanel>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Frame>
  );
}

/** Base da #118; os painéis reais das sub-opções vêm nas filhas #119–#124. */
export function ConfiguracoesScreen() {
  const { t } = useIdioma();
  const selectedItem = useAppStore((state) => state.selectedSettingsItem);
  const setSelectedItem = useAppStore((state) => state.setSelectedSettingsItem);
  const secoes = settingsSections(t);
  const porId = mapaSettingsPorId(secoes);
  const current = porId.get(selectedItem) ?? secoes[0].items[0];
  const CurrentIcon = current.icon;
  const frames = current.frames ?? [];

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Mesmo hero do Bridge: símbolo + título + subtítulo. */}
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Settings className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t.settings.cfgHeroTitulo}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t.settings.cfgHeroSubtitulo}
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <SettingsNavigation
          sections={secoes}
          selected={selectedItem}
          onSelect={setSelectedItem}
        />

        {/* Área de contexto PLANA (sem card/borda): título+descrição uma vez e,
            abaixo, um frame colapsável por sub-opção. Itens com empty state
            próprio (ex.: Accounts) renderizam SÓ o empty, sem header. */}
        <section aria-labelledby="settings-context-title" className="min-w-0 flex-1 overflow-y-auto pr-1">
          {current.emptyState ? (
            current.emptyState
          ) : (
            <>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md bg-secondary p-2 text-secondary-foreground">
                  <CurrentIcon className="size-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="settings-context-title" className="text-lg font-semibold tracking-tight">
                    {current.label}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">{current.description}</p>
                </div>
              </div>

              {frames.length > 0 ? (
                <div className="mt-6 space-y-3">
                  {frames.map((frame) => (
                    <OptionFrame key={frame.key} owner={current.id} frame={frame} />
                  ))}
                </div>
              ) : (
                <p className="mt-6 text-sm text-muted-foreground">
                  {t.settings.cfgSemOpcoes}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
