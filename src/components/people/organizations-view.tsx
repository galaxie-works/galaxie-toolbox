import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Info,
  Pencil,
  Plus,
  UserMinus,
  Users,
} from "lucide-react";

import {
  Autocomplete,
  AutocompleteInput,
} from "@/components/reui/autocomplete";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PersonHoverCard } from "@/components/people/person-hover-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
// #468: empty-states no componente reui `Empty` + ilustração do registry
// (NodesIllustration, theme-aware) — consistente com People e a "Caixa limpa".
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { NodesIllustration } from "@/components/examples/c-empty-19";
import {
  Frame,
  FramePanel,
} from "@/components/reui/frame";
import { Toolbar, ToolbarButton } from "@/components/ui/toolbar";
import { preencher, useIdioma } from "@/lib/idioma";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";
// #533: cache de fotos (mesmo padrão do #493/people-view) pro avatar do membro.
import { useFotos } from "@/lib/fotos";
import {
  contactDomain,
  organizationMembers,
  suggestedOrganizationName,
  type PeopleOrg,
  type PeopleOrgInput,
} from "@/lib/organizations";
import type { PeopleContact } from "@/lib/people";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";
import { toast } from "sonner";

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join("");
}

function splitDomains(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((domain) => domain.trim())
    .filter(Boolean);
}

