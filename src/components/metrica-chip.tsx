import { Badge } from "@/components/reui/badge";
import { Spinner } from "@/components/ui/spinner";

export function MetricaChip({
  icone,
  valor,
  titulo,
  consultando,
  carregando,
}: {
  icone: React.ReactNode;
  valor?: string;
  titulo?: string;
  consultando?: string;
  carregando?: boolean;
}) {
  if (!valor) {
    if (!carregando) return null;
    return (
      <Badge variant="secondary" size="lg" title={consultando}>
        <Spinner data-icon="inline-start" />
        {icone}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" size="lg" title={titulo}>
      {icone}
      {valor}
    </Badge>
  );
}
