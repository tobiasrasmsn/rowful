import { useEffect, useRef } from "react"
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom"
import { toast } from "sonner"

import { AdminAccessPage } from "@/components/AdminAccessPage"
import { CellInspector } from "@/components/CellInspector"
import { DomainsPage } from "@/components/DomainsPage"
import { FileTabsBar } from "@/components/FileTabsBar"
import { FilesBrowser } from "@/components/FilesBrowser"
import { Grid } from "@/components/Grid"
import { KanbanView } from "@/components/KanbanView"
import { LoginPage } from "@/components/LoginPage"
import { SheetTabs } from "@/components/SheetTabs"
import { SignupPage } from "@/components/SignupPage"
import { UserActionsPopover } from "@/components/UserActionsPopover"
import { Toaster } from "@/components/ui/sonner"
import { useAuthStore } from "@/store/authStore"
import { useSheetStore } from "@/store/sheetStore"

function LoadingScreen() {
  return (
    <div className="loading-screen-surface flex min-h-svh items-center justify-center">
      <div className="rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-md shadow-primary/10">
        Loading Planar...
      </div>
    </div>
  )
}

const parseKanbanQueryId = (raw: string | null) => {
  if (!raw) {
    return ""
  }
  return raw.split("/")[0]?.trim() || ""
}

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

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
      <div className="flex min-w-0 flex-col gap-1 px-2">
        <div className="flex min-w-0 items-center gap-4">
          <FileTabsBar compact className="min-w-0 flex-1" showLoadingStrip={false} />
          <UserActionsPopover className="shrink-0" />
        </div>
        <div className="flex min-w-0 items-end">
          <SheetTabs compact className="min-w-0 flex-1" />
        </div>
      </div>
      <div className="min-h-0 flex-1 p-2 pt-0">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card">
          {activeKanban ? null : <CellInspector />}

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
  const [searchParams, setSearchParams] = useSearchParams()
  const workbookID = useSheetStore((state) => state.workbook?.id)
  const sheetName = useSheetStore((state) => state.sheet?.name)
  const activeWorkspaceTab = useSheetStore((state) => state.activeWorkspaceTab)
  const kanbanRegions = useSheetStore((state) => state.kanbanRegions)
  const openWorkbookByID = useSheetStore((state) => state.openWorkbookByID)
  const loadSheet = useSheetStore((state) => state.loadSheet)
  const setActiveWorkspaceTab = useSheetStore(
    (state) => state.setActiveWorkspaceTab
  )
  const appliedKanbanParamRef = useRef("")
  const pendingKanbanParamRef = useRef("")

  useEffect(() => {
    if (!id || workbookID === id) {
      return
    }
    void openWorkbookByID(id)
  }, [id, workbookID, openWorkbookByID])

  useEffect(() => {
    appliedKanbanParamRef.current = ""
    pendingKanbanParamRef.current = ""
  }, [id])

  useEffect(() => {
    if (!id || workbookID !== id) {
      return
    }
    const rawKanbanParam = (searchParams.get("kanban") ?? "").trim()
    if (!rawKanbanParam) {
      appliedKanbanParamRef.current = ""
      pendingKanbanParamRef.current = ""
      return
    }

    const shouldHydrate =
      rawKanbanParam !== appliedKanbanParamRef.current ||
      rawKanbanParam === pendingKanbanParamRef.current
    if (!shouldHydrate) {
      return
    }

    const kanbanId = parseKanbanQueryId(rawKanbanParam)
    if (!kanbanId) {
      return
    }
    const targetRegion = kanbanRegions.find((region) => region.id === kanbanId)
    if (!targetRegion) {
      const next = new URLSearchParams(searchParams)
      next.delete("kanban")
      setSearchParams(next, { replace: true })
      appliedKanbanParamRef.current = ""
      pendingKanbanParamRef.current = ""
      return
    }

    const targetTab = `kanban:${targetRegion.id}`
    if (sheetName !== targetRegion.sheetName) {
      pendingKanbanParamRef.current = rawKanbanParam
      void loadSheet(targetRegion.sheetName)
      return
    }
    if (activeWorkspaceTab !== targetTab) {
      setActiveWorkspaceTab(targetTab)
    }
    appliedKanbanParamRef.current = rawKanbanParam
    pendingKanbanParamRef.current = ""
  }, [
    activeWorkspaceTab,
    id,
    kanbanRegions,
    loadSheet,
    searchParams,
    setActiveWorkspaceTab,
    setSearchParams,
    sheetName,
    workbookID,
  ])

  useEffect(() => {
    if (!id || workbookID !== id) {
      return
    }

    const queryKanbanId = parseKanbanQueryId(searchParams.get("kanban"))
    const queryRegion = queryKanbanId
      ? kanbanRegions.find((region) => region.id === queryKanbanId)
      : null
    const queryHydrationInProgress =
      Boolean(queryRegion) &&
      (sheetName !== queryRegion?.sheetName ||
        activeWorkspaceTab !== `kanban:${queryRegion?.id}`)
    if (queryHydrationInProgress) {
      return
    }

    const activeKanbanId = activeWorkspaceTab.startsWith("kanban:")
      ? activeWorkspaceTab.slice("kanban:".length)
      : ""
    const activeRegion = activeKanbanId
      ? kanbanRegions.find(
          (region) =>
            region.id === activeKanbanId && region.sheetName === sheetName
        )
      : null
    const nextKanbanValue = activeRegion
      ? `${activeRegion.id}/${slugify(activeRegion.name) || "kanban"}`
      : ""
    const currentKanbanValue = searchParams.get("kanban") ?? ""
    if (currentKanbanValue === nextKanbanValue) {
      return
    }

    const next = new URLSearchParams(searchParams)
    if (nextKanbanValue) {
      next.set("kanban", nextKanbanValue)
    } else {
      next.delete("kanban")
    }
    setSearchParams(next, { replace: true })
    if (!nextKanbanValue) {
      appliedKanbanParamRef.current = ""
      pendingKanbanParamRef.current = ""
    }
  }, [
    activeWorkspaceTab,
    id,
    kanbanRegions,
    searchParams,
    setSearchParams,
    sheetName,
    workbookID,
  ])

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
  const location = useLocation()
  const isSheetRoute = location.pathname.startsWith("/sheet/")

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      {isSheetRoute ? null : (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <FileTabsBar className="min-w-0 flex-1" />
          <UserActionsPopover className="shrink-0" />
        </div>
      )}
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
