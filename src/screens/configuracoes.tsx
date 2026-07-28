import {
  ChevronRight,
  MonitorCog,
  Palette,
  Settings,
  UserRound,
} from "lucide-react";
import { Fragment, type ComponentType, type ReactNode } from "react";
import { BridgeIcon } from "@/components/ui/icons/marca-anim";
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
import { NotificacoesPanels } from "@/components/notificacoes-settings";
import { BackgroundSettings } from "@/components/background-settings";
import {
  MoodSettings,
  StyleSettings,
} from "@/components/theme-settings";
import { TemplatesEmail } from "@/components/templates-email";
import { ColorSettings } from "@/components/color-settings";

/**
 * Um frame colapsável = UMA sub-opção configurável do item do menu (c-frame-5
 * literal): título + subtítulo no header e, dentro, os controles direto — SEM
 * frame-dentro-de-frame. `node` é o conteúdo real (interino) quando já existe;
 * senão fica um placeholder até a história filha entregar.
 */
interface SettingsFrame {
  key: string;
  /** Rótulo visual opcional que abre um grupo de cards no stack. */
  groupTitle?: string;
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
}

interface SettingsSection {
  label: string;
  items: SettingsItem[];
}

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    label: "General settings",
    items: [
      {
        id: "accounts",
        label: "Accounts",
        description: "Manage the accounts connected to GALAXIE Toolbox.",
        icon: UserRound,
      },
      {
        id: "personalization",
        label: "Personalization",
        description: "Make GALAXIE Toolbox feel like your workspace.",
        icon: Palette,
        frames: [
          {
            key: "sound-notifications",
            title: "Sound & notifications",
            subtitle: "Choose which events play a sound.",
            // Interino (AC5): os controles do #48 vão DIRETO aqui (sem moldura
            // própria); #119 realoca/reestiliza depois.
            node: <NotificacoesPanels />,
          },
          {
            key: "background",
            title: "Background",
            subtitle: "Set a background for your workspace.",
            node: <BackgroundSettings />,
          },
          {
            key: "mood",
            groupTitle: "Appearance",
            title: "Mood",
            subtitle: "Set the atmosphere and color palette for your workspace.",
            node: <MoodSettings />,
          },
          {
            key: "style",
            title: "Style",
            subtitle: "Choose light, dark, or match your operating system.",
            node: <StyleSettings />,
          },
          {
            key: "colors",
            title: "Colors",
            subtitle: "Choose an accessible accent color for the interface.",
            node: <ColorSettings />,
          },
          { key: "lock-screen", title: "Lock screen", subtitle: "Protect the app with a PIN.", pending: 122 },
        ],
      },
      {
        id: "system",
        label: "System",
        description: "Choose how GALAXIE Toolbox works with your device.",
        icon: MonitorCog,
        frames: [
          { key: "startup", title: "Startup", subtitle: "Choose what runs when the app starts.", pending: 123 },
        ],
      },
    ],
  },
  {
    label: "Apps",
    items: [
      {
        id: "galaxie-apps",
        label: "Galaxie Apps",
        description: "Configure the apps created by Galaxie.",
        icon: GalaxieSymbol,
        // Agrupador: a configuração real vive no subitem Bridge.
        children: [
          {
            id: "bridge",
            label: "Bridge",
            description: "Configure the Bridge email client.",
            icon: BridgeIcon,
            frames: [
              {
                key: "email-templates",
                title: "Email templates",
                subtitle: "Reusable message templates for Bridge.",
                // Interino (AC5): a CRUD do #93 vai DIRETO aqui (modo bare, sem
                // card/título próprios); #124 assume/reestiliza depois.
                node: (
                  <FramePanel>
                    <TemplatesEmail bare />
                  </FramePanel>
                ),
              },
            ],
          },
        ],
      },
      {
        id: "microsoft-365-copilot",
        label: "Microsoft 365 Copilot",
        description: "Manage Microsoft 365 Copilot integrations.",
        icon: CopilotIcon,
      },
      {
        id: "windows",
        label: "Windows",
        description: "Review Windows-related app settings.",
        icon: MonitorCog,
      },
    ],
  },
];

/** Achata itens + subitens (children) num mapa id → item, pra lookup do contexto. */
const SETTINGS_BY_ID = new Map<SettingsItemId, SettingsItem>();
for (const section of SETTINGS_SECTIONS) {
  for (const item of section.items) {
    SETTINGS_BY_ID.set(item.id, item);
    for (const child of item.children ?? []) {
      SETTINGS_BY_ID.set(child.id, child);
    }
  }
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
  selected,
  onSelect,
}: {
  selected: SettingsItemId;
  onSelect: (item: SettingsItemId) => void;
}) {
  return (
    <aside
      aria-label="Settings navigation"
      className="w-full shrink-0 overflow-y-auto rounded-xl border bg-card p-2 md:h-full md:w-64"
    >
      {SETTINGS_SECTIONS.map((section) => (
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
                  ? `Delivered in a follow-up (#${frame.pending}).`
                  : "Configuration controls for this option will appear here."}
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
  const selectedItem = useAppStore((state) => state.selectedSettingsItem);
  const setSelectedItem = useAppStore((state) => state.setSelectedSettingsItem);
  const current = SETTINGS_BY_ID.get(selectedItem) ?? SETTINGS_SECTIONS[0].items[0];
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
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage GALAXIE Toolbox settings in one place.
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <SettingsNavigation selected={selectedItem} onSelect={setSelectedItem} />

        {/* Área de contexto PLANA (sem card/borda): título+descrição uma vez e,
            abaixo, um frame colapsável por sub-opção. */}
        <section aria-labelledby="settings-context-title" className="min-w-0 flex-1 overflow-y-auto pr-1">
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
                <Fragment key={frame.key}>
                  {frame.groupTitle ? (
                    <h3 className="px-1 pt-2 text-sm font-semibold">
                      {frame.groupTitle}
                    </h3>
                  ) : null}
                  <OptionFrame owner={current.id} frame={frame} />
                </Fragment>
              ))}
            </div>
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">
              No configurable options here yet.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
