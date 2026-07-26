import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { SendIcon, DownloadIcon, BookmarkIcon } from "lucide-react"

export function Pattern() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() =>
          toast("Message sent", {
            description: "Your message has been delivered.",
            icon: (
              <SendIcon className="size-4" />
            ),
          })
        }
      >
        Send Icon
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() =>
          toast("Download complete", {
            description: "design-assets.zip is ready.",
            icon: (
              <DownloadIcon className="size-4" />
            ),
          })
        }
      >
        Download Icon
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() =>
          toast("Bookmark added", {
            description: "Saved to your collection.",
            icon: (
              <BookmarkIcon className="size-4" />
            ),
          })
        }
      >
        Bookmark Icon
      </Button>
    </div>
  )
}