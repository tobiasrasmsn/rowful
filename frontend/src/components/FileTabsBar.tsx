import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { FileSpreadsheetIcon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { useSheetStore } from "@/store/sheetStore"
import { buildRenamedFileName, getDisplayFileName } from "@/lib/fileName"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type FileTabsBarProps = {
  className?: string
  compact?: boolean
  showLoadingStrip?: boolean
}

export function FileTabsBar({
  className,
  compact = false,
  showLoadingStrip = !compact,
}: FileTabsBarProps) {
  const workbook = useSheetStore((state) => state.workbook)
  const isLoading = useSheetStore((state) => state.isLoading)
  const renameStoredFile = useSheetStore((state) => state.renameStoredFile)
  const [renameOpen, setRenameOpen] = useState(false)
  const [nextName, setNextName] = useState("")

  const currentFileName = workbook
    ? getDisplayFileName(workbook.fileName)
    : "No file selected"

  return (
    <div className={cn(compact ? "px-0 py-0" : "px-2 py-2", className)}>
      <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <HugeiconsIcon icon={FileSpreadsheetIcon} />
        {workbook ? (
          <button
            type="button"
            className="block w-fit truncate text-left text-base hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:outline-none"
            onClick={() => {
              setNextName(getDisplayFileName(workbook.fileName))
              setRenameOpen(true)
            }}
            title="Rename file"
          >
            {currentFileName}
          </button>
        ) : (
          <span className="block w-fit truncate text-base">
            {currentFileName}
          </span>
        )}
      </div>

      <div
        className={cn(
          "h-0.5 w-full bg-transparent",
          !showLoadingStrip && "hidden"
        )}
      >
        {isLoading ? <div className="loading-strip h-full w-full" /> : null}
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
            <DialogDescription>
              Change the display name for this workbook file.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={nextName}
            onChange={(event) => setNextName(event.target.value)}
            placeholder="File name"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={async () => {
                if (!workbook) {
                  return
                }
                await renameStoredFile(
                  workbook.id,
                  buildRenamedFileName(workbook.fileName, nextName)
                )
                setRenameOpen(false)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
