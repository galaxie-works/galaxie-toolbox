"use client";

import { useEffect, useMemo, useState } from "react";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import {
  ArrowLeft,
  Building2,
  Copy,
  KeyRound,
  Mail,
  Phone,
  SearchX,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@/components/reui/autocomplete";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { DataGrid, DataGridContainer } from "@/components/reui/data-grid/data-grid";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { IconStack } from "@/components/reui/icon-stack";
import { IconTile } from "@/components/reui/icon-tile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import * as api from "@/lib/api";
import { useFotos } from "@/lib/fotos";
import { useIdioma, preencher } from "@/lib/idioma";
import {
  peopleEnrichFieldIdentity,
  type PeopleContact,
} from "@/lib/people";
import type {
  PeopleEnrichField,
  PeopleEnrichFieldKey,
  PeopleEnrichPreview,
  PeopleEnrichSource,
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
  onClear,
}: {
  search: boolean;
  onClear: () => void;
}) {
  const { t } = useIdioma();
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <IconStack className="mb-2">
        {search ? <SearchX className="size-5" /> : <Users className="size-5" />}
      </IconStack>
      <p className="font-medium">
        {search ? t.controlRoom.peopleSemResultado : t.controlRoom.peopleVazio}
      </p>
      {!search && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {t.controlRoom.peopleVazioDesc}
        </p>
      )}
      {search && (
        <Button className="mt-3" variant="outline" size="sm" onClick={onClear}>
          {t.controlRoom.peopleLimparBusca}
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
    <Frame className="h-full min-h-0 w-full" stacked>
      <FrameHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-1 h-4 w-64" />
      </FrameHeader>
      <FramePanel className="space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </FramePanel>
      <FramePanel className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-full" />
      </FramePanel>
    </Frame>
  );
}

