import { useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { useSheetStore } from "@/store/sheetStore"
import { useAuthStore } from "@/store/authStore"
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
import { FileSpreadsheetIcon, Loader2 } from "lucide-react"

export function FileTabsBar() {
  const workbook = useSheetStore((state) => state.workbook)
  const isLoading = useSheetStore((state) => state.isLoading)
  const renameStoredFile = useSheetStore((state) => state.renameStoredFile)
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const location = useLocation()
  const navigate = useNavigate()
  const [renameOpen, setRenameOpen] = useState(false)
  const [nextName, setNextName] = useState("")

  const isFilesPage = location.pathname.startsWith("/files")
  const isDomainsPage = location.pathname.startsWith("/domains")
  const isAccessPage = location.pathname.startsWith("/admin/access")
  const currentFileName = workbook
    ? getDisplayFileName(workbook.fileName)
    : "No file selected"

  return (
    <div className="px-2 py-2">
      <div className="flex h-full items-center justify-between gap-2">
        <div className="flex min-w-0 flex-row items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
          <FileSpreadsheetIcon size={20} />
          {workbook ? (
            <button
              type="button"
              className="block w-fit truncate text-left text-base hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
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

        {isLoading ? (
          <div className="mr-1 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          {user?.isAdmin ? (
            <Button
              variant={isAccessPage ? "secondary" : "outline"}
              size="sm"
              onClick={() => navigate("/admin/access")}
            >
              Access
            </Button>
          ) : null}
          {user?.isAdmin ? (
            <Button
              variant={isDomainsPage ? "secondary" : "outline"}
              size="sm"
              onClick={() => navigate("/domains")}
            >
              Domains
            </Button>
          ) : null}
          <Button
            variant={isFilesPage ? "secondary" : "outline"}
            size="sm"
            onClick={() => navigate("/files")}
          >
            Browse Files
          </Button>
          <div className="hidden text-right text-xs text-muted-foreground sm:block">
            <div className="font-medium text-foreground">{user?.name ?? user?.email}</div>
            <div>{user?.email}</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await logout()
              navigate("/login", { replace: true })
            }}
          >
            Sign out
          </Button>
        </div>
      </div>

      <div className="h-0.5 w-full bg-transparent">
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
