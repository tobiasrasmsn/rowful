import { useEffect, useRef, type ChangeEvent } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { useSheetStore } from "@/store/sheetStore"
import { getDisplayFileName } from "@/lib/fileName"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function MenuBar() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const uploadFile = useSheetStore((state) => state.uploadFile)
  const recentFiles = useSheetStore((state) => state.recentFiles)
  const openWorkbookByID = useSheetStore((state) => state.openWorkbookByID)
  const refreshRecentFiles = useSheetStore((state) => state.refreshRecentFiles)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    void refreshRecentFiles()
  }, [refreshRecentFiles])

  const onOpenClick = () => {
    inputRef.current?.click()
  }

  const onFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    await uploadFile(file)
    const workbookID = useSheetStore.getState().workbook?.id
    if (workbookID) {
      navigate(`/sheet/${workbookID}`)
    }
    event.target.value = ""
  }

  return (
    <div className="flex h-10 items-center border-b border-border bg-muted/60 px-2">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={onFileSelected}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            File
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Workbook</DropdownMenuLabel>
          <DropdownMenuItem onClick={onOpenClick}>Open...</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Open Recent</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {recentFiles.length === 0 ? (
                <DropdownMenuItem disabled>No recent files</DropdownMenuItem>
              ) : (
                recentFiles.map((file) => (
                  <DropdownMenuItem
                    key={file.id}
                    onClick={async () => {
                      await openWorkbookByID(file.id)
                      navigate(`/sheet/${file.id}`)
                    }}
                  >
                    {getDisplayFileName(file.fileName)}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            Edit
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem disabled>Undo</DropdownMenuItem>
          <DropdownMenuItem disabled>Redo</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>Copy</DropdownMenuItem>
          <DropdownMenuItem disabled>Paste</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            View
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuCheckboxItem checked>
            Grid Lines
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked>
            Formula Bar
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem disabled>Freeze Panes</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto">
        <Button variant="outline" size="sm" onClick={() => navigate("/files")}>
          {location.pathname.startsWith("/files") ? "Files" : "Browse Files"}
        </Button>
      </div>
    </div>
  )
}
