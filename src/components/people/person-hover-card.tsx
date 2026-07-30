"use client";

import type { ReactElement } from "react";
import { Mail, Users } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { useIdioma } from "@/lib/idioma";
import {
  normalizeDomain,
  resolveOrganization,
} from "@/lib/organizations";
import { resolvePerson } from "@/lib/people";
import type { Pessoa } from "@/lib/types";
import { useAppStore } from "@/store";

function initials(name: string, email: string): string {
  const base = name && name !== email ? name : email.split("@")[0];
  return (
    base
      .trim()
      .split(/[\s._-]+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

export function PersonHoverCard({
  email,
  fallback,
  children,
}: {
  email: string;
  fallback?: Pessoa;
  children: ReactElement;
}) {
  const { t } = useIdioma();
  const contact = useAppStore((state) =>
    resolvePerson(state.peopleContacts, email),
  );
  const organizations = useAppStore((state) => state.organizations);
  const resolvePeoplePerson = useAppStore(
    (state) => state.resolvePeoplePerson,
  );
  const abrirCompose = useAppStore((state) => state.abrirCompose);
  const fecharCompose = useAppStore((state) => state.fecharCompose);
  const setComposePara = useAppStore((state) => state.setComposePara);
  const caixaAtiva = useAppStore((state) => state.caixaAtiva);
  const setBridgeView = useAppStore((state) => state.setBridgeView);
  const selectPerson = useAppStore((state) => state.selectPerson);

  const name = contact?.name || fallback?.nome || email;
  const primaryEmail =
    contact?.emails.find(
      (item) =>
        item.address.trim().toLocaleLowerCase() ===
        email.trim().toLocaleLowerCase(),
    )?.address ??
    contact?.emails[0]?.address ??
    email;
  const roleCompany = [contact?.jobTitle ?? fallback?.cargo, contact?.company]
    .filter(Boolean)
    .join(" · ");
  const photo = contact?.photo ?? fallback?.foto;
  const emailDomain = normalizeDomain(primaryEmail.split("@").at(-1) ?? "");
  const organizationLabel = emailDomain
    ? resolveOrganization(organizations, emailDomain)?.name ?? null
    : null;
  const frequent = contact?.frequent ?? fallback?.origem === "contatos";

  function compose() {
    abrirCompose("novo", caixaAtiva);
    setComposePara([primaryEmail]);
  }

  async function viewPeople() {
    const resolved =
      contact ?? (await resolvePeoplePerson(primaryEmail, fallback));
    fecharCompose();
    selectPerson(resolved?.id ?? null);
    setBridgeView("people");
  }

  return (
    <HoverCard
      openDelay={100}
      closeDelay={100}
      onOpenChange={(open) => {
        if (open && !contact) {
          void resolvePeoplePerson(email, fallback);
        }
      }}
    >
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-72">
        <div className="flex space-x-2">
          <Avatar className="size-10 shrink-0">
            {photo && <AvatarImage src={photo} alt="" />}
            <AvatarFallback>{initials(name, primaryEmail)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1">
            <div>
              <p className="truncate text-sm font-medium">{name}</p>
              {roleCompany && (
                <p className="text-muted-foreground truncate text-xs">
                  {roleCompany}
                </p>
              )}
            </div>
            <p className="text-foreground truncate text-xs">{primaryEmail}</p>
            <span className="flex flex-wrap items-center gap-1">
              {organizationLabel && (
                <Badge variant="outline" size="xs">
                  {organizationLabel}
                </Badge>
              )}
              {frequent && (
                <Badge variant="secondary" size="xs">
                  {t.controlRoom.peopleFrequente}
                </Badge>
              )}
            </span>
            <div className="flex flex-wrap gap-1 pt-1">
              <Button type="button" variant="outline" size="xs" onClick={compose}>
                <Mail />
                {t.controlRoom.peopleCompor}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void viewPeople()}
              >
                <Users />
                {t.controlRoom.peopleVerModulo}
              </Button>
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
