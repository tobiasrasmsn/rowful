import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type ReactNode,
} from "react"
import { useNavigate } from "react-router-dom"
import {
  ChevronRight,
  FileSpreadsheet,
  Folder,
  FolderOpen,
  FolderPlus,
  PencilLine,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react"
import {
  DragDropProvider,
  DragOverlay,
  useDraggable,
  useDroppable,
} from "@dnd-kit/react"

import { cn } from "@/lib/utils"
import { useSheetStore } from "@/store/sheetStore"
import type { FileEntry, FolderEntry } from "@/types/sheet"
import {
  buildRenamedFileName,
  buildUntitledSpreadsheetName,
  getDisplayFileName,
} from "@/lib/fileName"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

const ROOT_ID = ""

type TreeFolderNode = FolderEntry & {
  folders: TreeFolderNode[]
  files: FileEntry[]
}

type SelectedItem =
  | { kind: "file"; id: string }
  | { kind: "folder"; id: string }
  | null

type RenameTarget =
  | { kind: "file"; entry: FileEntry }
  | { kind: "folder"; entry: FolderEntry }
  | null

type DeleteTarget =
  | { kind: "file"; entry: FileEntry }
  | { kind: "folder"; entry: FolderEntry }
  | null

type DragItemData =
  | {
      kind: "file"
      id: string
      folderId: string
      name: string
    }
  | {
      kind: "folder"
      id: string
      parentId: string
      name: string
    }

type DropTargetData =
  | {
      kind: "root"
    }
  | {
      kind: "folder"
      id: string
    }

type DragDropProviderProps = ComponentProps<typeof DragDropProvider>
type FilesDragStartEvent = Parameters<
  NonNullable<DragDropProviderProps["onDragStart"]>
>[0]
type FilesDragOverEvent = Parameters<
  NonNullable<DragDropProviderProps["onDragOver"]>
>[0]
type FilesDragEndEvent = Parameters<
  NonNullable<DragDropProviderProps["onDragEnd"]>
>[0]

const compareByName = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" })

const isDragItemData = (value: unknown): value is DragItemData =>
  Boolean(
    value &&
    typeof value === "object" &&
    "kind" in value &&
    "id" in value &&
    (value as { kind?: unknown }).kind &&
    (value as { id?: unknown }).id
  )

const isDropTargetData = (value: unknown): value is DropTargetData =>
  Boolean(
    value &&
    typeof value === "object" &&
    "kind" in value &&
    ((value as { kind?: unknown }).kind === "root" ||
      ((value as { kind?: unknown }).kind === "folder" &&
        typeof (value as { id?: unknown }).id === "string"))
  )

const sortTree = (folders: TreeFolderNode[]) => {
  folders.sort(compareByName)
  for (const folder of folders) {
    folder.files.sort((left, right) =>
      left.fileName.localeCompare(right.fileName, undefined, {
        sensitivity: "base",
      })
    )
    sortTree(folder.folders)
  }
}

const buildFolderPathMap = (folders: FolderEntry[]) => {
  const byID = new Map(folders.map((folder) => [folder.id, folder]))
  const cache = new Map<string, string>()

  const resolvePath = (folderID: string): string => {
    if (!folderID) {
      return "Top level"
    }
    const cached = cache.get(folderID)
    if (cached) {
      return cached
    }
    const visited = new Set<string>()
    const segments: string[] = []
    let currentID = folderID
    while (currentID) {
      if (visited.has(currentID)) {
        break
      }
      visited.add(currentID)
      const folder = byID.get(currentID)
      if (!folder) {
        break
      }
      segments.unshift(folder.name)
      currentID = folder.parentId
    }
    const path = segments.length > 0 ? segments.join(" / ") : "Top level"
    cache.set(folderID, path)
    return path
  }

  const result = new Map<string, string>()
  result.set(ROOT_ID, "Top level")
  for (const folder of folders) {
    result.set(folder.id, resolvePath(folder.id))
  }
  return result
}

const buildTree = (folders: FolderEntry[], files: FileEntry[]) => {
  const folderMap = new Map<string, TreeFolderNode>()
  for (const folder of folders) {
    folderMap.set(folder.id, {
      ...folder,
      folders: [],
      files: [],
    })
  }

  const rootFolders: TreeFolderNode[] = []
  const rootFiles: FileEntry[] = []

  for (const folder of folders) {
    const node = folderMap.get(folder.id)
    if (!node) {
      continue
    }
    const parent = folder.parentId ? folderMap.get(folder.parentId) : null
    if (parent) {
      parent.folders.push(node)
    } else {
      rootFolders.push(node)
    }
  }

  for (const file of files) {
    const parent = file.folderId ? folderMap.get(file.folderId) : null
    if (parent) {
      parent.files.push(file)
    } else {
      rootFiles.push(file)
    }
  }

  sortTree(rootFolders)
  rootFiles.sort((left, right) =>
    left.fileName.localeCompare(right.fileName, undefined, {
      sensitivity: "base",
    })
  )

  return { rootFolders, rootFiles }
}

const folderHasAncestor = (
  folderID: string,
  ancestorID: string,
  foldersByID: Map<string, FolderEntry>
) => {
  const visited = new Set<string>()
  let currentID = folderID

  while (currentID) {
    if (currentID === ancestorID) {
      return true
    }
    if (visited.has(currentID)) {
      return false
    }
    visited.add(currentID)
    currentID = foldersByID.get(currentID)?.parentId ?? ""
  }

  return false
}

const getPointerCoordinates = (
  event: FilesDragOverEvent | FilesDragEndEvent
): { x: number; y: number } | null => {
  const position = (
    event as {
      operation?: {
        position?: {
          current?: { x?: number; y?: number }
        }
      }
    }
  ).operation?.position?.current

  if (
    !position ||
    typeof position.x !== "number" ||
    typeof position.y !== "number"
  ) {
    return null
  }

  return { x: position.x, y: position.y }
}

function DragPreview({ activeDrag }: { activeDrag: DragItemData | null }) {
  if (!activeDrag) {
    return null
  }

  const Icon = activeDrag.kind === "folder" ? Folder : FileSpreadsheet
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-lg">
      <Icon className="size-4 text-muted-foreground" />
      <span className="max-w-48 truncate text-sm font-medium">
        {activeDrag.name}
      </span>
    </div>
  )
}

