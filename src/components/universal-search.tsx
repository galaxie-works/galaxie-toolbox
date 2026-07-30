"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@/components/reui/autocomplete";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useFotos } from "@/lib/fotos";
import { useIdioma, preencher } from "@/lib/idioma";
import type { Tela } from "@/lib/navegacao";
import type { PeopleContact } from "@/lib/people";
import type { PeopleOrg } from "@/lib/organizations";
import { useAppStore } from "@/store";
import type { BridgeView } from "@/store/ui-slice";

type SearchResult =
  | {
      kind: "contact";
      value: PeopleContact;
    }
  | {
      kind: "organization";
      value: PeopleOrg;
    };

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join("");
}

export function UniversalSearch({
  tela,
  screenLabel,
  bridgeView,
}: {
  tela: Tela;
  screenLabel: string;
  bridgeView: BridgeView;
}) {
  const { t } = useIdioma();
  const peopleTab = useAppStore((state) => state.peopleTab);
  const contacts = useAppStore((state) => state.peopleContacts);
  const organizations = useAppStore((state) => state.organizations);
  const peopleSearchQuery = useAppStore((state) => state.peopleSearchQuery);
  const setPeopleSearchQuery = useAppStore(
    (state) => state.setPeopleSearchQuery,
  );
  const mailSearchQuery = useAppStore((state) => state.busca);
  const setMailSearchQuery = useAppStore((state) => state.setBusca);
  const selectPerson = useAppStore((state) => state.selectPerson);
  const selectOrganization = useAppStore(
    (state) => state.selectOrganization,
  );
  const [genericQuery, setGenericQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { getFoto, pedirFotos } = useFotos();

  const isPeople = tela === "control-room" && bridgeView === "people";
  const isMail = tela === "control-room" && bridgeView === "mail";
  const contextKey = `${tela}:${bridgeView}:${isPeople ? peopleTab : ""}`;
  const query = isPeople
    ? peopleSearchQuery
    : isMail
      ? mailSearchQuery
      : genericQuery;

  useEffect(() => {
    setPeopleSearchQuery("");
    setMailSearchQuery("");
    setGenericQuery("");
    setOpen(false);
  }, [contextKey, setMailSearchQuery, setPeopleSearchQuery]);

  useEffect(() => {
    if (!isPeople || peopleTab !== "contacts") return;
    pedirFotos(contacts.map((contact) => contact.emails[0]?.address));
  }, [contacts, isPeople, peopleTab, pedirFotos]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const results = useMemo<SearchResult[]>(() => {
    if (!isPeople) return [];

    if (peopleTab === "organizations") {
      return organizations
        .filter((organization) =>
          [organization.name, ...organization.domains]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalizedQuery),
        )
        .map((value) => ({ kind: "organization" as const, value }));
    }

    return contacts
      .filter((contact) =>
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
      .map((value) => ({ kind: "contact" as const, value }));
  }, [
    contacts,
    isPeople,
    normalizedQuery,
    organizations,
    peopleTab,
  ]);

  const placeholder =
    tela === "control-room"
      ? bridgeView === "people"
        ? peopleTab === "organizations"
          ? t.controlRoom.orgsBuscar
          : t.controlRoom.peopleBuscar
        : bridgeView === "mail"
          ? t.controlRoom.buscarEmail
          : t.controlRoom.agendaBuscar
      : preencher(t.nav.buscarEm, { nome: screenLabel });

  return (
    <Autocomplete
      items={results}
      value={query}
      onValueChange={
        isPeople
          ? setPeopleSearchQuery
          : isMail
            ? setMailSearchQuery
            : setGenericQuery
      }
      open={isPeople && open}
      onOpenChange={setOpen}
      itemToStringValue={(item: unknown) => {
        const result = item as SearchResult;
        return result.value.name;
      }}
      filter={null}
    >
      <AutocompleteInput
        size="lg"
        data-universal-search-input
        placeholder={placeholder}
        aria-label={placeholder}
        showClear
      />
      {isPeople && open && (
        <AutocompleteContent>
          {results.length === 0 ? (
            <AutocompleteEmpty>
              {t.controlRoom.peopleSemResultado}
            </AutocompleteEmpty>
          ) : (
            <AutocompleteList>
              <AutocompleteCollection>
                {(result: SearchResult) => {
                  if (result.kind === "organization") {
                    const organization = result.value;
                    return (
                      <AutocompleteItem
                        key={organization.id}
                        value={result}
                        onClick={() => selectOrganization(organization.id)}
                      >
                        <Avatar size="sm">
                          <AvatarFallback>
                            {initials(organization.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            {organization.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {organization.domains.join(" · ")}
                          </span>
                        </span>
                      </AutocompleteItem>
                    );
                  }

                  const contact = result.value;
                  const photo =
                    contact.photo || getFoto(contact.emails[0]?.address);
                  return (
                    <AutocompleteItem
                      key={contact.id}
                      value={result}
                      onClick={() => selectPerson(contact.id)}
                    >
                      <Avatar size="sm">
                        {photo && (
                          <AvatarImage src={photo} alt={contact.name} />
                        )}
                        <AvatarFallback>
                          {initials(contact.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{contact.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {contact.emails[0]?.address || contact.company}
                        </span>
                      </span>
                    </AutocompleteItem>
                  );
                }}
              </AutocompleteCollection>
            </AutocompleteList>
          )}
        </AutocompleteContent>
      )}
    </Autocomplete>
  );
}
