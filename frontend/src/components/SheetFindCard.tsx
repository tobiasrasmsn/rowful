import { useEffect, useRef } from "react"
import { ChevronDown, ChevronUp, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSheetStore } from "@/store/sheetStore"

export function SheetFindCard() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isFindOpen = useSheetStore((state) => state.isFindOpen)
  const search = useSheetStore((state) => state.search)
  const setSearch = useSheetStore((state) => state.setSearch)
  const closeFind = useSheetStore((state) => state.closeFind)
  const findMatchCount = useSheetStore((state) => state.findMatchCount)
  const findActiveMatchIndex = useSheetStore(
    (state) => state.findActiveMatchIndex
  )
  const requestFindNavigation = useSheetStore(
    (state) => state.requestFindNavigation
  )

  useEffect(() => {
    if (!isFindOpen) {
      return
    }
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isFindOpen])

  if (!isFindOpen) {
    return null
  }

  const hasSearch = Boolean(search.trim())
  const hasMatches = findMatchCount > 0

  return (
    <div className="pointer-events-none fixed top-20 right-4 z-50">
      <div className="pointer-events-auto w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-3 shadow-lg shadow-primary/10">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  requestFindNavigation(event.shiftKey ? "prev" : "next")
                }
              }}
              placeholder="Search current sheet"
              className="h-10 border-0 bg-transparent px-0 focus-visible:ring-0"
            />
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={() => requestFindNavigation("prev")}
            disabled={!hasSearch || !hasMatches}
            aria-label="Previous match"
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={() => requestFindNavigation("next")}
            disabled={!hasSearch || !hasMatches}
            aria-label="Next match"
          >
            <ChevronDown className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={closeFind}
            aria-label="Close search"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="mt-2 px-1 text-xs text-muted-foreground">
          {!hasSearch
            ? "Type to search this sheet."
            : hasMatches
              ? `${findActiveMatchIndex + 1} of ${findMatchCount}`
              : "No matches found"}
        </div>
      </div>
    </div>
  )
}
