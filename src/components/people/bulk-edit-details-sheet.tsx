// #1020 (escopo decidido pela mira): `BulkEditDetailsSheet` (448 linhas) sai do
// `people-view.tsx`. Extracao PURA — nenhuma logica muda.
//
// `BulkCategoriaPicker` e `emptyBulkEditDetailsState` vem junto: a teia medida
// mostrou uso EXCLUSIVO daqui (2 usos cada, zero fora). Os TIPOS
// (`BulkEditDetailsState`/`FieldState`) ficaram no `people-view`, que tambem os
// usa — cruzam seam, entao nao vieram.
"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Plus,
  Tag,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/reui/badge";
// #468: empty-states padronizadas no componente reui `Empty` + ilustração do
// registry (NodesIllustration = c-empty-19, theme-aware). Mesmo padrão da "Caixa
// limpa" do mail e do Accounts em Settings.
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
import { Spinner } from "@/components/ui/spinner";
import { useIdioma, preencher } from "@/lib/idioma";
import { type PeopleContact } from "@/lib/people";
import type {
  PeopleBulkDetailsChange,
  PeopleBulkDetailsField,
} from "@/lib/types";
import { useAppStore } from "@/store";
import type {
  BulkEditDetailsFieldState,
  BulkEditDetailsState,
  BulkEditDetailsStep,
} from "./people-shared";

function emptyBulkEditDetailsState(): BulkEditDetailsState {
  return {
    companyName: { enabled: false, clear: false, value: "" },
    department: { enabled: false, clear: false, value: "" },
    officeLocation: { enabled: false, clear: false, value: "" },
  };
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
  createLabel,
  selected,
  categorias,
  onToggle,
  onCriar,
}: {
  label: string;
  placeholder: string;
  emptyText: string;
  /** #401: rótulo do item "criar" (só relevante quando `onCriar` é passado). */
  createLabel?: string;
  selected: string[];
  categorias: Map<string, string>;
  onToggle: (nome: string) => void;
  /** #401: criar categoria inline durante o bulk (só no picker de adicionar). */
  onCriar?: (nome: string) => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const nomes = [...categorias.keys()];
  const buscaLimpa = busca.trim();
  const jaExiste = nomes.some(
    (nome) => nome.toLowerCase() === buscaLimpa.toLowerCase(),
  );
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
              <CommandInput
                placeholder={placeholder}
                value={busca}
                onValueChange={setBusca}
              />
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
                {/* #401: criar categoria inline durante o bulk edit. */}
                {onCriar && buscaLimpa && !jaExiste && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        value={`__criar__${buscaLimpa}`}
                        onSelect={() => {
                          void onCriar(buscaLimpa);
                          setBusca("");
                        }}
                      >
                        <Plus className="size-3.5 shrink-0" />
                        {createLabel} “{buscaLimpa}”
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

export function BulkEditDetailsSheet({
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
  const criarCategoriaPeople = useAppStore(
    (state) => state.criarCategoriaPeople,
  );
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
                    createLabel={t.controlRoom.peopleCategoriaCriar}
                    selected={catAdd}
                    categorias={peopleCategorias}
                    onToggle={(nome) => toggleCat(setCatAdd, setCatRemove, nome)}
                    onCriar={async (nome) => {
                      // #401: cria a categoria (M365) e já a marca pra adicionar.
                      await criarCategoriaPeople(nome, "preset0");
                      toggleCat(setCatAdd, setCatRemove, nome);
                    }}
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
