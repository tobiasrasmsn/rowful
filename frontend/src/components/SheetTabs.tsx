import { useMemo, useState } from "react"

import { useSheetStore } from "@/store/sheetStore"
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
import { KanbanSquareIcon } from "lucide-react"

export function SheetTabs() {
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
    <div className="px-6 pt-1.5 pb-px">
      <Tabs
        value={activeWorkspaceTab || selectedSheetName}
        onValueChange={(value) => {
          if (value.startsWith("kanban:")) {
            setActiveWorkspaceTab(value)
            return
          }
          void loadSheet(value)
        }}
      >
        <TabsList className="gap-1 bg-transparent">
          {(workbook?.sheets ?? []).map((sheetMeta) => (
            <div key={sheetMeta.name} className="contents">
              <TabsTrigger
                className="rounded-t-xl rounded-b-none border border-b-0 border-border bg-muted/35 px-8 py-4 shadow-none! data-active:-mb-px data-active:bg-card"
                value={sheetMeta.name}
                onDoubleClick={() => openEditDialog(sheetMeta.name)}
              >
                {sheetMeta.name}
              </TabsTrigger>
              {(kanbanBySheet.get(sheetMeta.name) ?? []).map((region) =>
                sheetMeta.name === selectedSheetName ? (
                  <TabsTrigger
                    className="rounded-t-xl rounded-b-none border border-b-0 border-border bg-muted/35 px-8 py-4 shadow-none! data-active:-mb-px data-active:bg-card"
                    key={`kanban:${region.id}`}
                    value={`kanban:${region.id}`}
                  >
                    <KanbanSquareIcon /> {region.name}
                  </TabsTrigger>
                ) : null
              )}
            </div>
          ))}
          {workbook ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full border border-border/60 bg-muted/80 px-3 text-base leading-none"
              onClick={createSheet}
            >
              +
            </Button>
          ) : null}
        </TabsList>
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
