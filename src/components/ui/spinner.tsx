import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"
import { textoUi } from "@/lib/idioma-core"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label={textoUi("carregando")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
