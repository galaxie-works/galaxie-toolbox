"use client";

/**
 * Extraído de people-view.tsx no #1020 (Ref) — a "barra de massa → atribuir
 * organização" (AssignToOrganizationSheet) e seus helpers privados
 * (BulkAssignStep, splitDomains), que só ela usa. Movimento PURO: zero mudança
 * de comportamento. Tirar esse Sheet (~370 linhas) do people-view reduz a
 * superfície do componente-monstro antes de memoizar os handlers do grid.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Info, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/reui/badge";
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
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { useIdioma, preencher } from "@/lib/idioma";
import { type PeopleContact } from "@/lib/people";
import {
  contactDomain,
  organizationMembers,
  suggestedOrganizationName,
} from "@/lib/organizations";
import { useAppStore } from "@/store";
type BulkAssignStep = "pick" | "create" | "preview";

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
export function AssignToOrganizationSheet({
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