function OrganizationForm({
  open,
  organization,
  contacts,
  onOpenChange,
}: {
  open: boolean;
  organization: PeopleOrg | null;
  contacts: PeopleContact[];
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useIdioma();
  const createOrganization = useAppStore((state) => state.createOrganization);
  const updateOrganization = useAppStore((state) => state.updateOrganization);
  const domainSuggestions = useMemo(
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
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    const firstDomain = organization?.domains.join(", ") ?? "";
    setName(
      organization?.name ||
        (domainSuggestions[0]
          ? suggestedOrganizationName(domainSuggestions[0], contacts)
          : ""),
    );
    setDomains(firstDomain || domainSuggestions[0] || "");
    setWebsite(organization?.website ?? "");
    setNotes(organization?.notes ?? "");
    setError(false);
  }, [contacts, domainSuggestions, open, organization]);

  const save = () => {
    const input: PeopleOrgInput = {
      name,
      domains: splitDomains(domains),
      website,
      notes,
    };
    if (!name.trim()) {
      setError(true);
      return;
    }
    if (organization) {
      updateOrganization(organization.id, input);
      toast.success(t.controlRoom.orgsAtualizada);
    } else {
      createOrganization(input);
      toast.success(t.controlRoom.orgsCriada);
    }
    onOpenChange(false);
  };

  const form = (
    <>
      <div className="grid gap-2">
        <Label htmlFor="organization-name">{t.controlRoom.orgsNome}</Label>
        <Input
          id="organization-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t.controlRoom.orgsNomePlaceholder}
          autoFocus
        />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="organization-domains">
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
          id="organization-domains"
          value={domains}
          onChange={(event) => setDomains(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              setDomains((current) => `${current.trim()}, `);
            }
          }}
          list="organization-domain-suggestions"
          placeholder={t.controlRoom.orgsDominiosPlaceholder}
        />
        <datalist id="organization-domain-suggestions">
          {domainSuggestions.map((domain) => (
            <option key={domain} value={domain} />
          ))}
        </datalist>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="organization-website">{t.controlRoom.orgsWebsite}</Label>
        <Input
          id="organization-website"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          placeholder="https://"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="organization-notes">{t.controlRoom.orgsNotas}</Label>
        <Textarea
          id="organization-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
      {error && (
        <p className="text-sm text-destructive">
          {t.controlRoom.orgsErroCampos}
        </p>
      )}
    </>
  );

  const actions = (
    <>
      <Button variant="outline" onClick={() => onOpenChange(false)}>
        {t.controlRoom.orgsCancelar}
      </Button>
      <Button onClick={save}>
        {organization ? t.controlRoom.orgsSalvar : t.controlRoom.orgsCriar}
      </Button>
    </>
  );

  if (organization) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.controlRoom.orgsEditarTitulo}</DialogTitle>
            <DialogDescription>{t.controlRoom.orgsDescricao}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">{form}</div>
          <DialogFooter>{actions}</DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="pr-6 text-left">
            {t.controlRoom.orgsCriarTitulo}
          </SheetTitle>
          <SheetDescription className="text-left">
            {t.controlRoom.orgsDescricao}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scrollbar-fina px-4 py-4">
          {form}
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
          {actions}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AssignContactsDialog({
  open,
  organization,
  contacts,
  onOpenChange,
}: {
  open: boolean;
  organization: PeopleOrg;
  contacts: PeopleContact[];
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useIdioma();
  const assign = useAppStore((state) => state.assignOrganizationContacts);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelected(new Set(organizationMembers(organization, contacts).map((item) => item.id)));
    setQuery("");
  }, [contacts, open, organization]);

  const filtered = contacts.filter((contact) => {
    const haystack = [
      contact.name,
      contact.company,
      ...contact.emails.map((email) => email.address),
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(query.trim().toLocaleLowerCase());
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {preencher(t.controlRoom.orgsAtribuirTitulo, {
              nome: organization.name,
            })}
          </DialogTitle>
          <DialogDescription>{t.controlRoom.orgsDescricao}</DialogDescription>
        </DialogHeader>
        <Autocomplete
          items={filtered}
          value={query}
          onValueChange={setQuery}
          open={false}
          itemToStringValue={(item: unknown) => (item as PeopleContact).name}
          filter={null}
        >
          <AutocompleteInput
            placeholder={t.controlRoom.orgsBuscarContatos}
            aria-label={t.controlRoom.orgsBuscarContatos}
            showClear
          />
        </Autocomplete>
        <ScrollArea className="max-h-80 rounded-lg border">
          <div className="divide-y">
            {filtered.map((contact) => {
              const checked = selected.has(contact.id);
              return (
                <label
                  key={contact.id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-accent/50"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (value === true) next.add(contact.id);
                        else next.delete(contact.id);
                        return next;
                      })
                    }
                  />
                  <Avatar size="sm">
                    <AvatarFallback>{initials(contact.name)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{contact.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {contact.emails[0]?.address}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.controlRoom.orgsCancelar}
          </Button>
          <Button
            onClick={() => {
              assign(organization.id, [...selected], contacts);
              toast.success(t.controlRoom.orgsAtribuicoesSalvas);
              onOpenChange(false);
            }}
          >
            {t.controlRoom.orgsConfirmarAtribuicao}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OrganizationsView({
  contacts,
}: {
  contacts: PeopleContact[];
}) {
  const { t, idioma } = useIdioma();
  // #533: fotos dos membros vêm do mesmo cache (getFoto/pedirFotos) do #493.
  const { getFoto, pedirFotos } = useFotos();
  const organizations = useAppStore((state) => state.organizations);
  const selectedId = useAppStore((state) => state.organizationSelectedId);
  const selectOrganization = useAppStore((state) => state.selectOrganization);
  const removeMember = useAppStore(
    (state) => state.removeContactFromOrganization,
  );
  const selectPerson = useAppStore((state) => state.selectPerson);
  const setPeopleTab = useAppStore((state) => state.setPeopleTab);
  const query = useAppStore((state) => state.peopleSearchQuery);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PeopleOrg | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const filtered = organizations.filter((organization) =>
    [organization.name, ...organization.domains]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const selected =
    organizations.find((organization) => organization.id === selectedId) ?? null;
  // #535: membros em ordem alfabética (A→Z) por nome, com localeCompare ciente
  // do locale/acento (É/é/e ordenam junto). Sem nome → cai no e-mail como chave.
  // useMemo dá identidade estável pro effect de fotos (#533) não refazer o batch
  // a cada render. `selected`/`contacts` mudam → recomputa; `idioma` afeta a ordem.
  const members = useMemo(() => {
    const lista = selected ? organizationMembers(selected, contacts) : [];
    return [...lista].sort((a, b) => {
      const ka = a.name?.trim() || a.emails[0]?.address || "";
      const kb = b.name?.trim() || b.emails[0]?.address || "";
      return ka.localeCompare(kb, idioma, { sensitivity: "base" });
    });
  }, [selected, contacts, idioma]);
  // #533: popula o cache com as fotos dos membros (batch, dedup no próprio cache).
  // O `getFoto` no avatar abaixo lê o resultado; o useFotos re-renderiza ao chegar.
  useEffect(() => {
    pedirFotos(members.map((contact) => contact.emails[0]?.address));
  }, [pedirFotos, members]);
  const wide = width >= 768;
  const listMin = width ? Math.min(50, (340 / width) * 100) : 30;
  const detailMin = width ? Math.min(64, (420 / width) * 100) : 40;

  const listPane = (
    <Frame
      className="h-full min-h-0 overflow-hidden"
      stacked
      dense
    >
      <FramePanel
        fit
        className="flex min-h-11 shrink-0 items-center justify-between gap-2 px-2 py-1.5"
      >
        <Toolbar aria-label={t.controlRoom.peopleOrganizationsTab}>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus />
            {t.controlRoom.orgsNova}
          </Button>
        </Toolbar>
        <span className="text-xs text-muted-foreground">
          {filtered.length}
        </span>
      </FramePanel>
      <FramePanel className="min-h-0 p-0">
        <ScrollArea className="h-full min-h-0">
        {filtered.length === 0 ? (
          <Empty className="h-full min-h-72">
            <EmptyHeader>
              <EmptyMedia>
                <NodesIllustration />
              </EmptyMedia>
              <EmptyTitle>
                <SoftBlurIn delay={80} stagger={18}>
                  {t.controlRoom.orgsVazia}
                </SoftBlurIn>
              </EmptyTitle>
              <EmptyDescription>{t.controlRoom.orgsVaziaDesc}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="divide-y">
            {filtered.map((organization) => {
              const count = organizationMembers(organization, contacts).length;
              const active = organization.id === selectedId;
              return (
                <button
                  key={organization.id}
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => selectOrganization(organization.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50",
                    active && "bg-secondary",
                  )}
                >
                  <Avatar>
                    {organization.logo && (
                      <AvatarImage
                        src={organization.logo}
                        alt={organization.name}
                      />
                    )}
                    <AvatarFallback>
                      {initials(organization.name) || <Building2 className="size-4" />}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {organization.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {organization.domains.join(" · ")}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {preencher(t.controlRoom.orgsMembros, { n: count })}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        </ScrollArea>
      </FramePanel>
    </Frame>
  );

  const detailPane = selected ? (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="border-b bg-card px-4 py-3">
        {!wide && (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-2"
            onClick={() => selectOrganization(null)}
          >
            <ArrowLeft />
            {t.controlRoom.peopleOrganizationsTab}
          </Button>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar className="size-16">
              {selected.logo && (
                <AvatarImage src={selected.logo} alt={selected.name} />
              )}
              <AvatarFallback className="text-lg">
                {initials(selected.name) || <Building2 className="size-5" />}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h3 className="truncate text-xl font-semibold">{selected.name}</h3>
              <p className="truncate text-sm text-muted-foreground">
                {selected.domains.join(" · ")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Toolbar aria-label={t.controlRoom.orgsDetalhes}>
              <ToolbarButton
                variant="default"
                tooltip={t.controlRoom.orgsEditar}
                aria-label={t.controlRoom.orgsEditar}
                onClick={() => {
                  setEditing(selected);
                  setEditorOpen(true);
                }}
              >
                <Pencil />
              </ToolbarButton>
              <ToolbarButton
                variant="default"
                tooltip={t.controlRoom.orgsAbrirSite}
                aria-label={t.controlRoom.orgsAbrirSite}
                disabled={!selected.website}
                onClick={() =>
                  selected.website &&
                  window.open(selected.website, "_blank", "noopener,noreferrer")
                }
              >
                <ExternalLink />
              </ToolbarButton>
            </Toolbar>
            <Button onClick={() => setAssignOpen(true)}>
              <Users />
              {t.controlRoom.orgsAtribuir}
            </Button>
          </div>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <section className="space-y-3 p-4">
          <h4 className="text-sm font-semibold">
            {preencher(t.controlRoom.orgsMembros, { n: members.length })}
          </h4>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t.controlRoom.orgsSelecionarDesc}
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {members.map((contact) => {
                const memberEmail = contact.emails[0]?.address;
                const identidade = (
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => {
                      setPeopleTab("contacts");
                      selectPerson(contact.id);
                    }}
                  >
                    <Avatar size="sm">
                      {/* #533: puxa a foto do cache (getFoto); 404/sem foto cai
                          nas iniciais (o AvatarImage do Radix já degrada). */}
                      <AvatarImage src={getFoto(memberEmail) ?? undefined} alt="" />
                      <AvatarFallback>{initials(contact.name)}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {contact.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {contact.emails[0]?.address}
                      </span>
                    </span>
                  </button>
                );
                return (
                  <div key={contact.id} className="flex items-center gap-3 px-3 py-2.5">
                    {/* #478 rework: a identidade do membro abre o PersonHoverCard
                        (avatar/nome/ações). O botão continua abrindo o contato no
                        clique; o hover mostra o card. Sem email, fica o botão só. */}
                    {memberEmail ? (
                      <PersonHoverCard
                        email={memberEmail}
                        // #553: passa a foto do cache (getFoto) no fallback, igual
                        // às instâncias que funcionam (reader/participantes) — o
                        // PersonHoverCard lê `fallback.foto` (não resolve o cache
                        // sozinho), então sem isto o hover ficava só nas iniciais.
                        fallback={{
                          nome: contact.name,
                          email: memberEmail,
                          foto: getFoto(memberEmail) ?? undefined,
                        }}
                      >
                        {identidade}
                      </PersonHoverCard>
                    ) : (
                      identidade
                    )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t.controlRoom.orgsRemoverMembro}
                        onClick={() =>
                          removeMember(selected.id, contact.id, contacts)
                        }
                      >
                        <UserMinus />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t.controlRoom.orgsRemoverMembro}
                    </TooltipContent>
                  </Tooltip>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <Separator />
        <section className="space-y-4 p-4">
          <h4 className="text-sm font-semibold">{t.controlRoom.orgsDetalhes}</h4>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">{t.controlRoom.orgsDominios}</p>
              <p className="mt-1">{selected.domains.join(", ")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t.controlRoom.orgsWebsite}</p>
              <p className="mt-1">{selected.website || t.controlRoom.orgsSemDado}</p>
            </div>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t.controlRoom.orgsNotas}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">
              {selected.notes || t.controlRoom.orgsSemDado}
            </p>
          </div>
        </section>
      </ScrollArea>
      <AssignContactsDialog
        open={assignOpen}
        organization={selected}
        contacts={contacts}
        onOpenChange={setAssignOpen}
      />
    </div>
  ) : (
    <Empty className="h-full min-h-0 rounded-xl border border-solid bg-card">
      <EmptyHeader>
        <EmptyMedia>
          <NodesIllustration />
        </EmptyMedia>
        <EmptyTitle>{t.controlRoom.orgsSelecionar}</EmptyTitle>
        <EmptyDescription>{t.controlRoom.orgsSelecionarDesc}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div ref={containerRef} className="@container/organizations flex min-h-0 flex-1">
        {!wide ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {selected ? detailPane : listPane}
          </div>
        ) : (
          <ResizablePanelGroup
            autoSaveId="people.organizations.layout"
            direction="horizontal"
            className="min-h-0 flex-1"
          >
            <ResizablePanel
              defaultSize={38}
              minSize={listMin}
              className="min-w-0 overflow-hidden"
            >
              {listPane}
            </ResizablePanel>
            <ResizableHandle
              withHandle
              aria-label={t.controlRoom.orgsRedimensionar}
              className="mx-1.5 bg-transparent hover:bg-border"
            />
            <ResizablePanel
              defaultSize={62}
              minSize={detailMin}
              className="min-w-0 overflow-hidden"
            >
              {detailPane}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
      <OrganizationForm
        open={editorOpen}
        organization={editing}
        contacts={contacts}
        onOpenChange={setEditorOpen}
      />
    </div>
  );
}
