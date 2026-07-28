import {
  AppWindow,
  ChevronRight,
  MonitorCog,
  Palette,
  Settings,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";
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
import {
  useAppStore,
} from "@/store";
import type { SettingsItemId } from "@/store/settings-ui-slice";
import { cn } from "@/lib/utils";
import { NotificacoesSettings } from "@/components/notificacoes-settings";
import { TemplatesEmail } from "@/components/templates-email";

interface SettingsItem {
  id: SettingsItemId;
  label: string;
  description: string;
  icon: LucideIcon;
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
      },
      {
        id: "system",
        label: "System",
        description: "Choose how GALAXIE Toolbox works with your device.",
        icon: MonitorCog,
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
        icon: Sparkles,
      },
      {
        id: "microsoft-365-copilot",
        label: "Microsoft 365 Copilot",
        description: "Manage Microsoft 365 Copilot integrations.",
        icon: AppWindow,
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

const SETTINGS_BY_ID = new Map(
  SETTINGS_SECTIONS.flatMap((section) => section.items).map((item) => [item.id, item])
);

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
      className="w-full shrink-0 rounded-xl border bg-card p-2 md:w-64"
    >
      {SETTINGS_SECTIONS.map((section) => (
        <Collapsible key={section.label} defaultOpen className="group/settings-section">
          <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent/50">
            <span className="flex-1">{section.label}</span>
            <ChevronRight className="size-4 transition-transform duration-200 group-data-[state=open]/settings-section:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1 pb-2">
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = selected === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-secondary font-medium text-secondary-foreground"
                      : "hover:bg-accent/50"
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </aside>
  );
}

/** Base da #118; os painéis de preferências reais são entregues nas filhas. */
export function ConfiguracoesScreen() {
  const selectedItem = useAppStore((state) => state.selectedSettingsItem);
  const setSelectedItem = useAppStore((state) => state.setSelectedSettingsItem);
  const current = SETTINGS_BY_ID.get(selectedItem) ?? SETTINGS_SECTIONS[0].items[0];
  const CurrentIcon = current.icon;

  return (
    <div className="flex min-h-[34rem] flex-1 flex-col gap-4">
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

        <section
          aria-labelledby="settings-context-title"
          className="min-w-0 flex-1 rounded-xl border bg-card p-4"
        >
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

          {/* @reui/c-frame-5 literal: os conteúdos reais entram nas filhas. */}
          <Frame className="mt-6 w-full" stacked>
            <Collapsible defaultOpen className="group/collapsible">
              <CollapsibleTrigger className="w-full">
                <FrameHeader className="flex grow flex-row items-center justify-between gap-2">
                  <FrameTitle>{current.label}</FrameTitle>
                  <ChevronRight className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </FrameHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <FramePanel>
                  {selectedItem === "personalization" ? (
                    // Interino p/ AC5: #119 vai realocar/reestilizar Sound & notifications;
                    // aqui só preservamos o acesso vivo enquanto a filha não chega.
                    <NotificacoesSettings />
                  ) : selectedItem === "galaxie-apps" ? (
                    // Interino p/ AC5: #124 realoca os Email templates (#93) pra Bridge;
                    // acesso preservado até a filha assumir.
                    <TemplatesEmail />
                  ) : (
                    <FrameDescription>
                      Configuration controls for this area will appear here as their Settings
                      sections are delivered.
                    </FrameDescription>
                  )}
                </FramePanel>
              </CollapsibleContent>
            </Collapsible>
          </Frame>
        </section>
      </div>
    </div>
  );
}
