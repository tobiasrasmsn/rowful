import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { cn } from "@/lib/utils"
import {
  buildRenamedFileName,
  buildUntitledSpreadsheetName,
  getDisplayFileName,
} from "@/lib/fileName"
import {
  GRID_COPY_SELECTION_EVENT,
  GRID_PASTE_SELECTION_EVENT,
} from "@/lib/gridEvents"
import {
  createSheet as createSheetRequest,
  downloadFileBlob,
  fetchSheet,
  fetchSheetWindow,
  listFiles,
  removeFile,
  saveSheet as saveSheetRequest,
  uploadWorkbook,
} from "@/api/client"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useTheme } from "@/components/theme-provider"
import { useSheetStore } from "@/store/sheetStore"
import { toast } from "sonner"
import { useLocation, useNavigate } from "react-router-dom"
import { HugeiconsIcon } from "@hugeicons/react"
import { ChevronRight, FileSpreadsheetIcon } from "@hugeicons/core-free-icons"
import type { Cell, CellRange, Sheet } from "@/types/sheet"

type FileTabsBarProps = {
  className?: string
  compact?: boolean
  showLoadingStrip?: boolean
}

const APP_NAME = "Rowful"
const FILE_NAME_AUTOSAVE_DELAY_MS = 500

type ImportMode = "new-file" | "add-sheets"
type FunctionTemplate = {
  label: string
  formula: string
}

type FormatOption = {
  label: string
  value: string
}

const MENU_ITEM_CLASSNAME =
  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-50"

const buildDownloadName = (
  fileName: string,
  format: "xlsx" | "csv",
  sheetName?: string
) => {
  const lastDotIndex = fileName.lastIndexOf(".")
  const baseName = lastDotIndex > 0 ? fileName.slice(0, lastDotIndex) : fileName
  if (format === "csv" && sheetName) {
    return `${baseName}-${sheetName}.csv`
  }
  return `${baseName}.${format}`
}

const ensureUniqueSheetName = (
  preferredName: string,
  existingNames: Set<string>
) => {
  const trimmed = preferredName.trim() || "Sheet"
  if (!existingNames.has(trimmed)) {
    existingNames.add(trimmed)
    return trimmed
  }

  let suffix = 2
  let nextName = `${trimmed} (${suffix})`
  while (existingNames.has(nextName)) {
    suffix += 1
    nextName = `${trimmed} (${suffix})`
  }
  existingNames.add(nextName)
  return nextName
}

const triggerBlobDownload = (blob: Blob, fileName: string) => {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}

const getMenuAccelLabel = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "Cmd"
    : "Ctrl"

const isEditableEventTarget = (event: KeyboardEvent) =>
  event
    .composedPath()
    .some(
      (node) =>
        node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement ||
        (node instanceof HTMLElement && node.isContentEditable)
    )

const FUNCTION_TEMPLATES: FunctionTemplate[] = [
  { label: "SUM", formula: "=SUM()" },
  { label: "AVERAGE", formula: "=AVERAGE()" },
  { label: "COUNT", formula: "=COUNT()" },
  { label: "MAX", formula: "=MAX()" },
  { label: "MIN", formula: "=MIN()" },
  { label: "IF", formula: '=IF(test, "yes", "no")' },
]

const NUMBER_FORMAT_OPTIONS: FormatOption[] = [
  { label: "Plain text", value: "text" },
  { label: "Number", value: "number" },
  { label: "Percent", value: "percent" },
  { label: "Currency", value: "currency" },
  { label: "Date", value: "date" },
  { label: "Scientific", value: "scientific" },
]

const ALIGNMENT_OPTIONS: FormatOption[] = [
  { label: "Left", value: "left" },
  { label: "Center", value: "center" },
  { label: "Right", value: "right" },
]

const WRAPPING_OPTIONS: FormatOption[] = [
  { label: "Overflow", value: "overflow" },
  { label: "Wrap", value: "wrap" },
  { label: "Clip", value: "clip" },
]

const NUMBER_FORMAT_BY_NUM_FMT: Record<string, string> = {
  "@": "text",
  "0.00": "number",
  "0.00%": "percent",
  "$#,##0.00": "currency",
  "yyyy-mm-dd": "date",
  "0.00E+00": "scientific",
}

const normalizeCellRange = (range: CellRange) => ({
  rowStart: Math.min(range.rowStart, range.rowEnd),
  rowEnd: Math.max(range.rowStart, range.rowEnd),
  colStart: Math.min(range.colStart, range.colEnd),
  colEnd: Math.max(range.colStart, range.colEnd),
})

const getSelectionBounds = (selection: {
  selectedRow: number
  selectedCol: number
  selectedRange: CellRange | null
}) =>
  selection.selectedRange
    ? normalizeCellRange(selection.selectedRange)
    : {
        rowStart: selection.selectedRow,
        rowEnd: selection.selectedRow,
        colStart: selection.selectedCol,
        colEnd: selection.selectedCol,
      }

const buildCellMatrix = (sheet: Sheet) => {
  const matrix = new Map<number, Map<number, Cell>>()
  for (const row of sheet.rows) {
    matrix.set(
      row.index,
      new Map(row.cells.map((cell) => [cell.col, cell] as const))
    )
  }
  return matrix
}

const getCellInputValue = (cell: Cell | null | undefined) =>
  cell?.formula ? `=${cell.formula}` : (cell?.value ?? "")

