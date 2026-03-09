import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { useNavigate } from "react-router-dom"

import { useSheetStore } from "@/store/sheetStore"
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

const formatDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "-"
  }
  return date.toLocaleString()
}

export function FilesBrowser() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const files = useSheetStore((state) => state.files)
  const uploadFile = useSheetStore((state) => state.uploadFile)
  const refreshFiles = useSheetStore((state) => state.refreshFiles)
  const renameStoredFile = useSheetStore((state) => state.renameStoredFile)
  const deleteStoredFile = useSheetStore((state) => state.deleteStoredFile)
  const navigate = useNavigate()

  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [activeFileID, setActiveFileID] = useState("")
  const [nextName, setNextName] = useState("")
  const [isImporting, setIsImporting] = useState(false)

  useEffect(() => {
    void refreshFiles()
  }, [refreshFiles])

  const activeFile = useMemo(
    () => files.find((file) => file.id === activeFileID) ?? null,
    [files, activeFileID]
  )

  const onRenameOpen = (id: string, name: string) => {
    setActiveFileID(id)
    setNextName(getDisplayFileName(name))
    setRenameOpen(true)
  }

  const onDeleteOpen = (id: string) => {
    setActiveFileID(id)
    setDeleteOpen(true)
  }

  const onImportClick = () => {
    inputRef.current?.click()
  }

  const onFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || isImporting) {
      return
    }

    setIsImporting(true)
    try {
      await uploadFile(file)
      const workbookID = useSheetStore.getState().workbook?.id
      if (workbookID) {
        navigate(`/sheet/${workbookID}`)
      }
    } finally {
      setIsImporting(false)
      event.target.value = ""
    }
  }

  return (
    <div className="min-h-0 flex-1 p-2">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={onFileSelected}
        />

        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="text-sm font-medium">Files</div>
          <Button size="sm" onClick={onImportClick} disabled={isImporting}>
            {isImporting ? "Importing..." : "Import (.xlsx)"}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Last Opened</th>
                <th className="px-4 py-2 font-medium">Updated</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-muted-foreground" colSpan={4}>
                    No uploaded files yet
                  </td>
                </tr>
              ) : (
                files.map((file) => (
                  <tr key={file.id} className="border-t border-border">
                    <td className="px-4 py-2">{getDisplayFileName(file.fileName)}</td>
                    <td className="px-4 py-2">{formatDate(file.lastOpenedAt)}</td>
                    <td className="px-4 py-2">{formatDate(file.updatedAt)}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/sheet/${file.id}`)}
                        >
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRenameOpen(file.id, file.fileName)}
                        >
                          Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onDeleteOpen(file.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
            <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={async () => {
                if (!activeFileID || !activeFile) {
                  return
                }
                await renameStoredFile(
                  activeFileID,
                  buildRenamedFileName(activeFile.fileName, nextName)
                )
                setRenameOpen(false)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete File</DialogTitle>
            <DialogDescription>
              This will remove the workbook and all sheet data permanently.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm">
            {activeFile ? getDisplayFileName(activeFile.fileName) : ""}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                if (!activeFileID) {
                  return
                }
                await deleteStoredFile(activeFileID)
                setDeleteOpen(false)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
