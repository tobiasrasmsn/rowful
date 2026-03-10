import { useEffect } from "react"
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom"
import { toast } from "sonner"

import { AdminAccessPage } from "@/components/AdminAccessPage"
import { CellInspector } from "@/components/CellInspector"
import { DomainsPage } from "@/components/DomainsPage"
import { FileTabsBar } from "@/components/FileTabsBar"
import { FilesBrowser } from "@/components/FilesBrowser"
import { FormatBar } from "@/components/FormatBar"
import { Grid } from "@/components/Grid"
import { KanbanView } from "@/components/KanbanView"
import { LoginPage } from "@/components/LoginPage"
import { SheetTabs } from "@/components/SheetTabs"
import { SignupPage } from "@/components/SignupPage"
import { Toaster } from "@/components/ui/sonner"
import { useAuthStore } from "@/store/authStore"
import { useSheetStore } from "@/store/sheetStore"

function LoadingScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-[linear-gradient(180deg,#f8fafc,#e2e8f0)]">
      <div className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
        Loading Planar...
      </div>
    </div>
  )
}

function SheetWorkspace() {
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
    if (!id || workbookID === id) {
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
    navigate(workbookID ? `/sheet/${workbookID}` : "/files", { replace: true })
  }, [navigate, workbookID])

  return null
}

function RequireAuth() {
  const status = useAuthStore((state) => state.status)
  const isReady = useAuthStore((state) => state.isReady)
  const location = useLocation()

  if (!isReady || status === "loading") {
    return <LoadingScreen />
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

function RequirePublicOnly() {
  const status = useAuthStore((state) => state.status)
  const isReady = useAuthStore((state) => state.isReady)

  if (!isReady || status === "loading") {
    return <LoadingScreen />
  }

  if (status === "authenticated") {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

function RequireAdmin() {
  const user = useAuthStore((state) => state.user)

  if (!user?.isAdmin) {
    return <Navigate to="/files" replace />
  }

  return <Outlet />
}

function AppShell() {
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <FileTabsBar />
      <Outlet />
    </div>
  )
}

export function App() {
  const error = useSheetStore((state) => state.error)
  const initializeAuth = useAuthStore((state) => state.initialize)

  useEffect(() => {
    void initializeAuth()
  }, [initializeAuth])

  useEffect(() => {
    if (!error) {
      return
    }
    toast.error(error, { id: "sheet-error" })
  }, [error])

  return (
    <>
      <Routes>
        <Route element={<RequirePublicOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/files" element={<FilesBrowser />} />
            <Route path="/sheet/:id" element={<SheetRoutePage />} />
            <Route element={<RequireAdmin />}>
              <Route path="/domains" element={<DomainsPage />} />
              <Route path="/admin/access" element={<AdminAccessPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </>
  )
}

export default App
