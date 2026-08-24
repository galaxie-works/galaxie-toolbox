// #1020 (escopo decidido pela mira): `PeopleDetail` (708 linhas) sai do
// `people-view.tsx`. Extracao PURA — nenhuma logica muda.
//
// `DetailValue` e `ContactCategories` vem junto porque a teia medida mostrou
// uso EXCLUSIVO daqui (5 e 1 usos, zero fora). Criterio do altair: uso unico
// vai com o seam dono; so o que cruza seams DIFERENTES vai pro comum.
"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Mail,
  Pencil,
  MoreHorizontal,
  Phone,
  Plus,
  Save,
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
// #468: empty-states padronizadas no componente reui `Empty` + ilustração do
// registry (NodesIllustration = c-empty-19, theme-aware). Mesmo padrão da "Caixa
// limpa" do mail e do Accounts em Settings.
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
import { Spinner } from "@/components/ui/spinner";
import * as api from "@/lib/api";
import { iniciais } from "@/lib/iniciais";
import { useIdioma } from "@/lib/idioma";
import { type PeopleContact } from "@/lib/people";
import {
  contactDomain,
  contactOrganizationLabel,
  normalizeDomain,
  resolveContactOrganization,
  type PeopleOrg,
} from "@/lib/organizations";
import type {
  PeopleContactEdit,
  PeopleEnrichSource,
  PeopleInteraction,
} from "@/lib/types";
import { useAppStore } from "@/store";
import { RelationshipBadges, SourceBadge, } from "./people-shared";
import { copyText } from "./people-copiar";

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

export function PeopleDetail({
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
                  {iniciais(contact.name, contact.emails[0]?.address)}
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
