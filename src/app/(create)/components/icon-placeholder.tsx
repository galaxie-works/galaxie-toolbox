// Ponte de ícones do registry reui (radix-nova). Os componentes vindos do
// registry usam <IconPlaceholder lucide="NomeIcon" .../> para não amarrar a
// biblioteca de ícones; aqui resolvemos para o lucide-react (a lib do projeto,
// ver components.json). Só mapeamos os ícones realmente usados pelo
// event-calendar — nomes desconhecidos caem em `null` (ícones decorativos).

import type { ComponentType, SVGProps } from "react";
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  RepeatIcon,
} from "lucide-react";

type IconeSvg = ComponentType<SVGProps<SVGSVGElement>>;

const LUCIDE: Record<string, IconeSvg> = {
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  RepeatIcon,
};

interface IconPlaceholderProps extends SVGProps<SVGSVGElement> {
  lucide?: string;
  tabler?: string;
  hugeicons?: string;
  phosphor?: string;
  remixicon?: string;
}

export function IconPlaceholder({
  lucide,
  tabler: _tabler,
  hugeicons: _hugeicons,
  phosphor: _phosphor,
  remixicon: _remixicon,
  ...props
}: IconPlaceholderProps) {
  const Icone = lucide ? LUCIDE[lucide] : undefined;
  if (!Icone) return null;
  return <Icone {...props} />;
}

export default IconPlaceholder;
