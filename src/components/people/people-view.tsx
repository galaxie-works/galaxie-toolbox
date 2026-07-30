"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnOrderState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpDown,
  ArrowUpRight,
  Building2,
  Copy,
  ExternalLink,
  FunnelX,
  KeyRound,
  LayoutGrid,
  List,
  ListFilter,
  Mail,
  Pencil,
  MoreHorizontal,
  Phone,
  Plus,
  SearchX,
  Save,
  Sparkles,
  Users,
} from "lucide-react";
import { isValidPhoneNumber } from "react-phone-number-input";
import { toast } from "sonner";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import {
  DataGrid,
  DataGridContainer,
  useDataGrid,
} from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridColumnVisibility } from "@/components/reui/data-grid/data-grid-column-visibility";
import {
  DataGridTableRowSelect,
  DataGridTableRowSelectAll,
} from "@/components/reui/data-grid/data-grid-table";
import { DataGridTableVirtual } from "@/components/reui/data-grid/data-grid-table-virtual";
import {
  Filters,
  type Filter,
  type FilterFieldConfig,
  type FilterOperator,
  type FilterOption,
} from "@/components/reui/filters";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { IconStack } from "@/components/reui/icon-stack";
import { IconTile } from "@/components/reui/icon-tile";
import { PhoneInput } from "@/components/reui/phone-input";
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@/components/reui/timeline";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrganizationsView } from "@/components/people/organizations-view";
import * as api from "@/lib/api";
import { useFotos } from "@/lib/fotos";
import { useIdioma, preencher } from "@/lib/idioma";
import {
  peopleEnrichFieldIdentity,
  type PeopleContact,
} from "@/lib/people";
import {
  contactDomain,
  resolveOrganization,
} from "@/lib/organizations";
import type {
  PeopleContactEdit,
  PeopleEnrichField,
  PeopleEnrichFieldKey,
  PeopleEnrichPreview,
  PeopleEnrichSource,
  PeopleInteraction,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function PeopleColumnsHeader({ label }: { label: string }) {
  const { table } = useDataGrid();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <DataGridColumnVisibility
            table={table}
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={label}
              >
                <Plus />
              </Button>
            }
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function RelationshipBadges({
  contact,
  compact = false,
}: {
  contact: PeopleContact;
  compact?: boolean;
}) {
  const { t } = useIdioma();
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge variant="outline" size={compact ? "xs" : "sm"}>
        {contact.organization ? t.controlRoom.peopleOrg : t.controlRoom.peopleExterno}
      </Badge>
      {contact.frequent && (
        <Badge variant="secondary" size={compact ? "xs" : "sm"}>
          {t.controlRoom.peopleFrequente}
        </Badge>
      )}
    </span>
  );
}

function SourceBadge({ source }: { source?: PeopleEnrichSource }) {
  const { t } = useIdioma();
  if (!source) return null;
  const labels: Record<PeopleEnrichSource, string> = {
    contacts: t.controlRoom.peopleSourceContacts,
    people: t.controlRoom.peopleSourcePeople,
    directory: t.controlRoom.peopleSourceDirectory,
  };
  return (
    <Badge
      variant={source === "directory" ? "info-light" : source === "people" ? "secondary" : "outline"}
      size="xs"
      title={labels[source]}
    >
      {labels[source]}
    </Badge>
  );
}

function DetailValue({
  label,
  value,
  source,
}: {
  label: string;
  value?: string | null;
  source?: PeopleEnrichSource;
}) {
  const { t } = useIdioma();
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate">{value || t.controlRoom.peopleSemDado}</span>
        {value && <SourceBadge source={source} />}
      </dd>
    </div>
  );
}

function PeopleEmpty({
  search,
  filtered,
  onClear,
}: {
  search: boolean;
  filtered: boolean;
  onClear: () => void;
}) {
  const { t } = useIdioma();
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <IconStack className="mb-2">
        {search || filtered ? <SearchX className="size-5" /> : <Users className="size-5" />}
      </IconStack>
      <p className="font-medium">
        {search || filtered ? t.controlRoom.peopleSemResultado : t.controlRoom.peopleVazio}
      </p>
      {!search && !filtered && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {t.controlRoom.peopleVazioDesc}
        </p>
      )}
      {(search || filtered) && (
        <Button className="mt-3" variant="outline" size="sm" onClick={onClear}>
          {filtered ? t.controlRoom.peopleClearFilters : t.controlRoom.peopleLimparBusca}
        </Button>
      )}
    </div>
  );
}

function PeoplePermissionEmpty() {
  const { t } = useIdioma();
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <IconTile className="mb-3" variant="frame" size="lg">
        <KeyRound />
      </IconTile>
      <p className="font-medium">{t.controlRoom.peopleSemPermissao}</p>
    </div>
  );
}

function PeopleDetailSkeleton() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border bg-card">
      <div className="border-b p-4">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </div>
      <div className="space-y-4 p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}

