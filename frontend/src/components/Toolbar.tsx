import { Minus, Plus, Search } from "lucide-react"

import { useSheetStore } from "@/store/sheetStore"
import { getDisplayFileName } from "@/lib/fileName"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function Toolbar() {
  const zoom = useSheetStore((state) => state.zoom)
  const setZoom = useSheetStore((state) => state.setZoom)
  const search = useSheetStore((state) => state.search)
  const setSearch = useSheetStore((state) => state.setSearch)
  const workbook = useSheetStore((state) => state.workbook)

  return (
    <TooltipProvider>
      <div className="flex h-11 items-center gap-2 border-b border-border bg-background px-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {workbook
            ? getDisplayFileName(workbook.fileName)
            : "No workbook loaded"}
        </span>
        <Separator orientation="vertical" className="mx-1 h-6" />

        <div className="ml-auto flex items-center gap-2">
          <div className="relative w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              className="pl-8"
            />
          </div>

          <Separator orientation="vertical" className="mx-1 h-6" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setZoom(zoom - 10)}
              >
                <Minus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom Out</TooltipContent>
          </Tooltip>

          <span className="w-14 text-center text-sm tabular-nums">{zoom}%</span>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setZoom(zoom + 10)}
              >
                <Plus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom In</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}
