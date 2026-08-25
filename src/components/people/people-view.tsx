"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  ArrowUpDown,
  Building2,
  ChevronDown,
  Copy,
  ExternalLink,
  FunnelX,
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
  Sparkles,
  Users,
} from "lucide-react";
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
import { montarGridI18n } from "@/lib/reui-i18n";
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
// #468: empty-states padronizadas no componente reui `Empty` + ilustração do
// registry (NodesIllustration = c-empty-19, theme-aware). Mesmo padrão da "Caixa
// limpa" do mail e do Accounts em Settings.
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { NodesIllustration } from "@/components/examples/c-empty-19";
import { IconTile } from "@/components/reui/icon-tile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Toolbar,
  ToolbarButton,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { OrganizationsView } from "@/components/people/organizations-view";
import { GroupsView } from "@/components/people/groups-view";
import { PersonalGroupsView } from "@/components/people/personal-groups-view";
import { ContactMergeSheet } from "@/components/people/contact-merge-sheet";
import { AssignToOrganizationSheet } from "@/components/people/assign-organization-sheet";
import { useFotos } from "@/lib/fotos";
import { iniciais } from "@/lib/iniciais";
import { useIdioma, preencher } from "@/lib/idioma";
import { useTier } from "@/lib/tier-context";
import { RecursoOrgEmpty } from "@/components/recurso-org-empty";
import { type PeopleContact } from "@/lib/people";
import {
  contactOrganizationLabel,
  resolveContactOrganization,
  } from "@/lib/organizations";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";
import { PeopleDetail } from "./people-detail";
import { BulkEditDetailsSheet } from "./bulk-edit-details-sheet";
import { RelationshipBadges, SourceBadge, } from "./people-shared";
import { copyText } from "./people-copiar";

