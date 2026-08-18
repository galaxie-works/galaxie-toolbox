import { useEffect, useState } from "react";
import {
  AppWindow,
  Building2,
  FileText,
  ListChecks,
  MonitorDown,
  Network,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { FramePanel } from "@/components/reui/frame";
import { Spinner } from "@/components/ui/spinner";
import {
  crMultiTenant,
  crOrgAdminAvailable,
  crOrgSettings,
  crOrgTodoSet,
  type MultiTenantCard,
  type OrgCardStatus,
  type OrgSettingsResult,
} from "@/lib/api";
import { useIdioma } from "@/lib/idioma";
import { useTier } from "@/lib/tier-context";
import { RecursoOrgEmpty } from "@/components/recurso-org-empty";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

/**
 * #208 (RW): a escrita org-wide de To Do fica TRAVADA até o endpoint `/admin/todo`
 * ser confirmado no live-QA de admin real (não dá pra testar Graph em dev). O
 * código do RW já está pronto (backend `cr_org_todo_set` + `crOrgTodoSet` + a UI
 * abaixo); ATIVAR é só virar isto pra `true` depois de validar o endpoint/shape.
 */
const TODO_RW_HABILITADO = false;

/** Linha de setting de To Do: read-only (pílula) enquanto o RW está travado;
 *  Switch com confirmação (sem escrita silenciosa) quando habilitado (#208). */
function LinhaTodo({
  label,
  valor,
  campo,
}: {
  label: string;
  valor: boolean | null;
  campo: string;
}) {
  const { t } = useIdioma();
  const s = t.settings;
  const [atual, setAtual] = useState<boolean | null>(valor);
  const [pendente, setPendente] = useState<boolean | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Travado (gate) ou valor desconhecido → read-only, como os outros cards.
  if (!TODO_RW_HABILITADO || atual === null) {
    return <LinhaSetting label={label} valor={atual} />;
  }

  async function confirmar() {
    if (pendente === null) return;
    setSalvando(true);
    try {
      await crOrgTodoSet(campo, pendente);
      setAtual(pendente);
    } finally {
      setSalvando(false);
      setPendente(null);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Switch
        checked={atual}
        disabled={salvando}
        onCheckedChange={(v) => setPendente(v)}
        aria-label={label}
      />
      <AlertDialog
        open={pendente !== null}
        onOpenChange={(o) => !o && !salvando && setPendente(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{s.cfgOrgTodoConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {s.cfgOrgTodoConfirmDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{s.cfgOrgTodoConfirmCancel}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmar}>
              {s.cfgOrgTodoConfirmOk}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** #426: pílula do estado de um tenant membro (active/pending/removed). */
function PilulaEstado({ state }: { state: string }) {
  const { t } = useIdioma();
  const s = t.settings;
  const rotulo =
    state === "active"
      ? s.cfgOrgMtActive
      : state === "pending"
        ? s.cfgOrgMtPending
        : state === "removed"
          ? s.cfgOrgMtRemoved
          : state;
  const cor =
    state === "active"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : state === "pending"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cor}`}>
      {rotulo}
    </span>
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
          {/* #1075 RB45: era ternário binário — TUDO que não fosse "forbidden"
              virava "não foi possível carregar", inclusive o endpoint que
              simplesmente não existe neste tenant. São coisas diferentes para
              quem lê: uma é permanente e sem ação, a outra pede tentar de novo. */}
          {status === "forbidden"
            ? s.cfgOrgCardForbidden
            : status === "indisponivel"
              ? s.cfgOrgCardIndisponivel
              : s.cfgOrgCardError}
        </p>
      )}
    </div>
  );
}

export function OrganizationSettings() {
  const { t } = useIdioma();
  const s = t.settings;
  // #699 (PS6): governança/Org Admin é feature de ORG — nos tiers pessoal/
  // uncontracted degrada pro empty-state de tier (não o gate de escopo, que soa
  // como "faltou permissão"). Na org contratada segue o gate de escopo abaixo.
  const { recursoOrgDisponivel } = useTier();
  // null = ainda verificando; true/false = tem/ não tem os escopos admin.
  const [disponivel, setDisponivel] = useState<boolean | null>(null);
  const [dados, setDados] = useState<OrgSettingsResult | null>(null);
  const [multiTenant, setMultiTenant] = useState<MultiTenantCard | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    // Tier pessoal/uncontracted nem sonda o backend — é empty-state de tier.
    if (!recursoOrgDisponivel) return;
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
  }, [recursoOrgDisponivel]);

  // Só busca os settings quando o gating confirma o acesso (S1).
  useEffect(() => {
    if (disponivel !== true) return;
    let vivo = true;
    setCarregando(true);
    // #426: OrgSettings (3 cards) + multi-tenant (1 card) em paralelo; ambos
    // gated pela S1 e cada um com seu próprio status de degradação.
    Promise.all([
      crOrgSettings().then((r) => {
        if (vivo) setDados(r);
      }),
      crMultiTenant()
        .then((r) => {
          if (vivo) setMultiTenant(r);
        })
        .catch(() => {
          if (vivo) setMultiTenant({ status: "error", displayName: null, members: [] });
        }),
    ])
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

  // #699: gate de tier ANTES do gate de escopo — feature de org num tier não-org
  // é empty-state de tier, não "faltou permissão".
  if (!recursoOrgDisponivel) {
    return (
      <FramePanel>
        <RecursoOrgEmpty />
      </FramePanel>
    );
  }

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

  if (carregando || !dados || !multiTenant) {
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
            // #425 fix: o Graph só retorna os apps que a plataforma tem — o
            // `appsForMac`, p.ex., não traz Project nem Visio. Renderizar só os
            // campos presentes (não-null) evita mostrar "—" pra app que não
            // existe naquela plataforma (dúvida do Wagner).
            const linhas = [
              { label: "Microsoft 365 Apps", valor: p?.isMicrosoft365AppsEnabled ?? null },
              { label: "Project", valor: p?.isProjectEnabled ?? null },
              { label: "Skype for Business", valor: p?.isSkypeForBusinessEnabled ?? null },
              { label: "Visio", valor: p?.isVisioEnabled ?? null },
            ].filter((linha) => linha.valor !== null);
            if (linhas.length === 0) return null;
            return (
              <div key={plataforma} className="py-1.5">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Building2 className="size-3.5" />
                  {rotulo}
                </p>
                <div className="pl-1">
                  {linhas.map((linha) => (
                    <LinhaSetting
                      key={linha.label}
                      label={linha.label}
                      valor={linha.valor}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </Cartao>

        {/* #208: To Do org-wide (OrgSettings-Todo). Read-only como os irmãos;
            a escrita (RW gated + confirmação) é seguida quando o endpoint for
            confirmado no live-QA (admin real). Degrada sozinho (sem permissão/erro). */}
        <Cartao icon={ListChecks} title={s.cfgOrgTodoTitle} status={dados.todo.status}>
          <LinhaTodo
            campo="isPushNotificationEnabled"
            label={s.cfgOrgTodoPush}
            valor={dados.todo.isPushNotificationEnabled}
          />
          <LinhaTodo
            campo="isExternalJoinEnabled"
            label={s.cfgOrgTodoExternalJoin}
            valor={dados.todo.isExternalJoinEnabled}
          />
          <LinhaTodo
            campo="isExternalShareEnabled"
            label={s.cfgOrgTodoExternalShare}
            valor={dados.todo.isExternalShareEnabled}
          />
        </Cartao>

        {/* #426: contexto multi-tenant (org + tenants membros). "inactive" =
            tenant não faz parte de uma org multi-tenant → mensagem própria. */}
        <Cartao
          icon={Network}
          title={s.cfgOrgMtTitle}
          status={multiTenant.status === "inactive" ? "ok" : multiTenant.status}
        >
          {multiTenant.status === "inactive" ? (
            <p className="text-sm text-muted-foreground">{s.cfgOrgMtInactive}</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-sm text-muted-foreground">
                  {s.cfgOrgMtOrg}
                </span>
                <span className="text-xs font-medium">
                  {multiTenant.displayName ?? s.cfgOrgUnknown}
                </span>
              </div>
              <div className="py-1.5">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {s.cfgOrgMtTenants}
                </p>
                <div className="divide-y divide-border/60 pl-1">
                  {multiTenant.members.map((m) => (
                    <div
                      key={m.tenantId || m.displayName}
                      className="flex items-center justify-between gap-3 py-1.5"
                    >
                      <span className="min-w-0 truncate text-sm">
                        {m.displayName || m.tenantId}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {m.role === "owner"
                            ? s.cfgOrgMtOwner
                            : s.cfgOrgMtMember}
                        </span>
                        <PilulaEstado state={m.state} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </Cartao>
      </div>
    </FramePanel>
  );
}
