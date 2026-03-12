import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { cn } from "@/lib/utils"
import { useSheetStore } from "@/store/sheetStore"
import { FileSettingsButton } from "./FileSettingsButton"
import { Button } from "./ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import { Input } from "./ui/input"
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs"
import { PlusSquareIcon } from "lucide-react"

type SheetTabsProps = {
  className?: string
  compact?: boolean
}

export function SheetTabs({ className, compact = false }: SheetTabsProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const workbook = useSheetStore((state) => state.workbook)
  const selectedSheetName = useSheetStore((state) => state.selectedSheetName)
  const activeWorkspaceTab = useSheetStore((state) => state.activeWorkspaceTab)
  const setActiveWorkspaceTab = useSheetStore(
    (state) => state.setActiveWorkspaceTab
  )
  const kanbanRegions = useSheetStore((state) => state.kanbanRegions)
  const loadSheet = useSheetStore((state) => state.loadSheet)
  const createSheet = useSheetStore((state) => state.createSheet)
  const renameSheet = useSheetStore((state) => state.renameSheet)
  const deleteSheet = useSheetStore((state) => state.deleteSheet)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSheetName, setEditingSheetName] = useState("")
  const [nextSheetName, setNextSheetName] = useState("")
  const tabsScrollRef = useRef<HTMLDivElement | null>(null)
  const [showFadeStart, setShowFadeStart] = useState(false)
  const [showFadeEnd, setShowFadeEnd] = useState(false)

  const slugify = useCallback(
    (value: string) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    []
  )

  const updateFades = useCallback(() => {
    const node = tabsScrollRef.current
    if (!node) {
      setShowFadeStart(false)
      setShowFadeEnd(false)
      return
    }

    const hasOverflow = node.scrollWidth - node.clientWidth > 1
    if (!hasOverflow) {
      setShowFadeStart(false)
      setShowFadeEnd(false)
      return
    }

    const maxScrollLeft = node.scrollWidth - node.clientWidth
    setShowFadeStart(node.scrollLeft > 1)
    setShowFadeEnd(node.scrollLeft < maxScrollLeft - 1)
  }, [])

  useEffect(() => {
    const node = tabsScrollRef.current
    if (!node) {
      return
    }

    const frame = window.requestAnimationFrame(updateFades)
    node.addEventListener("scroll", updateFades, { passive: true })
    window.addEventListener("resize", updateFades)

    return () => {
      window.cancelAnimationFrame(frame)
      node.removeEventListener("scroll", updateFades)
      window.removeEventListener("resize", updateFades)
    }
  }, [
    updateFades,
    workbook,
    kanbanRegions,
    selectedSheetName,
    activeWorkspaceTab,
  ])
  const kanbanBySheet = useMemo(() => {
    const grouped = new Map<string, typeof kanbanRegions>()
    for (const region of kanbanRegions) {
      const current = grouped.get(region.sheetName) ?? []
      current.push(region)
      grouped.set(region.sheetName, current)
    }
    return grouped
  }, [kanbanRegions])

  const openEditDialog = (sheetName: string) => {
    setEditingSheetName(sheetName)
    setNextSheetName(sheetName)
    setDialogOpen(true)
  }

  const handleRename = async () => {
    await renameSheet(editingSheetName, nextSheetName)
    setDialogOpen(false)
  }

  const handleDelete = async () => {
    await deleteSheet(editingSheetName)
    setDialogOpen(false)
  }

  return (
    <div
      className={cn(
        compact
          ? "w-full min-w-0 px-0 pt-0 pb-0"
          : "w-full min-w-0 px-6 pt-1.5 pb-px",
        className
      )}
    >
      <Tabs
        value={activeWorkspaceTab || selectedSheetName}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams)
          if (value.startsWith("kanban:")) {
            const regionId = value.slice("kanban:".length)
            const region = kanbanRegions.find((item) => item.id === regionId)
            if (region) {
              const slug = slugify(region.name) || "kanban"
              next.set("kanban", `${region.id}/${slug}`)
            } else {
              next.set("kanban", regionId)
            }
            setSearchParams(next, { replace: true })
            setActiveWorkspaceTab(value)
            return
          }
          next.delete("kanban")
          setSearchParams(next, { replace: true })
          setActiveWorkspaceTab(value)
          if (value === selectedSheetName) {
            return
          }
          void loadSheet(value)
        }}
      >
        <div className="flex w-full min-w-0 items-end gap-2">
          <div className="relative min-w-0 flex-1">
            <div
              ref={tabsScrollRef}
              className="h-12 w-full min-w-0 translate-x-6 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-color:color-mix(in_oklab,var(--border)_75%,transparent)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/70 [&::-webkit-scrollbar-thumb:hover]:bg-border [&::-webkit-scrollbar-track]:bg-transparent"
            >
              <TabsList className="h-full! min-h-0 w-max min-w-full flex-nowrap items-end justify-start gap-1 bg-transparent p-0 pb-0">
                {(workbook?.sheets ?? []).map((sheetMeta) => (
                  <div key={sheetMeta.name} className="flex items-end gap-1">
                    <TabsTrigger
                      className="h-full! rounded-t-lg rounded-b-none border border-b-0 border-border bg-muted/35 px-5 py-1 text-sm shadow-none! data-active:-mb-px data-active:bg-card"
                      value={sheetMeta.name}
                      onDoubleClick={() => openEditDialog(sheetMeta.name)}
                    >
                      {sheetMeta.name}
                    </TabsTrigger>
                    {sheetMeta.name === selectedSheetName &&
                    (kanbanBySheet.get(sheetMeta.name) ?? []).length > 0 ? (
                      <div className="-translate-x-1">
                        {(kanbanBySheet.get(sheetMeta.name) ?? []).map(
                          (region, index) => (
                            <TabsTrigger
                              className={cn(
                                "h-full! rounded-t-md rounded-b-none border border-b-0 border-l-0 border-border/70 bg-muted/20 px-3 py-1 text-xs text-muted-foreground shadow-none! data-active:-mb-px data-active:border-border data-active:bg-card data-active:text-foreground",
                                index !== 0
                                  ? "-translate-x-1 data-active:border-l"
                                  : "rounded-l-none"
                              )}
                              key={`kanban:${region.id}`}
                              value={`kanban:${region.id}`}
                              title={`${sheetMeta.name} · ${region.name}`}
                            >
                              {region.name}
                            </TabsTrigger>
                          )
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
                {workbook ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-2 rounded-t-lg rounded-b-none border border-b-0 border-border bg-muted/35 px-5 py-1 text-sm shadow-none! data-active:-mb-px data-active:bg-card"
                    onClick={createSheet}
                  >
                    <PlusSquareIcon /> New Sheet
                  </Button>
                ) : null}
              </TabsList>
            </div>
            {showFadeStart ? (
              <div className="pointer-events-none absolute top-0 bottom-0 left-0 w-8 bg-gradient-to-r from-background to-transparent" />
            ) : null}
            {showFadeEnd ? (
              <div className="pointer-events-none absolute top-0 right-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent" />
            ) : null}
          </div>
          <FileSettingsButton className="mb-px shrink-0 -translate-x-6" />
        </div>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Sheet</DialogTitle>
            <DialogDescription>
              Rename this sheet or delete it.
            </DialogDescription>
          </DialogHeader>

          <Input
            value={nextSheetName}
            onChange={(event) => setNextSheetName(event.target.value)}
            placeholder="Sheet name"
          />

          <DialogFooter className="justify-between sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={(workbook?.sheets.length ?? 0) <= 1}
            >
              Delete
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="button" onClick={() => void handleRename()}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
