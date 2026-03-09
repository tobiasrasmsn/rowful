import { useEffect } from "react"
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom"
import { toast } from "sonner"

import { CellInspector } from "@/components/CellInspector"
import { FileTabsBar } from "@/components/FileTabsBar"
import { FilesBrowser } from "@/components/FilesBrowser"
import { FormatBar } from "@/components/FormatBar"
import { Grid } from "@/components/Grid"
import { KanbanView } from "@/components/KanbanView"
import { SheetTabs } from "@/components/SheetTabs"
import { Toaster } from "@/components/ui/sonner"
import { useSheetStore } from "@/store/sheetStore"

function SheetWorkspace() {
  const error = useSheetStore((state) => state.error)
  const activeWorkspaceTab = useSheetStore((state) => state.activeWorkspaceTab)
  const kanbanRegions = useSheetStore((state) => state.kanbanRegions)
  const sheetName = useSheetStore((state) => state.sheet?.name)
  const activeKanban = activeWorkspaceTab.startsWith("kanban:")
    ? kanbanRegions.find(
        (region) =>
          region.id === activeWorkspaceTab.slice("kanban:".length) &&
          region.sheetName === sheetName
      )
    : null

  useEffect(() => {
    if (!error) {
      return
    }
    toast.error(error, { id: "sheet-error" })
  }, [error])

  return (
    <>
      <SheetTabs />
      <div className="min-h-0 flex-1 p-2 pt-0">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card">
          {activeKanban ? null : (
            <>
              <FormatBar />
              <CellInspector />
            </>
          )}

          <div className="min-h-0 flex-1">
            {activeKanban ? <KanbanView region={activeKanban} /> : <Grid />}
          </div>
        </div>
      </div>
    </>
  )
}

function SheetRoutePage() {
  const { id } = useParams<{ id: string }>()
  const workbookID = useSheetStore((state) => state.workbook?.id)
  const openWorkbookByID = useSheetStore((state) => state.openWorkbookByID)

  useEffect(() => {
    if (!id) {
      return
    }
    if (workbookID === id) {
      return
    }
    void openWorkbookByID(id)
  }, [id, workbookID, openWorkbookByID])

  return <SheetWorkspace />
}

function RootRedirect() {
  const navigate = useNavigate()
  const workbookID = useSheetStore((state) => state.workbook?.id)

  useEffect(() => {
    if (workbookID) {
      navigate(`/sheet/${workbookID}`, { replace: true })
      return
    }
    navigate("/files", { replace: true })
  }, [navigate, workbookID])

  return null
}

export function App() {
  return (
    <>
      <div className="flex h-svh flex-col overflow-hidden bg-background">
        <FileTabsBar />
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/files" element={<FilesBrowser />} />
          <Route path="/sheet/:id" element={<SheetRoutePage />} />
          <Route path="*" element={<Navigate to="/files" replace />} />
        </Routes>
      </div>
      <Toaster />
    </>
  )
}

export default App
