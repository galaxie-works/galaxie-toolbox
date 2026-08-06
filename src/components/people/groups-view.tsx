// #578: visão de Grupos no painel — grid de grupos (grupos M365 do #293, read-only
// via /me/memberOf) → detalhe com a lista de membros. Espelha o OrganizationsView
// (mesmo padrão split lista/detalhe, avatar de membro via getFoto do #533/#570,
// ordem alfabética do #535), sem criar/editar/atribuir: grupos são read-only.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, UsersRound } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PersonHoverCard } from "@/components/people/person-hover-card";
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

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join("");
}

export function GroupsView() {
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
          <div className="min-w-0">
            <h3 className="truncate text-xl font-semibold">{selected.name}</h3>
            {selected.description && (
              <p className="truncate text-sm text-muted-foreground">
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
                      {/* #533: foto do cache (getFoto); sem foto cai nas iniciais. */}
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
                  <div
                    key={contact.id}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    {/* #478/#553: identidade abre o PersonHoverCard; a foto do
                        cache vai no fallback (o card lê fallback.foto). */}
                    {memberEmail ? (
                      <PersonHoverCard
                        email={memberEmail}
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
    </div>
  );
}
