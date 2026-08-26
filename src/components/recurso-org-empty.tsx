import { Building2 } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { preencher, useIdioma } from "@/lib/idioma";

/** Nome da suite no {app} do empty-state (renomeado no #1599). */
const APP = "The GALAXIE";

/**
 * #699 (PS6): empty-state padrão de uma feature de ORGANIZAÇÃO vista num tier
 * pessoal/uncontracted. Nunca é erro — só informa que o recurso é de org e vira
 * quando a empresa ativar o app. Reusado por Sites, Org Admin e afins.
 */
export function RecursoOrgEmpty({ className }: { className?: string }) {
  const { t } = useIdioma();
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Building2 className="size-6" />
        </EmptyMedia>
        <EmptyTitle>{t.tier.recursoOrg}</EmptyTitle>
        <EmptyDescription>
          {preencher(t.tier.upgradeOrg, { app: APP })}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
