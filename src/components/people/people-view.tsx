"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FunnelX,
  Info,
  KeyRound,
  LayoutGrid,
  List,
  ListFilter,
  Mail,
  GitMerge,
  Pencil,
  MoreHorizontal,
  Phone,
  Plus,
  SearchX,
  Save,
  Sparkles,
  Tag,
  Users,
  X,
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { OrganizationsView } from "@/components/people/organizations-view";
import { ContactMergeSheet } from "@/components/people/contact-merge-sheet";
import * as api from "@/lib/api";
import { useFotos } from "@/lib/fotos";
import { useIdioma, preencher } from "@/lib/idioma";
import { type PeopleContact } from "@/lib/people";
import {
  contactDomain,
  contactOrganizationLabel,
  normalizeDomain,
  organizationMembers,
  resolveContactOrganization,
  suggestedOrganizationName,
  type PeopleOrg,
} from "@/lib/organizations";
import type {
  PeopleBulkDetailsChange,
  PeopleBulkDetailsField,
  PeopleContactEdit,
  PeopleEnrichSource,
  PeopleInteraction,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

const EMPTY_CONTACTS: PeopleContact[] = [];

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
  organizationLabel,
  organizationLogo,
  compact = false,
}: {
  contact: PeopleContact;
  organizationLabel?: string | null;
  organizationLogo?: string | null;
  compact?: boolean;
}) {
  const { t } = useIdioma();
  return (
    <span className="flex flex-wrap items-center gap-1">
      {organizationLabel && (
        <Badge variant="outline" size={compact ? "xs" : "sm"}>
          <Avatar className="size-3">
            {organizationLogo && (
              <AvatarImage src={organizationLogo} alt="" />
            )}
            <AvatarFallback>
              <Building2 className="size-2.5" />
            </AvatarFallback>
          </Avatar>
          {organizationLabel}
        </Badge>
      )}
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
  directory = false,
  onClear,
}: {
  search: boolean;
  filtered: boolean;
  directory?: boolean;
  onClear: () => void;
}) {
  const { t } = useIdioma();
  return (
    <div className="flex h-full min-h-56 w-full flex-col items-center justify-center px-6 text-center">
      <IconStack className="mb-2">
        {search || filtered ? <SearchX className="size-5" /> : <Users className="size-5" />}
      </IconStack>
      <p className="font-medium">
        {search || filtered
          ? t.controlRoom.peopleSemResultado
          : directory
            ? t.controlRoom.peopleDirectoryEmpty
            : t.controlRoom.peopleVazio}
      </p>
      {!search && !filtered && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {directory
            ? t.controlRoom.peopleDirectoryEmptyDesc
            : t.controlRoom.peopleVazioDesc}
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
    <div className="flex h-full min-h-56 w-full flex-col items-center justify-center px-6 text-center">
      <IconTile className="mb-3" variant="frame" size="lg">
        <KeyRound />
      </IconTile>
      <p className="font-medium">{t.controlRoom.peopleSemPermissao}</p>
    </div>
  );
}

function PeopleGroupEmpty({ selected }: { selected: boolean }) {
  const { t } = useIdioma();
  return (
    <div className="flex h-full min-h-56 w-full flex-col items-center justify-center px-6 text-center">
      <IconStack className="mb-2">
        <Users className="size-5" />
      </IconStack>
      <p className="font-medium">
        {selected
          ? t.controlRoom.peopleGroupEmpty
          : t.controlRoom.peopleGroupSelect}
      </p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {selected
          ? t.controlRoom.peopleGroupEmptyDesc
          : t.controlRoom.peopleGroupSelectDesc}
      </p>
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

/**
 * #278 S3b: seletor de categorias do Outlook no detalhe do contato. Mostra as
 * atuais como chips (swatch da cor real, padrão do sidebar #406) e um
 * Popover+Command pra marcar/desmarcar (multi-valor) + criar inline. Grava por
 * PATCH parcial (`setPeopleContactCategorias`). Só aparece pra contatos
 * EDITÁVEIS (com `contactId`) — itens do diretório (/users) não têm categorias.
 */
function ContactCategories({ contact }: { contact: PeopleContact }) {
  const { t } = useIdioma();
  const peopleCategorias = useAppStore((state) => state.peopleCategorias);
  const setPeopleContactCategorias = useAppStore(
    (state) => state.setPeopleContactCategorias,
  );
  const criarCategoriaPeople = useAppStore(
    (state) => state.criarCategoriaPeople,
  );
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);

  if (!contact.contactId) return null;

  const atuais = contact.categories ?? [];
  const disponiveis = [...peopleCategorias.keys()];
  const buscaLimpa = busca.trim();
  const jaExiste = disponiveis.some(
    (nome) => nome.toLowerCase() === buscaLimpa.toLowerCase(),
  );

  const gravar = async (proximas: string[]) => {
    setSalvando(true);
    try {
      await setPeopleContactCategorias(contact.id, proximas);
    } catch {
      toast.error(t.controlRoom.peopleCategoriaAtribuirErro);
    } finally {
      setSalvando(false);
    }
  };

  const alternar = (nome: string) => {
    const proximas = atuais.includes(nome)
      ? atuais.filter((categoria) => categoria !== nome)
      : [...atuais, nome];
    void gravar(proximas);
  };

  const criarEAtribuir = async () => {
    if (!buscaLimpa) return;
    setSalvando(true);
    try {
      await criarCategoriaPeople(buscaLimpa, "preset0");
      await setPeopleContactCategorias(contact.id, [...atuais, buscaLimpa]);
      setBusca("");
    } catch {
      toast.error(t.controlRoom.peopleCategoriaAtribuirErro);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <Separator />
      <section className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Tag className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">
            {t.controlRoom.peopleCategoriesSection}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {atuais.map((nome) => {
            const cor = peopleCategorias.get(nome);
            return (
              <Badge key={nome} variant="secondary" className="gap-1.5">
                {cor ? (
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: cor }}
                  />
                ) : (
                  <Tag className="size-3 shrink-0" />
                )}
                {nome}
                <button
                  type="button"
                  className="ml-0.5 rounded-sm opacity-70 hover:opacity-100"
                  aria-label={t.controlRoom.peopleCategoriaRemover}
                  onClick={() => alternar(nome)}
                  disabled={salvando}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            );
          })}

          <Popover open={aberto} onOpenChange={setAberto}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                disabled={salvando}
              >
                <Plus className="size-3" />
                {t.controlRoom.peopleCategoriaAdd}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
              <Command>
                <CommandInput
                  placeholder={t.controlRoom.peopleCategoriaBuscar}
                  value={busca}
                  onValueChange={setBusca}
                />
                <CommandList>
                  <CommandEmpty>
                    {t.controlRoom.peopleCategoriaVazio}
                  </CommandEmpty>
                  <CommandGroup>
                    {disponiveis.map((nome) => {
                      const cor = peopleCategorias.get(nome);
                      const marcada = atuais.includes(nome);
                      return (
                        <CommandItem
                          key={nome}
                          value={nome}
                          onSelect={() => alternar(nome)}
                        >
                          {cor ? (
                            <span
                              aria-hidden
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ background: cor }}
                            />
                          ) : (
                            <Tag className="size-3.5 shrink-0" />
                          )}
                          <span className="flex-1 truncate">{nome}</span>
                          {marcada && <Check className="size-3.5 shrink-0" />}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                  {buscaLimpa && !jaExiste && (
                    <>
                      <CommandSeparator />
                      <CommandGroup>
                        <CommandItem
                          value={`__criar__${buscaLimpa}`}
                          onSelect={() => void criarEAtribuir()}
                        >
                          <Plus className="size-3.5 shrink-0" />
                          {t.controlRoom.peopleCategoriaCriar} “{buscaLimpa}”
                        </CommandItem>
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </section>
    </>
  );
}

function PeopleDetail({
  contact,
  photo,
  userEmail,
  onBack,
  onCompose,
  onReauthenticate,
  stacked = false,
}: {
  contact: PeopleContact;
  photo: string | null;
  userEmail: string;
  onBack: () => void;
  onCompose: (email: string) => void;
  onReauthenticate: () => void;
  stacked?: boolean;
}) {
  const { idioma, t } = useIdioma();
  const autoEnrichDirectoryContact = useAppStore(
    (state) => state.autoEnrichDirectoryContact,
  );
  const updatePeopleContact = useAppStore((state) => state.updatePeopleContact);
  const organizations = useAppStore((state) => state.organizations);
  const selectOrganization = useAppStore((state) => state.selectOrganization);
  const setPeopleTab = useAppStore((state) => state.setPeopleTab);
  const assignPeopleOrganization = useAppStore(
    (state) => state.assignPeopleOrganization,
  );
  const primaryEmail = contact.emails[0]?.address;
  const userDomain = normalizeDomain(userEmail.split("@").at(-1) ?? "");
  const sameOrganization =
    contact.organization ||
    Boolean(userDomain && contactDomain(contact) === userDomain);
  const resolvedOrganization = resolveContactOrganization(
    organizations,
    contact,
  );
  const organizationLabel = contactOrganizationLabel(organizations, contact);
  const [enrichError, setEnrichError] = useState<string | null>(null);
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
  const [assigningOrganizationId, setAssigningOrganizationId] = useState<
    string | null
  >(null);
  const editUnavailableReason = sameOrganization
    ? "directory"
    : !contact.contactId
      ? "unsaved"
      : writeAvailable === false
        ? "permission"
        : null;
  const editLocked =
    sameOrganization || !contact.contactId || writeAvailable !== true;
  const editUnavailableDescription =
    editUnavailableReason === "directory"
      ? t.controlRoom.peopleEditDirectoryTooltip
      : editUnavailableReason === "unsaved"
        ? t.controlRoom.peopleEditDirectoryDesc
        : editUnavailableReason === "permission"
          ? t.reauth.descricao
          : t.controlRoom.peopleEditUnavailable;
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

  const assignOrganization = async (organization: PeopleOrg) => {
    setAssigningOrganizationId(organization.id);
    try {
      const result = await assignPeopleOrganization(organization.id, [contact.id]);
      if (result.skipped > 0) {
        toast.warning(t.controlRoom.orgWritebackSomenteLeitura);
        return;
      }
      if (result.failed > 0) {
        toast.error(t.controlRoom.orgWritebackErro);
        return;
      }
      toast.success(t.controlRoom.orgWritebackSucesso);
      selectOrganization(organization.id);
      setPeopleTab("organizations");
    } catch {
      toast.error(t.controlRoom.orgWritebackErro);
    } finally {
      setAssigningOrganizationId(null);
    }
  };

  useEffect(() => {
    let active = true;
    if (sameOrganization) {
      setEnrichError(null);
      void autoEnrichDirectoryContact(contact.id, true)
        .catch((error) => {
          if (active) setEnrichError(String(error));
        });
    }
    return () => {
      active = false;
    };
    // Auto-enrich de entidades da organização roda uma vez ao abrir o detalhe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                <RelationshipBadges
                  contact={contact}
                  organizationLabel={organizationLabel}
                  organizationLogo={resolvedOrganization?.logo}
                />
                <SourceBadge
                  source={
                    contact.sources.includes("directory")
                      ? "directory"
                      : contact.contactId
                        ? "contacts"
                        : "people"
                  }
                />
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
                      {editUnavailableDescription}
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
                {!editLocked && (
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
                            disabled={assigningOrganizationId !== null}
                            onClick={() => void assignOrganization(organization)}
                          >
                            {assigningOrganizationId === organization.id ? (
                              <Spinner />
                            ) : (
                              <Avatar className="size-4">
                                {organization.logo && (
                                  <AvatarImage src={organization.logo} alt="" />
                                )}
                                <AvatarFallback>
                                  <Building2 className="size-3" />
                                </AvatarFallback>
                              </Avatar>
                            )}
                            {organization.name}
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </Toolbar>
              {primaryEmail && (
                <Button onClick={() => onCompose(primaryEmail)}>
                  <Mail />
                  {t.controlRoom.peopleCompor}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col">
          {(!editing &&
            editUnavailableReason &&
            editUnavailableReason !== "directory") ||
          editError ||
          enrichError ? (
            <div className="space-y-3 border-b p-4">
              {!editing &&
                editUnavailableReason &&
                editUnavailableReason !== "directory" && (
                <Alert variant="warning">
                  {editUnavailableReason === "permission" ? (
                    <KeyRound />
                  ) : (
                    <Users />
                  )}
                  <AlertTitle>
                    {editUnavailableReason === "permission"
                      ? t.reauth.titulo
                      : t.controlRoom.peopleEditDirectoryTitle}
                  </AlertTitle>
                  <AlertDescription>
                    {editUnavailableDescription}
                  </AlertDescription>
                  {editUnavailableReason === "permission" && (
                    <AlertAction>
                      <Button size="sm" onClick={onReauthenticate}>
                        {t.reauth.entrarNovamente}
                      </Button>
                    </AlertAction>
                  )}
                </Alert>
              )}

              {editError && (
                <Alert variant="destructive">
                  <AlertTitle>{t.controlRoom.peopleEditError}</AlertTitle>
                  <AlertDescription>{editError}</AlertDescription>
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
            <Badge variant="secondary">
              <Avatar className="size-3">
                {resolvedOrganization.logo && (
                  <AvatarImage src={resolvedOrganization.logo} alt="" />
                )}
                <AvatarFallback>
                  <Building2 className="size-2.5" />
                </AvatarFallback>
              </Avatar>
              {resolvedOrganization.name}
            </Badge>
          </button>
        )}
          </section>

          {/* #278 S3b: categorias do Outlook do contato (só editável). */}
          <ContactCategories contact={contact} />

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
}: {
  contact: PeopleContact;
  onCompose: (email: string) => void;
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
  organizationLabel,
  organizationLogo,
  selected,
  photo,
  onSelect,
  onCompose,
}: {
  contact: PeopleContact;
  organizationLabel?: string | null;
  organizationLogo?: string | null;
  selected: boolean;
  photo: string | null;
  onSelect: () => void;
  onCompose: (email: string) => void;
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
          <RelationshipBadges
            contact={contact}
            organizationLabel={organizationLabel}
            organizationLogo={organizationLogo}
            compact
          />
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

type BulkAssignStep = "pick" | "create" | "preview";
type BulkEditDetailsStep = "edit" | "preview";
type BulkEditDetailsFieldState = {
  enabled: boolean;
  clear: boolean;
  value: string;
};
type BulkEditDetailsState = Record<
  PeopleBulkDetailsField,
  BulkEditDetailsFieldState
>;

function emptyBulkEditDetailsState(): BulkEditDetailsState {
  return {
    companyName: { enabled: false, clear: false, value: "" },
    department: { enabled: false, clear: false, value: "" },
    officeLocation: { enabled: false, clear: false, value: "" },
  };
}

function splitDomains(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((domain) => domain.trim())
    .filter(Boolean);
}

/**
 * Barra de massa → atribuir os contatos selecionados a uma organização
 * (existente ou nova). Aditivo e persistido no `companyName` dos contatos
 * editáveis; pessoas do diretório continuam read-only.
 */
function AssignToOrganizationSheet({
  open,
  contacts,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  contacts: PeopleContact[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useIdioma();
  const organizations = useAppStore((state) => state.organizations);
  const createOrganization = useAppStore((state) => state.createOrganization);
  const assignPeopleOrganization = useAppStore(
    (state) => state.assignPeopleOrganization,
  );
  const selectOrganization = useAppStore((state) => state.selectOrganization);

  const [step, setStep] = useState<BulkAssignStep>("pick");
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const wasOpenRef = useRef(false);

  const selectedDomains = useMemo(
    () =>
      Array.from(
        new Set(
          contacts
            .map(contactDomain)
            .filter((domain): domain is string => Boolean(domain)),
        ),
      ).sort(),
    [contacts],
  );

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    // Inicializa somente na transição fechado → aberto. Criar uma organização
    // atualiza o store e pode recriar `contacts`/`selectedDomains`; reiniciar
    // aqui devolveria o fluxo de "preview" para a etapa "pick".
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setStep("pick");
    setQuery("");
    setTargetId(null);
    setName(
      selectedDomains[0]
        ? suggestedOrganizationName(selectedDomains[0], contacts)
        : "",
    );
    setDomains(selectedDomains.join(", "));
    setError(false);
  }, [open, contacts, selectedDomains]);

  const target =
    organizations.find((organization) => organization.id === targetId) ?? null;

  // Preview: espelha a semântica aditiva de `addContactToOrganization`.
  // A membership de um contato depende só do contato + org, então basta olhar
  // os selecionados. `added` = vira membro agora; `already` = no-op;
  // `noEmail` = sem domínio, entra como membro explícito.
  const preview = useMemo(() => {
    if (!target) return null;
    const currentMemberIds = new Set(
      organizationMembers(target, contacts).map((contact) => contact.id),
    );
    let added = 0;
    let already = 0;
    let noEmail = 0;
    let readOnly = 0;
    for (const contact of contacts) {
      if (!contact.contactId) {
        readOnly += 1;
        continue;
      }
      const domain = contactDomain(contact);
      const isMember = currentMemberIds.has(contact.id);
      if (isMember) already += 1;
      else added += 1;
      if (!domain && !isMember) noEmail += 1;
    }
    return { added, already, noEmail, readOnly, total: contacts.length };
  }, [target, contacts]);

  const goToCreate = () => {
    setName(
      selectedDomains[0]
        ? suggestedOrganizationName(selectedDomains[0], contacts)
        : "",
    );
    setDomains(selectedDomains.join(", "));
    setError(false);
    setStep("create");
  };

  const submitCreate = () => {
    const parsedDomains = splitDomains(domains);
    if (!name.trim()) {
      setError(true);
      return;
    }
    const organization = createOrganization({ name, domains: parsedDomains });
    setTargetId(organization.id);
    setStep("preview");
  };

  const apply = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const result = await assignPeopleOrganization(
        target.id,
        contacts.map((contact) => contact.id),
      );
      if (result.assigned > 0) {
        toast.success(
          preencher(t.controlRoom.bulkOrgSucesso, {
            n: result.assigned,
            nome: target.name,
          }),
        );
        selectOrganization(target.id);
      }
      if (result.skipped > 0) {
        toast.warning(
          preencher(t.controlRoom.bulkOrgSomenteLeitura, {
            n: result.skipped,
          }),
        );
      }
      if (result.failed > 0) {
        toast.error(
          preencher(t.controlRoom.bulkOrgFalhas, {
            n: result.failed,
          }),
        );
      }
      onDone();
    } catch {
      toast.error(
        preencher(t.controlRoom.bulkOrgFalhas, {
          n: contacts.filter((contact) => Boolean(contact.contactId)).length,
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="pr-6 text-left">
            {step === "create"
              ? t.controlRoom.orgsCriarTitulo
              : preencher(t.controlRoom.bulkOrgTitulo, { n: contacts.length })}
          </SheetTitle>
          <SheetDescription className="text-left">
            {step === "create"
              ? t.controlRoom.orgsDescricao
              : t.controlRoom.bulkOrgDescricao}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-fina px-4 py-4">
          {step === "pick" && (
            <Command className="rounded-lg border">
              <CommandInput
                placeholder={t.controlRoom.bulkOrgBuscar}
                value={query}
                onValueChange={setQuery}
              />
              <CommandList>
                <CommandEmpty>{t.controlRoom.bulkOrgSemOrgs}</CommandEmpty>
                {organizations.length > 0 && (
                  <CommandGroup>
                    {organizations.map((organization) => (
                      <CommandItem
                        key={organization.id}
                        value={`${organization.name} ${organization.domains.join(" ")}`}
                        onSelect={() => {
                          setTargetId(organization.id);
                          setStep("preview");
                        }}
                      >
                        <Avatar className="size-4">
                          {organization.logo && (
                            <AvatarImage src={organization.logo} alt="" />
                          )}
                          <AvatarFallback>
                            <Building2 className="size-3" />
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1 truncate">
                          {organization.name}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {organization.domains.join(" · ")}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value="__create__" onSelect={goToCreate}>
                    <Plus />
                    {t.controlRoom.bulkOrgCriarNova}
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          )}

          {step === "create" && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="bulk-org-name">{t.controlRoom.orgsNome}</Label>
                <Input
                  id="bulk-org-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t.controlRoom.orgsNomePlaceholder}
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center gap-1">
                  <Label htmlFor="bulk-org-domains">
                    {t.controlRoom.orgsDominios}
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="rounded-full text-muted-foreground hover:text-foreground"
                        aria-label={t.controlRoom.orgsDominiosTooltip}
                      >
                        <Info className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-pretty">
                      {t.controlRoom.orgsDominiosTooltip}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="bulk-org-domains"
                  value={domains}
                  onChange={(event) => setDomains(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      setDomains((current) => `${current.trim()}, `);
                    }
                  }}
                  placeholder={t.controlRoom.orgsDominiosPlaceholder}
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">
                  {t.controlRoom.orgsErroCampos}
                </p>
              )}
            </div>
          )}

          {step === "preview" && preview && target && (
            <div className="grid gap-3">
              <p className="text-sm font-medium">
                {preencher(t.controlRoom.bulkOrgPreviewAlvo, {
                  nome: target.name,
                })}
              </p>
              <ul className="grid gap-1.5 text-sm">
                <li className="flex items-center gap-2">
                  <Badge variant="secondary">{preview.added}</Badge>
                  <span>{t.controlRoom.bulkOrgPreviewAdicionados}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Badge variant="outline">{preview.already}</Badge>
                  <span className="text-muted-foreground">
                    {t.controlRoom.bulkOrgPreviewJaPertencem}
                  </span>
                </li>
                {preview.noEmail > 0 && (
                  <li className="flex items-center gap-2">
                    <Badge variant="outline">{preview.noEmail}</Badge>
                    <span className="text-muted-foreground">
                      {t.controlRoom.bulkOrgPreviewSemEmail}
                    </span>
                  </li>
                )}
                {preview.readOnly > 0 && (
                  <li className="flex items-center gap-2">
                    <Badge variant="outline">{preview.readOnly}</Badge>
                    <span className="text-muted-foreground">
                      {preencher(t.controlRoom.bulkOrgSomenteLeitura, {
                        n: preview.readOnly,
                      })}
                    </span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
          {step === "pick" && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t.controlRoom.orgsCancelar}
            </Button>
          )}
          {step === "create" && (
            <>
              <Button variant="outline" onClick={() => setStep("pick")}>
                {t.controlRoom.bulkOrgVoltar}
              </Button>
              <Button onClick={submitCreate}>
                {t.controlRoom.bulkOrgCriarContinuar}
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("pick")}
                disabled={saving}
              >
                {t.controlRoom.bulkOrgVoltar}
              </Button>
              <Button onClick={() => void apply()} disabled={saving}>
                {saving && <Spinner />}
                {t.controlRoom.bulkOrgConfirmar}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * #278 S3c: seletor multi-check de categorias pro bulk (adicionar OU remover).
 * Chips do selecionado + Popover/Command com swatch da cor real, no mesmo
 * padrão do detalhe (#278 S3b) e do sidebar (#406).
 */
function BulkCategoriaPicker({
  label,
  placeholder,
  emptyText,
  selected,
  categorias,
  onToggle,
}: {
  label: string;
  placeholder: string;
  emptyText: string;
  selected: string[];
  categorias: Map<string, string>;
  onToggle: (nome: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const nomes = [...categorias.keys()];
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((nome) => {
          const cor = categorias.get(nome);
          return (
            <Badge key={nome} variant="secondary" className="gap-1.5">
              {cor ? (
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: cor }}
                />
              ) : (
                <Tag className="size-3 shrink-0" />
              )}
              {nome}
              <button
                type="button"
                className="ml-0.5 rounded-sm opacity-70 hover:opacity-100"
                onClick={() => onToggle(nome)}
              >
                <X className="size-3" />
              </button>
            </Badge>
          );
        })}
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
            >
              <Plus className="size-3" />
              {placeholder}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <Command>
              <CommandInput placeholder={placeholder} />
              <CommandList>
                <CommandEmpty>{emptyText}</CommandEmpty>
                <CommandGroup>
                  {nomes.map((nome) => {
                    const cor = categorias.get(nome);
                    const marcada = selected.includes(nome);
                    return (
                      <CommandItem
                        key={nome}
                        value={nome}
                        onSelect={() => onToggle(nome)}
                      >
                        {cor ? (
                          <span
                            aria-hidden
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ background: cor }}
                          />
                        ) : (
                          <Tag className="size-3.5 shrink-0" />
                        )}
                        <span className="flex-1 truncate">{nome}</span>
                        {marcada && <Check className="size-3.5 shrink-0" />}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function BulkEditDetailsSheet({
  open,
  contacts,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  contacts: PeopleContact[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useIdioma();
  const bulkEditPeopleDetails = useAppStore(
    (state) => state.bulkEditPeopleDetails,
  );
  const bulkSetPeopleCategorias = useAppStore(
    (state) => state.bulkSetPeopleCategorias,
  );
  const peopleCategorias = useAppStore((state) => state.peopleCategorias);
  const [step, setStep] = useState<BulkEditDetailsStep>("edit");
  const [edits, setEdits] = useState<BulkEditDetailsState>(
    emptyBulkEditDetailsState,
  );
  // #278 S3c: categorias a adicionar / remover no lote (nomes de masterCategory).
  const [catAdd, setCatAdd] = useState<string[]>([]);
  const [catRemove, setCatRemove] = useState<string[]>([]);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const wasOpenRef = useRef(false);

  const editableCount = contacts.filter((contact) =>
    Boolean(contact.contactId),
  ).length;
  const readOnlyCount = contacts.length - editableCount;
  const fields: Array<{
    key: PeopleBulkDetailsField;
    label: string;
    placeholder: string;
  }> = [
    {
      key: "companyName",
      label: t.controlRoom.bulkDetailsEmpresa,
      placeholder: t.controlRoom.bulkDetailsEmpresaPlaceholder,
    },
    {
      key: "department",
      label: t.controlRoom.bulkDetailsDepartamento,
      placeholder: t.controlRoom.bulkDetailsDepartamentoPlaceholder,
    },
    {
      key: "officeLocation",
      label: t.controlRoom.bulkDetailsLocalEscritorio,
      placeholder: t.controlRoom.bulkDetailsLocalEscritorioPlaceholder,
    },
  ];

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setStep("edit");
    setEdits(emptyBulkEditDetailsState());
    setCatAdd([]);
    setCatRemove([]);
    setValidationAttempted(false);
    setSaving(false);
  }, [open]);

  const enabledFields = fields.filter(({ key }) => edits[key].enabled);
  const missingValueFields = enabledFields.filter(
    ({ key }) => !edits[key].clear && !edits[key].value.trim(),
  );
  const changes: PeopleBulkDetailsChange[] = enabledFields.map(({ key }) => ({
    field: key,
    value: edits[key].clear ? null : edits[key].value.trim(),
  }));
  const hasCatChanges = catAdd.length > 0 || catRemove.length > 0;
  // Uma categoria em "adicionar" não pode estar em "remover" (e vice-versa): o
  // seletor de cada lado exclui o que já está no outro.
  const toggleCat = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    outro: React.Dispatch<React.SetStateAction<string[]>>,
    nome: string,
  ) => {
    setter((atual) =>
      atual.includes(nome)
        ? atual.filter((c) => c !== nome)
        : [...atual, nome],
    );
    outro((atual) => atual.filter((c) => c !== nome));
  };

  const updateField = (
    key: PeopleBulkDetailsField,
    patch: Partial<BulkEditDetailsFieldState>,
  ) => {
    setEdits((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  };

  const goToPreview = () => {
    setValidationAttempted(true);
    if (enabledFields.length === 0 && !hasCatChanges) return;
    if (missingValueFields.length > 0) return;
    setStep("preview");
  };

  const apply = async () => {
    if (changes.length === 0 && !hasCatChanges) return;
    setSaving(true);
    const ids = contacts.map((contact) => contact.id);
    try {
      if (changes.length > 0) {
        const result = await bulkEditPeopleDetails(ids, changes);
        if (result.updated > 0) {
          toast.success(
            preencher(t.controlRoom.bulkDetailsAtualizados, {
              n: result.updated,
            }),
          );
        }
        if (result.unchanged > 0) {
          toast.info(
            preencher(t.controlRoom.bulkDetailsSemMudanca, {
              n: result.unchanged,
            }),
          );
        }
        if (result.skipped > 0) {
          toast.warning(
            preencher(t.controlRoom.bulkDetailsIgnorados, {
              n: result.skipped,
            }),
          );
        }
        if (result.failed > 0) {
          toast.error(
            preencher(t.controlRoom.bulkDetailsFalhas, {
              n: result.failed,
            }),
          );
        }
      }
      if (hasCatChanges) {
        const result = await bulkSetPeopleCategorias(ids, catAdd, catRemove);
        if (result.updated > 0) {
          toast.success(
            preencher(t.controlRoom.bulkCategoriasAtualizados, {
              n: result.updated,
            }),
          );
        }
        if (result.skipped > 0) {
          toast.warning(
            preencher(t.controlRoom.bulkDetailsIgnorados, {
              n: result.skipped,
            }),
          );
        }
        if (result.failed > 0) {
          toast.error(
            preencher(t.controlRoom.bulkCategoriasFalhas, {
              n: result.failed,
            }),
          );
        }
      }
      onDone();
    } catch {
      toast.error(t.controlRoom.bulkDetailsErro);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="pr-6 text-left">
            {preencher(t.controlRoom.bulkDetailsTitulo, {
              n: contacts.length,
            })}
          </SheetTitle>
          <SheetDescription className="text-left">
            {t.controlRoom.bulkDetailsDescricao}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 **:data-[slot=scroll-area-viewport]:overscroll-contain">
          <div className="grid gap-4 px-4 py-4">
            {step === "edit" ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {contacts.length} {t.controlRoom.bulkDetailsSelecionados}
                  </Badge>
                  <Badge variant="outline">
                    {editableCount} {t.controlRoom.bulkDetailsEditaveis}
                  </Badge>
                  <Badge variant="outline">
                    {readOnlyCount} {t.controlRoom.bulkDetailsSomenteLeitura}
                  </Badge>
                </div>

                <div className="grid gap-3">
                  {fields.map(({ key, label, placeholder }) => {
                    const edit = edits[key];
                    const inputId = `bulk-details-${key}`;
                    const enabledId = `${inputId}-enabled`;
                    const clearId = `${inputId}-clear`;
                    const missingValue =
                      validationAttempted &&
                      edit.enabled &&
                      !edit.clear &&
                      !edit.value.trim();
                    return (
                      <div key={key} className="grid gap-3 rounded-lg border p-3">
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id={enabledId}
                            checked={edit.enabled}
                            onCheckedChange={(checked) =>
                              updateField(key, {
                                enabled: checked === true,
                              })
                            }
                          />
                          <div className="grid gap-0.5">
                            <Label htmlFor={enabledId}>{label}</Label>
                            <p className="text-xs text-muted-foreground">
                              {t.controlRoom.bulkDetailsPreservado}
                            </p>
                          </div>
                        </div>

                        {edit.enabled && (
                          <div className="grid gap-3 border-t pt-3">
                            <div className="grid gap-2">
                              <Label htmlFor={inputId}>
                                {t.controlRoom.bulkDetailsNovoValor}
                              </Label>
                              <Input
                                id={inputId}
                                value={edit.value}
                                onChange={(event) =>
                                  updateField(key, {
                                    value: event.target.value,
                                  })
                                }
                                placeholder={placeholder}
                                disabled={edit.clear}
                                aria-invalid={missingValue}
                              />
                              {missingValue && (
                                <p className="text-xs text-destructive">
                                  {t.controlRoom.bulkDetailsValorObrigatorio}
                                </p>
                              )}
                            </div>
                            <div className="flex items-start gap-2">
                              <Checkbox
                                id={clearId}
                                checked={edit.clear}
                                onCheckedChange={(checked) =>
                                  updateField(key, {
                                    clear: checked === true,
                                  })
                                }
                              />
                              <div className="grid gap-0.5">
                                <Label htmlFor={clearId}>
                                  {t.controlRoom.bulkDetailsLimpar}
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                  {t.controlRoom.bulkDetailsLimparDescricao}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* #278 S3c: categorias do Outlook em lote (add/remove). */}
                <div className="grid gap-3 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Tag className="size-4 text-muted-foreground" />
                    <Label>{t.controlRoom.bulkCategoriasSecao}</Label>
                  </div>
                  <BulkCategoriaPicker
                    label={t.controlRoom.bulkCategoriasAdicionar}
                    placeholder={t.controlRoom.peopleCategoriaAdd}
                    emptyText={t.controlRoom.peopleCategoriaVazio}
                    selected={catAdd}
                    categorias={peopleCategorias}
                    onToggle={(nome) => toggleCat(setCatAdd, setCatRemove, nome)}
                  />
                  <BulkCategoriaPicker
                    label={t.controlRoom.bulkCategoriasRemover}
                    placeholder={t.controlRoom.peopleCategoriaAdd}
                    emptyText={t.controlRoom.peopleCategoriaVazio}
                    selected={catRemove}
                    categorias={peopleCategorias}
                    onToggle={(nome) => toggleCat(setCatRemove, setCatAdd, nome)}
                  />
                </div>

                {validationAttempted &&
                  enabledFields.length === 0 &&
                  !hasCatChanges && (
                    <p className="text-sm text-destructive">
                      {t.controlRoom.bulkDetailsSelecioneCampo}
                    </p>
                  )}
              </>
            ) : (
              <>
                <div>
                  <h3 className="text-sm font-medium">
                    {t.controlRoom.bulkDetailsPreviewTitulo}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t.controlRoom.bulkDetailsPreviewDescricao}
                  </p>
                </div>

                <ul className="grid gap-2 text-sm">
                  <li className="flex items-center justify-between gap-3">
                    <span>{t.controlRoom.bulkDetailsSelecionados}</span>
                    <Badge variant="secondary">{contacts.length}</Badge>
                  </li>
                  <li className="flex items-center justify-between gap-3">
                    <span>{t.controlRoom.bulkDetailsEditaveis}</span>
                    <Badge variant="outline">{editableCount}</Badge>
                  </li>
                  <li className="flex items-center justify-between gap-3">
                    <span>{t.controlRoom.bulkDetailsSomenteLeitura}</span>
                    <Badge variant="outline">{readOnlyCount}</Badge>
                  </li>
                </ul>

                <Separator />

                <ul className="grid gap-2">
                  {enabledFields.map(({ key, label }) => (
                    <li
                      key={key}
                      className="grid gap-1 rounded-lg border p-3 text-sm"
                    >
                      <span className="font-medium">{label}</span>
                      <span className="break-words text-muted-foreground">
                        {edits[key].clear
                          ? t.controlRoom.bulkDetailsLimparValor
                          : preencher(t.controlRoom.bulkDetailsDefinirComo, {
                              valor: edits[key].value.trim(),
                            })}
                      </span>
                    </li>
                  ))}
                </ul>

                {hasCatChanges && (
                  <ul className="grid gap-2">
                    {catAdd.length > 0 && (
                      <li className="grid gap-1.5 rounded-lg border p-3 text-sm">
                        <span className="font-medium">
                          {t.controlRoom.bulkCategoriasAdicionar}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {catAdd.map((nome) => (
                            <Badge key={nome} variant="secondary">
                              {nome}
                            </Badge>
                          ))}
                        </div>
                      </li>
                    )}
                    {catRemove.length > 0 && (
                      <li className="grid gap-1.5 rounded-lg border p-3 text-sm">
                        <span className="font-medium">
                          {t.controlRoom.bulkCategoriasRemover}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {catRemove.map((nome) => (
                            <Badge key={nome} variant="outline">
                              {nome}
                            </Badge>
                          ))}
                        </div>
                      </li>
                    )}
                  </ul>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
          {step === "edit" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t.controlRoom.orgsCancelar}
              </Button>
              <Button onClick={goToPreview}>
                {t.controlRoom.bulkDetailsContinuar}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("edit")}
                disabled={saving}
              >
                {t.controlRoom.bulkOrgVoltar}
              </Button>
              <Button onClick={() => void apply()} disabled={saving}>
                {saving && <Spinner />}
                {t.controlRoom.bulkDetailsConfirmar}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function PeopleView({
  userEmail,
  onGrantAccess,
  onCompose,
  onReauthenticate,
}: {
  userEmail: string;
  onGrantAccess: () => void;
  onCompose: (email: string) => void;
  onReauthenticate: () => void;
}) {
  const { t } = useIdioma();
  const contacts = useAppStore((state) => state.peopleContacts);
  const organizations = useAppStore((state) => state.organizations);
  const loadOrganizationLogo = useAppStore(
    (state) => state.loadOrganizationLogo,
  );
  const selectedId = useAppStore((state) => state.peopleSelectedId);
  const selectPerson = useAppStore((state) => state.selectPerson);
  const loading = useAppStore((state) => state.peopleLoading);
  const loaded = useAppStore((state) => state.peopleLoaded);
  const error = useAppStore((state) => state.peopleError);
  const missingScopes = useAppStore((state) => state.peopleMissingScopes);
  const nextLinks = useAppStore((state) => state.peopleNextLinks);
  const fetchingMore = useAppStore((state) => state.peopleFetchingMore);
  const directory = useAppStore((state) => state.peopleDirectory);
  const directoryLoading = useAppStore(
    (state) => state.peopleDirectoryLoading,
  );
  const directoryLoaded = useAppStore((state) => state.peopleDirectoryLoaded);
  const directoryError = useAppStore((state) => state.peopleDirectoryError);
  const directoryMissingScopes = useAppStore(
    (state) => state.peopleDirectoryMissingScopes,
  );
  const hydratePeopleM365 = useAppStore((state) => state.hydratePeopleM365);
  const peopleSessionGeneration = useAppStore(
    (state) => state.peopleSessionGeneration,
  );
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
  const peopleSelectedCategory = useAppStore(
    (state) => state.peopleSelectedCategory,
  );
  const selectedGroupId = useAppStore(
    (state) => state.peopleSelectedGroupId,
  );
  const groupMembersById = useAppStore(
    (state) => state.peopleGroupMembersById,
  );
  const groupMembersLoadingId = useAppStore(
    (state) => state.peopleGroupMembersLoadingId,
  );
  const groupMembersError = useAppStore(
    (state) => state.peopleGroupMembersError,
  );
  const groups = useAppStore((state) => state.peopleGroups);
  const selectPeopleGroup = useAppStore((state) => state.selectPeopleGroup);
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
    "columns",
  ]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [keyboardActiveId, setKeyboardActiveId] = useState<string | null>(null);
  const tableFocusRef = useRef<HTMLDivElement>(null);
  const selectionAnchorRef = useRef<string | null>(null);
  const [assignOrgOpen, setAssignOrgOpen] = useState(false);
  const [bulkEditDetailsOpen, setBulkEditDetailsOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const { getFoto, pedirFotos } = useFotos();
  // Mede o shell estável do MÓDULO (não a aba nem a janela): Contacts e
  // Organizations alternam o conteúdo interno, mas este elemento nunca desmonta.
  // Assim o observer não fica preso num container removido ao trocar de aba.
  const detailContainerRef = useRef<HTMLElement>(null);
  const [moduleWidth, setModuleWidth] = useState(0);
  const groupMembers =
    selectedGroupId == null
      ? EMPTY_CONTACTS
      : (groupMembersById[selectedGroupId] ?? EMPTY_CONTACTS);
  // #406: aba "category" filtra os contatos pessoais pela categoria escolhida.
  const categoryContacts =
    peopleTab === "category" && peopleSelectedCategory
      ? contacts.filter((c) => c.categories.includes(peopleSelectedCategory))
      : EMPTY_CONTACTS;
  const visibleContacts =
    peopleTab === "groups"
      ? groupMembers
      : peopleTab === "directory"
        ? directory
        : peopleTab === "category"
          ? categoryContacts
          : contacts;
  const activeGroup =
    groups.find((group) => group.id === selectedGroupId) ?? null;
  const groupMembersLoading =
    peopleTab === "groups" &&
    selectedGroupId != null &&
    groupMembersLoadingId === selectedGroupId;
  const listLoading =
    peopleTab === "groups"
      ? groupMembersLoading
      : peopleTab === "directory"
        ? directoryLoading
        : loading;
  const listLoaded =
    peopleTab === "groups"
      ? !groupMembersLoading
      : peopleTab === "directory"
        ? directoryLoaded
        : loaded;
  const canLoadMore = peopleTab === "contacts" && nextLinks.length > 0;

  useEffect(() => {
    setRowSelection({});
    setKeyboardActiveId(null);
    selectionAnchorRef.current = null;
  }, [peopleSessionGeneration]);
  useEffect(() => {
    setRowSelection({});
    setKeyboardActiveId(null);
    selectionAnchorRef.current = null;
  }, [peopleTab]);
  const activeMissingScopes =
    peopleTab === "directory"
      ? directoryMissingScopes
      : peopleTab === "contacts"
        ? missingScopes
        : [];

  useLayoutEffect(() => {
    const el = detailContainerRef.current;
    if (!el) return;

    const updateWidth = (width: number) => {
      // O Control Room permanece montado quando outra área está ativa. Não
      // rebaixa um split válido para stacked só porque um ancestral ficou
      // temporariamente `display:none`; o observer atualizará ao reaparecer.
      if (width > 0) setModuleWidth(width);
    };

    updateWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) updateWidth(entry.contentRect.width);
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
    for (const organization of organizations) {
      if (!organization.logo) void loadOrganizationLogo(organization.id);
    }
  }, [loadOrganizationLogo, organizations]);

  useEffect(() => {
    pedirFotos(visibleContacts.map((contact) => contact.emails[0]?.address));
  }, [pedirFotos, visibleContacts]);

  const organizationDataByContactId = useMemo(
    () =>
      new Map(
        visibleContacts.map((contact) => [
          contact.id,
          {
            label: contactOrganizationLabel(organizations, contact),
            organization: resolveContactOrganization(organizations, contact),
          },
        ]),
      ),
    [organizations, visibleContacts],
  );

  const filterFields = useMemo<FilterFieldConfig<string>[]>(() => {
    const operators: FilterOperator[] = [
      { value: "is", label: t.controlRoom.filtroOperadorIs },
      { value: "is_not", label: t.controlRoom.filtroOpNaoE },
    ];
    const companyLabels = [
      ...visibleContacts.map((contact) =>
        contactOrganizationLabel(organizations, contact),
      ),
      ...organizations.map((organization) => organization.name),
    ].filter((value): value is string => Boolean(value?.trim()));
    const companyOptions: FilterOption<string>[] = Array.from(
      new Map(
        companyLabels.map((label) => [
          label.trim().toLocaleLowerCase(),
          label.trim(),
        ]),
      ).values(),
    )
      .sort((a, b) => String(a).localeCompare(String(b)))
      .map((company) => ({
        value: String(company).toLocaleLowerCase(),
        label: String(company),
      }));
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
        searchable: true,
        operators,
        options: organizations
          .map((organization) => ({
            value: organization.id,
            label: organization.name,
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
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
          {
            value: "contacts",
            label: t.controlRoom.peopleFilterSourceContacts,
          },
          {
            value: "people",
            label: t.controlRoom.peopleFilterSourcePeople,
          },
          {
            value: "directory",
            label: t.controlRoom.peopleSourceDirectory,
          },
        ],
      },
    ];
  }, [organizations, t, visibleContacts]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => {
    const next = visibleContacts.filter((contact) => {
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
          const label = contactOrganizationLabel(organizations, contact);
          matches = Boolean(
            label && values.has(label.trim().toLocaleLowerCase()),
          );
        } else if (filter.field === "relationship") {
          const organization = resolveContactOrganization(organizations, contact);
          matches = Boolean(organization && values.has(organization.id));
        } else if (filter.field === "phone") {
          matches = values.has(contact.phones.length > 0 ? "yes" : "no");
        } else if (filter.field === "source") {
          matches = contact.sources.some((source) => values.has(source));
        }
        return filter.operator === "is_not" ? !matches : matches;
      });
    });
    return next;
  }, [filters, normalizedQuery, organizations, visibleContacts]);

  const selectedContacts = useMemo(
    () =>
      peopleTab === "directory"
        ? EMPTY_CONTACTS
        : filtered.filter((contact) => rowSelection[contact.id]),
    [filtered, peopleTab, rowSelection],
  );

  const selected =
    visibleContacts.find((contact) => contact.id === selectedId) ?? null;

  useEffect(() => {
    if (
      keyboardActiveId &&
      !filtered.some((contact) => contact.id === keyboardActiveId)
    ) {
      setKeyboardActiveId(null);
      selectionAnchorRef.current = null;
    }
  }, [filtered, keyboardActiveId]);

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
          const organizationData = organizationDataByContactId.get(contact.id);
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar className="size-9">
                {photo && <AvatarImage src={photo} alt={contact.name} />}
                <AvatarFallback>{initials(contact.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{contact.name}</span>
                  <RelationshipBadges
                    contact={contact}
                    organizationLabel={organizationData?.label}
                    organizationLogo={organizationData?.organization?.logo}
                    compact
                  />
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
    [
      getFoto,
      organizationDataByContactId,
      t,
    ],
  );
  const activeColumns = useMemo(
    () =>
      peopleTab === "directory"
        ? columns.filter((column) => column.id !== "select")
        : columns,
    [columns, peopleTab],
  );

  const table = useReactTable({
    data: filtered,
    columns: activeColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
    enableRowSelection: peopleTab !== "directory",
    enableMultiRowSelection: peopleTab !== "directory",
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

  const activeRowIndex = keyboardActiveId
    ? table.getRowModel().rows.findIndex((row) => row.id === keyboardActiveId)
    : -1;
  const tableRows = table.getRowModel().rows;

  function handleTableKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;

    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (event.key === "Escape") {
      handled();
      setRowSelection({});
      selectionAnchorRef.current = null;
      return;
    }

    if (
      peopleTab !== "directory" &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLocaleLowerCase() === "a"
    ) {
      handled();
      table.toggleAllPageRowsSelected(true);
      if (!keyboardActiveId && tableRows[0]) {
        setKeyboardActiveId(tableRows[0].id);
      }
      selectionAnchorRef.current =
        keyboardActiveId ?? tableRows[0]?.id ?? null;
      return;
    }

    if (tableRows.length === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      handled();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const currentIndex =
        activeRowIndex >= 0
          ? activeRowIndex
          : direction > 0
            ? -1
            : tableRows.length;
      const nextIndex = Math.max(
        0,
        Math.min(tableRows.length - 1, currentIndex + direction),
      );
      const nextRow = tableRows[nextIndex];
      if (!nextRow) return;

      if (event.shiftKey && peopleTab !== "directory") {
        const anchorId =
          selectionAnchorRef.current ?? keyboardActiveId ?? nextRow.id;
        const anchorIndex = tableRows.findIndex((row) => row.id === anchorId);
        const rangeStart = Math.min(
          anchorIndex >= 0 ? anchorIndex : nextIndex,
          nextIndex,
        );
        const rangeEnd = Math.max(
          anchorIndex >= 0 ? anchorIndex : nextIndex,
          nextIndex,
        );
        setRowSelection((current) => {
          const next = { ...current };
          for (let index = rangeStart; index <= rangeEnd; index += 1) {
            const row = tableRows[index];
            if (row) next[row.id] = true;
          }
          return next;
        });
        selectionAnchorRef.current = anchorId;
      } else {
        selectionAnchorRef.current = nextRow.id;
      }
      setKeyboardActiveId(nextRow.id);
      return;
    }

    if (event.key === " ") {
      if (peopleTab === "directory") return;
      handled();
      const activeRow =
        (activeRowIndex >= 0 ? tableRows[activeRowIndex] : null) ?? tableRows[0];
      if (!activeRow) return;
      setKeyboardActiveId(activeRow.id);
      selectionAnchorRef.current = activeRow.id;
      setRowSelection((current) => ({
        ...current,
        [activeRow.id]: !current[activeRow.id],
      }));
      return;
    }

    if (event.key === "Enter") {
      handled();
      const activeRow =
        (activeRowIndex >= 0 ? tableRows[activeRowIndex] : null) ?? tableRows[0];
      if (activeRow) {
        setKeyboardActiveId(activeRow.id);
        selectPerson(activeRow.id);
      }
    }
  }

  const sortMode =
    sorting.some((item) => item.id === "name") ? "az" : "relevance";

  return (
    <section
      ref={detailContainerRef}
      className="@container/people flex min-h-0 min-w-0 flex-1 flex-col gap-3"
    >
      {peopleTab === "organizations" ? (
        <OrganizationsView contacts={contacts} />
      ) : (
        <>
      <AssignToOrganizationSheet
        open={assignOrgOpen}
        contacts={selectedContacts}
        onOpenChange={setAssignOrgOpen}
        onDone={() => {
          setAssignOrgOpen(false);
          table.resetRowSelection();
        }}
      />
      <BulkEditDetailsSheet
        open={bulkEditDetailsOpen}
        contacts={selectedContacts}
        onOpenChange={setBulkEditDetailsOpen}
        onDone={() => {
          setBulkEditDetailsOpen(false);
          table.resetRowSelection();
        }}
      />
      <ContactMergeSheet
        open={mergeOpen}
        contacts={selectedContacts}
        onOpenChange={setMergeOpen}
        onDone={() => {
          setMergeOpen(false);
          table.resetRowSelection();
        }}
      />

      {activeMissingScopes.length > 0 && (
        <Alert variant="warning">
          <KeyRound />
          <AlertTitle>{t.controlRoom.peopleSemPermissao}</AlertTitle>
          <AlertDescription>
            {preencher(t.controlRoom.peopleSemPermissaoDesc, {
              escopos: activeMissingScopes.join(" + "),
            })}
          </AlertDescription>
          <AlertAction>
            <Button size="sm" onClick={onGrantAccess}>
              {t.controlRoom.peopleConcederAcesso}
            </Button>
          </AlertAction>
        </Alert>
      )}

      {peopleTab === "contacts" && error && (
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

      {peopleTab === "directory" && directoryError && (
        <Alert variant="destructive">
          <AlertTitle>{t.controlRoom.peopleDirectoryError}</AlertTitle>
          <AlertDescription>{directoryError}</AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void hydratePeopleM365({ force: true })}
            >
              {t.controlRoom.peopleTentarNovamente}
            </Button>
          </AlertAction>
        </Alert>
      )}

      {peopleTab === "groups" && groupMembersError && selectedGroupId && (
        <Alert variant="destructive">
          <AlertTitle>{t.controlRoom.peopleGroupsError}</AlertTitle>
          <AlertDescription>{groupMembersError}</AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void selectPeopleGroup(selectedGroupId)}
            >
              {t.controlRoom.peopleTentarNovamente}
            </Button>
          </AlertAction>
        </Alert>
      )}

      <div className="flex min-h-0 flex-1">
        {(() => {
          const listPane = (
            <Frame
              className="h-full min-h-0 min-w-0 overflow-hidden"
              stacked
              dense
            >
              <FramePanel
                fit
                className="flex shrink-0 items-center gap-2 px-3 py-3"
              >
                <h2 className="text-sm font-semibold">
                  {peopleTab === "groups"
                    ? activeGroup?.name ?? t.controlRoom.peopleGroupsSection
                    : t.controlRoom.peopleContactsTab}
                </h2>
                <Badge variant="secondary" size="sm">
                  {filtered.length}
                </Badge>
                <Toolbar
                  aria-label={t.controlRoom.peopleContactsTab}
                  className="ml-auto gap-1"
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
                </Toolbar>
              </FramePanel>
              {peopleTab !== "directory" && selectedContacts.length > 0 && (
                <FramePanel
                  fit
                  className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-secondary/40 px-2 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {preencher(t.controlRoom.peopleBulkSelecionados, {
                        n: selectedContacts.length,
                      })}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => table.resetRowSelection()}
                    >
                      {t.controlRoom.peopleBulkLimpar}
                    </Button>
                  </div>
                  <Toolbar aria-label={t.controlRoom.peopleBulkAcoes}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm">
                          {t.controlRoom.peopleBulkMaisOpcoes}
                          <ChevronDown
                            aria-hidden="true"
                            className="size-3.5 opacity-60"
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          onSelect={() => setAssignOrgOpen(true)}
                        >
                          <Building2 />
                          {t.controlRoom.peopleBulkAtribuirOrg}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={selectedContacts.length < 2}
                          onSelect={() => setMergeOpen(true)}
                        >
                          <GitMerge />
                          {t.controlRoom.peopleBulkMesclar}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={selectedContacts.length < 2}
                          onSelect={() => setBulkEditDetailsOpen(true)}
                        >
                          <Pencil />
                          {t.controlRoom.peopleBulkEditarDetalhes}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Toolbar>
                </FramePanel>
              )}
              <FramePanel className="min-h-0 p-0">
                {filtered.length === 0 && !(listLoading && !listLoaded) ? (
                  peopleTab === "groups" &&
                  !normalizedQuery &&
                  filters.length === 0 ? (
                    <PeopleGroupEmpty selected={selectedGroupId != null} />
                  ) : activeMissingScopes.length > 0 ? (
                    <PeoplePermissionEmpty />
                  ) : (
                    <PeopleEmpty
                      search={Boolean(normalizedQuery)}
                      filtered={filters.length > 0}
                      directory={peopleTab === "directory"}
                      onClear={() => {
                        setPeopleSearchQuery("");
                        setFilters([]);
                      }}
                    />
                  )
                ) : view === "table" || (listLoading && !listLoaded) ? (
                  <DataGrid
                    table={table}
                    recordCount={filtered.length}
                    activeRowId={keyboardActiveId}
                    isLoading={listLoading && !listLoaded}
                    loadingMode="skeleton"
                    emptyMessage={
                      activeMissingScopes.length > 0 ? (
                        <PeoplePermissionEmpty />
                      ) : (
                        <PeopleEmpty
                          search={Boolean(normalizedQuery)}
                          filtered={filters.length > 0}
                          directory={peopleTab === "directory"}
                          onClear={() => {
                            setPeopleSearchQuery("");
                            setFilters([]);
                          }}
                        />
                      )
                    }
                    onRowClick={(contact) => {
                      tableFocusRef.current?.focus({ preventScroll: true });
                      setKeyboardActiveId(contact.id);
                      selectPerson(contact.id);
                      selectionAnchorRef.current = contact.id;
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
                    <div
                      ref={tableFocusRef}
                      role="region"
                      tabIndex={0}
                      aria-label={t.controlRoom.peopleContactsTab}
                      onKeyDown={handleTableKeyDown}
                      onFocus={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (keyboardActiveId) return;
                        const initialId =
                          (selectedId &&
                          tableRows.some((row) => row.id === selectedId)
                            ? selectedId
                            : tableRows[0]?.id) ?? null;
                        setKeyboardActiveId(initialId);
                        selectionAnchorRef.current = initialId;
                      }}
                      className="h-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                    >
                      <DataGridContainer className="h-full">
                        <ScrollArea className="h-full">
                          <DataGridTableVirtual
                            onFetchMore={() => {
                              if (peopleTab === "contacts") {
                                void loadMorePeople();
                              }
                            }}
                            isFetchingMore={
                              peopleTab === "contacts" && fetchingMore
                            }
                            hasMore={canLoadMore}
                            fetchMoreOffset={8}
                            estimateSize={48}
                            overscan={8}
                            scrollToRowIndex={
                              activeRowIndex >= 0 ? activeRowIndex : undefined
                            }
                          />
                        </ScrollArea>
                      </DataGridContainer>
                    </div>
                  </DataGrid>
                ) : (
                  <div className="h-full overflow-auto p-3">
                    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                      {filtered.map((contact) => (
                        <PeopleCard
                          key={contact.id}
                          contact={contact}
                          organizationLabel={
                            organizationDataByContactId.get(contact.id)?.label
                          }
                          organizationLogo={
                            organizationDataByContactId.get(contact.id)
                              ?.organization?.logo
                          }
                          selected={contact.id === selectedId}
                          photo={
                            contact.photo ||
                            getFoto(contact.emails[0]?.address) ||
                            null
                          }
                          onSelect={() => selectPerson(contact.id)}
                          onCompose={onCompose}
                        />
                      ))}
                    </div>
                    {canLoadMore && (
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
                )}
              </FramePanel>
            </Frame>
          );

          const detailPane =
            listLoading && !listLoaded ? (
              <PeopleDetailSkeleton />
            ) : selected ? (
              <PeopleDetail
                key={selected.id}
                contact={selected}
                photo={getFoto(selected.emails[0]?.address) ?? null}
                userEmail={userEmail}
                onBack={() => selectPerson(null)}
                onCompose={onCompose}
                onReauthenticate={onReauthenticate}
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
