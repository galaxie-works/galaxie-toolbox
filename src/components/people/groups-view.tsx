// #578: visão de Grupos no painel — grid de grupos (grupos M365 do #293, read-only
// via /me/memberOf) → detalhe com a lista de membros. Espelha o OrganizationsView
// (mesmo padrão split lista/detalhe, avatar de membro via getFoto do #533/#570,
// ordem alfabética do #535), sem criar/editar/atribuir: grupos são read-only.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Mail, UsersRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// #578 rework: reusa o MESMO card de contato do people-view nos membros do grupo.
import { PeopleCard } from "@/components/people/people-view";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
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
// #533/#570: avatar do membro vem do mesmo cache de fotos (getFoto/pedirFotos).
import { useFotos } from "@/lib/fotos";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

export function GroupsView({
  onCompose,
}: {
  onCompose: (email: string) => void;
}) {
  const { t, idioma } = useIdioma();
  const { getFoto, pedirFotos } = useFotos();
  const groups = useAppStore((state) => state.peopleGroups);
  const groupsLoading = useAppStore((state) => state.peopleGroupsLoading);
  const groupsLoaded = useAppStore((state) => state.peopleGroupsLoaded);
  const groupsError = useAppStore((state) => state.peopleGroupsError);
  const selectedId = useAppStore((state) => state.peopleSelectedGroupId);
  const membersById = useAppStore((state) => state.peopleGroupMembersById);
  const membersLoadingId = useAppStore(
    (state) => state.peopleGroupMembersLoadingId,
  );
  const selectPeopleGroup = useAppStore((state) => state.selectPeopleGroup);
  const selectPerson = useAppStore((state) => state.selectPerson);
  const setPeopleTab = useAppStore((state) => state.setPeopleTab);
  const query = useAppStore((state) => state.peopleSearchQuery);
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

  const filtered = groups.filter((group) =>
    [group.name, group.description]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const selected = groups.find((group) => group.id === selectedId) ?? null;
  const membersLoading = selectedId != null && membersLoadingId === selectedId;

  // #535: membros em ordem alfabética (A→Z), localeCompare ciente de acento. O
  // useMemo dá identidade estável pro effect de fotos (#533) não refazer o batch.
  const members = useMemo(() => {
    const lista = selectedId ? (membersById[selectedId] ?? []) : [];
    return [...lista].sort((a, b) => {
      const ka = a.name?.trim() || a.emails[0]?.address || "";
      const kb = b.name?.trim() || b.emails[0]?.address || "";
      return ka.localeCompare(kb, idioma, { sensitivity: "base" });
    });
  }, [selectedId, membersById, idioma]);
  // #533: popula o cache com as fotos dos membros (batch, dedup no próprio cache).
  useEffect(() => {
    pedirFotos(members.map((contact) => contact.emails[0]?.address));
  }, [pedirFotos, members]);

  const wide = width >= 768;
  const listMin = width ? Math.min(50, (340 / width) * 100) : 30;
  const detailMin = width ? Math.min(64, (420 / width) * 100) : 40;

  const listPane = (
    <Frame className="h-full min-h-0 overflow-hidden" stacked dense>
      <FramePanel
        fit
        className="flex min-h-11 shrink-0 items-center justify-between gap-2 px-2 py-1.5"
      >
        <Toolbar aria-label={t.controlRoom.peopleGroupsSection}>
          <span className="px-1.5 text-sm font-medium">
            {t.controlRoom.peopleGroupsSection}
          </span>
        </Toolbar>
        <span className="text-xs text-muted-foreground">{filtered.length}</span>
      </FramePanel>
      <FramePanel className="min-h-0 p-0">
        <ScrollArea className="h-full min-h-0">
          {groupsLoading && groups.length === 0 ? (
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
                  {groupsError && groupsLoaded
                    ? t.controlRoom.peopleGroupsError
                    : t.controlRoom.peopleGroupsEmpty}
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="divide-y">
              {filtered.map((group) => {
                const active = group.id === selectedId;
                return (
                  <button
                    key={group.id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => void selectPeopleGroup(group.id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50",
                      active && "bg-secondary",
                    )}
                  >
                    <Avatar>
                      <AvatarFallback>
                        <UsersRound className="size-4" />
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {group.name}
                      </span>
                      {group.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {group.description}
                        </span>
                      )}
                    </span>
                    {group.memberCount != null && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {preencher(t.controlRoom.orgsMembros, {
                          n: group.memberCount,
                        })}
                      </span>
                    )}
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
            onClick={() => void selectPeopleGroup(null)}
          >
            <ArrowLeft />
            {t.controlRoom.peopleGroupsSection}
          </Button>
        )}
        <div className="flex min-w-0 items-start gap-3">
          <Avatar className="size-16">
            <AvatarFallback className="text-lg">
              <UsersRound className="size-5" />
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-xl font-semibold">{selected.name}</h3>
              {/* #578 rework: visibility (Public/Private) do grupo M365, quando há. */}
              {selected.visibility && (
                <Badge variant="outline" className="shrink-0">
                  {selected.visibility}
                </Badge>
              )}
            </div>
            {/* #578 rework: e-mail do grupo (M365 `mail`) — o PO pediu ver o
                endereço; security group sem mail simplesmente não mostra. */}
            {selected.mail && (
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                <Mail className="size-3.5 shrink-0" />
                <span className="truncate">{selected.mail}</span>
              </p>
            )}
            {selected.description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {selected.description}
              </p>
            )}
          </div>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <section className="space-y-3 p-4">
          <h4 className="text-sm font-semibold">
            {preencher(t.controlRoom.orgsMembros, { n: members.length })}
          </h4>
          {membersLoading ? (
            <div className="flex items-center gap-2 px-1 py-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {t.controlRoom.peopleGroupsLoading}
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t.controlRoom.peopleGroupEmpty}
            </p>
          ) : (
            // #578 rework: membros no MESMO grid de cards da view de contatos
            // (reusa o PeopleCard do people-view) — o PO pediu "dentro do grid
            // que temos de contatos" + "como se fosse um contato", não a lista.
            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
              {members.map((contact) => (
                <PeopleCard
                  key={contact.id}
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
              ))}
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
        <EmptyTitle>{t.controlRoom.peopleGroupSelect}</EmptyTitle>
        <EmptyDescription>
          {t.controlRoom.peopleGroupSelectDesc}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        ref={containerRef}
        className="@container/groups flex min-h-0 flex-1"
      >
        {!wide ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {selected ? detailPane : listPane}
          </div>
        ) : (
          <ResizablePanelGroup
            autoSaveId="people.groups.layout"
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
    </div>
  );
}
