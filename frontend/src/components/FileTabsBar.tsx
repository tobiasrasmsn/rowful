import { cn } from "@/lib/utils"
import { getDisplayFileName } from "@/lib/fileName"
import { useSheetStore } from "@/store/sheetStore"
import { useLocation } from "react-router-dom"

type FileTabsBarProps = {
  className?: string
  compact?: boolean
  showLoadingStrip?: boolean
}

const APP_NAME = "Planar"

export function FileTabsBar({
  className,
  compact = false,
  showLoadingStrip = !compact,
}: FileTabsBarProps) {
  const location = useLocation()
  const workbook = useSheetStore((state) => state.workbook)
  const isLoading = useSheetStore((state) => state.isLoading)
  const isFilesRoute = location.pathname === "/files"
  const title =
    !isFilesRoute && workbook
      ? getDisplayFileName(workbook.fileName)
      : APP_NAME

  return (
    <div className={cn(compact ? "px-0 py-0" : "px-2 py-2", className)}>
      <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm text-foreground">
        <span className="block w-fit truncate text-lg font-medium">
          {title}
        </span>
      </div>

      <div
        className={cn(
          "h-0.5 w-full bg-transparent",
          !showLoadingStrip && "hidden"
        )}
      >
        {isLoading ? <div className="loading-strip h-full w-full" /> : null}
      </div>
    </div>
  )
}
