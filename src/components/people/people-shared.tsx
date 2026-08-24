// #1020: helpers que a teia medida mostrou CRUZANDO seams — usados pelo
// `people-view` E pelo `people-detail`. Criterio do altair: so o que cruza vem
// pra ca; uso unico fica com o seam dono.
//
// Medicao (citacoes fora da propria declaracao): `SourceBadge` 4+3,
// `RelationshipBadges` 1+2, `copyText` 1+1.
"use client";

import {
  Building2,
} from "lucide-react";

import { Badge } from "@/components/reui/badge";
// #468: empty-states padronizadas no componente reui `Empty` + ilustração do
// registry (NodesIllustration = c-empty-19, theme-aware). Mesmo padrão da "Caixa
// limpa" do mail e do Accounts em Settings.
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useIdioma } from "@/lib/idioma";
import { type PeopleContact } from "@/lib/people";
import type {
  PeopleBulkDetailsField,
  PeopleEnrichSource,
} from "@/lib/types";

export function RelationshipBadges({
  contact,
  organizationLabel,
  organizationLogo,
  compact = false,
}: {
  contact: PeopleContact;
  organizationLabel?: string | null;
  organizationLogo?: string | null;
  compact?: boolean;
}) {
  const { t } = useIdioma();
  return (
    <span className="flex flex-wrap items-center gap-1">
      {organizationLabel && (
        <Badge variant="outline" size={compact ? "xs" : "sm"}>
          <Avatar className="size-3">
            {organizationLogo && (
              <AvatarImage src={organizationLogo} alt="" />
            )}
            <AvatarFallback>
              <Building2 className="size-2.5" />
            </AvatarFallback>
          </Avatar>
          {organizationLabel}
        </Badge>
      )}
      {contact.frequent && (
        <Badge variant="secondary" size={compact ? "xs" : "sm"}>
          {t.controlRoom.peopleFrequente}
        </Badge>
      )}
    </span>
  );
}

export function SourceBadge({ source }: { source?: PeopleEnrichSource }) {
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


/**
 * #1020: os tipos do bulk-edit ficam AQUI, não no seam nem no `people-view`.
 * O `people-view` monta o estado e o `bulk-edit-details-sheet` o consome — se
 * o tipo morasse num dos dois, o outro teria de importar do primeiro e nasceria
 * o import circular que a `mira` alertou. Tipo no comum custa zero e corta a
 * aresta.
 */
export type BulkEditDetailsStep = "edit" | "preview";
export type BulkEditDetailsFieldState = {
  enabled: boolean;
  clear: boolean;
  value: string;
};
export type BulkEditDetailsState = Record<
  PeopleBulkDetailsField,
  BulkEditDetailsFieldState
>;
