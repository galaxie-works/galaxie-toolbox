import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ChevronRightIcon } from "lucide-react"

export function Pattern() {
  return (
    <div className="h-54 w-full max-w-xs">
      <Frame stacked dense spacing="sm" className="w-full">
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="flex w-full">
            <FrameHeader className="flex grow flex-row items-center justify-between gap-2">
              <FrameTitle className="text-sm font-medium">
                Deployment successful
              </FrameTitle>
              <ChevronRightIcon aria-hidden="true" className="text-muted-foreground size-4 transition-transform in-data-[state=open]:rotate-90" />
            </FrameHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <FramePanel>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Updated the core authentication logic and fixed a minor bug in
                the login flow. Improved session handling for better
                performance.
              </p>
            </FramePanel>
          </CollapsibleContent>
        </Collapsible>
      </Frame>
    </div>
  )
}