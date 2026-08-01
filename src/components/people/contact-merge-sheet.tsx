"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Mail, Phone } from "lucide-react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIdioma, preencher } from "@/lib/idioma";
import {
  buildMergePlan,
  chooseMergeMaster,
  chooseScalar,
  createMergeDraft,
  keepAllMaster,
  previewMergeResult,
  snapshotMergeSelection,
  toggleMergeEmail,
  toggleMergePhone,
  validateMergeDraft,
  type MergeDraft,
  type MergePlan,
  type MergeScalarField,
} from "@/lib/people-merge";
import type { PeopleContact } from "@/lib/people";
import { cn } from "@/lib/utils";

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

function contactName(draft: MergeDraft, contactId: string): string {
  return (
    draft.candidates.find((candidate) => candidate.contactId === contactId)
      ?.name ?? contactId
  );
}

export function ContactMergeSheet({
  open,
  contacts,
  onOpenChange,
}: {
  open: boolean;
  contacts: PeopleContact[];
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useIdioma();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<MergeDraft>(() =>
    createMergeDraft(snapshotMergeSelection([])),
  );
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setDraft(createMergeDraft(snapshotMergeSelection(contacts)));
    setStep(1);
    setPlan(null);
  }, [contacts, open]);

  const result = useMemo(() => previewMergeResult(draft), [draft]);
  const validation = useMemo(() => validateMergeDraft(draft), [draft]);
  const canReconcile = Boolean(draft.masterContactId);
  const canConfirm = canReconcile && validation.length === 0;
  const master = draft.candidates.find(
    (candidate) => candidate.contactId === draft.masterContactId,
  );
  const absorbed = draft.candidates.filter(
    (candidate) => candidate.contactId !== draft.masterContactId,
  );
  const unresolvedConflicts = draft.scalars
    ? Object.values(draft.scalars).filter(
        (decision) => decision.conflict && !decision.reviewed,
      ).length
    : 0;

  const moveTo = (next: number) => {
    if (next < step || (next === 2 && canReconcile) || (next === 3 && canConfirm)) {
      setStep(next);
    }
  };

  const selectScalar = (field: MergeScalarField, contactId: string) => {
    setDraft((current) => chooseScalar(current, field, contactId));
    setPlan(null);
  };

  const createPlan = () => {
    setPlan(buildMergePlan(draft));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="pr-6 text-left">
            {t.controlRoom.mergeTitulo}
          </SheetTitle>
          <SheetDescription className="text-left">
            {t.controlRoom.mergeDescricao}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 **:data-[slot=scroll-area-viewport]:overscroll-contain">
          <Stepper value={step} onValueChange={moveTo} className="grid gap-4">
            <StepperNav className="border-b px-4 py-3">
              {[
                [1, t.controlRoom.mergePassoMaster],
                [2, t.controlRoom.mergePassoCampos],
                [3, t.controlRoom.mergePassoConfirmar],
              ].map(([value, label], index) => (
                <StepperItem
                  key={value}
                  step={value as number}
                  disabled={
                    value === 2 ? !canReconcile : value === 3 ? !canConfirm : false
                  }
                >
                  <StepperTrigger className="gap-1.5">
                    <StepperIndicator>{value}</StepperIndicator>
                    <StepperTitle className="hidden text-xs sm:block">
                      {label}
                    </StepperTitle>
                  </StepperTrigger>
                  {index < 2 && <StepperSeparator />}
                </StepperItem>
              ))}
            </StepperNav>

            <StepperPanel className="px-4 pb-4">
              <StepperContent value={1} className="grid gap-4">
                <div>
                  <h3 className="text-sm font-medium">
                    {t.controlRoom.mergeMasterTitulo}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t.controlRoom.mergeMasterDescricao}
                  </p>
                </div>

                <RadioGroup
                  value={draft.masterContactId ?? ""}
                  onValueChange={(contactId) => {
                    setDraft((current) => chooseMergeMaster(current, contactId));
                    setPlan(null);
                  }}
                >
                  {draft.candidates.map((candidate) => {
                    const radioId = `merge-master-${candidate.contactId}`;
                    const selected = candidate.contactId === draft.masterContactId;
                    return (
                      <Label
                        key={candidate.contactId}
                        htmlFor={radioId}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg border p-3",
                          selected && "border-primary bg-primary/5",
                        )}
                      >
                        <RadioGroupItem id={radioId} value={candidate.contactId} />
                        <Avatar className="size-9">
                          <AvatarFallback>{initials(candidate.name)}</AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {candidate.name}
                          </span>
                          <span className="block truncate text-xs font-normal text-muted-foreground">
                            {candidate.emails[0]?.address ?? t.controlRoom.mergeSemEmail}
                          </span>
                        </span>
                        {selected && (
                          <Badge variant="secondary">
                            {t.controlRoom.mergeSeraMantido}
                          </Badge>
                        )}
                      </Label>
                    );
                  })}
                </RadioGroup>

                {draft.excluded.length > 0 && (
                  <Alert variant="warning">
                    <AlertTriangle />
                    <AlertTitle>{t.controlRoom.mergeExcluidosTitulo}</AlertTitle>
                    <AlertDescription>
                      {preencher(t.controlRoom.mergeExcluidosDescricao, {
                        n: draft.excluded.length,
                      })}
                      <ul className="mt-2 list-disc pl-4">
                        {draft.excluded.map((contact) => (
                          <li key={`${contact.id}-${contact.reason}`}>{contact.name}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </StepperContent>

              <StepperContent value={2} className="grid gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">
                      {t.controlRoom.mergeCamposTitulo}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t.controlRoom.mergeCamposDescricao}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDraft((current) => keepAllMaster(current));
                      setPlan(null);
                    }}
                  >
                    {t.controlRoom.mergeManterMaster}
                  </Button>
                </div>

                {draft.scalars &&
                  (["name", "company"] as const).map((field) => {
                    const decision = draft.scalars![field];
                    const label =
                      field === "name"
                        ? t.controlRoom.mergeCampoNome
                        : t.controlRoom.mergeCampoEmpresa;
                    return (
                      <div key={field} className="grid gap-3 rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{label}</span>
                          <Badge variant={decision.reviewed ? "secondary" : "outline"}>
                            {decision.reviewed
                              ? t.controlRoom.mergeRevisado
                              : decision.conflict
                                ? t.controlRoom.mergeRevisaoPendente
                                : t.controlRoom.mergeSemConflito}
                          </Badge>
                        </div>
                        <RadioGroup value={decision.chosenContactId ?? ""}>
                          {decision.candidates.map((candidate, index) => {
                            const sourceId = candidate.sourceContactIds[0];
                            const inputId = `merge-${field}-${index}`;
                            return (
                              <Label
                                key={`${field}-${sourceId}`}
                                htmlFor={inputId}
                                onClick={() => selectScalar(field, sourceId)}
                                className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5"
                              >
                                <RadioGroupItem
                                  id={inputId}
                                  value={sourceId}
                                  onClick={() => selectScalar(field, sourceId)}
                                />
                                <span className="min-w-0">
                                  <span className="block break-words text-sm">
                                    {candidate.value || t.controlRoom.mergeVazio}
                                  </span>
                                  <span className="block text-xs font-normal text-muted-foreground">
                                    {candidate.sourceContactIds
                                      .map((id) => contactName(draft, id))
                                      .join(", ")}
                                  </span>
                                </span>
                              </Label>
                            );
                          })}
                        </RadioGroup>
                      </div>
                    );
                  })}

                <div className="grid gap-3 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Mail className="size-4" />
                    <span className="text-sm font-medium">
                      {t.controlRoom.mergeCampoEmails}
                    </span>
                    <Badge variant="secondary">
                      {draft.emails.filter((option) => option.selected).length}
                    </Badge>
                  </div>
                  <div className="grid gap-2">
                    {draft.emails.map((option) => {
                      const inputId = `merge-email-${option.key}`;
                      return (
                        <Label key={option.key} htmlFor={inputId} className="flex items-start gap-2">
                          <Checkbox
                            id={inputId}
                            checked={option.selected}
                            onCheckedChange={(checked) => {
                              setDraft((current) =>
                                toggleMergeEmail(current, option.key, checked === true),
                              );
                              setPlan(null);
                            }}
                          />
                          <span className="min-w-0 font-normal">
                            <span className="block break-all text-sm">{option.value.address}</span>
                            {option.value.label && (
                              <span className="block text-xs text-muted-foreground">
                                {option.value.label}
                              </span>
                            )}
                          </span>
                        </Label>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Phone className="size-4" />
                    <span className="text-sm font-medium">
                      {t.controlRoom.mergeCampoTelefones}
                    </span>
                    <Badge variant="secondary">
                      {draft.phones.filter((option) => option.selected).length}
                    </Badge>
                  </div>
                  {draft.phones.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t.controlRoom.mergeSemTelefones}
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {draft.phones.map((option) => {
                        const inputId = `merge-phone-${option.key}`;
                        return (
                          <Label key={option.key} htmlFor={inputId} className="flex items-start gap-2">
                            <Checkbox
                              id={inputId}
                              checked={option.selected}
                              onCheckedChange={(checked) => {
                                setDraft((current) =>
                                  toggleMergePhone(current, option.key, checked === true),
                                );
                                setPlan(null);
                              }}
                            />
                            <span className="min-w-0 font-normal">
                              <span className="block break-all text-sm">{option.value.number}</span>
                              {option.value.label && (
                                <span className="block text-xs text-muted-foreground">
                                  {option.value.label}
                                </span>
                              )}
                            </span>
                          </Label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
                  <span className="text-sm font-medium">
                    {t.controlRoom.mergePreviewTitulo}
                  </span>
                  <div className="grid gap-1 text-sm">
                    <span className="font-medium">{result.name || t.controlRoom.mergeVazio}</span>
                    <span className="text-muted-foreground">
                      {result.company || t.controlRoom.mergeSemEmpresa}
                    </span>
                    <span className="text-muted-foreground">
                      {preencher(t.controlRoom.mergePreviewValores, {
                        emails: result.emails.length,
                        phones: result.phones.length,
                      })}
                    </span>
                  </div>
                </div>

                {unresolvedConflicts > 0 && (
                  <p className="text-sm text-destructive">
                    {preencher(t.controlRoom.mergeConflitosPendentes, {
                      n: unresolvedConflicts,
                    })}
                  </p>
                )}
                {validation.some((error) => error.field === "emails") && (
                  <p className="text-sm text-destructive">
                    {t.controlRoom.mergeEmailObrigatorio}
                  </p>
                )}
              </StepperContent>

              <StepperContent value={3} className="grid gap-4">
                <div>
                  <h3 className="text-sm font-medium">
                    {t.controlRoom.mergeResumoTitulo}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {preencher(t.controlRoom.mergeResumoDescricao, {
                      n: draft.candidates.length,
                    })}
                  </p>
                </div>

                {plan && (
                  <Alert>
                    <Check />
                    <AlertTitle>{t.controlRoom.mergeProntoTitulo}</AlertTitle>
                    <AlertDescription>
                      {preencher(t.controlRoom.mergeProntoDescricao, {
                        version: plan.version,
                        n: plan.absorbed.length,
                      })}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-2 rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span>{t.controlRoom.mergeMaster}</span>
                    <span className="text-right font-medium">{master?.name}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>{t.controlRoom.mergeCampoEmails}</span>
                    <Badge variant="secondary">{result.emails.length}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>{t.controlRoom.mergeCampoTelefones}</span>
                    <Badge variant="secondary">{result.phones.length}</Badge>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium">
                    {t.controlRoom.mergeAbsorvidos}
                  </h4>
                  <ul className="mt-2 grid gap-2">
                    {absorbed.map((contact) => (
                      <li key={contact.contactId} className="rounded-lg border p-3 text-sm">
                        {contact.name}
                      </li>
                    ))}
                  </ul>
                </div>

                <Alert variant="warning">
                  <AlertTriangle />
                  <AlertTitle>{t.controlRoom.mergeAvisoTitulo}</AlertTitle>
                  <AlertDescription>{t.controlRoom.mergeAvisoDescricao}</AlertDescription>
                </Alert>
              </StepperContent>
            </StepperPanel>
          </Stepper>
        </ScrollArea>

        <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t.controlRoom.orgsCancelar}
              </Button>
              <Button disabled={!canReconcile} onClick={() => setStep(2)}>
                {t.controlRoom.mergeContinuar}
              </Button>
            </>
          ) : step === 2 ? (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                {t.controlRoom.bulkOrgVoltar}
              </Button>
              <Button disabled={!canConfirm} onClick={() => setStep(3)}>
                {t.controlRoom.mergeContinuar}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(2)}>
                {t.controlRoom.bulkOrgVoltar}
              </Button>
              <Button disabled={Boolean(plan)} onClick={createPlan}>
                {plan
                  ? t.controlRoom.mergeProntoCta
                  : preencher(t.controlRoom.mergeCta, {
                      n: draft.candidates.length,
                    })}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
