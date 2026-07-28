import type { ReactElement } from "react"

import { Field } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScanIcon, LayoutDashboardIcon, ActivityIcon, ShieldIcon, SettingsIcon } from "lucide-react"

interface IconPlaceholderProps {
  lucide: string
  tabler: string
  hugeicons: string
  phosphor: string
  remixicon: string
  className?: string
}

interface Item {
  label: string
  value: string | null
  icon: ReactElement<IconPlaceholderProps>
}

const items: Item[] = [
  {
    label: "Select an option",
    value: null,
    icon: (
      <ScanIcon className="text-muted-foreground size-4" />
    ),
  },
  {
    label: "Dashboard",
    value: "dashboard",
    icon: (
      <LayoutDashboardIcon className="text-muted-foreground size-4" />
    ),
  },
  {
    label: "Activity",
    value: "activity",
    icon: (
      <ActivityIcon className="text-muted-foreground size-4" />
    ),
  },
  {
    label: "Security",
    value: "security",
    icon: (
      <ShieldIcon className="text-muted-foreground size-4" />
    ),
  },
  {
    label: "Settings",
    value: "settings",
    icon: (
      <SettingsIcon className="text-muted-foreground size-4" />
    ),
  },
]

export function Pattern() {
  return (
    <Field className="max-w-xs">
      <Select>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            {items.slice(1).map((item) => (
              <SelectItem key={item.value} value={item.value!}>
                {item.icon}
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}