export function FileTabsBar({
  className,
  compact = false,
  showLoadingStrip = !compact,
}: FileTabsBarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { resolvedTheme } = useTheme()
  const workbook = useSheetStore((state) => state.workbook)
  const selectedSheetName = useSheetStore((state) => state.selectedSheetName)
  const isLoading = useSheetStore((state) => state.isLoading)
  const createWorkbook = useSheetStore((state) => state.createWorkbook)
  const createSheet = useSheetStore((state) => state.createSheet)
  const uploadFile = useSheetStore((state) => state.uploadFile)
  const loadSheet = useSheetStore((state) => state.loadSheet)
  const renameStoredFile = useSheetStore((state) => state.renameStoredFile)
  const deleteStoredFile = useSheetStore((state) => state.deleteStoredFile)
  const refreshFiles = useSheetStore((state) => state.refreshFiles)
  const refreshRecentFiles = useSheetStore((state) => state.refreshRecentFiles)
  const isFilesRoute = location.pathname === "/files"
  const isSheetRoute = location.pathname.startsWith("/sheet/")
  const inputRef = useRef<HTMLInputElement | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queuedTitleRef = useRef<string | null>(null)
  const saveInFlightRef = useRef(false)
  const exitAfterSaveRef = useRef(false)
  const [editingWorkbookId, setEditingWorkbookId] = useState<string | null>(
    null
  )
  const [savingWorkbookId, setSavingWorkbookId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [editMenuOpen, setEditMenuOpen] = useState(false)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [insertMenuOpen, setInsertMenuOpen] = useState(false)
  const [formatMenuOpen, setFormatMenuOpen] = useState(false)
  const [importPopoverOpen, setImportPopoverOpen] = useState(false)
  const [downloadPopoverOpen, setDownloadPopoverOpen] = useState(false)
  const [viewZoomPopoverOpen, setViewZoomPopoverOpen] = useState(false)
  const [viewShowPopoverOpen, setViewShowPopoverOpen] = useState(false)
  const [insertCellsPopoverOpen, setInsertCellsPopoverOpen] = useState(false)
  const [insertRowsPopoverOpen, setInsertRowsPopoverOpen] = useState(false)
  const [insertColumnsPopoverOpen, setInsertColumnsPopoverOpen] =
    useState(false)
  const [insertFunctionsPopoverOpen, setInsertFunctionsPopoverOpen] =
    useState(false)
  const [formatNumberPopoverOpen, setFormatNumberPopoverOpen] = useState(false)
  const [formatTextPopoverOpen, setFormatTextPopoverOpen] = useState(false)
  const [formatAlignmentPopoverOpen, setFormatAlignmentPopoverOpen] =
    useState(false)
  const [formatWrappingPopoverOpen, setFormatWrappingPopoverOpen] =
    useState(false)
  const [formatClearPopoverOpen, setFormatClearPopoverOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isCreatingWorkbook, setIsCreatingWorkbook] = useState(false)
  const [isDeletingWorkbook, setIsDeletingWorkbook] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [pendingImportMode, setPendingImportMode] = useState<ImportMode | null>(
    null
  )
  const canEditTitle = !isFilesRoute && Boolean(workbook)
  const isEditing = Boolean(workbook) && editingWorkbookId === workbook?.id
  const isSaving = Boolean(workbook) && savingWorkbookId === workbook?.id
  const historyPast = useSheetStore((state) => state.historyPast)
  const historyFuture = useSheetStore((state) => state.historyFuture)
  const undo = useSheetStore((state) => state.undo)
  const redo = useSheetStore((state) => state.redo)
  const zoom = useSheetStore((state) => state.zoom)
  const setZoom = useSheetStore((state) => state.setZoom)
  const showCellInspector = useSheetStore((state) => state.showCellInspector)
  const setShowCellInspector = useSheetStore(
    (state) => state.setShowCellInspector
  )
  const showGridLines = useSheetStore((state) => state.showGridLines)
  const setShowGridLines = useSheetStore((state) => state.setShowGridLines)
  const selectedRow = useSheetStore((state) => state.selectedRow)
  const selectedCol = useSheetStore((state) => state.selectedCol)
  const selectedRange = useSheetStore((state) => state.selectedRange)
  const sheet = useSheetStore((state) => state.sheet)
  const updateCell = useSheetStore((state) => state.updateCell)
  const updateCells = useSheetStore((state) => state.updateCells)
  const insertRowsAt = useSheetStore((state) => state.insertRowsAt)
  const insertColsAt = useSheetStore((state) => state.insertColsAt)
  const selectedStyle = useSheetStore((state) => state.selectedStyle)
  const applyStyle = useSheetStore((state) => state.applyStyle)
  const setNumberFormat = useSheetStore((state) => state.setNumberFormat)
  const clearFormatting = useSheetStore((state) => state.clearFormatting)
  const clearSelectedValues = useSheetStore(
    (state) => state.clearSelectedValues
  )
  const openFind = useSheetStore((state) => state.openFind)
  const title =
    canEditTitle && workbook ? getDisplayFileName(workbook.fileName) : APP_NAME
  const shouldInvertLogo =
    resolvedTheme === "light" ||
    resolvedTheme === "blossom" ||
    resolvedTheme === "matcha"
  const editMenuDisabled = !workbook
  const viewMenuDisabled = !workbook
  const insertMenuDisabled = !workbook || !sheet
  const formatMenuDisabled = !workbook || !sheet
  const accelLabel = getMenuAccelLabel()
  const currentNumberFormat =
    NUMBER_FORMAT_BY_NUM_FMT[selectedStyle.numFmt ?? "@"] ?? "text"
  const currentWrapping =
    selectedStyle.wrapText || selectedStyle.overflow === "wrap"
      ? "wrap"
      : selectedStyle.overflow === "clip"
        ? "clip"
        : "overflow"

  const clearSaveTimer = () => {
    if (!saveTimerRef.current || typeof window === "undefined") {
      return
    }
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
  }

  const flushRename = async () => {
    if (saveInFlightRef.current) {
      return
    }

    const latestWorkbook = useSheetStore.getState().workbook
    if (!latestWorkbook || !workbook || latestWorkbook.id !== workbook.id) {
      queuedTitleRef.current = null
      setSavingWorkbookId(null)
      if (exitAfterSaveRef.current) {
        exitAfterSaveRef.current = false
        setEditingWorkbookId(null)
      }
      return
    }

    const queuedTitle = queuedTitleRef.current
    if (queuedTitle === null) {
      setSavingWorkbookId(null)
      if (exitAfterSaveRef.current) {
        exitAfterSaveRef.current = false
        setEditingWorkbookId(null)
      }
      return
    }

    queuedTitleRef.current = null
    const normalizedTitle =
      queuedTitle.trim() || getDisplayFileName(latestWorkbook.fileName)
    const nextFileName = buildRenamedFileName(
      latestWorkbook.fileName,
      normalizedTitle
    )

    if (nextFileName === latestWorkbook.fileName) {
      setDraftTitle(normalizedTitle)
      setSavingWorkbookId(null)
      if (exitAfterSaveRef.current) {
        exitAfterSaveRef.current = false
        setEditingWorkbookId(null)
      }
      return
    }

    saveInFlightRef.current = true
    setSavingWorkbookId(latestWorkbook.id)

    await renameStoredFile(latestWorkbook.id, nextFileName)

    const refreshedWorkbook = useSheetStore.getState().workbook
    if (
      queuedTitleRef.current === null &&
      refreshedWorkbook?.id === latestWorkbook.id
    ) {
      setDraftTitle(getDisplayFileName(refreshedWorkbook.fileName))
    }

    saveInFlightRef.current = false

    if (queuedTitleRef.current !== null) {
      void flushRename()
      return
    }

    setSavingWorkbookId(null)
    if (exitAfterSaveRef.current) {
      exitAfterSaveRef.current = false
      setEditingWorkbookId(null)
    }
  }

  const scheduleRename = (nextTitle: string) => {
    queuedTitleRef.current = nextTitle
    clearSaveTimer()
    if (typeof window === "undefined") {
      void flushRename()
      return
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushRename()
    }, FILE_NAME_AUTOSAVE_DELAY_MS)
  }

  const startEditing = () => {
    if (!canEditTitle || !workbook) {
      return
    }
    exitAfterSaveRef.current = false
    setDraftTitle(getDisplayFileName(workbook.fileName))
    setEditingWorkbookId(workbook.id)
  }

  const finishEditing = () => {
    if (!canEditTitle) {
      return
    }
    clearSaveTimer()
    queuedTitleRef.current = draftTitle
    exitAfterSaveRef.current = true
    void flushRename()
  }

  const cancelEditing = () => {
    clearSaveTimer()
    queuedTitleRef.current = null
    exitAfterSaveRef.current = false
    setSavingWorkbookId(null)
    setDraftTitle(title)
    setEditingWorkbookId(null)
  }

  const handleCreateSheet = async () => {
    if (!workbook) {
      return
    }
    setFileMenuOpen(false)
    setImportPopoverOpen(false)
    setDownloadPopoverOpen(false)
    await createSheet()
  }

  const handleCreateWorkbook = async () => {
    if (isCreatingWorkbook) {
      return
    }
    setFileMenuOpen(false)
    setImportPopoverOpen(false)
    setDownloadPopoverOpen(false)
    setIsCreatingWorkbook(true)
    try {
      const createdWorkbook = await createWorkbook(
        buildUntitledSpreadsheetName()
      )
      if (createdWorkbook) {
        navigate(`/sheet/${createdWorkbook.id}`)
      }
    } finally {
      setIsCreatingWorkbook(false)
    }
  }

  const openImportPicker = (mode: ImportMode) => {
    if (mode === "add-sheets" && !workbook) {
      return
    }
    setPendingImportMode(mode)
    importInputRef.current?.click()
  }

  const handleImportIntoCurrentFile = async (file: File) => {
    const targetWorkbook = useSheetStore.getState().workbook
    const currentSheetName =
      useSheetStore.getState().selectedSheetName || targetWorkbook?.activeSheet
    if (!targetWorkbook || !currentSheetName) {
      throw new Error("Open a workbook before importing sheets into it.")
    }

    let tempWorkbookId = ""
    let shouldDeleteUploadedWorkbook = false

    try {
      const existingFiles = await listFiles()
      const existingFileIds = new Set(
        existingFiles.files.map((entry) => entry.id)
      )
      const uploaded = await uploadWorkbook(file)
      tempWorkbookId = uploaded.workbook.id
      shouldDeleteUploadedWorkbook = !existingFileIds.has(uploaded.workbook.id)

      const existingNames = new Set(
        targetWorkbook.sheets.map((sheetMeta) => sheetMeta.name)
      )
      let importedCount = 0

      for (const sheetMeta of uploaded.workbook.sheets) {
        const uniqueName = ensureUniqueSheetName(sheetMeta.name, existingNames)
        const importedSheetPayload = await fetchSheet(
          uploaded.workbook.id,
          sheetMeta.name,
          {
            rowStart: 1,
            rowCount: Math.max(1, sheetMeta.maxRow),
            colStart: 1,
            colCount: Math.max(1, sheetMeta.maxCol),
          }
        )
        const createdSheetPayload = await createSheetRequest(
          targetWorkbook.id,
          {
            name: uniqueName,
          }
        )

        await saveSheetRequest(targetWorkbook.id, {
          sheet: {
            ...importedSheetPayload.sheet,
            name: uniqueName,
            index: createdSheetPayload.sheet.index,
          },
        })
        importedCount += 1
      }

      await loadSheet(currentSheetName)
      await Promise.all([refreshFiles(), refreshRecentFiles()])
      toast.success(
        importedCount === 1
          ? "Imported 1 sheet into this file."
          : `Imported ${importedCount} sheets into this file.`
      )
    } finally {
      if (tempWorkbookId && shouldDeleteUploadedWorkbook) {
        try {
          await removeFile(tempWorkbookId)
          await Promise.all([refreshFiles(), refreshRecentFiles()])
        } catch {
          // Ignore cleanup errors; the imported content is already in the target file.
        }
      }
    }
  }

  const handleImportSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    const mode = pendingImportMode
    event.target.value = ""

    if (!file || !mode || isImporting) {
      return
    }

    setIsImporting(true)
    setFileMenuOpen(false)
    setImportPopoverOpen(false)
    setDownloadPopoverOpen(false)

    try {
      if (mode === "new-file") {
        const previousWorkbookId = useSheetStore.getState().workbook?.id ?? null
        await uploadFile(file)
        const workbookID = useSheetStore.getState().workbook?.id
        if (workbookID && workbookID !== previousWorkbookId) {
          navigate(`/sheet/${workbookID}`)
          toast.success("Imported workbook as a new file.")
        }
        return
      }

      await handleImportIntoCurrentFile(file)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to import workbook"
      )
    } finally {
      setPendingImportMode(null)
      setIsImporting(false)
    }
  }

  const handleDeleteWorkbook = async () => {
    if (!workbook || isDeletingWorkbook) {
      return
    }

    const deletingWorkbookId = workbook.id
    setIsDeletingWorkbook(true)
    try {
      await deleteStoredFile(deletingWorkbookId)
      if (useSheetStore.getState().workbook?.id !== deletingWorkbookId) {
        setDeleteDialogOpen(false)
        setFileMenuOpen(false)
        setImportPopoverOpen(false)
        setDownloadPopoverOpen(false)
        navigate("/files")
      }
    } finally {
      setIsDeletingWorkbook(false)
    }
  }

  const handleDownload = async (format: "xlsx" | "csv") => {
    if (!workbook || isDownloading) {
      return
    }

    setIsDownloading(true)
    try {
      const blob = await downloadFileBlob(workbook.id, {
        format,
        sheet:
          format === "csv"
            ? selectedSheetName || workbook.activeSheet
            : undefined,
      })

      triggerBlobDownload(
        blob,
        buildDownloadName(
          workbook.fileName,
          format,
          format === "csv"
            ? selectedSheetName || workbook.activeSheet
            : undefined
        )
      )
      setFileMenuOpen(false)
      setImportPopoverOpen(false)
      setDownloadPopoverOpen(false)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to download file"
      )
    } finally {
      setIsDownloading(false)
    }
  }

  const dispatchGridEvent = (name: string, detail?: Record<string, string>) => {
    if (typeof window === "undefined") {
      return
    }
    window.dispatchEvent(new CustomEvent(name, { detail }))
  }

  const handleCopySelection = () => {
    if (!workbook) {
      return
    }
    dispatchGridEvent(GRID_COPY_SELECTION_EVENT)
    setEditMenuOpen(false)
  }

  const handlePasteSelection = () => {
    if (!workbook) {
      return
    }
    dispatchGridEvent(GRID_PASTE_SELECTION_EVENT)
    setEditMenuOpen(false)
  }

  const handleOpenFind = () => {
    if (!workbook) {
      return
    }
    openFind()
    setEditMenuOpen(false)
  }

  const closeInsertMenus = () => {
    setInsertMenuOpen(false)
    setInsertCellsPopoverOpen(false)
    setInsertRowsPopoverOpen(false)
    setInsertColumnsPopoverOpen(false)
    setInsertFunctionsPopoverOpen(false)
  }

  const closeFormatMenus = () => {
    setFormatMenuOpen(false)
    setFormatNumberPopoverOpen(false)
    setFormatTextPopoverOpen(false)
    setFormatAlignmentPopoverOpen(false)
    setFormatWrappingPopoverOpen(false)
    setFormatClearPopoverOpen(false)
  }

  const handleInsertCellShift = async (direction: "right" | "down") => {
    if (!workbook || !sheet) {
      return
    }

    const selection = getSelectionBounds({
      selectedRow,
      selectedCol,
      selectedRange,
    })

    try {
      if (direction === "right") {
        const width = selection.colEnd - selection.colStart + 1
        const payload = await fetchSheetWindow(workbook.id, {
          sheet: sheet.name,
          rowStart: selection.rowStart,
          rowCount: selection.rowEnd - selection.rowStart + 1,
          colStart: selection.colStart,
          colCount: Math.max(1, sheet.maxCol - selection.colStart + 1),
        })
        const matrix = buildCellMatrix(payload.sheet)
        const updates: Array<{ row: number; col: number; value: string }> = []

        for (let row = selection.rowStart; row <= selection.rowEnd; row += 1) {
          const rowCells = matrix.get(row)
          for (let col = sheet.maxCol; col >= selection.colStart; col -= 1) {
            updates.push({
              row,
              col: col + width,
              value: getCellInputValue(rowCells?.get(col)),
            })
          }
          for (
            let col = selection.colStart;
            col < selection.colStart + width;
            col += 1
          ) {
            updates.push({ row, col, value: "" })
          }
        }

        await updateCells(updates)
      } else {
        const height = selection.rowEnd - selection.rowStart + 1
        const payload = await fetchSheetWindow(workbook.id, {
          sheet: sheet.name,
          rowStart: selection.rowStart,
          rowCount: Math.max(1, sheet.maxRow - selection.rowStart + 1),
          colStart: selection.colStart,
          colCount: selection.colEnd - selection.colStart + 1,
        })
        const matrix = buildCellMatrix(payload.sheet)
        const updates: Array<{ row: number; col: number; value: string }> = []

        for (let row = sheet.maxRow; row >= selection.rowStart; row -= 1) {
          for (
            let col = selection.colStart;
            col <= selection.colEnd;
            col += 1
          ) {
            updates.push({
              row: row + height,
              col,
              value: getCellInputValue(matrix.get(row)?.get(col)),
            })
          }
        }
        for (
          let row = selection.rowStart;
          row < selection.rowStart + height;
          row += 1
        ) {
          for (
            let col = selection.colStart;
            col <= selection.colEnd;
            col += 1
          ) {
            updates.push({ row, col, value: "" })
          }
        }

        await updateCells(updates)
      }

      closeInsertMenus()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to insert cells"
      )
    }
  }

  const handleInsertFunctionTemplate = async (formula: string) => {
    if (!sheet) {
      return
    }
    try {
      await updateCell(selectedRow, selectedCol, formula)
      closeInsertMenus()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to insert function template"
      )
    }
  }

  const handleApplyTextStyle = async (
    patch:
      | { bold: boolean }
      | { italic: boolean }
      | { underline: boolean }
      | { strike: boolean }
  ) => {
    try {
      await applyStyle(patch)
      closeFormatMenus()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update text style"
      )
    }
  }

  const handleSetNumberFormat = async (value: string) => {
    try {
      await setNumberFormat(value)
      closeFormatMenus()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update number format"
      )
    }
  }

  const handleSetAlignment = async (value: string) => {
    try {
      await applyStyle({ hAlign: value })
      closeFormatMenus()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update alignment"
      )
    }
  }

  const handleSetWrapping = async (value: string) => {
    try {
      await applyStyle({
        overflow: value,
        wrapText: value === "wrap",
      })
      closeFormatMenus()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update wrapping"
      )
    }
  }

  const handleClearFormatting = async () => {
    try {
      await clearFormatting()
      closeFormatMenus()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to clear formatting"
      )
    }
  }

  const handleClearContent = async () => {
    try {
      await clearSelectedValues()
      closeFormatMenus()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to clear content"
      )
    }
  }

  useEffect(() => {
    if (!isEditing) {
      return
    }
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  useEffect(
    () => () => {
      clearSaveTimer()
    },
    []
  )

  useEffect(() => {
    if (!fileMenuOpen) {
      setImportPopoverOpen(false)
      setDownloadPopoverOpen(false)
    }
  }, [fileMenuOpen])

  useEffect(() => {
    if (!viewMenuOpen) {
      setViewZoomPopoverOpen(false)
      setViewShowPopoverOpen(false)
    }
  }, [viewMenuOpen])

  useEffect(() => {
    if (!insertMenuOpen) {
      setInsertCellsPopoverOpen(false)
      setInsertRowsPopoverOpen(false)
      setInsertColumnsPopoverOpen(false)
      setInsertFunctionsPopoverOpen(false)
    }
  }, [insertMenuOpen])

  useEffect(() => {
    if (!formatMenuOpen) {
      setFormatNumberPopoverOpen(false)
      setFormatTextPopoverOpen(false)
      setFormatAlignmentPopoverOpen(false)
      setFormatWrappingPopoverOpen(false)
      setFormatClearPopoverOpen(false)
    }
  }, [formatMenuOpen])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!workbook || event.defaultPrevented) {
        return
      }
      if (isEditableEventTarget(event)) {
        return
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return
      }
      const key = event.key.toLowerCase()

      if (key === "z" && event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        void redo()
        return
      }
      if (key === "z") {
        event.preventDefault()
        event.stopPropagation()
        void undo()
        return
      }
      if (key === "y") {
        event.preventDefault()
        event.stopPropagation()
        void redo()
        return
      }
      if (key === "f") {
        event.preventDefault()
        event.stopPropagation()
        openFind()
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [openFind, redo, undo, workbook])

  return (
    <div className={cn(compact ? "px-0 py-0" : "px-2 py-2", className)}>
      <input
        ref={importInputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={handleImportSelected}
      />
      <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm text-foreground/90">
        {title === "Rowful" ? (
          <img
            src="/logo.png"
            alt="Rowful Logo"
            className={cn("size-6", shouldInvertLogo && "invert")}
          />
        ) : (
          <HugeiconsIcon icon={FileSpreadsheetIcon} size={18} />
        )}
        {isEditing ? (
          <Input
            ref={inputRef}
            value={draftTitle}
            onChange={(event) => {
              const nextTitle = event.target.value
              setDraftTitle(nextTitle)
              exitAfterSaveRef.current = false
              scheduleRename(nextTitle)
            }}
            onBlur={finishEditing}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                finishEditing()
                return
              }
              if (event.key === "Escape") {
                event.preventDefault()
                cancelEditing()
              }
            }}
            aria-label="File name"
            className="h-9 max-w-md min-w-0 flex-1 px-0! text-lg font-medium underline focus-within:border-0! focus-within:ring-0! focus-within:outline-none!"
          />
        ) : (
          <span
            onDoubleClick={startEditing}
            className={cn(
              "font-medium",
              title === "Rowful"
                ? "text-xl"
                : "block w-fit max-w-full truncate text-lg",
              canEditTitle && "cursor-text select-none",
              isSaving && "text-foreground/70"
            )}
            title={canEditTitle ? "Double-click to rename" : undefined}
          >
            {title}
          </span>
        )}
      </div>
      <div className={cn("hidden md:block", !isSheetRoute && "md:hidden")}>
        <ul className="flex -translate-x-1.5 flex-row items-center gap-4 px-3 text-[13px] text-muted-foreground">
          <li>
            <Popover open={fileMenuOpen} onOpenChange={setFileMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="h-fit rounded-md px-2 py-px transition-colors duration-200 hover:bg-muted hover:text-foreground"
                >
                  File
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={10}
                className="w-48 rounded-xl border-border/70 p-2"
              >
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => void handleCreateSheet()}
                    disabled={!workbook}
                    className={MENU_ITEM_CLASSNAME}
                  >
                    <span>New spreadsheet</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void handleCreateWorkbook()
                    }}
                    disabled={isCreatingWorkbook}
                    className={MENU_ITEM_CLASSNAME}
                  >
                    <span>
                      {isCreatingWorkbook
                        ? "Creating document..."
                        : "New document"}
                    </span>
                  </button>

                  <Popover
                    open={importPopoverOpen}
                    onOpenChange={setImportPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button type="button" className={MENU_ITEM_CLASSNAME}>
                        <span>Import</span>
                        <HugeiconsIcon icon={ChevronRight} size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="w-72 rounded-xl border-border/70 p-3"
                    >
                      <div className="space-y-2">
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {workbook
                            ? "Import as a separate file, or pull every sheet from an .xlsx workbook into the file you already have open."
                            : "Open a file to enable adding imported sheets into the current workbook."}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="flex-1"
                            onClick={() => openImportPicker("new-file")}
                            disabled={isImporting}
                          >
                            New file
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => openImportPicker("add-sheets")}
                            disabled={!workbook || isImporting}
                          >
                            Add sheets
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Popover
                    open={downloadPopoverOpen}
                    onOpenChange={setDownloadPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={!workbook}
                        className={MENU_ITEM_CLASSNAME}
                      >
                        <span>Download</span>
                        <HugeiconsIcon icon={ChevronRight} size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="w-72 rounded-xl border-border/70 p-3"
                    >
                      <div className="space-y-2">
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          XLSX downloads the full workbook. CSV downloads the
                          active sheet only.
                        </p>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="flex-1"
                            onClick={() => void handleDownload("xlsx")}
                            disabled={isDownloading}
                          >
                            XLSX
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => void handleDownload("csv")}
                            disabled={isDownloading}
                          >
                            CSV
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteDialogOpen(true)
                      setFileMenuOpen(false)
                      setImportPopoverOpen(false)
                      setDownloadPopoverOpen(false)
                    }}
                    disabled={!workbook}
                    className={cn(
                      MENU_ITEM_CLASSNAME,
                      "text-destructive hover:bg-destructive/10 hover:text-destructive"
                    )}
                  >
                    <span>Delete</span>
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </li>
          <li>
            <Popover open={editMenuOpen} onOpenChange={setEditMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={editMenuDisabled}
                  className="h-fit rounded-md px-2 py-px transition-colors duration-200 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Edit
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={10}
                className="w-72 rounded-xl border-border/70 p-2"
              >
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      void undo()
                      setEditMenuOpen(false)
                    }}
                    disabled={historyPast.length === 0 || !workbook}
                    className={MENU_ITEM_CLASSNAME}
                  >
                    <span>Undo</span>
                    <KbdGroup>
                      <Kbd>{accelLabel}</Kbd>
                      <Kbd>Z</Kbd>
                    </KbdGroup>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void redo()
                      setEditMenuOpen(false)
                    }}
                    disabled={historyFuture.length === 0 || !workbook}
                    className={MENU_ITEM_CLASSNAME}
                  >
                    <span>Redo</span>
                    <KbdGroup>
                      <Kbd>{accelLabel}</Kbd>
                      <Kbd>Shift</Kbd>
                      <Kbd>Z</Kbd>
                    </KbdGroup>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopySelection}
                    disabled={!workbook}
                    className={MENU_ITEM_CLASSNAME}
                  >
                    <span>Copy</span>
                    <KbdGroup>
                      <Kbd>{accelLabel}</Kbd>
                      <Kbd>C</Kbd>
                    </KbdGroup>
                  </button>
                  <button
                    type="button"
                    onClick={handlePasteSelection}
                    disabled={!workbook}
                    className={MENU_ITEM_CLASSNAME}
                  >
                    <span>Paste</span>
                    <KbdGroup>
                      <Kbd>{accelLabel}</Kbd>
                      <Kbd>V</Kbd>
                    </KbdGroup>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenFind}
                    disabled={!workbook}
                    className={MENU_ITEM_CLASSNAME}
                  >
                    <span>Find</span>
                    <KbdGroup>
                      <Kbd>{accelLabel}</Kbd>
                      <Kbd>F</Kbd>
                    </KbdGroup>
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </li>
          <li>
            <Popover open={viewMenuOpen} onOpenChange={setViewMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={viewMenuDisabled}
                  className="h-fit rounded-md px-2 py-px transition-colors duration-200 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  View
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={10}
                className="w-44 rounded-xl border-border/70 p-2"
              >
                <div className="space-y-1">
                  <Popover
                    open={viewZoomPopoverOpen}
                    onOpenChange={setViewZoomPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button type="button" className={MENU_ITEM_CLASSNAME}>
                        <span>Zoom</span>
                        <HugeiconsIcon icon={ChevronRight} size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="w-64 rounded-xl border-border/70 p-3"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">Zoom</div>
                            <div className="text-xs text-muted-foreground">
                              Adjust the current sheet scale
                            </div>
                          </div>
                          <div className="text-sm font-medium tabular-nums">
                            {zoom}%
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => setZoom(zoom - 10)}
                          >
                            -10%
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="flex-1"
                            onClick={() => setZoom(zoom + 10)}
                          >
                            +10%
                          </Button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {[50, 75, 100, 125, 150, 200].map((value) => (
                            <Button
                              key={value}
                              type="button"
                              size="sm"
                              variant={zoom === value ? "default" : "outline"}
                              onClick={() => setZoom(value)}
                            >
                              {value}%
                            </Button>
                          ))}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Popover
                    open={viewShowPopoverOpen}
                    onOpenChange={setViewShowPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button type="button" className={MENU_ITEM_CLASSNAME}>
                        <span>Show</span>
                        <HugeiconsIcon icon={ChevronRight} size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="w-72 rounded-xl border-border/70 p-3"
                    >
                      <div className="space-y-2">
                        <div className="text-xs leading-relaxed text-muted-foreground">
                          Toggle sheet interface elements on or off.
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setShowCellInspector(!showCellInspector)
                          }
                          className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-muted/40"
                        >
                          <div>
                            <div className="text-sm font-medium">
                              Cell inspector
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Show the address and formula/value bar
                            </div>
                          </div>
                          <span className="text-xs font-medium text-muted-foreground">
                            {showCellInspector ? "On" : "Off"}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowGridLines(!showGridLines)}
                          className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-muted/40"
                        >
                          <div>
                            <div className="text-sm font-medium">
                              Grid lines
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Show cell borders inside the spreadsheet
                            </div>
                          </div>
                          <span className="text-xs font-medium text-muted-foreground">
                            {showGridLines ? "On" : "Off"}
                          </span>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </PopoverContent>
            </Popover>
          </li>
          <li>
            <Popover open={insertMenuOpen} onOpenChange={setInsertMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={insertMenuDisabled}
                  className="h-fit rounded-md px-2 py-px transition-colors duration-200 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Insert
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={10}
                className="w-48 rounded-xl border-border/70 p-2"
              >
                <div className="space-y-1">
                  <Popover
                    open={insertCellsPopoverOpen}
                    onOpenChange={setInsertCellsPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button type="button" className={MENU_ITEM_CLASSNAME}>
                        <span>Cells</span>
                        <HugeiconsIcon icon={ChevronRight} size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="w-72 rounded-xl border-border/70 p-3"
                    >
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => void handleInsertCellShift("right")}
                          className={MENU_ITEM_CLASSNAME}
                        >
                          <span>Insert cell and shift right</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleInsertCellShift("down")}
                          className={MENU_ITEM_CLASSNAME}
                        >
                          <span>Insert cell and shift down</span>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Popover
                    open={insertRowsPopoverOpen}
                    onOpenChange={setInsertRowsPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button type="button" className={MENU_ITEM_CLASSNAME}>
                        <span>Rows</span>
                        <HugeiconsIcon icon={ChevronRight} size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="w-64 rounded-xl border-border/70 p-3"
                    >
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => {
                            void insertRowsAt(selectedRow, 1)
                            closeInsertMenus()
                          }}
                          className={MENU_ITEM_CLASSNAME}
                        >
                          <span>Insert 1 row above</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void insertRowsAt(selectedRow + 1, 1)
                            closeInsertMenus()
                          }}
                          className={MENU_ITEM_CLASSNAME}
                        >
                          <span>Insert 1 row below</span>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Popover
                    open={insertColumnsPopoverOpen}
                    onOpenChange={setInsertColumnsPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button type="button" className={MENU_ITEM_CLASSNAME}>
                        <span>Columns</span>
                        <HugeiconsIcon icon={ChevronRight} size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="w-72 rounded-xl border-border/70 p-3"
                    >
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => {
                            void insertColsAt(selectedCol, 1)
                            closeInsertMenus()
                          }}
                          className={MENU_ITEM_CLASSNAME}
                        >
                          <span>Insert 1 column left</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void insertColsAt(selectedCol + 1, 1)
                            closeInsertMenus()
                          }}
                          className={MENU_ITEM_CLASSNAME}
                        >
                          <span>Insert 1 column right</span>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Popover
                    open={insertFunctionsPopoverOpen}
                    onOpenChange={setInsertFunctionsPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button type="button" className={MENU_ITEM_CLASSNAME}>
                        <span>Function</span>
                        <HugeiconsIcon icon={ChevronRight} size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="w-72 rounded-xl border-border/70 p-3"
                    >
                      <div className="space-y-1">
                        {FUNCTION_TEMPLATES.map((template) => (
                          <button
                            key={template.label}
                            type="button"
                            onClick={() =>
                              void handleInsertFunctionTemplate(
                                template.formula
                              )
                            }
                            className={MENU_ITEM_CLASSNAME}
                          >
                            <span>{template.label}</span>
                            <Kbd>{template.formula}</Kbd>
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </PopoverContent>
            </Popover>
          </li>
          <li>
            <Popover open={formatMenuOpen} onOpenChange={setFormatMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={formatMenuDisabled}
                  className="h-fit rounded-md px-2 py-px transition-colors duration-200 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Format
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={10}
                className="w-48 rounded-xl border-border/70 p-2"
              >
                <div className="space-y-1">
                  <Popover
                    open={formatNumberPopoverOpen}
                    onOpenChange={setFormatNumberPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button type="button" className={MENU_ITEM_CLASSNAME}>
                        <span>Number</span>
                        <HugeiconsIcon icon={ChevronRight} size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="w-64 rounded-xl border-border/70 p-3"
                    >
                      <div className="space-y-1">
                        {NUMBER_FORMAT_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() =>
                              void handleSetNumberFormat(option.value)
                            }
                            className={MENU_ITEM_CLASSNAME}
                          >
                            <span>{option.label}</span>
                            {currentNumberFormat === option.value ? (
                              <Kbd>Active</Kbd>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Popover
                    open={formatTextPopoverOpen}
                    onOpenChange={setFormatTextPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button type="button" className={MENU_ITEM_CLASSNAME}>
                        <span>Text</span>
                        <HugeiconsIcon icon={ChevronRight} size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="w-64 rounded-xl border-border/70 p-3"
                    >
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() =>
                            void handleApplyTextStyle({
                              bold: !selectedStyle.bold,
                            })
                          }
                          className={MENU_ITEM_CLASSNAME}
                        >
                          <span>Bold</span>
                          {selectedStyle.bold ? <Kbd>On</Kbd> : null}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleApplyTextStyle({
                              italic: !selectedStyle.italic,
                            })
                          }
                          className={MENU_ITEM_CLASSNAME}
                        >
                          <span>Italic</span>
                          {selectedStyle.italic ? <Kbd>On</Kbd> : null}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleApplyTextStyle({
                              underline: !selectedStyle.underline,
                            })
                          }
                          className={MENU_ITEM_CLASSNAME}
                        >
                          <span>Underline</span>
                          {selectedStyle.underline ? <Kbd>On</Kbd> : null}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleApplyTextStyle({
                              strike: !selectedStyle.strike,
                            })
                          }
                          className={MENU_ITEM_CLASSNAME}
                        >
                          <span>Strikethrough</span>
                          {selectedStyle.strike ? <Kbd>On</Kbd> : null}
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Popover
                    open={formatAlignmentPopoverOpen}
                    onOpenChange={setFormatAlignmentPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button type="button" className={MENU_ITEM_CLASSNAME}>
                        <span>Alignment</span>
                        <HugeiconsIcon icon={ChevronRight} size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="w-64 rounded-xl border-border/70 p-3"
                    >
                      <div className="space-y-1">
                        {ALIGNMENT_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() =>
                              void handleSetAlignment(option.value)
                            }
                            className={MENU_ITEM_CLASSNAME}
                          >
                            <span>{option.label}</span>
                            {selectedStyle.hAlign === option.value ? (
                              <Kbd>Active</Kbd>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Popover
                    open={formatWrappingPopoverOpen}
                    onOpenChange={setFormatWrappingPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button type="button" className={MENU_ITEM_CLASSNAME}>
                        <span>Wrapping</span>
                        <HugeiconsIcon icon={ChevronRight} size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="w-64 rounded-xl border-border/70 p-3"
                    >
                      <div className="space-y-1">
                        {WRAPPING_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => void handleSetWrapping(option.value)}
                            className={MENU_ITEM_CLASSNAME}
                          >
                            <span>{option.label}</span>
                            {currentWrapping === option.value ? (
                              <Kbd>Active</Kbd>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Popover
                    open={formatClearPopoverOpen}
                    onOpenChange={setFormatClearPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <button type="button" className={MENU_ITEM_CLASSNAME}>
                        <span>Clear</span>
                        <HugeiconsIcon icon={ChevronRight} size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="w-64 rounded-xl border-border/70 p-3"
                    >
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => void handleClearFormatting()}
                          className={MENU_ITEM_CLASSNAME}
                        >
                          <span>Clear formatting</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleClearContent()}
                          className={MENU_ITEM_CLASSNAME}
                        >
                          <span>Clear content</span>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </PopoverContent>
            </Popover>
          </li>
        </ul>
      </div>
      <div
        className={cn(
          "h-0.5 w-full bg-transparent",
          !showLoadingStrip && "hidden"
        )}
      >
        {isLoading ? <div className="loading-strip h-full w-full" /> : null}
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete File</DialogTitle>
            <DialogDescription>
              {workbook
                ? `Delete ${getDisplayFileName(workbook.fileName)} permanently?`
                : "Delete this file permanently?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDeleteWorkbook()}
              disabled={isDeletingWorkbook}
            >
              {isDeletingWorkbook ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
