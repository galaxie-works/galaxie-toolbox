import { useEffect, useState } from "react";
import { Building2, ShieldAlert } from "lucide-react";

import { FramePanel } from "@/components/reui/frame";
import { Spinner } from "@/components/ui/spinner";
import { crOrgAdminAvailable } from "@/lib/api";
import { useIdioma } from "@/lib/idioma";

/**
 * Settings › Apps › Organization — painel de governança org-wide do M365
 * (épico #206). **S1 (fundação):** estabelece o surface + o gating por escopo
 * admin. Os cartões read-only (Apps & Services / Forms / Microsoft 365 Install
 * — S2/#425) e o contexto multi-tenant (S3/#426) entram nas próximas slices.
 *
 * Gating: `cr_org_admin_available` diz se o token carrega os escopos OrgSettings
 * (admin consent + relogin depois de os escopos entrarem no `config::SCOPES`).
 * Não-admin (ou quem ainda não relogou) vê uma degradação graciosa — sem erro
 * cru, sem consent silencioso.
 */
export function OrganizationSettings() {
  const { t } = useIdioma();
  // null = ainda verificando; true/false = tem/ não tem os escopos admin.
  const [disponivel, setDisponivel] = useState<boolean | null>(null);

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
          <p className="text-sm text-muted-foreground">
            {t.settings.cfgOrgGateMsg}
          </p>
        </div>
      </FramePanel>
    );
  }

  return (
    <FramePanel>
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
        <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t.settings.cfgOrgPlaceholderMsg}
        </p>
      </div>
    </FramePanel>
  );
}
