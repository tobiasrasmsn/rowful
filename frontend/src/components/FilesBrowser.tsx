import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { useNavigate } from "react-router-dom"
import {
  FolderOpen,
  MoreVertical,
  PencilLine,
  Plus,
  Trash2,
  Upload,
} from "lucide-react"

import { useSheetStore } from "@/store/sheetStore"
import {
  buildRenamedFileName,
  buildUntitledSpreadsheetName,
  getDisplayFileName,
} from "@/lib/fileName"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { HugeiconsIcon } from "@hugeicons/react"
import { FileSpreadsheetIcon } from "@hugeicons/core-free-icons"

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
  const createWorkbook = useSheetStore((state) => state.createWorkbook)
  const uploadFile = useSheetStore((state) => state.uploadFile)
  const refreshFiles = useSheetStore((state) => state.refreshFiles)
  const renameStoredFile = useSheetStore((state) => state.renameStoredFile)
  const deleteStoredFile = useSheetStore((state) => state.deleteStoredFile)
  const navigate = useNavigate()

  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false)
  const [activeFileID, setActiveFileID] = useState("")
  const [nextName, setNextName] = useState("")
  const [isCreating, setIsCreating] = useState(false)
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

  const onMobileActionsOpen = (id: string, name: string) => {
    setActiveFileID(id)
    setNextName(getDisplayFileName(name))
    setMobileActionsOpen(true)
  }

  const onImportClick = () => {
    inputRef.current?.click()
  }

  const onCreateClick = () => {
    if (isCreating) {
      return
    }
    setIsCreating(true)
    void (async () => {
      try {
        const createdWorkbook = await createWorkbook(
          buildUntitledSpreadsheetName()
        )
        if (createdWorkbook) {
          navigate(`/sheet/${createdWorkbook.id}`)
        }
      } finally {
        setIsCreating(false)
      }
    })()
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
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col md:h-full md:min-h-0">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={onFileSelected}
        />

        <section className="md:min-h-0 md:flex-1 md:overflow-hidden md:rounded-[28px] md:border md:border-border md:bg-card">
          <div className="px-4 py-3 sm:px-5 md:border-b md:border-border">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-medium">Your Files</div>
                <div className="text-sm text-muted-foreground">
                  Browse, reopen, rename, or delete workbooks
                </div>
              </div>
              <div className="hidden items-center gap-2 md:flex">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCreateClick}
                  disabled={isCreating}
                >
                  {isCreating ? "Creating..." : "New File"}
                </Button>
                <Button
                  size="sm"
                  onClick={onImportClick}
                  disabled={isImporting}
                >
                  {isImporting ? "Importing..." : "Import (.xlsx)"}
                </Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 md:hidden">
              <Button size="sm" onClick={onCreateClick} disabled={isCreating}>
                <Plus className="size-4" />
                {isCreating ? "Creating..." : "New"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onImportClick}
                disabled={isImporting}
              >
                <Upload className="size-4" />
                {isImporting ? "Importing..." : "Import"}
              </Button>
            </div>
            <div className="mt-3 text-sm text-muted-foreground md:hidden">
              {files.length === 0
                ? "No files yet. Start with a blank workbook or import an existing spreadsheet."
                : `${files.length} workbook${files.length === 1 ? "" : "s"} available.`}
            </div>
          </div>

          <div className="md:min-h-0 md:flex-1 md:overflow-auto">
            <div className="space-y-2 p-2 md:hidden">
              {files.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-border bg-background/60 px-4 py-8 text-center">
                  <div className="mx-auto flex size-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <FolderOpen className="size-5" />
                  </div>
                  <div className="mt-3 text-base font-medium">
                    No uploaded files yet
                  </div>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground">
                    Create a workbook or import an `.xlsx` file to get started.
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      onClick={onCreateClick}
                      disabled={isCreating}
                    >
                      <Plus className="size-4" />
                      {isCreating ? "Creating..." : "New"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onImportClick}
                      disabled={isImporting}
                    >
                      <Upload className="size-4" />
                      {isImporting ? "Importing..." : "Import"}
                    </Button>
                  </div>
                </div>
              ) : (
                files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-3 px-2 py-2.5"
                  >
                    <HugeiconsIcon icon={FileSpreadsheetIcon} size={18} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {getDisplayFileName(file.fileName)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/sheet/${file.id}`)}
                    >
                      Open
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() =>
                        onMobileActionsOpen(file.id, file.fileName)
                      }
                      aria-label={`Open actions for ${getDisplayFileName(file.fileName)}`}
                    >
                      <MoreVertical className="size-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead className="border-b text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Last Opened</th>
                    <th className="px-4 py-2 font-medium">Updated</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {files.length === 0 ? (
                    <tr>
                      <td
                        className="px-4 py-8 text-center text-muted-foreground"
                        colSpan={4}
                      >
                        No uploaded files yet
                      </td>
                    </tr>
                  ) : (
                    files.map((file) => (
                      <tr key={file.id} className="border-t border-border">
                        <td className="flex items-center gap-2 px-4 py-2 text-base">
                          <HugeiconsIcon icon={FileSpreadsheetIcon} size={18} />
                          {getDisplayFileName(file.fileName)}
                        </td>
                        <td className="px-4 py-2 text-sm text-muted-foreground">
                          {formatDate(file.lastOpenedAt)}
                        </td>
                        <td className="px-4 py-2 text-sm text-muted-foreground">
                          {formatDate(file.updatedAt)}
                        </td>
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
                              onClick={() =>
                                onRenameOpen(file.id, file.fileName)
                              }
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
        </section>
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

      <Drawer open={mobileActionsOpen} onOpenChange={setMobileActionsOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {activeFile
                ? getDisplayFileName(activeFile.fileName)
                : "File actions"}
            </DrawerTitle>
            <DrawerDescription>
              Rename this workbook or remove it permanently.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                if (!activeFile) {
                  return
                }
                setMobileActionsOpen(false)
                onRenameOpen(activeFile.id, activeFile.fileName)
              }}
            >
              <PencilLine className="size-4" />
              Rename
            </Button>
            <Button
              variant="destructive"
              className="w-full justify-start"
              onClick={() => {
                if (!activeFile) {
                  return
                }
                setMobileActionsOpen(false)
                onDeleteOpen(activeFile.id)
              }}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

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
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
            >
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
