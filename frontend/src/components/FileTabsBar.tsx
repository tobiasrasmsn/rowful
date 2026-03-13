import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { buildRenamedFileName, getDisplayFileName } from "@/lib/fileName"
import { Input } from "@/components/ui/input"
import { useTheme } from "@/components/theme-provider"
import { useSheetStore } from "@/store/sheetStore"
import { useLocation } from "react-router-dom"
import { HugeiconsIcon } from "@hugeicons/react"
import { FileSpreadsheetIcon } from "@hugeicons/core-free-icons"

type FileTabsBarProps = {
  className?: string
  compact?: boolean
  showLoadingStrip?: boolean
}

const APP_NAME = "Rowful"
const FILE_NAME_AUTOSAVE_DELAY_MS = 500

export function FileTabsBar({
  className,
  compact = false,
  showLoadingStrip = !compact,
}: FileTabsBarProps) {
  const location = useLocation()
  const { resolvedTheme } = useTheme()
  const workbook = useSheetStore((state) => state.workbook)
  const isLoading = useSheetStore((state) => state.isLoading)
  const renameStoredFile = useSheetStore((state) => state.renameStoredFile)
  const isFilesRoute = location.pathname === "/files"
  const inputRef = useRef<HTMLInputElement | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queuedTitleRef = useRef<string | null>(null)
  const saveInFlightRef = useRef(false)
  const exitAfterSaveRef = useRef(false)
  const [editingWorkbookId, setEditingWorkbookId] = useState<string | null>(
    null
  )
  const [savingWorkbookId, setSavingWorkbookId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const canEditTitle = !isFilesRoute && Boolean(workbook)
  const isEditing = Boolean(workbook) && editingWorkbookId === workbook?.id
  const isSaving = Boolean(workbook) && savingWorkbookId === workbook?.id
  const title =
    canEditTitle && workbook ? getDisplayFileName(workbook.fileName) : APP_NAME
  const shouldInvertLogo =
    resolvedTheme === "light" || resolvedTheme === "blossom"

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

  return (
    <div className={cn(compact ? "px-0 py-0" : "px-2 py-2", className)}>
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

      <div
        className={cn(
          "h-0.5 w-full bg-transparent",
          !showLoadingStrip && "hidden"
        )}
      >
        {isLoading ? <div className="loading-strip h-full w-full" /> : null}
      </div>
    </div>
  )
}