function RootDropZone({ children }: { children: ReactNode }) {
  const { ref } = useDroppable<DropTargetData>({
    id: "files-root-drop",
    data: { kind: "root" },
    collisionPriority: 0,
  })

  return <div ref={ref}>{children}</div>
}

function FileRow({
  file,
  selected,
  onOpen,
  onSelect,
  onRename,
  onDelete,
}: {
  file: FileEntry
  selected: boolean
  onOpen: (file: FileEntry) => void
  onSelect: (file: FileEntry) => void
  onRename: (file: FileEntry) => void
  onDelete: (file: FileEntry) => void
}) {
  const { ref, handleRef, isDragSource } = useDraggable<DragItemData>({
    id: `file:${file.id}`,
    data: {
      kind: "file",
      id: file.id,
      folderId: file.folderId,
      name: getDisplayFileName(file.fileName),
    },
  })

  return (
    <div
      ref={ref}
      className={cn(
        "group flex items-center gap-2 rounded-lg px-3 py-1 transition-colors",
        selected ? "border-border bg-muted/70" : "hover:bg-muted/45",
        isDragSource && "opacity-45"
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] py-1.5 text-left outline-none"
        onClick={() => onSelect(file)}
        onDoubleClick={() => onOpen(file)}
      >
        <FileSpreadsheet
          ref={handleRef}
          className="size-4 cursor-grab text-muted-foreground active:cursor-grabbing"
          onClick={(event) => event.stopPropagation()}
          aria-label={`Drag ${getDisplayFileName(file.fileName)}`}
        />
        <span className="min-w-0 truncate text-sm text-foreground">
          {getDisplayFileName(file.fileName)}
        </span>
      </button>
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={(event) => {
            event.stopPropagation()
            onOpen(file)
          }}
          aria-label={`Open ${getDisplayFileName(file.fileName)}`}
        >
          <ChevronRight className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={(event) => {
            event.stopPropagation()
            onRename(file)
          }}
          aria-label={`Rename ${getDisplayFileName(file.fileName)}`}
        >
          <PencilLine className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-destructive hover:text-destructive"
          onClick={(event) => {
            event.stopPropagation()
            onDelete(file)
          }}
          aria-label={`Delete ${getDisplayFileName(file.fileName)}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function FolderRow({
  folder,
  depth,
  expanded,
  selected,
  dropTargetFolderID,
  expandedFolders,
  onExpandedChange,
  onSelect,
  onOpenFile,
  onRenameFile,
  onDeleteFile,
  onRenameFolder,
  onDeleteFolder,
  onCreateFolder,
  onQuickCreateFolder,
  onCreateFile,
  selectedItem,
}: {
  folder: TreeFolderNode
  depth: number
  expanded: boolean
  selected: boolean
  dropTargetFolderID: string | null
  expandedFolders: Record<string, boolean>
  onExpandedChange: (folderID: string, open: boolean) => void
  onSelect: (item: SelectedItem) => void
  onOpenFile: (file: FileEntry) => void
  onRenameFile: (file: FileEntry) => void
  onDeleteFile: (file: FileEntry) => void
  onRenameFolder: (folder: FolderEntry) => void
  onDeleteFolder: (folder: FolderEntry) => void
  onCreateFolder: (parentID: string) => void
  onQuickCreateFolder: (parentID: string) => void
  onCreateFile: (folderID: string) => void
  selectedItem: SelectedItem
}) {
  const { ref: dropRef } = useDroppable<DropTargetData>({
    id: `folder-drop:${folder.id}`,
    data: { kind: "folder", id: folder.id },
    collisionPriority: 2,
  })
  const {
    ref: dragRef,
    handleRef,
    isDragSource,
  } = useDraggable<DragItemData>({
    id: `folder:${folder.id}`,
    data: {
      kind: "folder",
      id: folder.id,
      parentId: folder.parentId,
      name: folder.name,
    },
  })

  const setRefs = useCallback(
    (element: HTMLElement | null) => {
      dropRef(element)
      dragRef(element)
    },
    [dragRef, dropRef]
  )

  const isDropTarget = dropTargetFolderID === folder.id

  return (
    <Collapsible
      open={expanded}
      onOpenChange={(open) => onExpandedChange(folder.id, open)}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setRefs}
            data-folder-row="true"
            data-folder-id={folder.id}
            className={cn(
              "rounded-xl transition-colors",
              selected ? "border-border bg-muted/75" : "",
              isDropTarget ? "border-primary/50 bg-primary/5" : "",
              isDragSource && "opacity-45"
            )}
            onContextMenu={() => onSelect({ kind: "folder", id: folder.id })}
          >
            <div className="group flex items-center gap-2 px-2 py-1 pl-3">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-[12px] py-1.5 text-left outline-none"
                  onClick={() => onSelect({ kind: "folder", id: folder.id })}
                >
                  <ChevronRight
                    className={cn(
                      "size-4 text-muted-foreground transition-transform",
                      expanded && "rotate-90"
                    )}
                  />
                  {expanded ? (
                    <FolderOpen
                      ref={handleRef}
                      className="size-4 cursor-grab text-muted-foreground active:cursor-grabbing"
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Drag ${folder.name}`}
                    />
                  ) : (
                    <Folder
                      ref={handleRef}
                      className="size-4 cursor-grab text-muted-foreground active:cursor-grabbing"
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Drag ${folder.name}`}
                    />
                  )}
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {folder.name}
                  </span>
                </button>
              </CollapsibleTrigger>
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={(event) => {
                    event.stopPropagation()
                    onCreateFolder(folder.id)
                  }}
                  aria-label={`Create a folder inside ${folder.name}`}
                >
                  <FolderPlus className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={(event) => {
                    event.stopPropagation()
                    onRenameFolder(folder)
                  }}
                  aria-label={`Rename ${folder.name}`}
                >
                  <PencilLine className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-destructive hover:text-destructive"
                  onClick={(event) => {
                    event.stopPropagation()
                    onDeleteFolder(folder)
                  }}
                  aria-label={`Delete ${folder.name}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onQuickCreateFolder(folder.id)}>
            <FolderPlus className="size-4" />
            New Folder
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCreateFile(folder.id)}>
            <Plus className="size-4" />
            New File
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <CollapsibleContent className="mt-1 space-y-1">
        {folder.folders.map((child) => (
          <div key={child.id} style={{ paddingLeft: "16px" }}>
            <FolderRow
              folder={child}
              depth={depth + 1}
              expanded={expandedFolders[child.id] ?? true}
              selected={
                selectedItem?.kind === "folder" && selectedItem.id === child.id
              }
              dropTargetFolderID={dropTargetFolderID}
              expandedFolders={expandedFolders}
              onExpandedChange={onExpandedChange}
              onSelect={onSelect}
              onOpenFile={onOpenFile}
              onRenameFile={onRenameFile}
              onDeleteFile={onDeleteFile}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onCreateFolder={onCreateFolder}
              onQuickCreateFolder={onQuickCreateFolder}
              onCreateFile={onCreateFile}
              selectedItem={selectedItem}
            />
          </div>
        ))}
        {folder.files.map((file) => (
          <div key={file.id} style={{ paddingLeft: "16px" }}>
            <FileRow
              file={file}
              selected={
                selectedItem?.kind === "file" && selectedItem.id === file.id
              }
              onOpen={onOpenFile}
              onSelect={(entry) => onSelect({ kind: "file", id: entry.id })}
              onRename={onRenameFile}
              onDelete={onDeleteFile}
            />
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function FilesBrowser() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dropTargetFolderIDRef = useRef<string | null>(null)
  const pendingRootDropTimerRef = useRef<number | null>(null)
  const pendingExpandFolderTimerRef = useRef<number | null>(null)
  const navigate = useNavigate()

  const files = useSheetStore((state) => state.files)
  const folders = useSheetStore((state) => state.folders)
  const createWorkbook = useSheetStore((state) => state.createWorkbook)
  const uploadFile = useSheetStore((state) => state.uploadFile)
  const refreshFiles = useSheetStore((state) => state.refreshFiles)
  const createFolder = useSheetStore((state) => state.createFolder)
  const renameStoredFile = useSheetStore((state) => state.renameStoredFile)
  const renameStoredFolder = useSheetStore((state) => state.renameStoredFolder)
  const moveStoredFile = useSheetStore((state) => state.moveStoredFile)
  const moveStoredFolder = useSheetStore((state) => state.moveStoredFolder)
  const deleteStoredFile = useSheetStore((state) => state.deleteStoredFile)
  const deleteStoredFolder = useSheetStore((state) => state.deleteStoredFolder)

  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null)
  const [expandedFolders, setExpandedFolders] = useState<
    Record<string, boolean>
  >({})
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null)
  const [nextName, setNextName] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [createFolderParentID, setCreateFolderParentID] = useState(ROOT_ID)
  const [createFolderName, setCreateFolderName] = useState("")
  const [pendingImportFolderID, setPendingImportFolderID] = useState(ROOT_ID)
  const [isCreating, setIsCreating] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [activeDrag, setActiveDrag] = useState<DragItemData | null>(null)
  const [dropTargetFolderID, setDropTargetFolderID] = useState<string | null>(
    null
  )
  const [fileSearch, setFileSearch] = useState("")

  useEffect(() => {
    void refreshFiles()
  }, [refreshFiles])

  useEffect(() => {
    setExpandedFolders((current) => {
      const next = { ...current }
      let changed = false
      for (const folder of folders) {
        if (!(folder.id in next)) {
          next[folder.id] = true
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [folders])

  const folderPathMap = useMemo(() => buildFolderPathMap(folders), [folders])
  const foldersByID = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders]
  )
  const { rootFolders, rootFiles } = useMemo(
    () => buildTree(folders, files),
    [files, folders]
  )
  const filteredFiles = useMemo(() => {
    const query = fileSearch.trim().toLowerCase()
    if (!query) {
      return []
    }

    return files
      .filter((file) => {
        const fileName = getDisplayFileName(file.fileName).toLowerCase()
        const folderPath = (
          folderPathMap.get(file.folderId) ?? "Top level"
        ).toLowerCase()

        return fileName.includes(query) || folderPath.includes(query)
      })
      .sort((left, right) =>
        getDisplayFileName(left.fileName).localeCompare(
          getDisplayFileName(right.fileName),
          undefined,
          { sensitivity: "base" }
        )
      )
  }, [fileSearch, files, folderPathMap])

  const selectedFile = useMemo(
    () =>
      selectedItem?.kind === "file"
        ? (files.find((file) => file.id === selectedItem.id) ?? null)
        : null,
    [files, selectedItem]
  )
  const selectedFolder = useMemo(
    () =>
      selectedItem?.kind === "folder"
        ? (folders.find((folder) => folder.id === selectedItem.id) ?? null)
        : null,
    [folders, selectedItem]
  )

  const activeFolderID = selectedFolder?.id ?? selectedFile?.folderId ?? ROOT_ID

  const openFile = useCallback(
    (file: FileEntry) => {
      setSelectedItem({ kind: "file", id: file.id })
      navigate(`/sheet/${file.id}`)
    },
    [navigate]
  )

  const openRenameFile = useCallback((file: FileEntry) => {
    setRenameTarget({ kind: "file", entry: file })
    setNextName(getDisplayFileName(file.fileName))
    setRenameOpen(true)
  }, [])

  const openRenameFolder = useCallback((folder: FolderEntry) => {
    setRenameTarget({ kind: "folder", entry: folder })
    setNextName(folder.name)
    setRenameOpen(true)
  }, [])

  const openDeleteFile = useCallback((file: FileEntry) => {
    setDeleteTarget({ kind: "file", entry: file })
    setDeleteOpen(true)
  }, [])

  const openDeleteFolder = useCallback((folder: FolderEntry) => {
    setDeleteTarget({ kind: "folder", entry: folder })
    setDeleteOpen(true)
  }, [])

  const onImportClick = useCallback(
    (folderID = activeFolderID) => {
      setPendingImportFolderID(folderID)
      inputRef.current?.click()
    },
    [activeFolderID]
  )

  const onCreateClick = useCallback(
    (folderID = activeFolderID) => {
      if (isCreating) {
        return
      }
      setIsCreating(true)
      void (async () => {
        try {
          const createdWorkbook = await createWorkbook(
            buildUntitledSpreadsheetName(),
            folderID
          )
          if (createdWorkbook) {
            setSelectedItem({ kind: "file", id: createdWorkbook.id })
          }
        } finally {
          setIsCreating(false)
        }
      })()
    },
    [activeFolderID, createWorkbook, isCreating]
  )

  const onCreateFolderOpen = useCallback(
    (parentID = activeFolderID) => {
      setCreateFolderParentID(parentID)
      setCreateFolderName("")
      setCreateFolderOpen(true)
    },
    [activeFolderID]
  )

  const onQuickCreateFolder = useCallback(
    async (parentID = ROOT_ID) => {
      const createdFolder = await createFolder(
        "New Folder",
        parentID || undefined
      )
      if (!createdFolder) {
        return
      }
      setExpandedFolders((current) => ({
        ...current,
        [createdFolder.id]: true,
        ...(parentID ? { [parentID]: true } : {}),
      }))
      setSelectedItem({ kind: "folder", id: createdFolder.id })
    },
    [createFolder]
  )

  const onFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || isImporting) {
      return
    }

    setIsImporting(true)
    try {
      await uploadFile(file, pendingImportFolderID)
      const workbookID = useSheetStore.getState().workbook?.id
      if (workbookID) {
        navigate(`/sheet/${workbookID}`)
      }
    } finally {
      setIsImporting(false)
      setPendingImportFolderID(ROOT_ID)
      event.target.value = ""
    }
  }

  const resolveDropFolderID = useCallback((value: unknown) => {
    if (!isDropTargetData(value)) {
      return null
    }
    return value.kind === "root" ? ROOT_ID : value.id
  }, [])

  const resolveHoveredFolderID = useCallback(
    (event: FilesDragOverEvent | FilesDragEndEvent) => {
      const pointer = getPointerCoordinates(event)
      if (!pointer) {
        return null
      }
      const hoveredElement = document.elementFromPoint(pointer.x, pointer.y)
      const hoveredFolderRow = hoveredElement?.closest<HTMLElement>(
        "[data-folder-id]"
      )
      const hoveredFolderID = hoveredFolderRow?.dataset.folderId
      return hoveredFolderID && foldersByID.has(hoveredFolderID)
        ? hoveredFolderID
        : null
    },
    [foldersByID]
  )

  const clearPendingRootDrop = useCallback(() => {
    if (pendingRootDropTimerRef.current !== null) {
      window.clearTimeout(pendingRootDropTimerRef.current)
      pendingRootDropTimerRef.current = null
    }
  }, [])

  const clearPendingExpandFolder = useCallback(() => {
    if (pendingExpandFolderTimerRef.current !== null) {
      window.clearTimeout(pendingExpandFolderTimerRef.current)
      pendingExpandFolderTimerRef.current = null
    }
  }, [])

  const setStableDropTargetFolderID = useCallback((folderID: string | null) => {
    dropTargetFolderIDRef.current = folderID
    setDropTargetFolderID(folderID)
  }, [])

  useEffect(
    () => () => {
      clearPendingRootDrop()
      clearPendingExpandFolder()
    },
    [clearPendingExpandFolder, clearPendingRootDrop]
  )

  const handleDragStart = useCallback((event: FilesDragStartEvent) => {
    const sourceData = event.operation.source?.data
    clearPendingRootDrop()
    clearPendingExpandFolder()
    setStableDropTargetFolderID(null)
    setActiveDrag(isDragItemData(sourceData) ? sourceData : null)
  }, [clearPendingExpandFolder, clearPendingRootDrop, setStableDropTargetFolderID])

  const handleDragOver = useCallback(
    (event: FilesDragOverEvent) => {
      const sourceData = event.operation.source?.data
      const rawTargetFolderID = resolveDropFolderID(event.operation.target?.data)
      const nextTargetFolderID =
        rawTargetFolderID === ROOT_ID
          ? resolveHoveredFolderID(event) ?? ROOT_ID
          : rawTargetFolderID

      if (!isDragItemData(sourceData) || nextTargetFolderID === null) {
        return
      }

      if (
        sourceData.kind === "folder" &&
        nextTargetFolderID &&
        (nextTargetFolderID === sourceData.id ||
          folderHasAncestor(nextTargetFolderID, sourceData.id, foldersByID))
      ) {
        clearPendingRootDrop()
        clearPendingExpandFolder()
        setStableDropTargetFolderID(null)
        return
      }

      clearPendingRootDrop()
      setStableDropTargetFolderID(nextTargetFolderID)

      if (!expandedFolders[nextTargetFolderID]) {
        clearPendingExpandFolder()
        pendingExpandFolderTimerRef.current = window.setTimeout(() => {
          setExpandedFolders((current) => ({
            ...current,
            [nextTargetFolderID]: true,
          }))
          pendingExpandFolderTimerRef.current = null
        }, 300)
        return
      }

      clearPendingExpandFolder()
    },
    [
      clearPendingExpandFolder,
      clearPendingRootDrop,
      expandedFolders,
      foldersByID,
      resolveHoveredFolderID,
      resolveDropFolderID,
      setStableDropTargetFolderID,
    ]
  )

  const handleDragEnd = useCallback(
    async (event: FilesDragEndEvent) => {
      const sourceData = event.operation.source?.data
      const hoveredFolderID = resolveHoveredFolderID(event)
      const targetFolderID =
        dropTargetFolderIDRef.current === ROOT_ID && hoveredFolderID
          ? hoveredFolderID
          : dropTargetFolderIDRef.current

      clearPendingRootDrop()
      clearPendingExpandFolder()
      setActiveDrag(null)
      setStableDropTargetFolderID(null)

      if (
        event.canceled ||
        !isDragItemData(sourceData) ||
        targetFolderID === null
      ) {
        return
      }

      if (sourceData.kind === "file") {
        if (sourceData.folderId === targetFolderID) {
          return
        }
        await moveStoredFile(sourceData.id, targetFolderID)
        setSelectedItem({ kind: "file", id: sourceData.id })
        if (targetFolderID) {
          setExpandedFolders((current) => ({
            ...current,
            [targetFolderID]: true,
          }))
        }
        return
      }

      if (
        sourceData.parentId === targetFolderID ||
        sourceData.id === targetFolderID ||
        (targetFolderID &&
          folderHasAncestor(targetFolderID, sourceData.id, foldersByID))
      ) {
        return
      }

      await moveStoredFolder(sourceData.id, targetFolderID)
      setSelectedItem({ kind: "folder", id: sourceData.id })
      if (targetFolderID) {
        setExpandedFolders((current) => ({
          ...current,
          [targetFolderID]: true,
        }))
      }
    },
    [
      clearPendingExpandFolder,
      clearPendingRootDrop,
      foldersByID,
      moveStoredFile,
      moveStoredFolder,
      resolveHoveredFolderID,
      setStableDropTargetFolderID,
    ]
  )

  const hasItems = folders.length > 0 || files.length > 0
  const hasSearch = fileSearch.trim().length > 0

  return (
    <div className="flex h-dvh min-h-150 w-full flex-1 flex-col items-center justify-center overflow-y-auto">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={onFileSelected}
      />

      <div className="w-full p-4 md:w-3/5 md:p-0">
        <section className="overflow-hidden">
          <h1 className="text-3xl font-medium">Your Workbooks</h1>
          <p className="mb-5 text-sm text-muted-foreground">
            Browse all of your workbooks and folders here.
          </p>
          <DragDropProvider
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={(event) => {
              void handleDragEnd(event)
            }}
          >
            <RootDropZone>
              <div
                className={cn(
                  "rounded-xl border border-border/80 bg-background/70 p-3",
                  dropTargetFolderID === ROOT_ID &&
                    "border-primary/50 bg-primary/5"
                )}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {hasItems ? (
                    <div className="relative min-w-55 flex-1">
                      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={fileSearch}
                        onChange={(event) => setFileSearch(event.target.value)}
                        placeholder="Search files by name or folder"
                        className="pl-9"
                        aria-label="Search files"
                      />
                    </div>
                  ) : null}

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => onCreateFolderOpen()}
                  >
                    <FolderPlus className="size-4" />
                    Folder
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => onCreateClick()}
                    disabled={isCreating}
                  >
                    <Plus className="size-4" />
                    {isCreating ? "Creating..." : "New File"}
                  </Button>
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() => onImportClick()}
                    disabled={isImporting}
                  >
                    <Upload className="size-4" />
                    {isImporting ? "Importing..." : "Import"}
                  </Button>
                </div>

                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div className="min-h-80">
                      {!hasItems ? (
                        <div className="rounded-[22px] border border-dashed border-border bg-background/80 px-4 py-10 text-center">
                          <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                            <FolderOpen className="size-5" />
                          </div>
                          <div className="mt-3 text-base font-medium">
                            Nothing here yet
                          </div>
                          <p className="mt-2 text-sm leading-5 text-muted-foreground">
                            Create a folder, start a workbook, or import an existing
                            `.xlsx` file.
                          </p>
                          <div className="mt-4 flex flex-wrap justify-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onCreateFolderOpen(ROOT_ID)}
                            >
                              <FolderPlus className="size-4" />
                              New Folder
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onCreateClick(ROOT_ID)}
                              disabled={isCreating}
                            >
                              <Plus className="size-4" />
                              {isCreating ? "Creating..." : "New File"}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => onImportClick(ROOT_ID)}
                              disabled={isImporting}
                            >
                              <Upload className="size-4" />
                              {isImporting ? "Importing..." : "Import"}
                            </Button>
                          </div>
                        </div>
                      ) : hasSearch ? (
                        filteredFiles.length === 0 ? (
                          <div className="rounded-[20px] border border-dashed border-border bg-background/80 px-4 py-8 text-center text-sm text-muted-foreground">
                            No files match "{fileSearch.trim()}".
                          </div>
                        ) : (
                          <div className="max-h-80 min-h-80 space-y-2 overflow-auto">
                            {filteredFiles.map((file) => (
                              <div
                                key={file.id}
                                className="group flex items-center gap-3 rounded-2xl border border-border bg-card/80 px-3 py-2"
                              >
                                <button
                                  type="button"
                                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                  onClick={() =>
                                    setSelectedItem({ kind: "file", id: file.id })
                                  }
                                  onDoubleClick={() => openFile(file)}
                                >
                                  <FileSpreadsheet className="size-4 text-muted-foreground" />
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium">
                                      {getDisplayFileName(file.fileName)}
                                    </div>
                                    <div className="truncate text-xs text-muted-foreground">
                                      {folderPathMap.get(file.folderId) ??
                                        "Top level"}
                                    </div>
                                  </div>
                                </button>
                                <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      openFile(file)
                                    }}
                                    aria-label={`Open ${getDisplayFileName(file.fileName)}`}
                                  >
                                    <ChevronRight className="size-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      openRenameFile(file)
                                    }}
                                    aria-label={`Rename ${getDisplayFileName(file.fileName)}`}
                                  >
                                    <PencilLine className="size-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    className="text-destructive hover:text-destructive"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      openDeleteFile(file)
                                    }}
                                    aria-label={`Delete ${getDisplayFileName(file.fileName)}`}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      ) : (
                        <div className="max-h-80 min-h-80 space-y-1 overflow-auto">
                          {rootFolders.map((folder) => (
                            <FolderRow
                              key={folder.id}
                              folder={folder}
                              depth={0}
                              expanded={expandedFolders[folder.id] ?? true}
                              selected={
                                selectedItem?.kind === "folder" &&
                                selectedItem.id === folder.id
                              }
                              dropTargetFolderID={dropTargetFolderID}
                              expandedFolders={expandedFolders}
                              onExpandedChange={(folderID, open) =>
                                setExpandedFolders((current) => ({
                                  ...current,
                                  [folderID]: open,
                                }))
                              }
                              onSelect={setSelectedItem}
                              onOpenFile={openFile}
                              onRenameFile={openRenameFile}
                              onDeleteFile={openDeleteFile}
                              onRenameFolder={openRenameFolder}
                              onDeleteFolder={openDeleteFolder}
                              onCreateFolder={onCreateFolderOpen}
                              onQuickCreateFolder={onQuickCreateFolder}
                              onCreateFile={onCreateClick}
                              selectedItem={selectedItem}
                            />
                          ))}

                          {rootFiles.map((file) => (
                            <FileRow
                              key={file.id}
                              file={file}
                              selected={
                                selectedItem?.kind === "file" &&
                                selectedItem.id === file.id
                              }
                              onOpen={openFile}
                              onSelect={(entry) =>
                                setSelectedItem({ kind: "file", id: entry.id })
                              }
                              onRename={openRenameFile}
                              onDelete={openDeleteFile}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() => onQuickCreateFolder(ROOT_ID)}
                    >
                      <FolderPlus className="size-4" />
                      New Folder
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onCreateClick(ROOT_ID)}>
                      <Plus className="size-4" />
                      New File
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </div>
            </RootDropZone>

            <DragOverlay dropAnimation={null}>
              <DragPreview activeDrag={activeDrag} />
            </DragOverlay>
          </DragDropProvider>
        </section>
      </div>

      <Dialog
        open={createFolderOpen}
        onOpenChange={(open) => {
          setCreateFolderOpen(open)
          if (!open) {
            setCreateFolderName("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
            <DialogDescription>
              Add a new folder inside{" "}
              {folderPathMap.get(createFolderParentID) ?? "Top level"}.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={createFolderName}
            onChange={(event) => setCreateFolderName(event.target.value)}
            placeholder="Folder name"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateFolderOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={async () => {
                const createdFolder = await createFolder(
                  createFolderName,
                  createFolderParentID || undefined
                )
                if (!createdFolder) {
                  return
                }
                setExpandedFolders((current) => ({
                  ...current,
                  [createdFolder.id]: true,
                  ...(createFolderParentID
                    ? { [createFolderParentID]: true }
                    : {}),
                }))
                setSelectedItem({ kind: "folder", id: createdFolder.id })
                setCreateFolderOpen(false)
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          setRenameOpen(open)
          if (!open) {
            setRenameTarget(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {renameTarget?.kind === "folder"
                ? "Rename Folder"
                : "Rename File"}
            </DialogTitle>
            <DialogDescription>
              {renameTarget?.kind === "folder"
                ? "Update the folder name."
                : "Change the display name for this workbook file."}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={nextName}
            onChange={(event) => setNextName(event.target.value)}
            placeholder={
              renameTarget?.kind === "folder" ? "Folder name" : "File name"
            }
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
                if (!renameTarget) {
                  return
                }
                if (renameTarget.kind === "folder") {
                  await renameStoredFolder(renameTarget.entry.id, nextName)
                } else {
                  await renameStoredFile(
                    renameTarget.entry.id,
                    buildRenamedFileName(renameTarget.entry.fileName, nextName)
                  )
                }
                setRenameOpen(false)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open)
          if (!open) {
            setDeleteTarget(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteTarget?.kind === "folder"
                ? "Delete Folder"
                : "Delete File"}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.kind === "folder"
                ? "This will remove the folder and every nested folder and file inside it permanently."
                : "This will remove the workbook and all sheet data permanently."}
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm">
            {deleteTarget?.kind === "folder"
              ? deleteTarget.entry.name
              : deleteTarget
                ? getDisplayFileName(deleteTarget.entry.fileName)
                : ""}
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
                if (!deleteTarget) {
                  return
                }
                if (deleteTarget.kind === "folder") {
                  await deleteStoredFolder(deleteTarget.entry.id)
                  if (
                    selectedItem?.kind === "folder" &&
                    selectedItem.id === deleteTarget.entry.id
                  ) {
                    setSelectedItem(null)
                  }
                } else {
                  await deleteStoredFile(deleteTarget.entry.id)
                  if (
                    selectedItem?.kind === "file" &&
                    selectedItem.id === deleteTarget.entry.id
                  ) {
                    setSelectedItem(null)
                  }
                }
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