const EMPTY_CONTACTS: PeopleContact[] = [];

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
  const buscando = search || filtered;
  return (
    <Empty className="min-h-56">
      <EmptyHeader>
        <EmptyMedia>
          <NodesIllustration />
        </EmptyMedia>
        <EmptyTitle>
          {buscando
            ? t.controlRoom.peopleSemResultado
            : directory
              ? t.controlRoom.peopleDirectoryEmpty
              : t.controlRoom.peopleVazio}
        </EmptyTitle>
        {!buscando && (
          <EmptyDescription>
            {directory
              ? t.controlRoom.peopleDirectoryEmptyDesc
              : t.controlRoom.peopleVazioDesc}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {buscando && (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onClear}>
            {filtered ? t.controlRoom.peopleClearFilters : t.controlRoom.peopleLimparBusca}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

function PeoplePermissionEmpty({ mensagem }: { mensagem?: string }) {
  const { t } = useIdioma();
  return (
    <div className="flex h-full min-h-56 w-full flex-col items-center justify-center px-6 text-center">
      <IconTile className="mb-3" variant="frame" size="lg">
        <KeyRound />
      </IconTile>
      <p className="font-medium">{mensagem ?? t.controlRoom.peopleSemPermissao}</p>
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

// #578 rework: exportado pra o GroupsView reusar o MESMO card de contato nos
// membros do grupo (o PO pediu o grid de contatos, não uma lista).
export function PeopleCard({
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
          <AvatarFallback>
            {iniciais(contact.name, contact.emails[0]?.address)}
          </AvatarFallback>
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
  // #1058: i18n do DataGrid (menu de coluna + aria-labels). Memoizado por idioma
  // (t é estável) para não republicar o context do grid a cada render.
  const gridI18n = useMemo(() => montarGridI18n(t.grid), [t]);
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
  // #712 (PS6 follow-on): diretório da org é feature de ORG — gate por tier.
  const { recursoOrgDisponivel } = useTier();
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
  // #495: caixa selecionada + a que os dados atuais pertencem (reload ao trocar).
  const caixaAtiva = useAppStore((state) => state.caixaAtiva);
  const caixaDadosPeople = useAppStore((state) => state.peopleCaixaDados);
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
  // #417 (P0): MEMOIZAR — sem isto o filtro inline gera um array NOVO a cada
  // render; a referência instável entra na DataGrid virtualizada (efeitos
  // por-commit sem dep estável) e trava o app (mesma classe do #416, o filtro
  // por domínio). As outras fontes (contacts/directory/groupMembers) já são
  // refs estáveis do store — esta era a única derivada inline.
  const categoryContacts = useMemo(
    () =>
      peopleTab === "category" && peopleSelectedCategory
        ? contacts.filter((c) => c.categories.includes(peopleSelectedCategory))
        : EMPTY_CONTACTS,
    [peopleTab, peopleSelectedCategory, contacts],
  );
  const visibleContacts =
    peopleTab === "groups"
      ? groupMembers
      : peopleTab === "directory"
        ? directory
        : peopleTab === "category"
          ? categoryContacts
          : contacts;
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
  // #495: caixa compartilhada sem permissão (403) → empty gracioso em vez de
  // "nenhum contato" (que dá a impressão errada de caixa vazia).
  const semAcessoCaixa =
    caixaAtiva !== "me" && !!error && /403|forbidden/i.test(error);

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

  // #495: carrega na 1ª vez E recarrega quando a caixa selecionada muda
  // (contatos seguem a caixa; `peopleCaixaDados !== caixaAtiva` = dados de outra
  // caixa, precisa recarregar). O `loadPeople` limpa e busca pra caixa atual.
  useEffect(() => {
    if ((!loaded && !loading) || caixaDadosPeople !== caixaAtiva) {
      void loadPeople();
    }
  }, [loadPeople, loaded, loading, caixaAtiva, caixaDadosPeople]);

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
                <AvatarFallback>
                  {iniciais(contact.name, contact.emails[0]?.address)}
                </AvatarFallback>
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

  // #1020: handlers do grid memoizados. O único que MOVE o ponteiro é
  // `handleFetchMore` — ele é prop do `MemoizedVirtualBody` (`memo(...)` em
  // data-grid-table-virtual.tsx:575), então inline (novo a cada render) quebra
  // esse memo e re-renderiza o corpo virtual a cada render de PeopleView.
  // `handleRowClick` o grid já EXCLUI do seu context-memo (data-grid.tsx:289) e
  // `tableLayout` ele compara por `JSON.stringify` (data-grid.tsx:315) — nenhum
  // dos dois quebra memo; memoizo por consistência + evitar trabalho por render.
  const handleRowClick = useCallback(
    (contact: PeopleContact) => {
      tableFocusRef.current?.focus({ preventScroll: true });
      setKeyboardActiveId(contact.id);
      selectPerson(contact.id);
      selectionAnchorRef.current = contact.id;
    },
    [selectPerson],
  );
  const handleFetchMore = useCallback(() => {
    if (peopleTab === "contacts") {
      void loadMorePeople();
    }
  }, [peopleTab, loadMorePeople]);
  const tableLayout = useMemo(
    () => ({
      dense: true,
      stripped: true,
      rowBorder: false,
      headerBackground: true,
      headerSticky: true,
      columnsVisibility: true,
      columnsResizable: true,
      columnsResizeMode: "onChange" as const,
      columnsMovable: true,
      width: "fixed" as const,
    }),
    [],
  );

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
      ) : peopleTab === "groups" ? (
        // #578: Groups vira visão própria (grid → detalhe com membros), como o
        // OrganizationsView — sai do caminho do DataGrid de contatos.
        <GroupsView onCompose={onCompose} />
      ) : peopleTab === "personalGroups" ? (
        // #562: grupos de contato pessoais (contactFolders) — seção editável.
        <PersonalGroupsView onCompose={onCompose} />
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

      {/* #578: o erro de membros de grupo agora é tratado no GroupsView (a aba
          "groups" tem visão própria); aqui só sobra o caminho de contatos. */}

      <div className="flex min-h-0 flex-1">
        {(() => {
          // #712 (PS6 follow-on): o diretório da organização é feature de ORG —
          // no tier pessoal/uncontracted vira empty-state de tier (não erro).
          if (peopleTab === "directory" && !recursoOrgDisponivel) {
            return <RecursoOrgEmpty className="m-4 flex-1" />;
          }
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
                  {t.controlRoom.peopleContactsTab}
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
                  semAcessoCaixa ? (
                    <PeoplePermissionEmpty
                      mensagem={t.controlRoom.peopleSemAcessoCaixa}
                    />
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
                    i18n={gridI18n}
                    emptyMessage={
                      semAcessoCaixa ? (
                        <PeoplePermissionEmpty
                          mensagem={t.controlRoom.peopleSemAcessoCaixa}
                        />
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
                    }
                    onRowClick={handleRowClick}
                    tableLayout={tableLayout}
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
                            onFetchMore={handleFetchMore}
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
              <Empty className="h-full min-h-0 rounded-xl border border-solid bg-card">
                <EmptyHeader>
                  <EmptyMedia>
                    <NodesIllustration />
                  </EmptyMedia>
                  <EmptyTitle>{t.controlRoom.peopleSelecionar}</EmptyTitle>
                  <EmptyDescription>
                    {t.controlRoom.peopleSelecionarDesc}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
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
              <ResizableHandle withHandle />
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
