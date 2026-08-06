// #562: grupos de contato PESSOAIS (Graph contactFolders) — pastas EDITÁVEIS do
// usuário (Contacts.ReadWrite), seção separada dos grupos M365 read-only do #578.
// Espelha o GroupsView (split lista/detalhe + grid de PeopleCard), acrescentando
// as affordances de escrita: criar/renomear/excluir pasta e mover contato.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Folder,
  FolderInput,
  FolderPlus,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PeopleCard } from "@/components/people/people-view";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { NodesIllustration } from "@/components/examples/c-empty-19";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Toolbar } from "@/components/ui/toolbar";
import { preencher, useIdioma } from "@/lib/idioma";
import { useFotos } from "@/lib/fotos";
import type { ContactFolder } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

export function PersonalGroupsView({
  onCompose,
}: {
  onCompose: (email: string) => void;
}) {
  const { t, idioma } = useIdioma();
  const { getFoto, pedirFotos } = useFotos();
  const folders = useAppStore((state) => state.contactFolders);
  const foldersLoading = useAppStore((state) => state.contactFoldersLoading);
  const foldersLoaded = useAppStore((state) => state.contactFoldersLoaded);
  const foldersError = useAppStore((state) => state.contactFoldersError);
  const selectedId = useAppStore((state) => state.selectedContactFolderId);
  const contactsById = useAppStore((state) => state.folderContactsById);
  const contactsLoadingId = useAppStore(
    (state) => state.folderContactsLoadingId,
  );
  const loadContactFolders = useAppStore((state) => state.loadContactFolders);
  const selectContactFolder = useAppStore((state) => state.selectContactFolder);
  const createContactFolder = useAppStore((state) => state.createContactFolder);
  const renameContactFolder = useAppStore((state) => state.renameContactFolder);
  const deleteContactFolder = useAppStore((state) => state.deleteContactFolder);
  const moveContactToFolder = useAppStore((state) => state.moveContactToFolder);
  const selectPerson = useAppStore((state) => state.selectPerson);
  const setPeopleTab = useAppStore((state) => state.setPeopleTab);
  const query = useAppStore((state) => state.peopleSearchQuery);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Diálogos de escrita (criar/renomear/excluir).
  const [criarAberto, setCriarAberto] = useState(false);
  const [nomeNovo, setNomeNovo] = useState("");
  const [renomearAlvo, setRenomearAlvo] = useState<ContactFolder | null>(null);
  const [nomeEditar, setNomeEditar] = useState("");
  const [excluirAlvo, setExcluirAlvo] = useState<ContactFolder | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Carrega as pastas ao montar a seção (#562).
  useEffect(() => {
    void loadContactFolders();
  }, [loadContactFolders]);

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

  const filtered = folders.filter((folder) =>
    folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const selected = folders.find((folder) => folder.id === selectedId) ?? null;
  const contactsLoading =
    selectedId != null && contactsLoadingId === selectedId;

  // #535: contatos da pasta em ordem alfabética; useMemo estabiliza o batch de fotos.
  const contacts = useMemo(() => {
    const lista = selectedId ? (contactsById[selectedId] ?? []) : [];
    return [...lista].sort((a, b) => {
      const ka = a.name?.trim() || a.emails[0]?.address || "";
      const kb = b.name?.trim() || b.emails[0]?.address || "";
      return ka.localeCompare(kb, idioma, { sensitivity: "base" });
    });
  }, [selectedId, contactsById, idioma]);
  useEffect(() => {
    pedirFotos(contacts.map((contact) => contact.emails[0]?.address));
  }, [pedirFotos, contacts]);

  const wide = width >= 768;
  const listMin = width ? Math.min(50, (340 / width) * 100) : 30;
  const detailMin = width ? Math.min(64, (420 / width) * 100) : 40;

  const salvarCriar = async () => {
    const nome = nomeNovo.trim();
    if (!nome) return;
    setSalvando(true);
    try {
      await createContactFolder(nome);
      toast.success(t.controlRoom.folderCreated);
      setCriarAberto(false);
      setNomeNovo("");
    } catch {
      toast.error(t.controlRoom.folderCreateError);
    } finally {
      setSalvando(false);
    }
  };

  const salvarRenomear = async () => {
    const nome = nomeEditar.trim();
    if (!renomearAlvo || !nome) return;
    setSalvando(true);
    try {
      await renameContactFolder(renomearAlvo.id, nome);
      toast.success(t.controlRoom.folderRenamed);
      setRenomearAlvo(null);
    } catch {
      toast.error(t.controlRoom.folderRenameError);
    } finally {
      setSalvando(false);
    }
  };

  const confirmarExcluir = async () => {
    if (!excluirAlvo) return;
    setSalvando(true);
    try {
      await deleteContactFolder(excluirAlvo.id);
      toast.success(t.controlRoom.folderDeleted);
      setExcluirAlvo(null);
    } catch {
      toast.error(t.controlRoom.folderDeleteError);
    } finally {
      setSalvando(false);
    }
  };

  const moverContato = async (contactId: string, targetFolderId: string) => {
    try {
      await moveContactToFolder(contactId, targetFolderId);
      toast.success(t.controlRoom.moveContactSuccess);
    } catch {
      toast.error(t.controlRoom.moveContactError);
    }
  };

  const listPane = (
    <Frame className="h-full min-h-0 overflow-hidden" stacked dense>
      <FramePanel
        fit
        className="flex min-h-11 shrink-0 items-center justify-between gap-2 px-2 py-1.5"
      >
        <Toolbar aria-label={t.controlRoom.personalGroupsSection}>
          <Button
            size="sm"
            onClick={() => {
              setNomeNovo("");
              setCriarAberto(true);
            }}
          >
            <FolderPlus />
            {t.controlRoom.createFolder}
          </Button>
        </Toolbar>
        <span className="text-xs text-muted-foreground">{filtered.length}</span>
      </FramePanel>
      <FramePanel className="min-h-0 p-0">
        <ScrollArea className="h-full min-h-0">
          {foldersLoading && folders.length === 0 ? (
            <div className="flex h-full min-h-72 items-center justify-center">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <Empty className="h-full min-h-72">
              <EmptyHeader>
                <EmptyMedia>
                  <NodesIllustration />
                </EmptyMedia>
                <EmptyTitle>
                  {foldersError && foldersLoaded
                    ? t.controlRoom.peopleGroupsError
                    : t.controlRoom.personalGroupsEmpty}
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="divide-y">
              {filtered.map((folder) => {
                const active = folder.id === selectedId;
                const count = contactsById[folder.id]?.length;
                return (
                  <div
                    key={folder.id}
                    className={cn(
                      "group/folder flex items-center gap-1 pr-1.5 transition-colors hover:bg-accent/50",
                      active && "bg-secondary",
                    )}
                  >
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => void selectContactFolder(folder.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                    >
                      <Avatar>
                        <AvatarFallback>
                          <Folder className="size-4" />
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {folder.name}
                      </span>
                      {count != null && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {count}
                        </span>
                      )}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 opacity-0 group-hover/folder:opacity-100 data-[state=open]:opacity-100"
                          aria-label={folder.name}
                        >
                          <MoreVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setRenomearAlvo(folder);
                            setNomeEditar(folder.name);
                          }}
                        >
                          <Pencil /> {t.controlRoom.renameFolder}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setExcluirAlvo(folder)}
                        >
                          <Trash2 /> {t.controlRoom.deleteFolder}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
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
            onClick={() => void selectContactFolder(null)}
          >
            <ArrowLeft />
            {t.controlRoom.personalGroupsSection}
          </Button>
        )}
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar className="size-16">
              <AvatarFallback className="text-lg">
                <Folder className="size-5" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h3 className="truncate text-xl font-semibold">{selected.name}</h3>
              <p className="text-sm text-muted-foreground">
                {preencher(t.controlRoom.orgsMembros, { n: contacts.length })}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRenomearAlvo(selected);
                setNomeEditar(selected.name);
              }}
            >
              <Pencil /> {t.controlRoom.renameFolder}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t.controlRoom.deleteFolder}
              onClick={() => setExcluirAlvo(selected)}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <section className="space-y-3 p-4">
          {contactsLoading ? (
            <div className="flex items-center gap-2 px-1 py-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {t.controlRoom.peopleGroupsLoading}
            </div>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t.controlRoom.personalGroupEmpty}
            </p>
          ) : (
            // #562: contatos da pasta no MESMO grid de cards da view de contatos
            // (reusa o PeopleCard do #578). O "mover" fica FORA do card (menu ⋮).
            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
              {contacts.map((contact) => {
                const outras = folders.filter((f) => f.id !== selected.id);
                return (
                  <div key={contact.id} className="relative">
                    <PeopleCard
                      contact={contact}
                      selected={false}
                      photo={
                        contact.photo ||
                        getFoto(contact.emails[0]?.address) ||
                        null
                      }
                      onSelect={() => {
                        setPeopleTab("contacts");
                        selectPerson(contact.id);
                      }}
                      onCompose={onCompose}
                    />
                    {contact.contactId && outras.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="absolute right-2 bottom-2"
                            aria-label={t.controlRoom.moveToFolder}
                          >
                            <FolderInput />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>
                            {t.controlRoom.moveToFolder}
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {outras.map((f) => (
                            <DropdownMenuItem
                              key={f.id}
                              onClick={() =>
                                void moverContato(contact.id, f.id)
                              }
                            >
                              <Folder /> {f.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </ScrollArea>
    </div>
  ) : (
    <Empty className="h-full min-h-0 rounded-xl border border-solid bg-card">
      <EmptyHeader>
        <EmptyMedia>
          <NodesIllustration />
        </EmptyMedia>
        <EmptyTitle>{t.controlRoom.personalGroupSelect}</EmptyTitle>
        <EmptyDescription>
          {t.controlRoom.personalGroupSelectDesc}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        ref={containerRef}
        className="@container/personal-groups flex min-h-0 flex-1"
      >
        {!wide ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {selected ? detailPane : listPane}
          </div>
        ) : (
          <ResizablePanelGroup
            autoSaveId="people.personalGroups.layout"
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

      {/* Criar pasta */}
      <Dialog open={criarAberto} onOpenChange={(o) => !o && setCriarAberto(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.controlRoom.createFolder}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="pg-nome-novo">{t.controlRoom.folderName}</Label>
            <Input
              id="pg-nome-novo"
              value={nomeNovo}
              onChange={(e) => setNomeNovo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void salvarCriar()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCriarAberto(false)}>
              {t.controlRoom.agendaEditarCancelar}
            </Button>
            <Button disabled={salvando || !nomeNovo.trim()} onClick={salvarCriar}>
              {salvando && <Spinner className="size-4" />}
              {t.controlRoom.createFolder}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renomear pasta */}
      <Dialog
        open={renomearAlvo != null}
        onOpenChange={(o) => !o && setRenomearAlvo(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.controlRoom.renameFolder}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="pg-nome-editar">{t.controlRoom.folderName}</Label>
            <Input
              id="pg-nome-editar"
              value={nomeEditar}
              onChange={(e) => setNomeEditar(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void salvarRenomear()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenomearAlvo(null)}>
              {t.controlRoom.agendaEditarCancelar}
            </Button>
            <Button
              disabled={salvando || !nomeEditar.trim()}
              onClick={salvarRenomear}
            >
              {salvando && <Spinner className="size-4" />}
              {t.controlRoom.renameFolder}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excluir pasta (destrutivo) */}
      <AlertDialog
        open={excluirAlvo != null}
        onOpenChange={(o) => !o && !salvando && setExcluirAlvo(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.controlRoom.deleteFolder}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.controlRoom.deleteFolderConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvando}>
              {t.controlRoom.agendaEditarCancelar}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={salvando}
              onClick={(e) => {
                e.preventDefault();
                void confirmarExcluir();
              }}
            >
              {salvando && <Spinner className="size-4" />}
              {t.controlRoom.deleteFolder}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
