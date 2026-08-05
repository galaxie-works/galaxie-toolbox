import { useEffect, useState } from "react";
import {
  AppWindow,
  Building2,
  FileText,
  MonitorDown,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { FramePanel } from "@/components/reui/frame";
import { Spinner } from "@/components/ui/spinner";
import {
  crOrgAdminAvailable,
  crOrgSettings,
  type OrgCardStatus,
  type OrgSettingsResult,
} from "@/lib/api";
import { useIdioma } from "@/lib/idioma";

/**
 * Settings › Apps › Organization — governança org-wide do M365 (épico #206).
 * **S2 (#425):** cartões READ-ONLY de OrgSettings (Apps & Services / Forms /
 * Microsoft 365 Install), lidos via `cr_org_settings`. Cada card degrada sozinho
 * (sem permissão / erro). O painel inteiro é gated pela S1 (`cr_org_admin_available`).
 * Multi-tenant (S3/#426) entra depois.
 */

/** Pílula Ativado/Desativado/— pra um setting booleano (null = desconhecido). */
function ValorBool({ v }: { v: boolean | null }) {
  const { t } = useIdioma();
  const s = t.settings;
  if (v === null) {
    return <span className="text-xs text-muted-foreground">{s.cfgOrgUnknown}</span>;
  }
  return (
    <span
      className={
        v
          ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
          : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
      }
    >
      {v ? s.cfgOrgOn : s.cfgOrgOff}
    </span>
  );
}

/** Linha label ↔ valor dentro de um cartão. */
function LinhaSetting({ label, valor }: { label: string; valor: boolean | null }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <ValorBool v={valor} />
    </div>
  );
}

/** Casca do cartão: header (ícone + título) + corpo, ou mensagem de degradação. */
function Cartao({
  icon: Icon,
  title,
  status,
  children,
}: {
  icon: LucideIcon;
  title: string;
  status: OrgCardStatus;
  children: React.ReactNode;
}) {
  const { t } = useIdioma();
  const s = t.settings;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <h4 className="text-sm font-medium">{title}</h4>
      </div>
      {status === "ok" ? (
        <div className="divide-y divide-border/60">{children}</div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {status === "forbidden" ? s.cfgOrgCardForbidden : s.cfgOrgCardError}
        </p>
      )}
    </div>
  );
}

export function OrganizationSettings() {
  const { t } = useIdioma();
  const s = t.settings;
  // null = ainda verificando; true/false = tem/ não tem os escopos admin.
  const [disponivel, setDisponivel] = useState<boolean | null>(null);
  const [dados, setDados] = useState<OrgSettingsResult | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    let vivo = true;
    crOrgAdminAvailable()
      .then((ok) => {
        if (vivo) setDisponivel(ok);
      })
      .catch(() => {
        if (vivo) setDisponivel(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

  // Só busca os settings quando o gating confirma o acesso (S1).
  useEffect(() => {
    if (disponivel !== true) return;
    let vivo = true;
    setCarregando(true);
    crOrgSettings()
      .then((r) => {
        if (vivo) setDados(r);
      })
      .catch(() => {
        if (vivo) setDados(null);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [disponivel]);

  if (disponivel === null) {
    return (
      <FramePanel>
        <div className="flex items-center justify-center py-8">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      </FramePanel>
    );
  }

  if (!disponivel) {
    return (
      <FramePanel>
        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{s.cfgOrgGateMsg}</p>
        </div>
      </FramePanel>
    );
  }

  if (carregando || !dados) {
    return (
      <FramePanel>
        <div className="flex items-center justify-center py-8">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      </FramePanel>
    );
  }

  const { appsAndServices, forms, microsoft365Install: m365 } = dados;

  return (
    <FramePanel>
      <div className="flex flex-col gap-3">
        <Cartao
          icon={AppWindow}
          title={s.cfgOrgAppsServicesTitle}
          status={appsAndServices.status}
        >
          <LinhaSetting
            label={s.cfgOrgOfficeStore}
            valor={appsAndServices.isOfficeStoreEnabled}
          />
          <LinhaSetting
            label={s.cfgOrgAppsTrial}
            valor={appsAndServices.isAppAndServicesTrialEnabled}
          />
        </Cartao>

        <Cartao icon={FileText} title={s.cfgOrgFormsTitle} status={forms.status}>
          <LinhaSetting
            label={s.cfgOrgFormExternalSend}
            valor={forms.isExternalSendFormEnabled}
          />
          <LinhaSetting
            label={s.cfgOrgFormExternalShareCollab}
            valor={forms.isExternalShareCollaborationEnabled}
          />
          <LinhaSetting
            label={s.cfgOrgFormExternalShareResult}
            valor={forms.isExternalShareResultEnabled}
          />
          <LinhaSetting
            label={s.cfgOrgFormExternalShareTemplate}
            valor={forms.isExternalShareTemplateEnabled}
          />
          <LinhaSetting
            label={s.cfgOrgFormRecordIdentity}
            valor={forms.isRecordIdentityByDefaultEnabled}
          />
          <LinhaSetting
            label={s.cfgOrgFormBingImage}
            valor={forms.isBingImageSearchEnabled}
          />
          <LinhaSetting
            label={s.cfgOrgFormPhishingScan}
            valor={forms.isInOrgFormsPhishingScanEnabled}
          />
        </Cartao>

        <Cartao
          icon={MonitorDown}
          title={s.cfgOrgM365InstallTitle}
          status={m365.status}
        >
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-sm text-muted-foreground">
              {s.cfgOrgUpdateChannel}
            </span>
            <span className="text-xs font-medium">
              {m365.updateChannel ?? s.cfgOrgUnknown}
            </span>
          </div>
          {(["appsForWindows", "appsForMac"] as const).map((plataforma) => {
            const p = m365[plataforma];
            const rotulo = plataforma === "appsForWindows" ? "Windows" : "Mac";
            return (
              <div key={plataforma} className="py-1.5">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Building2 className="size-3.5" />
                  {rotulo}
                </p>
                <div className="pl-1">
                  <LinhaSetting
                    label="Microsoft 365 Apps"
                    valor={p?.isMicrosoft365AppsEnabled ?? null}
                  />
                  <LinhaSetting label="Project" valor={p?.isProjectEnabled ?? null} />
                  <LinhaSetting
                    label="Skype for Business"
                    valor={p?.isSkypeForBusinessEnabled ?? null}
                  />
                  <LinhaSetting label="Visio" valor={p?.isVisioEnabled ?? null} />
                </div>
              </div>
            );
          })}
        </Cartao>
      </div>
    </FramePanel>
  );
}