function PeopleDetail({
  contact,
  photo,
  onBack,
  onCompose,
}: {
  contact: PeopleContact;
  photo: string | null;
  onBack: () => void;
  onCompose: (email: string) => void;
}) {
  const { t } = useIdioma();
  const applyPeopleFields = useAppStore((state) => state.applyPeopleFields);
  const primaryEmail = contact.emails[0]?.address;
  const [enriching, setEnriching] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<PeopleEnrichPreview | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<number>>(new Set());
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [sessionOnlyApplied, setSessionOnlyApplied] = useState(false);
  const [sessionOnlyFields, setSessionOnlyFields] = useState<PeopleEnrichField[]>([]);
  const sparse = !contact.jobTitle || !contact.company || contact.phones.length === 0;

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
    <Frame className="h-full min-h-0 w-full overflow-auto" stacked>
      <FrameHeader className="flex-row items-center justify-between gap-2">
        <Button
          className="min-[1400px]:invisible"
          variant="ghost"
          size="sm"
          onClick={onBack}
        >
          <ArrowLeft />
          {t.controlRoom.peopleVoltar}
        </Button>
        {primaryEmail && (
          <Button onClick={() => void enrich()} disabled={enriching || applying}>
            {enriching ? <Spinner /> : <Sparkles />}
            {enriching
              ? t.controlRoom.peopleEnriching
              : t.controlRoom.peopleEnrich}
          </Button>
        )}
      </FrameHeader>
      <FramePanel>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex shrink-0 flex-col items-center gap-1">
            <Avatar className="size-16">
              {(contact.photo || photo) && (
                <AvatarImage src={contact.photo || photo || undefined} alt={contact.name} />
              )}
              <AvatarFallback className="text-lg">{initials(contact.name)}</AvatarFallback>
            </Avatar>
            {contact.photo && <SourceBadge source={contact.photoSource} />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold">{contact.name}</h2>
            <p className="text-sm text-muted-foreground">
              {[contact.jobTitle, contact.company].filter(Boolean).join(" · ") ||
                t.controlRoom.peopleSemDado}
            </p>
            <div className="mt-2">
              <div className="flex flex-wrap items-center gap-1">
                <RelationshipBadges contact={contact} />
                <SourceBadge source={contact.contactId ? "contacts" : "people"} />
              </div>
            </div>
          </div>
          {primaryEmail && (
            <Button onClick={() => onCompose(primaryEmail)}>
              <Mail />
              {t.controlRoom.peopleCompor}
            </Button>
          )}
        </div>
      </FramePanel>

      {sparse && !preview && !sessionOnlyApplied && (
        <FramePanel fit>
          <Alert variant="info">
            <Sparkles />
            <AlertTitle>{t.controlRoom.peopleEnrichPrompt}</AlertTitle>
            <AlertDescription>{t.controlRoom.peopleEnrichPromptDesc}</AlertDescription>
            <AlertAction>
              <Button size="sm" onClick={() => void enrich()} disabled={enriching}>
                {enriching ? <Spinner /> : <Sparkles />}
                {enriching
                  ? t.controlRoom.peopleEnriching
                  : t.controlRoom.peopleEnrich}
              </Button>
            </AlertAction>
          </Alert>
        </FramePanel>
      )}

      {preview && (
        <FramePanel className="space-y-4">
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
              <AlertDescription>{preview.failures.join(" · ")}</AlertDescription>
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
                        <AvatarFallback>{initials(contact.name)}</AvatarFallback>
                      </Avatar>
                    ) : (
                      <span className="block truncate text-sm">{field.value}</span>
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
                  disabled={!acceptedFields.some((field) => field.key !== "photo")}
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
        </FramePanel>
      )}

      {sessionOnlyApplied && (
        <FramePanel fit>
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
                disabled={!sessionOnlyFields.some((field) => field.key !== "photo")}
              >
                <Copy />
                {t.controlRoom.peopleEnrichCopy}
              </Button>
            </AlertAction>
          </Alert>
        </FramePanel>
      )}

      {enrichError && (
        <FramePanel fit>
          <Alert variant="destructive">
            <AlertTitle>{t.controlRoom.peopleEnrichError}</AlertTitle>
            <AlertDescription>{enrichError}</AlertDescription>
          </Alert>
        </FramePanel>
      )}

      <FramePanel>
        <div className="mb-3 flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t.controlRoom.peopleEmails}</h3>
        </div>
        <div className="space-y-2">
          {contact.emails.map((email) => (
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
          ))}
        </div>
      </FramePanel>

      <FramePanel>
        <div className="mb-3 flex items-center gap-2">
          <Phone className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t.controlRoom.peopleTelefones}</h3>
        </div>
        {contact.phones.length > 0 ? (
          <div className="space-y-2">
            {contact.phones.map((phone) => (
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
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t.controlRoom.peopleSemDado}</p>
        )}
      </FramePanel>

      <FramePanel>
        <div className="mb-3 flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t.controlRoom.peopleEmpresaCargo}</h3>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <DetailValue
            label={t.controlRoom.peopleEmpresa}
            value={contact.company}
            source={contact.companySource}
          />
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
  const loadPeople = useAppStore((state) => state.loadPeople);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<"relevance" | "az">("relevance");
  const { getFoto, pedirFotos } = useFotos();

  useEffect(() => {
    if (!loaded && !loading) void loadPeople();
  }, [loadPeople, loaded, loading]);

  useEffect(() => {
    pedirFotos(contacts.map((contact) => contact.emails[0]?.address));
  }, [contacts, pedirFotos]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => {
    const next = normalizedQuery
      ? contacts.filter((contact) =>
          [
            contact.name,
            contact.company,
            contact.jobTitle,
            ...contact.emails.map((email) => email.address),
          ]
            .filter(Boolean)
            .some((value) =>
              String(value).toLocaleLowerCase().includes(normalizedQuery),
            ),
        )
      : [...contacts];
    if (sort === "az") {
      next.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    }
    return next;
  }, [contacts, normalizedQuery, sort]);

  const selected = contacts.find((contact) => contact.id === selectedId) ?? null;

  const columns = useMemo<ColumnDef<PeopleContact>[]>(
    () => [
      {
        accessorKey: "name",
        header: t.controlRoom.peopleNome,
        meta: { skeleton: <Skeleton className="h-8 w-44" /> },
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
                <div className="truncate text-xs text-muted-foreground">
                  {[contact.company || contact.jobTitle, contact.emails[0]?.address]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </div>
          );
        },
      },
    ],
    [getFoto, t],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    enableRowSelection: true,
    state: {
      rowSelection: selectedId ? { [selectedId]: true } : {},
    },
  });

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t.controlRoom.peopleTitulo}</h2>
          <p className="text-sm text-muted-foreground">{t.controlRoom.peopleDescricao}</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row xl:max-w-2xl">
          <Autocomplete
            items={filtered}
            value={query}
            onValueChange={setQuery}
            open={open}
            onOpenChange={setOpen}
            itemToStringValue={(item: unknown) => (item as PeopleContact).name}
            filter={null}
          >
            <AutocompleteInput
              className="h-9"
              placeholder={t.controlRoom.peopleBuscar}
              aria-label={t.controlRoom.peopleBuscar}
              showClear
            />
            {open && (
              <AutocompleteContent>
                {filtered.length === 0 ? (
                  <AutocompleteEmpty>{t.controlRoom.peopleSemResultado}</AutocompleteEmpty>
                ) : (
                  <AutocompleteList>
                    <AutocompleteCollection>
                      {(contact: PeopleContact) => (
                        <AutocompleteItem
                          key={contact.id}
                          value={contact}
                          onClick={() => selectPerson(contact.id)}
                        >
                          <Avatar size="sm">
                            {(contact.photo || getFoto(contact.emails[0]?.address)) && (
                              <AvatarImage
                                src={
                                  contact.photo ||
                                  getFoto(contact.emails[0]?.address) ||
                                  undefined
                                }
                                alt={contact.name}
                              />
                            )}
                            <AvatarFallback>{initials(contact.name)}</AvatarFallback>
                          </Avatar>
                          <span className="truncate">{contact.name}</span>
                        </AutocompleteItem>
                      )}
                    </AutocompleteCollection>
                  </AutocompleteList>
                )}
              </AutocompleteContent>
            )}
          </Autocomplete>
          <Select value={sort} onValueChange={(value) => setSort(value as typeof sort)}>
            <SelectTrigger className="w-full sm:w-44" aria-label={t.controlRoom.peopleOrdenar}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="relevance">{t.controlRoom.peopleRelevancia}</SelectItem>
              <SelectItem value="az">{t.controlRoom.peopleAZ}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

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

      <div className="flex min-h-0 flex-1 gap-4">
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border bg-card min-[1400px]:basis-[38%]",
            selected && "max-[1399px]:hidden",
          )}
        >
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
                  onClear={() => setQuery("")}
                />
              )
            }
            onRowClick={(contact) => selectPerson(contact.id)}
            tableLayout={{
              dense: true,
              rowBorder: true,
              headerSticky: true,
              width: "auto",
            }}
          >
            <DataGridContainer className="h-full overflow-auto">
              <DataGridTable />
            </DataGridContainer>
          </DataGrid>
        </div>

        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 min-[1400px]:flex min-[1400px]:basis-[62%]",
            selected ? "flex" : "hidden",
          )}
        >
          {loading && !loaded ? (
            <PeopleDetailSkeleton />
          ) : selected ? (
            <PeopleDetail
              key={selected.id}
              contact={selected}
              photo={getFoto(selected.emails[0]?.address) ?? null}
              onBack={() => selectPerson(null)}
              onCompose={onCompose}
            />
          ) : (
            <Frame className="h-full w-full" stacked>
              <FrameHeader>
                <FrameTitle>{t.controlRoom.peopleSelecionar}</FrameTitle>
                <FrameDescription>{t.controlRoom.peopleSelecionarDesc}</FrameDescription>
              </FrameHeader>
              <FramePanel className="flex items-center justify-center">
                <IconStack>
                  <Users className="size-5" />
                </IconStack>
              </FramePanel>
            </Frame>
          )}
        </div>
      </div>
    </section>
  );
}