function PeopleDetail({
  contact,
  photo,
  onBack,
  onCompose,
  autoEnrich,
  stacked = false,
}: {
  contact: PeopleContact;
  photo: string | null;
  onBack: () => void;
  onCompose: (email: string) => void;
  autoEnrich?: boolean;
  stacked?: boolean;
}) {
  const { idioma, t } = useIdioma();
  const applyPeopleFields = useAppStore((state) => state.applyPeopleFields);
  const updatePeopleContact = useAppStore((state) => state.updatePeopleContact);
  const organizations = useAppStore((state) => state.organizations);
  const selectOrganization = useAppStore((state) => state.selectOrganization);
  const setPeopleTab = useAppStore((state) => state.setPeopleTab);
  const addContactToOrganization = useAppStore(
    (state) => state.addContactToOrganization,
  );
  const primaryEmail = contact.emails[0]?.address;
  const resolvedOrganization = resolveOrganization(
    organizations,
    contactDomain(contact),
  );
  const [enriching, setEnriching] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<PeopleEnrichPreview | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<number>>(new Set());
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [sessionOnlyApplied, setSessionOnlyApplied] = useState(false);
  const [sessionOnlyFields, setSessionOnlyFields] = useState<PeopleEnrichField[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [writeAvailable, setWriteAvailable] = useState<boolean | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PeopleContactEdit>({
    name: contact.name,
    emails: contact.emails.map((email) => ({ ...email })),
    phones: contact.phones.map((phone) => ({ ...phone })),
    company: contact.company,
  });
  const [interactions, setInteractions] = useState<PeopleInteraction[]>([]);
  const [interactionsLoading, setInteractionsLoading] = useState(Boolean(primaryEmail));
  const [interactionsError, setInteractionsError] = useState(false);
  const sparse = !contact.jobTitle || !contact.company || contact.phones.length === 0;
  const editLocked = !contact.contactId || writeAvailable !== true;
  const openOutlook = () =>
    window.open(
      "https://outlook.office.com/people/",
      "_blank",
      "noopener,noreferrer",
    );
  const copyEmail = () => {
    if (!primaryEmail) return;
    void copyText(primaryEmail).then((copied) => {
      if (copied) toast.success(t.controlRoom.peopleEmailCopied);
    });
  };
  const enterEdit = () => {
    resetDraft();
    setEditing(true);
  };

  useEffect(() => {
    let active = true;
    void api
      .crPeopleWriteAvailable()
      .then((available) => active && setWriteAvailable(available))
      .catch(() => active && setWriteAvailable(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!primaryEmail) {
      setInteractionsLoading(false);
      return () => {
        active = false;
      };
    }
    setInteractionsLoading(true);
    setInteractionsError(false);
    void api
      .crPeopleInteractions(primaryEmail)
      .then((items) => {
        if (active) setInteractions(items);
      })
      .catch(() => {
        if (active) setInteractionsError(true);
      })
      .finally(() => {
        if (active) setInteractionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [primaryEmail]);

  const resetDraft = () => {
    setDraft({
      name: contact.name,
      emails: contact.emails.map((email) => ({ ...email })),
      phones: contact.phones.map((phone) => ({ ...phone })),
      company: contact.company,
    });
    setEditError(null);
  };

  const saveContact = async () => {
    const emailValid = draft.emails.every((email) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.address.trim()),
    );
    if (!emailValid) {
      setEditError(t.controlRoom.peopleInvalidEmail);
      return;
    }
    if (
      draft.phones.some(
        (phone) => phone.number.trim() && !isValidPhoneNumber(phone.number),
      )
    ) {
      setEditError(t.controlRoom.peopleInvalidPhone);
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await updatePeopleContact(contact.id, {
        ...draft,
        name: draft.name.trim(),
        emails: draft.emails.map((email) => ({
          ...email,
          address: email.address.trim(),
        })),
        phones: draft.phones.map((phone) => ({
          ...phone,
          number: phone.number.trim(),
        })),
        company: draft.company?.trim() || null,
      });
      setEditing(false);
      toast.success(t.controlRoom.peopleSave);
    } catch {
      resetDraft();
      setEditError(t.controlRoom.peopleEditError);
    } finally {
      setSaving(false);
    }
  };

  const fieldLabel = (field: PeopleEnrichField): string => {
    const labels: Record<PeopleEnrichFieldKey, string> = {
      photo: t.controlRoom.peopleFieldPhoto,
      email: t.controlRoom.peopleEmail,
      businessPhone: t.controlRoom.peopleFieldBusinessPhone,
      mobilePhone: t.controlRoom.peopleFieldMobilePhone,
      jobTitle: t.controlRoom.peopleCargo,
      companyName: t.controlRoom.peopleEmpresa,
      department: t.controlRoom.peopleDepartment,
      officeLocation: t.controlRoom.peopleOfficeLocation,
      manager: t.controlRoom.peopleManager,
    };
    return labels[field.key];
  };

  const acceptedFields = preview
    ? preview.fields.filter((_, index) => selectedFields.has(index))
    : [];

  const enrich = async () => {
    if (!primaryEmail) return;
    setEnriching(true);
    setEnrichError(null);
    setSessionOnlyApplied(false);
    setSessionOnlyFields([]);
    try {
      const result = await api.crPeopleEnrichPreview(
        contact.contactId ?? null,
        primaryEmail,
      );
      const enrichedValues = new Set(contact.enrichedValues ?? []);
      const next = {
        ...result,
        fields: result.fields.filter(
          (field) => !enrichedValues.has(peopleEnrichFieldIdentity(field)),
        ),
      };
      setPreview(next);
      setSelectedFields(new Set(next.fields.map((_, index) => index)));
    } catch (error) {
      setPreview(null);
      setEnrichError(String(error));
    } finally {
      setEnriching(false);
    }
  };

  useEffect(() => {
    if (autoEnrich) void enrich();
    // `key` do detalhe muda a cada ação Enrich; roda exatamente uma vez no mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async () => {
    if (!preview || acceptedFields.length === 0) return;
    setApplying(true);
    setEnrichError(null);
    try {
      if (preview.writeAvailable && contact.contactId) {
        const result = await api.crPeopleEnrichApply(
          contact.contactId,
          acceptedFields,
        );
        if (!result.saved) {
          applyPeopleFields(contact.id, acceptedFields);
          setSessionOnlyApplied(true);
          setSessionOnlyFields(acceptedFields);
          toast.success(t.controlRoom.peopleEnrichSessionSaved);
        } else {
          applyPeopleFields(contact.id, acceptedFields);
          toast.success(t.controlRoom.peopleEnrichSaved);
        }
      } else {
        applyPeopleFields(contact.id, acceptedFields);
        setSessionOnlyApplied(true);
        setSessionOnlyFields(acceptedFields);
        toast.success(t.controlRoom.peopleEnrichSessionSaved);
      }
      setPreview(null);
      setSelectedFields(new Set());
    } catch (error) {
      setEnrichError(String(error));
    } finally {
      setApplying(false);
    }
  };

  const copyFields = async (fields: PeopleEnrichField[]) => {
    const text = fields
      .filter((field) => field.key !== "photo")
      .map((field) => `${fieldLabel(field)}: ${field.value}`)
      .join("\n");
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      toast.success(t.controlRoom.peopleEnrichCopied);
    } catch {
      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (copied) toast.success(t.controlRoom.peopleEnrichCopied);
      else setEnrichError(t.controlRoom.peopleEnrichError);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border bg-card">
      <div className="border-b bg-card px-4 py-3">
        {stacked && (
          <Button
            className="-ml-2 mb-2"
            variant="ghost"
            size="sm"
            onClick={onBack}
          >
            <ArrowLeft />
            {t.controlRoom.peopleVoltar}
          </Button>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex shrink-0 flex-col items-center gap-1">
              <Avatar className="size-16">
                {(contact.photo || photo) && (
                  <AvatarImage
                    src={contact.photo || photo || undefined}
                    alt={contact.name}
                  />
                )}
                <AvatarFallback className="text-lg">
                  {initials(contact.name)}
                </AvatarFallback>
              </Avatar>
              {contact.photo && <SourceBadge source={contact.photoSource} />}
            </div>
            <div className="min-w-0 flex-1">
              {editing ? (
                <Input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  aria-label={t.controlRoom.peopleNome}
                />
              ) : (
                <h2 className="truncate text-xl font-semibold">{contact.name}</h2>
              )}
              <p className="truncate text-sm text-muted-foreground">
                {[contact.jobTitle, contact.company].filter(Boolean).join(" · ") ||
                  t.controlRoom.peopleSemDado}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <RelationshipBadges contact={contact} />
                <SourceBadge source={contact.contactId ? "contacts" : "people"} />
              </div>
            </div>
          </div>

          {editing ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  resetDraft();
                  setEditing(false);
                }}
                disabled={saving}
              >
                {t.controlRoom.peopleEnrichCancel}
              </Button>
              <Button
                onClick={() => void saveContact()}
                disabled={saving || !draft.name.trim()}
              >
                {saving ? <Spinner /> : <Save />}
                {saving ? t.controlRoom.peopleSaving : t.controlRoom.peopleSave}
              </Button>
            </div>
          ) : (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {primaryEmail && (
                <Button onClick={() => onCompose(primaryEmail)}>
                  <Mail />
                  {t.controlRoom.peopleCompor}
                </Button>
              )}
              <Toolbar
                aria-label={t.controlRoom.peopleRowActions}
                className="gap-0.5"
              >
                {editLocked ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex" tabIndex={0}>
                        <ToolbarButton
                          variant="default"
                          aria-label={t.controlRoom.peopleEdit}
                          disabled
                        >
                          <Pencil />
                        </ToolbarButton>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t.controlRoom.peopleEditUnavailableDesc}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <ToolbarButton
                    variant="default"
                    tooltip={t.controlRoom.peopleEdit}
                    aria-label={t.controlRoom.peopleEdit}
                    onClick={enterEdit}
                  >
                    <Pencil />
                  </ToolbarButton>
                )}
                <ToolbarButton
                  variant="default"
                  tooltip={t.controlRoom.peopleEnrich}
                  aria-label={t.controlRoom.peopleEnrich}
                  onClick={() => void enrich()}
                  disabled={!primaryEmail || enriching || applying}
                >
                  {enriching ? <Spinner /> : <Sparkles />}
                </ToolbarButton>
                <ToolbarSeparator />
                <ToolbarButton
                  variant="default"
                  tooltip={t.controlRoom.peopleCopyEmail}
                  aria-label={t.controlRoom.peopleCopyEmail}
                  onClick={copyEmail}
                  disabled={!primaryEmail}
                >
                  <Copy />
                </ToolbarButton>
                <ToolbarButton
                  variant="default"
                  tooltip={t.controlRoom.abrirOutlook}
                  aria-label={t.controlRoom.abrirOutlook}
                  onClick={openOutlook}
                >
                  <ExternalLink />
                </ToolbarButton>
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <ToolbarButton
                          variant="default"
                          aria-label={t.controlRoom.orgsAtribuirContato}
                        >
                          <MoreHorizontal />
                        </ToolbarButton>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t.controlRoom.orgsAtribuirContato}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>
                      {t.controlRoom.orgsAtribuirContato}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {organizations.length === 0 ? (
                      <DropdownMenuItem disabled>
                        {t.controlRoom.orgsSemOrganizacoes}
                      </DropdownMenuItem>
                    ) : (
                      organizations.map((organization) => (
                        <DropdownMenuItem
                          key={organization.id}
                          onClick={() => {
                            addContactToOrganization(
                              organization.id,
                              contact.id,
                              useAppStore.getState().peopleContacts,
                            );
                            selectOrganization(organization.id);
                            setPeopleTab("organizations");
                          }}
                        >
                          <Building2 />
                          {organization.name}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </Toolbar>
            </div>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col">
          {(!editing && editLocked) ||
          editError ||
          (sparse && !preview && !sessionOnlyApplied) ||
          preview ||
          sessionOnlyApplied ||
          enrichError ? (
            <div className="space-y-3 border-b p-4">
              {!editing && editLocked && (
                <Alert variant="warning">
                  <KeyRound />
                  <AlertTitle>{t.controlRoom.peopleEditUnavailable}</AlertTitle>
                  <AlertDescription>
                    {t.controlRoom.peopleEditUnavailableDesc}
                  </AlertDescription>
                </Alert>
              )}

              {editError && (
                <Alert variant="destructive">
                  <AlertTitle>{t.controlRoom.peopleEditError}</AlertTitle>
                  <AlertDescription>{editError}</AlertDescription>
                </Alert>
              )}

              {sparse && !preview && !sessionOnlyApplied && (
                <Alert variant="info">
                  <Sparkles />
                  <AlertTitle>{t.controlRoom.peopleEnrichPrompt}</AlertTitle>
                  <AlertDescription>
                    {t.controlRoom.peopleEnrichPromptDesc}
                  </AlertDescription>
                  <AlertAction>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void enrich()}
                      disabled={enriching}
                    >
                      {enriching ? <Spinner /> : <Sparkles />}
                      {enriching
                        ? t.controlRoom.peopleEnriching
                        : t.controlRoom.peopleEnrich}
                    </Button>
                  </AlertAction>
                </Alert>
              )}

              {preview && (
                <div className="space-y-4 rounded-xl border bg-background p-4 shadow-xs">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {t.controlRoom.peopleEnrichPreview}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {t.controlRoom.peopleEnrichPreviewDesc}
                    </p>
                  </div>

                  {preview.failures.length > 0 && (
                    <Alert variant="warning">
                      <AlertTitle>{t.controlRoom.peopleEnrichSourceError}</AlertTitle>
                      <AlertDescription>
                        {preview.failures.join(" · ")}
                      </AlertDescription>
                    </Alert>
                  )}

                  {preview.fields.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t.controlRoom.peopleEnrichNoChanges}
                    </p>
                  ) : (
                    <div className="divide-y rounded-lg border">
                      {preview.fields.map((field, index) => (
                        <label
                          key={`${field.key}:${field.value}:${index}`}
                          className="flex cursor-pointer items-start gap-3 px-3 py-2.5"
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={selectedFields.has(index)}
                            onCheckedChange={(checked) =>
                              setSelectedFields((current) => {
                                const next = new Set(current);
                                if (checked === true) next.add(index);
                                else next.delete(index);
                                return next;
                              })
                            }
                            aria-label={`${fieldLabel(field)}: ${field.value}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs text-muted-foreground">
                              {fieldLabel(field)}
                            </span>
                            {field.key === "photo" ? (
                              <Avatar className="mt-1 size-10">
                                <AvatarImage src={field.value} alt={contact.name} />
                                <AvatarFallback>
                                  {initials(contact.name)}
                                </AvatarFallback>
                              </Avatar>
                            ) : (
                              <span className="block truncate text-sm">
                                {field.value}
                              </span>
                            )}
                          </span>
                          <SourceBadge source={field.source} />
                        </label>
                      ))}
                    </div>
                  )}

                  {!preview.writeAvailable && preview.fields.length > 0 && (
                    <Alert variant="warning">
                      <KeyRound />
                      <AlertTitle>{t.controlRoom.peopleEnrichReadOnly}</AlertTitle>
                      <AlertDescription>
                        {t.controlRoom.peopleEnrichReadOnlyDesc}
                      </AlertDescription>
                      <AlertAction>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void copyFields(acceptedFields)}
                          disabled={
                            !acceptedFields.some((field) => field.key !== "photo")
                          }
                        >
                          <Copy />
                          {t.controlRoom.peopleEnrichCopy}
                        </Button>
                      </AlertAction>
                    </Alert>
                  )}

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPreview(null);
                        setSelectedFields(new Set());
                      }}
                      disabled={applying}
                    >
                      {t.controlRoom.peopleEnrichCancel}
                    </Button>
                    {preview.fields.length > 0 && (
                      <Button
                        onClick={() => void apply()}
                        disabled={acceptedFields.length === 0 || applying}
                      >
                        {applying ? <Spinner /> : <Sparkles />}
                        {preview.writeAvailable
                          ? t.controlRoom.peopleEnrichApply
                          : t.controlRoom.peopleEnrichSessionApply}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {sessionOnlyApplied && (
                <Alert variant="warning">
                  <KeyRound />
                  <AlertTitle>{t.controlRoom.peopleEnrichReadOnly}</AlertTitle>
                  <AlertDescription>
                    {t.controlRoom.peopleEnrichReadOnlyDesc}
                  </AlertDescription>
                  <AlertAction>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyFields(sessionOnlyFields)}
                      disabled={
                        !sessionOnlyFields.some((field) => field.key !== "photo")
                      }
                    >
                      <Copy />
                      {t.controlRoom.peopleEnrichCopy}
                    </Button>
                  </AlertAction>
                </Alert>
              )}

              {enrichError && (
                <Alert variant="destructive">
                  <AlertTitle>{t.controlRoom.peopleEnrichError}</AlertTitle>
                  <AlertDescription>{enrichError}</AlertDescription>
                </Alert>
              )}
            </div>
          ) : null}

          <section className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t.controlRoom.peopleEmails}</h3>
        </div>
        <div className="space-y-2">
          {(editing ? draft.emails : contact.emails).map((email, index) =>
            editing ? (
              <div
                key={`${email.label || "email"}:${index}`}
                className="flex items-center gap-2"
              >
                <Input
                  value={email.address}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      emails: current.emails.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, address: event.target.value }
                          : item,
                      ),
                    }))
                  }
                  aria-label={`${t.controlRoom.peopleEmail} ${index + 1}`}
                />
                <Badge variant="outline" size="xs">
                  {email.label || t.controlRoom.peopleEmail}
                </Badge>
              </div>
            ) : (
              <button
                type="button"
                key={email.address}
                onClick={() => onCompose(email.address)}
                className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left hover:bg-muted/40"
              >
                <span className="min-w-0 truncate text-sm">{email.address}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <Badge variant="outline" size="xs">
                    {email.label || t.controlRoom.peopleEmail}
                  </Badge>
                  <SourceBadge source={email.source} />
                </span>
              </button>
            ),
          )}
        </div>
          </section>

          <Separator />

          <section className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Phone className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t.controlRoom.peopleTelefones}</h3>
        </div>
        {(editing ? draft.phones : contact.phones).length > 0 ? (
          <div className="space-y-2">
            {(editing ? draft.phones : contact.phones).map((phone, index) =>
              editing ? (
                <div
                  key={`${phone.label}:${index}`}
                  className="flex items-center gap-2"
                >
                  <PhoneInput
                    className="min-w-0 flex-1"
                    value={phone.number}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        phones: current.phones.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, number: value || "" }
                            : item,
                        ),
                      }))
                    }
                    aria-label={`${t.controlRoom.peopleTelefone} ${index + 1}`}
                  />
                  <Badge variant="outline" size="xs">
                    {phone.label}
                  </Badge>
                </div>
              ) : (
                <a
                  key={`${phone.label}:${phone.number}`}
                  href={`tel:${phone.number}`}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 hover:bg-muted/40"
                >
                  <span className="text-sm">{phone.number}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Badge variant="outline" size="xs">
                      {phone.label}
                    </Badge>
                    <SourceBadge source={phone.source} />
                  </span>
                </a>
              ),
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t.controlRoom.peopleSemDado}</p>
        )}
          </section>

          <Separator />

          <section className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t.controlRoom.peopleEmpresaCargo}</h3>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {editing ? (
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">
                {t.controlRoom.peopleEmpresa}
              </span>
              <Input
                value={draft.company || ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    company: event.target.value,
                  }))
                }
              />
            </label>
          ) : (
            <DetailValue
              label={t.controlRoom.peopleEmpresa}
              value={contact.company}
              source={contact.companySource}
            />
          )}
          <DetailValue
            label={t.controlRoom.peopleCargo}
            value={contact.jobTitle}
            source={contact.jobTitleSource}
          />
          <DetailValue
            label={t.controlRoom.peopleDepartment}
            value={contact.department}
            source={contact.departmentSource}
          />
          <DetailValue
            label={t.controlRoom.peopleOfficeLocation}
            value={contact.officeLocation}
            source={contact.officeLocationSource}
          />
          <DetailValue
            label={t.controlRoom.peopleManager}
            value={contact.manager}
            source={contact.managerSource}
          />
        </dl>
        {!editing && resolvedOrganization && (
          <button
            type="button"
            className="mt-3"
            onClick={() => {
              selectOrganization(resolvedOrganization.id);
              setPeopleTab("organizations");
            }}
          >
            <Badge variant="secondary">{resolvedOrganization.name}</Badge>
          </button>
        )}
          </section>

          <Separator />

          <section className="p-4">
        <div className="mb-4 flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">
            {t.controlRoom.peopleInteractions}
          </h3>
        </div>
        {interactionsLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : interactionsError ? (
          <p className="text-sm text-destructive">
            {t.controlRoom.peopleInteractionsError}
          </p>
        ) : interactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t.controlRoom.peopleInteractionsEmpty}
          </p>
        ) : (
          <Timeline defaultValue={interactions.length}>
            {interactions.map((interaction, index) => (
              <TimelineItem key={interaction.id} step={index + 1}>
                <TimelineHeader>
                  <TimelineDate dateTime={interaction.occurredAt}>
                    {new Intl.DateTimeFormat(idioma, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(interaction.occurredAt))}
                  </TimelineDate>
                  <TimelineTitle>{interaction.subject}</TimelineTitle>
                </TimelineHeader>
                <TimelineIndicator className="flex items-center justify-center bg-background">
                  {interaction.direction === "inbound" ? (
                    <ArrowDownLeft className="size-2.5" />
                  ) : (
                    <ArrowUpRight className="size-2.5" />
                  )}
                </TimelineIndicator>
                <TimelineSeparator />
                <TimelineContent>
                  {interaction.direction === "inbound"
                    ? t.controlRoom.peopleInbound
                    : t.controlRoom.peopleOutbound}
                </TimelineContent>
              </TimelineItem>
            ))}
          </Timeline>
        )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

function BulkEnrichReview({
  contacts,
  onClose,
}: {
  contacts: PeopleContact[];
  onClose: () => void;
}) {
  const { t } = useIdioma();
  const applyPeopleFields = useAppStore((state) => state.applyPeopleFields);
  const [index, setIndex] = useState(0);
  const [preview, setPreview] = useState<PeopleEnrichPreview | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contact = contacts[index];

  const fieldLabel = (field: PeopleEnrichField): string => {
    const labels: Record<PeopleEnrichFieldKey, string> = {
      photo: t.controlRoom.peopleFieldPhoto,
      email: t.controlRoom.peopleEmail,
      businessPhone: t.controlRoom.peopleFieldBusinessPhone,
      mobilePhone: t.controlRoom.peopleFieldMobilePhone,
      jobTitle: t.controlRoom.peopleCargo,
      companyName: t.controlRoom.peopleEmpresa,
      department: t.controlRoom.peopleDepartment,
      officeLocation: t.controlRoom.peopleOfficeLocation,
      manager: t.controlRoom.peopleManager,
    };
    return labels[field.key];
  };

  useEffect(() => {
    let active = true;
    if (!contact) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    void api
      .crPeopleEnrichPreview(
        contact.contactId ?? null,
        contact.emails[0]?.address || "",
      )
      .then((result) => {
        if (!active) return;
        const enrichedValues = new Set(contact.enrichedValues ?? []);
        const next = {
          ...result,
          fields: result.fields.filter(
            (field) => !enrichedValues.has(peopleEnrichFieldIdentity(field)),
          ),
        };
        setPreview(next);
        setSelectedFields(new Set(next.fields.map((_, fieldIndex) => fieldIndex)));
      })
      .catch((nextError) => {
        if (active) setError(String(nextError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [contact]);

  const next = () => {
    if (index + 1 >= contacts.length) {
      toast.success(t.controlRoom.peopleBulkDone);
      onClose();
      return;
    }
    setIndex((current) => current + 1);
    setPreview(null);
    setSelectedFields(new Set());
  };

  const apply = async (sessionOnly: boolean) => {
    if (!contact || !preview) return;
    const fields = preview.fields.filter((_, fieldIndex) =>
      selectedFields.has(fieldIndex),
    );
    if (fields.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      if (!sessionOnly && preview.writeAvailable && contact.contactId) {
        const result = await api.crPeopleEnrichApply(contact.contactId, fields);
        if (!result.saved) {
          throw new Error(t.controlRoom.peopleEditUnavailableDesc);
        }
      }
      applyPeopleFields(contact.id, fields);
      next();
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setApplying(false);
    }
  };

  if (!contact) return null;
  const selected = preview
    ? preview.fields.filter((_, fieldIndex) => selectedFields.has(fieldIndex))
    : [];

  return (
    <Frame stacked>
      <FrameHeader className="flex-row items-center justify-between gap-3">
        <div>
          <FrameTitle>{t.controlRoom.peopleBulkTitle}</FrameTitle>
          <FrameDescription>
            {preencher(t.controlRoom.peopleBulkContact, {
              atual: index + 1,
              total: contacts.length,
            })}
            {" · "}
            {contact.name}
          </FrameDescription>
        </div>
        <Button variant="outline" onClick={onClose} disabled={applying}>
          {t.controlRoom.peopleEnrichCancel}
        </Button>
      </FrameHeader>
      <FramePanel className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : preview?.fields.length ? (
          <div className="divide-y rounded-lg border">
            {preview.fields.map((field, fieldIndex) => (
              <label
                key={`${field.key}:${field.value}:${fieldIndex}`}
                className="flex cursor-pointer items-start gap-3 px-3 py-2.5"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={selectedFields.has(fieldIndex)}
                  onCheckedChange={(checked) =>
                    setSelectedFields((current) => {
                      const updated = new Set(current);
                      if (checked === true) updated.add(fieldIndex);
                      else updated.delete(fieldIndex);
                      return updated;
                    })
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">
                    {fieldLabel(field)}
                  </span>
                  <span className="block truncate text-sm">{field.value}</span>
                </span>
                <SourceBadge source={field.source} />
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t.controlRoom.peopleEnrichNoChanges}
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>{t.controlRoom.peopleEnrichError}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={next} disabled={applying}>
            {t.controlRoom.peopleBulkSkip}
          </Button>
          {preview && preview.fields.length > 0 && (
            <>
              <Button
                variant="outline"
                onClick={() => void apply(true)}
                disabled={applying || selected.length === 0}
              >
                {applying && <Spinner />}
                {t.controlRoom.peopleEnrichSessionApply}
              </Button>
              {preview.writeAvailable && contact.contactId && (
                <Button
                  onClick={() => void apply(false)}
                  disabled={applying || selected.length === 0}
                >
                  {applying ? <Spinner /> : <Sparkles />}
                  {t.controlRoom.peopleEnrichApply}
                </Button>
              )}
            </>
          )}
        </div>
      </FramePanel>
    </Frame>
  );
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}

function PeopleRowActions({
  contact,
  onCompose,
  onEnrich,
}: {
  contact: PeopleContact;
  onCompose: (email: string) => void;
  onEnrich: () => void;
}) {
  const { t } = useIdioma();
  const email = contact.emails[0]?.address;
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={stop}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t.controlRoom.peopleRowActions}
          className="opacity-70 group-hover:opacity-100 focus:opacity-100"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={stop}>
        <DropdownMenuItem disabled={!email} onClick={() => email && onCompose(email)}>
          <Mail />
          {t.controlRoom.peopleCompor}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!email}
          onClick={() => {
            if (!email) return;
            void copyText(email).then((copied) => {
              if (copied) toast.success(t.controlRoom.peopleEmailCopied);
            });
          }}
        >
          <Copy />
          {t.controlRoom.peopleCopyEmail}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!email} onClick={onEnrich}>
          <Sparkles />
          {t.controlRoom.peopleEnrich}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            window.open(
              "https://outlook.office.com/people/",
              "_blank",
              "noopener,noreferrer",
            )
          }
        >
          <ExternalLink />
          {t.controlRoom.abrirOutlook}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PeopleCard({
  contact,
  selected,
  photo,
  onSelect,
  onCompose,
  onEnrich,
}: {
  contact: PeopleContact;
  selected: boolean;
  photo: string | null;
  onSelect: () => void;
  onCompose: (email: string) => void;
  onEnrich: () => void;
}) {
  const { t } = useIdioma();
  return (
    <Frame
      className={cn(
        "group cursor-pointer transition-colors hover:border-primary/40",
        selected && "border-primary ring-1 ring-primary/20",
      )}
      stacked
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <FrameHeader className="flex-row items-start gap-3">
        <Avatar className="size-11">
          {photo && <AvatarImage src={photo} alt={contact.name} />}
          <AvatarFallback>{initials(contact.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <FrameTitle className="truncate">{contact.name}</FrameTitle>
          <FrameDescription className="truncate">
            {[contact.jobTitle, contact.company].filter(Boolean).join(" · ") ||
              t.controlRoom.peopleSemDado}
          </FrameDescription>
        </div>
        <PeopleRowActions
          contact={contact}
          onCompose={onCompose}
          onEnrich={onEnrich}
        />
      </FrameHeader>
      <FramePanel className="space-y-3">
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <Mail className="size-4 shrink-0" />
          <span className="truncate">
            {contact.emails[0]?.address || t.controlRoom.peopleSemDado}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <RelationshipBadges contact={contact} compact />
          <span className="flex flex-wrap justify-end gap-1">
            {contact.sources.map((source) => (
              <SourceBadge key={source} source={source} />
            ))}
          </span>
        </div>
      </FramePanel>
    </Frame>
  );
}

export function PeopleView({
  onGrantAccess,
  onCompose,
}: {
  onGrantAccess: () => void;
  onCompose: (email: string) => void;
}) {
  const { t } = useIdioma();
  const contacts = useAppStore((state) => state.peopleContacts);
  const selectedId = useAppStore((state) => state.peopleSelectedId);
  const selectPerson = useAppStore((state) => state.selectPerson);
  const loading = useAppStore((state) => state.peopleLoading);
  const loaded = useAppStore((state) => state.peopleLoaded);
  const error = useAppStore((state) => state.peopleError);
  const missingScopes = useAppStore((state) => state.peopleMissingScopes);
  const nextLinks = useAppStore((state) => state.peopleNextLinks);
  const fetchingMore = useAppStore((state) => state.peopleFetchingMore);
  const filters = useAppStore((state) => state.peopleFilters);
  const view = useAppStore((state) => state.peopleView);
  const columnVisibility = useAppStore((state) => state.peopleColumnVisibility);
  const loadPeople = useAppStore((state) => state.loadPeople);
  const loadMorePeople = useAppStore((state) => state.loadMorePeople);
  const setFilters = useAppStore((state) => state.setPeopleFilters);
  const setView = useAppStore((state) => state.setPeopleView);
  const setColumnVisibility = useAppStore(
    (state) => state.setPeopleColumnVisibility,
  );
  const peopleTab = useAppStore((state) => state.peopleTab);
  const setPeopleTab = useAppStore((state) => state.setPeopleTab);
  const query = useAppStore((state) => state.peopleSearchQuery);
  const setPeopleSearchQuery = useAppStore(
    (state) => state.setPeopleSearchQuery,
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([
    "select",
    "name",
    "email",
    "company",
    "title",
    "phone",
    "source",
    "actions",
    "columns",
  ]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [enrichRequest, setEnrichRequest] = useState<{
    id: string;
    token: number;
  } | null>(null);
  const [bulkContacts, setBulkContacts] = useState<PeopleContact[] | null>(null);
  const { getFoto, pedirFotos } = useFotos();
  // Mede o MÓDULO (não a janela): a sidebar colapsa e o zoom mudam a largura do
  // módulo, então um media query de viewport erra o alvo. Um ResizeObserver no
  // container reflete a largura real disponível — a mesma base da container query.
  const detailContainerRef = useRef<HTMLDivElement>(null);
  const [moduleWidth, setModuleWidth] = useState(0);

  useEffect(() => {
    const el = detailContainerRef.current;
    if (!el) return;
    setModuleWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setModuleWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const wideSplit = moduleWidth >= 768;
  const listMinSize = moduleWidth ? Math.min(50, (340 / moduleWidth) * 100) : 30;
  const detailMinSize = moduleWidth ? Math.min(64, (420 / moduleWidth) * 100) : 40;

  useEffect(() => {
    if (!loaded && !loading) void loadPeople();
  }, [loadPeople, loaded, loading]);

  useEffect(() => {
    pedirFotos(contacts.map((contact) => contact.emails[0]?.address));
  }, [contacts, pedirFotos]);

  const filterFields = useMemo<FilterFieldConfig<string>[]>(() => {
    const operators: FilterOperator[] = [
      { value: "is", label: t.controlRoom.filtroOperadorIs },
      { value: "is_not", label: t.controlRoom.filtroOpNaoE },
    ];
    const companyOptions: FilterOption<string>[] = Array.from(
      new Set(contacts.map((contact) => contact.company).filter(Boolean)),
    )
      .sort((a, b) => String(a).localeCompare(String(b)))
      .map((company) => ({ value: String(company), label: String(company) }));
    return [
      {
        key: "company",
        label: t.controlRoom.peopleEmpresa,
        icon: <Building2 className="size-3.5" />,
        type: "select",
        searchable: true,
        operators,
        options: companyOptions,
      },
      {
        key: "relationship",
        label: t.controlRoom.peopleRelationship,
        icon: <Users className="size-3.5" />,
        type: "select",
        searchable: false,
        operators,
        options: [
          { value: "org", label: t.controlRoom.peopleOrg },
          { value: "external", label: t.controlRoom.peopleExterno },
        ],
      },
      {
        key: "phone",
        label: t.controlRoom.peopleHasPhone,
        icon: <Phone className="size-3.5" />,
        type: "select",
        searchable: false,
        operators,
        options: [
          { value: "yes", label: t.controlRoom.peopleYes },
          { value: "no", label: t.controlRoom.peopleNo },
        ],
      },
      {
        key: "source",
        label: t.controlRoom.peopleSource,
        icon: <Sparkles className="size-3.5" />,
        type: "select",
        searchable: false,
        operators,
        options: [
          { value: "contacts", label: t.controlRoom.peopleSourceContacts },
          { value: "people", label: t.controlRoom.peopleSourcePeople },
          { value: "directory", label: t.controlRoom.peopleSourceDirectory },
        ],
      },
    ];
  }, [contacts, t]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => {
    const next = contacts.filter((contact) => {
      const matchesQuery =
        !normalizedQuery ||
          [
            contact.name,
            contact.company,
            contact.jobTitle,
            ...contact.emails.map((email) => email.address),
          ]
            .filter(Boolean)
            .some((value) =>
              String(value).toLocaleLowerCase().includes(normalizedQuery),
            );
      if (!matchesQuery) return false;
      return filters.every((filter: Filter<string>) => {
        const values = new Set(filter.values);
        let matches = true;
        if (filter.field === "company") {
          matches = Boolean(contact.company && values.has(contact.company));
        } else if (filter.field === "relationship") {
          matches = values.has(contact.organization ? "org" : "external");
        } else if (filter.field === "phone") {
          matches = values.has(contact.phones.length > 0 ? "yes" : "no");
        } else if (filter.field === "source") {
          matches = contact.sources.some((source) => values.has(source));
        }
        return filter.operator === "is_not" ? !matches : matches;
      });
    });
    return next;
  }, [contacts, filters, normalizedQuery]);

  const selectedContacts = useMemo(
    () => filtered.filter((contact) => rowSelection[contact.id]),
    [filtered, rowSelection],
  );

  const selected = contacts.find((contact) => contact.id === selectedId) ?? null;

  const columns = useMemo<ColumnDef<PeopleContact>[]>(
    () => [
      {
        id: "select",
        header: () => <DataGridTableRowSelectAll />,
        cell: ({ row }) => <DataGridTableRowSelect row={row} />,
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        size: 36,
      },
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => (
          <DataGridColumnHeader
            column={column}
            title={t.controlRoom.peopleNome}
          />
        ),
        enableSorting: true,
        enableHiding: false,
        minSize: 200,
        meta: {
          headerTitle: t.controlRoom.peopleNome,
          skeleton: <Skeleton className="h-8 w-44" />,
        },
        cell: ({ row }) => {
          const contact = row.original;
          const photo = contact.photo || getFoto(contact.emails[0]?.address);
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar className="size-9">
                {photo && <AvatarImage src={photo} alt={contact.name} />}
                <AvatarFallback>{initials(contact.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{contact.name}</span>
                  <RelationshipBadges contact={contact} compact />
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "company",
        accessorKey: "company",
        header: ({ column }) => (
          <DataGridColumnHeader
            column={column}
            title={t.controlRoom.peopleEmpresa}
          />
        ),
        enableSorting: true,
        meta: { headerTitle: t.controlRoom.peopleEmpresa },
        cell: ({ row }) => row.original.company || t.controlRoom.peopleSemDado,
      },
      {
        id: "title",
        accessorKey: "jobTitle",
        header: ({ column }) => (
          <DataGridColumnHeader
            column={column}
            title={t.controlRoom.peopleCargo}
          />
        ),
        enableSorting: true,
        meta: { headerTitle: t.controlRoom.peopleCargo },
        cell: ({ row }) => row.original.jobTitle || t.controlRoom.peopleSemDado,
      },
      {
        id: "email",
        accessorFn: (contact) => contact.emails[0]?.address || "",
        header: ({ column }) => (
          <DataGridColumnHeader
            column={column}
            title={t.controlRoom.peopleEmail}
          />
        ),
        enableSorting: true,
        enableHiding: false,
        minSize: 180,
        meta: { headerTitle: t.controlRoom.peopleEmail },
        cell: ({ row }) => (
          <span className="block max-w-52 truncate">
            {row.original.emails[0]?.address || t.controlRoom.peopleSemDado}
          </span>
        ),
      },
      {
        id: "phone",
        accessorFn: (contact) => contact.phones[0]?.number || "",
        header: ({ column }) => (
          <DataGridColumnHeader
            column={column}
            title={t.controlRoom.peopleTelefone}
          />
        ),
        enableSorting: true,
        meta: { headerTitle: t.controlRoom.peopleTelefone },
        cell: ({ row }) =>
          row.original.phones[0]?.number || t.controlRoom.peopleSemDado,
      },
      {
        id: "source",
        header: ({ column }) => (
          <DataGridColumnHeader
            column={column}
            title={t.controlRoom.peopleSource}
          />
        ),
        enableSorting: false,
        meta: { headerTitle: t.controlRoom.peopleSource },
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.sources.map((source) => (
              <SourceBadge key={source} source={source} />
            ))}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        enableSorting: false,
        enableResizing: false,
        cell: ({ row }) => (
          <PeopleRowActions
            contact={row.original}
            onCompose={onCompose}
            onEnrich={() => {
              selectPerson(row.original.id);
              setEnrichRequest({
                id: row.original.id,
                token: Date.now(),
              });
            }}
          />
        ),
      },
      {
        id: "columns",
        header: () => (
          <PeopleColumnsHeader label={t.controlRoom.peopleColumns} />
        ),
        cell: () => null,
        enableHiding: false,
        enableSorting: false,
        enableResizing: false,
        size: 36,
      },
    ],
    [getFoto, onCompose, selectPerson, t],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
    enableRowSelection: true,
    enableMultiRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnOrderChange: setColumnOrder,
    onColumnVisibilityChange: (updater) => {
      const next =
        typeof updater === "function"
          ? updater(columnVisibility as VisibilityState)
          : updater;
      setColumnVisibility(next);
    },
    state: {
      rowSelection,
      sorting,
      columnOrder,
      columnVisibility,
    },
  });

  const peopleNavigation = (
    <Tabs
      value={peopleTab}
      onValueChange={(value) =>
        setPeopleTab(value as "contacts" | "organizations")
      }
    >
      <TabsList>
        <TabsTrigger value="contacts">
          {t.controlRoom.peopleContactsTab}
        </TabsTrigger>
        <TabsTrigger value="organizations">
          {t.controlRoom.peopleOrganizationsTab}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
  const sortMode =
    sorting.some((item) => item.id === "name") ? "az" : "relevance";

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="shrink-0">
        <h2 className="text-lg font-semibold">{t.controlRoom.peopleTitulo}</h2>
        <p className="text-sm text-muted-foreground">
          {peopleTab === "contacts"
            ? t.controlRoom.peopleDescricao
            : t.controlRoom.orgsDescricao}
        </p>
      </div>

      {peopleTab === "organizations" ? (
        <OrganizationsView contacts={contacts} navigation={peopleNavigation} />
      ) : (
        <>
      {bulkContacts && (
        <BulkEnrichReview
          contacts={bulkContacts}
          onClose={() => setBulkContacts(null)}
        />
      )}

      {missingScopes.length > 0 && (
        <Alert variant="warning">
          <KeyRound />
          <AlertTitle>{t.controlRoom.peopleSemPermissao}</AlertTitle>
          <AlertDescription>
            {preencher(t.controlRoom.peopleSemPermissaoDesc, {
              escopos: missingScopes.join(" + "),
            })}
          </AlertDescription>
          <AlertAction>
            <Button size="sm" onClick={onGrantAccess}>
              {t.controlRoom.peopleConcederAcesso}
            </Button>
          </AlertAction>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t.controlRoom.peopleErro}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={() => void loadPeople()}>
              {t.controlRoom.peopleTentarNovamente}
            </Button>
          </AlertAction>
        </Alert>
      )}

      <div
        ref={detailContainerRef}
        className="@container/people flex min-h-0 flex-1"
      >
        {(() => {
          const listPane = (
            <Frame
              className="h-full min-h-0 min-w-0 overflow-hidden"
              stacked
              dense
            >
              <FrameHeader className="shrink-0">
                {peopleNavigation}
              </FrameHeader>
              <FramePanel
                fit
                className="flex min-h-11 shrink-0 items-center justify-between gap-2 px-2 py-1.5"
              >
                <Toolbar
                  aria-label={t.controlRoom.peopleContactsTab}
                  className="flex-wrap"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Filters<string>
                          filters={filters}
                          fields={filterFields}
                          onChange={setFilters}
                          allowMultiple
                          trigger={
                            <ToolbarButton
                              aria-label={t.controlRoom.peopleFilters}
                              pressed={filters.length > 0}
                            >
                              <ListFilter />
                            </ToolbarButton>
                          }
                          i18n={{
                            addFilter: t.controlRoom.peopleFilters,
                            searchFields: t.controlRoom.filtroBuscarCampo,
                            select: t.controlRoom.filtroSelecione,
                          }}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t.controlRoom.peopleFilters}
                    </TooltipContent>
                  </Tooltip>
                  {filters.length > 0 && (
                    <ToolbarButton
                      tooltip={t.controlRoom.peopleClearFilters}
                      onClick={() => setFilters([])}
                    >
                      <FunnelX />
                    </ToolbarButton>
                  )}
                  <ToolbarSeparator />
                  <ToolbarButton
                    tooltip={t.controlRoom.peopleOrdenar}
                    pressed={sortMode === "az"}
                    onClick={() =>
                      setSorting(
                        sortMode === "relevance"
                          ? [{ id: "name", desc: false }]
                          : [],
                      )
                    }
                  >
                    <ArrowUpDown />
                  </ToolbarButton>
                  <ToolbarButton
                    tooltip={
                      view === "table"
                        ? t.controlRoom.peopleCardsView
                        : t.controlRoom.peopleTableView
                    }
                    pressed={view === "cards"}
                    onClick={() =>
                      setView(view === "table" ? "cards" : "table")
                    }
                  >
                    {view === "table" ? <LayoutGrid /> : <List />}
                  </ToolbarButton>
                  <ToolbarSeparator />
                  <ToolbarButton
                    tooltip={
                      selectedContacts.length > 0
                        ? t.controlRoom.peopleEnrichSelected
                        : t.controlRoom.peopleEnrichAll
                    }
                    disabled={contacts.every(
                      (contact) => contact.emails.length === 0,
                    )}
                    onClick={() =>
                      setBulkContacts(
                        (selectedContacts.length > 0
                          ? selectedContacts
                          : contacts
                        ).filter((contact) => contact.emails[0]?.address),
                      )
                    }
                  >
                    <Sparkles />
                  </ToolbarButton>
                </Toolbar>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {filtered.length}
                </span>
              </FramePanel>
              <FramePanel className="min-h-0 p-0">
                {view === "table" ? (
                  <DataGrid
                    table={table}
                    recordCount={filtered.length}
                    isLoading={loading && !loaded}
                    loadingMode="skeleton"
                    emptyMessage={
                      missingScopes.length > 0 ? (
                        <PeoplePermissionEmpty />
                      ) : (
                        <PeopleEmpty
                          search={Boolean(normalizedQuery)}
                          filtered={filters.length > 0}
                          onClear={() => {
                            setPeopleSearchQuery("");
                            setFilters([]);
                          }}
                        />
                      )
                    }
                    onRowClick={(contact) => {
                      selectPerson(contact.id);
                      setRowSelection((current) => ({
                        ...current,
                        [contact.id]: true,
                      }));
                    }}
                    tableLayout={{
                      dense: true,
                      stripped: true,
                      rowBorder: false,
                      headerBackground: true,
                      headerSticky: true,
                      columnsVisibility: true,
                      columnsResizable: true,
                      columnsResizeMode: "onChange",
                      columnsMovable: true,
                      width: "fixed",
                    }}
                  >
                    <DataGridContainer className="h-full">
                      <ScrollArea className="h-full">
                        <DataGridTableVirtual
                          onFetchMore={() => void loadMorePeople()}
                          isFetchingMore={fetchingMore}
                          hasMore={nextLinks.length > 0}
                          fetchMoreOffset={8}
                          estimateSize={48}
                          overscan={8}
                        />
                      </ScrollArea>
                    </DataGridContainer>
                  </DataGrid>
                ) : filtered.length > 0 ? (
                  <div className="h-full overflow-auto p-3">
                    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                      {filtered.map((contact) => (
                        <PeopleCard
                          key={contact.id}
                          contact={contact}
                          selected={contact.id === selectedId}
                          photo={
                            contact.photo ||
                            getFoto(contact.emails[0]?.address) ||
                            null
                          }
                          onSelect={() => selectPerson(contact.id)}
                          onCompose={onCompose}
                          onEnrich={() => {
                            selectPerson(contact.id);
                            setEnrichRequest({
                              id: contact.id,
                              token: Date.now(),
                            });
                          }}
                        />
                      ))}
                    </div>
                    {nextLinks.length > 0 && (
                      <div className="flex justify-center py-4">
                        <Button
                          variant="outline"
                          disabled={fetchingMore}
                          onClick={() => void loadMorePeople()}
                        >
                          {fetchingMore && <Spinner />}
                          {t.controlRoom.peopleLoadMore}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : missingScopes.length > 0 ? (
                  <PeoplePermissionEmpty />
                ) : (
                  <PeopleEmpty
                    search={Boolean(normalizedQuery)}
                    filtered={filters.length > 0}
                    onClear={() => {
                      setPeopleSearchQuery("");
                      setFilters([]);
                    }}
                  />
                )}
              </FramePanel>
            </Frame>
          );

          const detailPane =
            loading && !loaded ? (
              <PeopleDetailSkeleton />
            ) : selected ? (
              <PeopleDetail
                key={`${selected.id}:${enrichRequest?.id === selected.id ? enrichRequest.token : 0}`}
                contact={selected}
                photo={getFoto(selected.emails[0]?.address) ?? null}
                onBack={() => selectPerson(null)}
                onCompose={onCompose}
                autoEnrich={enrichRequest?.id === selected.id}
                stacked={!wideSplit}
              />
            ) : (
              <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 rounded-xl border bg-card p-6 text-center">
                <IconStack>
                  <Users className="size-5" />
                </IconStack>
                <div>
                  <p className="font-medium">{t.controlRoom.peopleSelecionar}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t.controlRoom.peopleSelecionarDesc}
                  </p>
                </div>
              </div>
            );

          if (!wideSplit) {
            return (
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                {selected ? detailPane : listPane}
              </div>
            );
          }

          return (
            <ResizablePanelGroup
              autoSaveId="people.detail.layout"
              direction="horizontal"
              className="min-h-0 flex-1"
            >
              <ResizablePanel
                defaultSize={38}
                minSize={listMinSize}
                className="min-w-0 overflow-hidden"
              >
                {listPane}
              </ResizablePanel>
              <ResizableHandle
                withHandle
                className="mx-1.5 bg-transparent hover:bg-border"
              />
              <ResizablePanel
                defaultSize={62}
                minSize={detailMinSize}
                className="min-w-0 overflow-hidden"
              >
                {detailPane}
              </ResizablePanel>
            </ResizablePanelGroup>
          );
        })()}
      </div>
        </>
      )}
    </section>
  );
}
