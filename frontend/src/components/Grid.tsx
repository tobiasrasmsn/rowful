import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  RevoGrid,
  defineCustomElements,
  type AfterEditEvent,
  type ChangedRange,
  type ColumnDataSchemaModel,
  type ColumnRegular,
  type FocusAfterRenderEvent,
  type InitialHeaderClick,
  type PluginProviders,
  type RangeArea,
  type ViewPortScrollEvent,
} from "@revolist/react-datagrid"

import { sendFileEmail } from "@/api/client"
import { renderCellDisplayValue } from "@/lib/cellFormat"
import { useSheetStore } from "@/store/sheetStore"
import type { Cell, KanbanRegion, Sheet } from "@/types/sheet"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

defineCustomElements()

type GridRow = Record<string, string>
type CellStyleValue = Cell["style"]
type ColumnSizeMap = Record<number, number>
type GridCellStyle = Record<string, string | undefined>
type PersistedSheetWidths = {
  manual?: ColumnSizeMap
}
type PersistedWidthsBySheet = Record<string, PersistedSheetWidths>
type PreparedCell = {
  formula: string
  style?: CellStyleValue
  value: string
  cellProperties?: {
    style: GridCellStyle
  }
}
type PreparedGridData = {
  cellMatrix: Map<number, Map<number, PreparedCell>>
  columnLabels: string[]
  loadedRows: Set<number>
  source: GridRow[]
}
type ViewportWindow = {
  rowStart: number
  rowCount: number
  colStart: number
  colCount: number
}
type ViewportAccessor = {
  get?: (key: "start" | "end") => number
}
type GridViewportElement = HTMLRevoGridElement & {
  getProviders?: () => Promise<PluginProviders | undefined>
  getSelectedRange?: () => Promise<
    (RangeArea & { type?: string; colType?: string }) | null
  >
  setCellsFocus?: (
    cellStart?: { x: number; y: number },
    cellEnd?: { x: number; y: number },
    colType?: string,
    rowType?: string
  ) => Promise<void>
  viewportRow?: ViewportAccessor
  viewportCol?: ViewportAccessor
}
type GridContextMenuContext = {
  row: number
  col: number
  rowStart: number
  rowCount: number
  colStart: number
  colCount: number
}
type CellCoords = {
  row: number
  col: number
}
type ClipboardCellPayload = {
  value: string
  formula: string
}
type ClipboardPayload = {
  rowCount: number
  colCount: number
  cells: ClipboardCellPayload[][]
}
type DragMoveState = {
  pointerId: number
  startClientX: number
  startClientY: number
  sourceRange: {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  }
  isDragging: boolean
}
type EmailSendTarget = {
  email: string
  row: number
  vars: Record<string, string>
}
type SnippetChoice = {
  key: string
  label: string
}
type KanbanBadgePosition = {
  id: string
  left: number
  top: number
}

const DEFAULT_COLUMN_WIDTH = 110
const MIN_COLUMN_WIDTH = 70
const MAX_COLUMN_WIDTH = 1400
const COLUMN_WIDTHS_STORAGE_KEY = "planar:column-widths:v1"
const VISIBLE_ROW_OVERSCAN = 150
const VISIBLE_COL_OVERSCAN = 12
const FETCH_ROW_BLOCK = 400
const FETCH_COL_BLOCK = 32
const CELL_UPDATE_BATCH_CONCURRENCY = 12

const toColumnLabel = (index: number) => {
  let label = ""
  let value = index
  while (value > 0) {
    const offset = (value - 1) % 26
    label = String.fromCharCode(65 + offset) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}

const toColumnNumber = (label: string) => {
  let value = 0
  for (const char of label.toUpperCase()) {
    const code = char.charCodeAt(0)
    if (code < 65 || code > 90) {
      return null
    }
    value = value * 26 + (code - 64)
  }
  return value > 0 ? value : null
}

const hasRenderableStyle = (
  style: CellStyleValue | undefined
): style is NonNullable<CellStyleValue> =>
  Boolean(style && Object.keys(style).length > 0)

const buildPreparedCellStyle = (
  style: NonNullable<CellStyleValue>
): GridCellStyle => {
  const textDecoration = [
    style.underline ? "underline" : "",
    style.strike ? "line-through" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return {
    backgroundColor: style.fillColor || undefined,
    color: style.fontColor || undefined,
    fontFamily: style.fontFamily || undefined,
    fontSize: style.fontSize ? `${style.fontSize}px` : undefined,
    fontStyle: style.italic ? "italic" : undefined,
    fontWeight: style.bold ? "700" : undefined,
    textAlign:
      style.hAlign === "center" ||
      style.hAlign === "right" ||
      style.hAlign === "left"
        ? style.hAlign
        : undefined,
    textDecoration: textDecoration || undefined,
    whiteSpace: style.wrapText ? "normal" : undefined,
  }
}

const buildKanbanBorderStyle = (
  row: number,
  col: number,
  kanbanRegions: KanbanRegion[]
): GridCellStyle => {
  let borderTop: string | undefined
  let borderBottom: string | undefined
  let borderLeft: string | undefined
  let borderRight: string | undefined
  for (const region of kanbanRegions) {
    const inRow = row >= region.range.rowStart && row <= region.range.rowEnd
    const inCol = col >= region.range.colStart && col <= region.range.colEnd
    if (!inRow || !inCol) {
      continue
    }
    const border = "1px solid #0ea5e9"
    if (row === region.range.rowStart) {
      borderTop = border
    }
    if (row === region.range.rowEnd) {
      borderBottom = border
    }
    if (col === region.range.colStart) {
      borderLeft = border
    }
    if (col === region.range.colEnd) {
      borderRight = border
    }
  }
  return { borderTop, borderBottom, borderLeft, borderRight }
}

const buildDropPreviewBorderStyle = (
  row: number,
  col: number,
  dropPreviewRange: {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  } | null
): GridCellStyle => {
  if (!dropPreviewRange) {
    return {}
  }
  const inRow =
    row >= dropPreviewRange.rowStart && row <= dropPreviewRange.rowEnd
  const inCol =
    col >= dropPreviewRange.colStart && col <= dropPreviewRange.colEnd
  if (!inRow || !inCol) {
    return {}
  }
  const border = "2px dashed #0ea5e9"
  return {
    borderTop: row === dropPreviewRange.rowStart ? border : undefined,
    borderBottom: row === dropPreviewRange.rowEnd ? border : undefined,
    borderLeft: col === dropPreviewRange.colStart ? border : undefined,
    borderRight: col === dropPreviewRange.colEnd ? border : undefined,
  }
}

const buildDragHandleCursorStyle = (
  row: number,
  col: number,
  dragHandleRange: {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  } | null
): GridCellStyle => {
  if (!dragHandleRange) {
    return {}
  }
  if (
    row === dragHandleRange.rowStart &&
    col >= dragHandleRange.colStart &&
    col <= dragHandleRange.colEnd
  ) {
    return { cursor: "grab" }
  }
  return {}
}

const resolveCellProperties = (
  row: number,
  col: number,
  preparedGridData: PreparedGridData,
  kanbanRegions: KanbanRegion[],
  dragHandleRange: {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  } | null,
  dropPreviewRange: {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  } | null
) => {
  const baseStyle =
    preparedGridData.cellMatrix.get(row)?.get(col)?.cellProperties?.style ?? {}
  const kanbanStyle = buildKanbanBorderStyle(row, col, kanbanRegions)
  const dropPreviewStyle = buildDropPreviewBorderStyle(
    row,
    col,
    dropPreviewRange
  )
  const dragHandleStyle = buildDragHandleCursorStyle(row, col, dragHandleRange)
  const style = {
    ...baseStyle,
    ...kanbanStyle,
    ...dropPreviewStyle,
    ...dragHandleStyle,
  }
  return { style }
}

const createPreparedGridData = (sheet: Sheet): PreparedGridData => ({
  cellMatrix: new Map(),
  columnLabels: Array.from({ length: Math.max(sheet.maxCol, 1) }, (_, idx) =>
    toColumnLabel(idx + 1)
  ),
  loadedRows: new Set(),
  source: Array.from({ length: Math.max(sheet.maxRow, 1) }, () => ({})),
})

const applySheetRowsToPreparedGridData = (
  preparedGridData: PreparedGridData,
  rows: Sheet["rows"],
  currency: string
) => {
  for (const row of rows) {
    preparedGridData.loadedRows.add(row.index)
    const rowCells = new Map<number, PreparedCell>()
    const rowSource: GridRow = {}

    for (const cell of row.cells) {
      const value = cell.value || ""
      const displayValue = renderCellDisplayValue(
        value,
        cell.style,
        cell.display,
        { currency }
      )
      const cellProperties = hasRenderableStyle(cell.style)
        ? { style: buildPreparedCellStyle(cell.style) }
        : undefined

      rowCells.set(cell.col, {
        formula: cell.formula || "",
        style: cell.style,
        value,
        cellProperties,
      })
      rowSource[String(cell.col)] = displayValue
    }

    preparedGridData.cellMatrix.set(row.index, rowCells)
    preparedGridData.source[row.index - 1] = rowSource
  }
}

const buildColumns = (
  preparedGridData: PreparedGridData,
  manualColumnSizes: ColumnSizeMap,
  kanbanRegions: KanbanRegion[],
  dragHandleRange: {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  } | null,
  dropPreviewRange: {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  } | null
): ColumnRegular[] =>
  preparedGridData.columnLabels.map((label, idx) => {
    const col = idx + 1
    return {
      name: label,
      prop: String(col),
      size: manualColumnSizes[col] ?? DEFAULT_COLUMN_WIDTH,
      sortable: false,
      cellProperties: (schema: ColumnDataSchemaModel) =>
        resolveCellProperties(
          schema.rowIndex + 1,
          col,
          preparedGridData,
          kanbanRegions,
          dragHandleRange,
          dropPreviewRange
        ),
      columnProperties: () => ({ title: label }),
    }
  })

const parseColNumber = (prop: string | number) => {
  const value = typeof prop === "number" ? prop : Number(prop)
  return Number.isFinite(value) && value >= 1 ? value : null
}

const clampColumnWidth = (size: number) =>
  Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(size)))

const normalizeColumnSizeMap = (value: unknown): ColumnSizeMap => {
  if (!value || typeof value !== "object") {
    return {}
  }
  const entries = Object.entries(value as Record<string, unknown>)
  const next: ColumnSizeMap = {}
  for (const [rawCol, rawSize] of entries) {
    const col = Number(rawCol)
    const size = Number(rawSize)
    if (!Number.isFinite(col) || col < 1 || !Number.isFinite(size)) {
      continue
    }
    next[col] = clampColumnWidth(size)
  }
  return next
}

const readPersistedWidths = (): PersistedWidthsBySheet => {
  if (typeof window === "undefined") {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") {
      return {}
    }
    return parsed as PersistedWidthsBySheet
  } catch {
    return {}
  }
}

const writePersistedManualWidths = (
  sheetKey: string,
  manual: ColumnSizeMap
) => {
  if (typeof window === "undefined" || !sheetKey) {
    return
  }
  const all = readPersistedWidths()
  all[sheetKey] = { ...(all[sheetKey] ?? {}), manual }
  try {
    window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(all))
  } catch {
    // ignore storage failures
  }
}

const clampRange = (start: number, end: number, maxValue: number) => {
  const safeMax = Math.max(1, maxValue)
  const normalizedStart = Math.max(1, Math.min(start, safeMax))
  const normalizedEnd = Math.max(normalizedStart, Math.min(end, safeMax))
  return { start: normalizedStart, end: normalizedEnd }
}

const snapRangeToBlocks = (
  start: number,
  end: number,
  blockSize: number,
  maxValue: number
) => {
  const clamped = clampRange(start, end, maxValue)
  const blockStart = Math.floor((clamped.start - 1) / blockSize) * blockSize + 1
  const blockEnd = Math.min(
    Math.max(1, maxValue),
    Math.ceil(clamped.end / blockSize) * blockSize
  )
  return {
    start: blockStart,
    end: Math.max(blockStart, blockEnd),
  }
}

const hasMultiCellRange = (range: RangeArea | null) => {
  if (!range) {
    return false
  }
  return range.x !== range.x1 || range.y !== range.y1
}

const readViewportWindow = (
  grid: GridViewportElement,
  sheet: Sheet
): { visible: ViewportWindow; fetch: ViewportWindow } => {
  const maxRow = Math.max(sheet.maxRow, 1)
  const maxCol = Math.max(sheet.maxCol, 1)
  const rowStart = (grid.viewportRow?.get?.("start") ?? 0) + 1
  const rowEnd =
    (grid.viewportRow?.get?.("end") ?? Math.min(maxRow - 1, rowStart + 199)) + 1
  const colStart = (grid.viewportCol?.get?.("start") ?? 0) + 1
  const colEnd =
    (grid.viewportCol?.get?.("end") ?? Math.min(maxCol - 1, colStart + 59)) + 1

  const visibleRows = clampRange(rowStart, rowEnd, maxRow)
  const visibleCols = clampRange(colStart, colEnd, maxCol)
  const fetchRows = snapRangeToBlocks(
    visibleRows.start - VISIBLE_ROW_OVERSCAN,
    visibleRows.end + VISIBLE_ROW_OVERSCAN,
    FETCH_ROW_BLOCK,
    maxRow
  )
  const fetchCols = snapRangeToBlocks(
    visibleCols.start - VISIBLE_COL_OVERSCAN,
    visibleCols.end + VISIBLE_COL_OVERSCAN,
    FETCH_COL_BLOCK,
    maxCol
  )

  return {
    visible: {
      rowStart: visibleRows.start,
      rowCount: visibleRows.end - visibleRows.start + 1,
      colStart: visibleCols.start,
      colCount: visibleCols.end - visibleCols.start + 1,
    },
    fetch: {
      rowStart: fetchRows.start,
      rowCount: fetchRows.end - fetchRows.start + 1,
      colStart: fetchCols.start,
      colCount: fetchCols.end - fetchCols.start + 1,
    },
  }
}

const readViewportWindowFromScroll = (
  grid: GridViewportElement,
  sheet: Sheet,
  event: ViewPortScrollEvent,
  rowSize: number
): { visible: ViewportWindow; fetch: ViewportWindow } => {
  const base = readViewportWindow(grid, sheet)
  if (event.dimension !== "rgRow") {
    return base
  }

  const maxRow = Math.max(sheet.maxRow, 1)
  const estimatedVisibleRows = Math.max(
    base.visible.rowCount,
    Math.ceil(grid.getBoundingClientRect().height / Math.max(rowSize, 1))
  )
  const rowStart = Math.max(
    1,
    Math.min(Math.floor(event.coordinate / Math.max(rowSize, 1)) + 1, maxRow)
  )
  const rowEnd = Math.min(maxRow, rowStart + estimatedVisibleRows - 1)
  const fetchRows = snapRangeToBlocks(
    rowStart - VISIBLE_ROW_OVERSCAN,
    rowEnd + VISIBLE_ROW_OVERSCAN,
    FETCH_ROW_BLOCK,
    maxRow
  )

  return {
    visible: {
      ...base.visible,
      rowStart,
      rowCount: rowEnd - rowStart + 1,
    },
    fetch: {
      ...base.fetch,
      rowStart: fetchRows.start,
      rowCount: fetchRows.end - fetchRows.start + 1,
    },
  }
}

const rangeAreaToSelection = (range: RangeArea) => ({
  rowStart: range.y + 1,
  rowEnd: range.y1 + 1,
  colStart: range.x + 1,
  colEnd: range.x1 + 1,
})

const readNumericAttr = (element: Element, names: string[]) => {
  for (const name of names) {
    const raw = element.getAttribute(name)
    if (!raw) {
      continue
    }
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed
    }
  }
  return null
}

const getCellCoordsFromTarget = (target: Element): CellCoords | null => {
  const cell = target.closest(".rgCell")
  if (!cell) {
    return null
  }
  const rowZeroBased = readNumericAttr(cell, ["data-rgRow", "data-rgrow"])
  const colZeroBased = readNumericAttr(cell, ["data-rgCol", "data-rgcol"])
  if (rowZeroBased === null || colZeroBased === null) {
    return null
  }
  return { row: rowZeroBased + 1, col: colZeroBased + 1 }
}

const parseClipboardText = (text: string) => {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop()
  }
  return lines.map((line) => line.split("\t"))
}

const runCellUpdateBatch = async (
  tasks: Array<() => Promise<void>>,
  concurrency = CELL_UPDATE_BATCH_CONCURRENCY
) => {
  if (tasks.length === 0) {
    return
  }
  const safeConcurrency = Math.max(1, Math.min(concurrency, tasks.length))
  let nextTaskIndex = 0
  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (nextTaskIndex < tasks.length) {
      const taskIndex = nextTaskIndex
      nextTaskIndex += 1
      await tasks[taskIndex]()
    }
  })
  await Promise.all(workers)
}

const isCellInsideRange = (
  cell: CellCoords,
  range: {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  } | null
) => {
  if (!range) {
    return false
  }
  return (
    cell.row >= range.rowStart &&
    cell.row <= range.rowEnd &&
    cell.col >= range.colStart &&
    cell.col <= range.colEnd
  )
}

const areRangesEqual = (
  a: {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  } | null,
  b: {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  } | null
) => {
  if (a === b) {
    return true
  }
  if (!a || !b) {
    return false
  }
  return (
    a.rowStart === b.rowStart &&
    a.rowEnd === b.rowEnd &&
    a.colStart === b.colStart &&
    a.colEnd === b.colEnd
  )
}

const EMAIL_PATTERN = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i

const findFirstEmailInRow = (
  rowCells: Map<number, PreparedCell> | undefined
) => {
  if (!rowCells) {
    return null
  }
  for (const [col, cell] of rowCells.entries()) {
    const raw = (cell.value ?? "").trim()
    if (!raw) {
      continue
    }
    const match = raw.match(EMAIL_PATTERN)
    if (match?.[1]) {
      return { email: match[1], col }
    }
  }
  return null
}

const extractEmailsFromValue = (value: string) => {
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)
  return matches ?? []
}

const toSnippetKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

const findTopContentRowInColumns = (
  preparedGridData: PreparedGridData,
  columns: {
    colStart: number
    colEnd: number
  }
) => {
  const rowIndexes = Array.from(preparedGridData.cellMatrix.keys()).sort(
    (a, b) => a - b
  )
  for (const row of rowIndexes) {
    for (let col = columns.colStart; col <= columns.colEnd; col += 1) {
      const value = (
        preparedGridData.cellMatrix.get(row)?.get(col)?.value ?? ""
      ).trim()
      if (value) {
        return row
      }
    }
  }
  return null
}

const collectSnippetVarsForRow = (
  preparedGridData: PreparedGridData,
  row: number,
  options?: {
    headerRowIndex?: number | null
    colStart?: number
    colEnd?: number
  }
) => {
  const rowCells = preparedGridData.cellMatrix.get(row)
  if (!rowCells) {
    return {}
  }
  const headerRow = options?.headerRowIndex
    ? preparedGridData.cellMatrix.get(options.headerRowIndex)
    : undefined
  const minCol = options?.colStart ?? 1
  const maxCol = options?.colEnd ?? Number.POSITIVE_INFINITY
  const vars: Record<string, string> = {}

  for (const [col, cell] of rowCells.entries()) {
    if (col < minCol || col > maxCol) {
      continue
    }
    const value = (cell.value ?? "").trim()
    if (!value) {
      continue
    }
    const colLetter = toColumnLabel(col)
    vars[colLetter] = value
    const header = (headerRow?.get(col)?.value ?? "").trim()
    const headerKey = toSnippetKey(header)
    if (headerKey) {
      vars[headerKey] = value
      if (!vars.name && headerKey.includes("name")) {
        vars.name = value
      }
    }
  }

  return vars
}

const extractEmailTargetsFromRange = (
  preparedGridData: PreparedGridData,
  selectedRange: {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  }
) => {
  const targets: EmailSendTarget[] = []
  const headerRowIndex = findTopContentRowInColumns(preparedGridData, {
    colStart: selectedRange.colStart,
    colEnd: selectedRange.colEnd,
  })
  const seen = new Set<string>()
  for (
    let row = selectedRange.rowStart;
    row <= selectedRange.rowEnd;
    row += 1
  ) {
    const rowVars = collectSnippetVarsForRow(preparedGridData, row, {
      headerRowIndex,
      colStart: selectedRange.colStart,
      colEnd: selectedRange.colEnd,
    })
    for (
      let col = selectedRange.colStart;
      col <= selectedRange.colEnd;
      col += 1
    ) {
      const value = preparedGridData.cellMatrix.get(row)?.get(col)?.value ?? ""
      for (const email of extractEmailsFromValue(value)) {
        const normalized = email.trim()
        const key = normalized.toLowerCase()
        if (!normalized || seen.has(key)) {
          continue
        }
        seen.add(key)
        targets.push({
          email: normalized,
          row,
          vars: rowVars,
        })
      }
    }
  }
  return targets
}

const buildSnippetChoices = (targets: EmailSendTarget[]): SnippetChoice[] => {
  const choices = new Map<string, SnippetChoice>()
  let hasNamedSnippet = false
  for (const target of targets) {
    for (const key of Object.keys(target.vars)) {
      const lower = key.toLowerCase()
      if (!choices.has(lower)) {
        const isColLetter = /^[A-Z]+$/.test(key)
        if (!isColLetter) {
          hasNamedSnippet = true
        }
        choices.set(lower, {
          key,
          label: isColLetter ? `{${key}} (column ${key})` : `{${key}}`,
        })
      }
    }
  }
  let values = Array.from(choices.values())
  if (hasNamedSnippet) {
    values = values.filter((choice) => !/^[A-Z]+$/.test(choice.key))
  }
  return values.sort((a, b) => {
    if (a.key.toLowerCase() === "name") {
      return -1
    }
    if (b.key.toLowerCase() === "name") {
      return 1
    }
    return a.key.localeCompare(b.key)
  })
}

export function Grid() {
  const workbook = useSheetStore((state) => state.workbook)
  const sheet = useSheetStore((state) => state.sheet)
  const currency = useSheetStore((state) => state.fileSettings.currency)
  const zoom = useSheetStore((state) => state.zoom)
  const selectCell = useSheetStore((state) => state.selectCell)
  const selectColumn = useSheetStore((state) => state.selectColumn)
  const selectAll = useSheetStore((state) => state.selectAll)
  const selectionMode = useSheetStore((state) => state.selectionMode)
  const selectedRange = useSheetStore((state) => state.selectedRange)
  const selectedRow = useSheetStore((state) => state.selectedRow)
  const selectedCol = useSheetStore((state) => state.selectedCol)
  const setSelectedRange = useSheetStore((state) => state.setSelectedRange)
  const updateCell = useSheetStore((state) => state.updateCell)
  const clearSelectedValues = useSheetStore(
    (state) => state.clearSelectedValues
  )
  const ensureWindow = useSheetStore((state) => state.ensureWindow)
  const setViewportWindow = useSheetStore((state) => state.setViewportWindow)
  const createKanbanFromSelection = useSheetStore(
    (state) => state.createKanbanFromSelection
  )
  const extendKanbanRegion = useSheetStore((state) => state.extendKanbanRegion)
  const insertRowsAt = useSheetStore((state) => state.insertRowsAt)
  const insertColsAt = useSheetStore((state) => state.insertColsAt)
  const deleteRowsAt = useSheetStore((state) => state.deleteRowsAt)
  const deleteColsAt = useSheetStore((state) => state.deleteColsAt)
  const kanbanRegions = useSheetStore((state) => state.kanbanRegions)
  const rowSize = Math.max(26, Math.round(28 * (zoom / 100)))
  const kanbanRegionsForSheet = useMemo(
    () => kanbanRegions.filter((region) => region.sheetName === sheet?.name),
    [kanbanRegions, sheet?.name]
  )

  const sheetKey = workbook && sheet ? `${workbook.id}::${sheet.name}` : ""
  const [manualColumnSizes, setManualColumnSizes] = useState<ColumnSizeMap>({})
  const gridRef = useRef<GridViewportElement | null>(null)
  const gridContainerRef = useRef<HTMLDivElement | null>(null)
  const preparedGridDataRef = useRef<PreparedGridData | null>(null)
  const viewportSyncFrameRef = useRef<number | null>(null)
  const lastRangeSelectionAtRef = useRef(0)
  const [menuContext, setMenuContext] = useState<GridContextMenuContext | null>(
    null
  )
  const clipboardRef = useRef<{
    plainText: string
    payload: ClipboardPayload
  } | null>(null)
  const dragMoveStateRef = useRef<DragMoveState | null>(null)
  const dropPreviewRangeRef = useRef<{
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  } | null>(null)
  const shortcutActionsRef = useRef<{
    copy: () => void
    cut: () => void
    paste: (row: number, col: number) => void
  } | null>(null)
  const [dropPreviewRange, setDropPreviewRange] = useState<{
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  } | null>(null)
  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  const [sendEmailDialogOpen, setSendEmailDialogOpen] = useState(false)
  const [sendEmailTargets, setSendEmailTargets] = useState<EmailSendTarget[]>(
    []
  )
  const [sendEmailSubject, setSendEmailSubject] = useState(
    "Message from Planar"
  )
  const [sendEmailMessage, setSendEmailMessage] = useState("")
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const [extendKanbanDialogOpen, setExtendKanbanDialogOpen] = useState(false)
  const [extendKanbanAxis, setExtendKanbanAxis] = useState<"rows" | "cols">(
    "cols"
  )
  const [extendKanbanAmount, setExtendKanbanAmount] = useState("1")
  const [extendKanbanRegionId, setExtendKanbanRegionId] = useState<
    string | null
  >(null)
  const [activeSnippetField, setActiveSnippetField] = useState<
    "subject" | "message"
  >("message")
  const [kanbanBadgePositions, setKanbanBadgePositions] = useState<
    KanbanBadgePosition[]
  >([])
  const sendEmailSubjectRef = useRef<HTMLInputElement | null>(null)
  const sendEmailMessageRef = useRef<HTMLTextAreaElement | null>(null)

  const refreshKanbanBadgePositions = useCallback(() => {
    const grid = gridRef.current
    const container = gridContainerRef.current
    if (!grid || !container || kanbanRegionsForSheet.length === 0) {
      setKanbanBadgePositions([])
      return
    }

    const containerRect = container.getBoundingClientRect()
    const next: KanbanBadgePosition[] = []

    for (const region of kanbanRegionsForSheet) {
      const rowIndex = region.range.rowStart - 1
      const colIndex = region.range.colStart - 1
      const selector = `.rgCell[data-rgRow="${rowIndex}"][data-rgCol="${colIndex}"], .rgCell[data-rgrow="${rowIndex}"][data-rgcol="${colIndex}"]`
      const cell = grid.querySelector(selector)
      if (!(cell instanceof HTMLElement)) {
        continue
      }
      const rect = cell.getBoundingClientRect()
      next.push({
        id: region.id,
        left: Math.round(rect.left - containerRect.left),
        top: Math.round(rect.top - containerRect.top),
      })
    }

    setKanbanBadgePositions(next)
  }, [kanbanRegionsForSheet])

  const getActiveSelectionRange = useCallback(() => {
    if (selectedRange) {
      return selectedRange
    }
    return {
      rowStart: selectedRow,
      rowEnd: selectedRow,
      colStart: selectedCol,
      colEnd: selectedCol,
    }
  }, [selectedCol, selectedRange, selectedRow])

  const setDropPreview = useCallback(
    (
      next: {
        rowStart: number
        rowEnd: number
        colStart: number
        colEnd: number
      } | null
    ) => {
      if (areRangesEqual(dropPreviewRangeRef.current, next)) {
        return
      }
      dropPreviewRangeRef.current = next
      setDropPreviewRange(next)
    },
    []
  )

  const buildMenuContext = useCallback(
    (row: number, col: number) => {
      if (selectionMode === "sheet") {
        return {
          row,
          col,
          rowStart: 1,
          rowCount: Math.max(1, sheet?.maxRow ?? 1),
          colStart: 1,
          colCount: Math.max(1, sheet?.maxCol ?? 1),
        }
      }
      if (selectedRange) {
        return {
          row,
          col,
          rowStart: selectedRange.rowStart,
          rowCount: selectedRange.rowEnd - selectedRange.rowStart + 1,
          colStart: selectedRange.colStart,
          colCount: selectedRange.colEnd - selectedRange.colStart + 1,
        }
      }
      if (selectionMode === "column") {
        return {
          row,
          col,
          rowStart: row,
          rowCount: 1,
          colStart: selectedCol,
          colCount: 1,
        }
      }
      return {
        row,
        col,
        rowStart: row,
        rowCount: 1,
        colStart: col,
        colCount: 1,
      }
    },
    [selectedCol, selectedRange, selectionMode, sheet?.maxCol, sheet?.maxRow]
  )

  useEffect(() => {
    if (!sheetKey) {
      setManualColumnSizes({})
      return
    }
    const all = readPersistedWidths()
    const persistedForSheet = all[sheetKey] ?? {}
    setManualColumnSizes(normalizeColumnSizeMap(persistedForSheet.manual))
  }, [sheetKey])

  const preparedGridData = useMemo(() => {
    if (!sheet) {
      preparedGridDataRef.current = null
      return null
    }

    const current = preparedGridDataRef.current
    if (
      !current ||
      current.source.length !== Math.max(sheet.maxRow, 1) ||
      current.columnLabels.length !== Math.max(sheet.maxCol, 1)
    ) {
      preparedGridDataRef.current = createPreparedGridData(sheet)
    }

    const prepared =
      preparedGridDataRef.current ?? createPreparedGridData(sheet)
    preparedGridDataRef.current = prepared
    applySheetRowsToPreparedGridData(prepared, sheet.rows, currency)
    return prepared
  }, [currency, sheet])

  const dragHandleRange = useMemo(() => {
    const range = selectedRange ?? {
      rowStart: selectedRow,
      rowEnd: selectedRow,
      colStart: selectedCol,
      colEnd: selectedCol,
    }
    const isSingleCell =
      range.rowStart === range.rowEnd && range.colStart === range.colEnd
    return isSingleCell ? null : range
  }, [selectedCol, selectedRange, selectedRow])

  const columns = useMemo(() => {
    if (!preparedGridData) {
      return null
    }
    return buildColumns(
      preparedGridData,
      manualColumnSizes,
      kanbanRegionsForSheet,
      dragHandleRange,
      dropPreviewRange
    )
  }, [
    dragHandleRange,
    dropPreviewRange,
    kanbanRegionsForSheet,
    manualColumnSizes,
    preparedGridData,
  ])

  const syncSelection = useCallback(
    (range: RangeArea | null) => {
      if (!sheet || !preparedGridData || !range) {
        return
      }

      const row = range.y1 + 1
      const col = range.x1 + 1
      const cell = preparedGridData.cellMatrix.get(row)?.get(col)
      if (hasMultiCellRange(range)) {
        lastRangeSelectionAtRef.current = Date.now()
      }
      selectCell(row, col, cell?.value || "", cell?.formula || "")

      if (hasMultiCellRange(range)) {
        setSelectedRange(rangeAreaToSelection(range))
      } else {
        setSelectedRange(null)
      }
    },
    [preparedGridData, selectCell, setSelectedRange, sheet]
  )

  const syncSelectionFromGrid = useCallback(
    async (fallbackFocus?: { rowIndex: number; colIndex: number }) => {
      const grid = gridRef.current
      if (!grid || !preparedGridData) {
        return
      }

      const range = await grid.getSelectedRange?.()
      if (range && hasMultiCellRange(range)) {
        syncSelection(range)
        return
      }

      if (!fallbackFocus) {
        return
      }

      const row = fallbackFocus.rowIndex + 1
      const col = fallbackFocus.colIndex + 1
      const cell = preparedGridData.cellMatrix.get(row)?.get(col)
      selectCell(row, col, cell?.value || "", cell?.formula || "")
      setSelectedRange(null)
    },
    [preparedGridData, selectCell, setSelectedRange, syncSelection]
  )

  const scheduleViewportSync = useCallback(() => {
    if (viewportSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(viewportSyncFrameRef.current)
    }

    viewportSyncFrameRef.current = window.requestAnimationFrame(() => {
      viewportSyncFrameRef.current = null
      const grid = gridRef.current
      if (!grid || !sheet) {
        return
      }
      const viewport = readViewportWindow(grid, sheet)
      setViewportWindow(viewport.visible)
      void ensureWindow(viewport.fetch)
    })
  }, [ensureWindow, setViewportWindow, sheet])

  const syncGridDimensions = useCallback(async () => {
    const grid = gridRef.current
    if (!grid || !preparedGridData || !sheet) {
      return
    }

    const providers = await grid.getProviders?.()
    if (!providers) {
      return
    }

    providers.data.setData(
      preparedGridData.source,
      "rgRow",
      false,
      undefined,
      true
    )
    providers.dimension.setItemCount(Math.max(sheet.maxRow, 1), "rgRow")
    providers.dimension.setViewPortCoordinate({ type: "rgRow", force: true })
  }, [preparedGridData, sheet])

  useEffect(() => {
    void syncGridDimensions()
    scheduleViewportSync()
    return () => {
      if (viewportSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportSyncFrameRef.current)
        viewportSyncFrameRef.current = null
      }
    }
  }, [scheduleViewportSync, syncGridDimensions])

  useEffect(() => {
    const schedule = () => {
      window.requestAnimationFrame(() => {
        refreshKanbanBadgePositions()
      })
    }
    schedule()
    window.addEventListener("resize", schedule)
    return () => {
      window.removeEventListener("resize", schedule)
    }
  }, [
    refreshKanbanBadgePositions,
    rowSize,
    manualColumnSizes,
    kanbanRegionsForSheet,
    preparedGridData,
  ])

  const handleAfterFocus = useCallback(
    (event: CustomEvent<FocusAfterRenderEvent>) => {
      if (Date.now() - lastRangeSelectionAtRef.current < 250) {
        void syncSelectionFromGrid({
          rowIndex: event.detail.rowIndex,
          colIndex: event.detail.colIndex,
        })
        return
      }
      void syncSelectionFromGrid({
        rowIndex: event.detail.rowIndex,
        colIndex: event.detail.colIndex,
      })
    },
    [syncSelectionFromGrid]
  )

  const handleHeaderClick = useCallback(
    (detail: ColumnRegular | InitialHeaderClick | null | undefined) => {
      if (!detail) {
        return
      }
      const col =
        "index" in detail && typeof detail.index === "number"
          ? detail.index + 1
          : "prop" in detail
            ? parseColNumber(detail.prop)
            : null
      if (!col) {
        return
      }
      setSelectedRange(null)
      selectColumn(col)
      void gridRef.current?.setCellsFocus?.(
        { x: col - 1, y: 0 },
        { x: col - 1, y: Math.max((sheet?.maxRow ?? 1) - 1, 0) },
        "rgCol",
        "rgRow"
      )
    },
    [selectColumn, setSelectedRange, sheet?.maxRow]
  )

  const handleSelectAll = useCallback(() => {
    setSelectedRange(null)
    selectAll()
    void gridRef.current?.setCellsFocus?.(
      { x: 0, y: 0 },
      {
        x: Math.max((sheet?.maxCol ?? 1) - 1, 0),
        y: Math.max((sheet?.maxRow ?? 1) - 1, 0),
      },
      "rgCol",
      "rgRow"
    )
  }, [selectAll, setSelectedRange, sheet?.maxCol, sheet?.maxRow])

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) {
      return
    }

    const handleSelectionChange = (event: Event) => {
      const detail = (event as CustomEvent<ChangedRange>).detail
      syncSelection(detail.newRange)
    }
    const handleSetRange = (event: Event) => {
      const detail = (event as CustomEvent<RangeArea>).detail
      syncSelection(detail)
    }
    const handleSelectAllEvent = () => {
      handleSelectAll()
    }
    const handleGridClick = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      const cornerHeaderCell = target.closest(
        ".rowHeaders revogr-header .rgHeaderCell"
      )
      if (!cornerHeaderCell) {
        return
      }
      handleSelectAll()
    }
    const handleClearRegionEvent = () => {
      void clearSelectedValues()
    }
    const handleHeaderClickEvent = (event: Event) => {
      handleHeaderClick(
        (event as CustomEvent<ColumnRegular | InitialHeaderClick>).detail
      )
    }
    const handleBeforeKeyDown = (event: Event) => {
      if (sendEmailDialogOpen || extendKanbanDialogOpen) {
        return
      }
      const original = (event as CustomEvent<{ original?: KeyboardEvent }>)
        .detail?.original
      if (!original) {
        return
      }
      const target = original.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      if (original.key === "Backspace" || original.key === "Delete") {
        original.preventDefault()
        void clearSelectedValues()
        return
      }
      const isAccel = original.metaKey || original.ctrlKey
      if (!isAccel || original.altKey) {
        return
      }
      const key = original.key.toLowerCase()
      if (key === "c") {
        original.preventDefault()
        shortcutActionsRef.current?.copy()
        return
      }
      if (key === "x") {
        original.preventDefault()
        shortcutActionsRef.current?.cut()
        return
      }
      if (key === "v") {
        original.preventDefault()
        shortcutActionsRef.current?.paste(selectedRow, selectedCol)
      }
    }

    grid.addEventListener(
      "selectionchangeinit",
      handleSelectionChange as EventListener
    )
    grid.addEventListener("setrange", handleSetRange as EventListener)
    grid.addEventListener("selectall", handleSelectAllEvent as EventListener)
    grid.addEventListener("click", handleGridClick as EventListener)
    grid.addEventListener(
      "clearregion",
      handleClearRegionEvent as EventListener
    )
    grid.addEventListener(
      "headerclick",
      handleHeaderClickEvent as EventListener
    )
    grid.addEventListener(
      "beforeheaderclick",
      handleHeaderClickEvent as EventListener
    )
    grid.addEventListener("beforekeydown", handleBeforeKeyDown as EventListener)

    return () => {
      grid.removeEventListener(
        "selectionchangeinit",
        handleSelectionChange as EventListener
      )
      grid.removeEventListener("setrange", handleSetRange as EventListener)
      grid.removeEventListener(
        "selectall",
        handleSelectAllEvent as EventListener
      )
      grid.removeEventListener("click", handleGridClick as EventListener)
      grid.removeEventListener(
        "clearregion",
        handleClearRegionEvent as EventListener
      )
      grid.removeEventListener(
        "headerclick",
        handleHeaderClickEvent as EventListener
      )
      grid.removeEventListener(
        "beforeheaderclick",
        handleHeaderClickEvent as EventListener
      )
      grid.removeEventListener(
        "beforekeydown",
        handleBeforeKeyDown as EventListener
      )
    }
  }, [
    clearSelectedValues,
    extendKanbanDialogOpen,
    handleHeaderClick,
    handleSelectAll,
    sendEmailDialogOpen,
    selectedCol,
    selectedRow,
    syncSelection,
  ])

  const handleAfterEdit = useCallback(
    (event: CustomEvent<AfterEditEvent>) => {
      const detail = event.detail
      if (!("prop" in detail) || typeof detail.rowIndex !== "number") {
        return
      }
      const col = parseColNumber(detail.prop)
      if (!col) {
        return
      }
      const value =
        detail.val === undefined || detail.val === null
          ? ""
          : String(detail.val)
      void updateCell(detail.rowIndex + 1, col, value)
    },
    [updateCell]
  )

  const handleAfterColumnResize = useCallback(
    (event: CustomEvent<Record<number, ColumnRegular>>) => {
      const next = { ...manualColumnSizes }
      for (const column of Object.values(event.detail || {})) {
        const col = parseColNumber(column.prop)
        if (!col || typeof column.size !== "number") {
          continue
        }
        next[col] = clampColumnWidth(column.size)
      }
      setManualColumnSizes(next)
      if (sheetKey) {
        writePersistedManualWidths(sheetKey, next)
      }
      window.requestAnimationFrame(() => {
        refreshKanbanBadgePositions()
      })
    },
    [manualColumnSizes, refreshKanbanBadgePositions, sheetKey]
  )

  const handleViewportScroll = useCallback(
    (event: CustomEvent<ViewPortScrollEvent>) => {
      const grid = gridRef.current
      if (!grid || !sheet) {
        return
      }
      const viewport = readViewportWindowFromScroll(
        grid,
        sheet,
        event.detail,
        rowSize
      )
      setViewportWindow(viewport.visible)
      void ensureWindow(viewport.fetch)
      window.requestAnimationFrame(() => {
        refreshKanbanBadgePositions()
      })
    },
    [
      ensureWindow,
      refreshKanbanBadgePositions,
      rowSize,
      setViewportWindow,
      sheet,
    ]
  )

  const handleCopy = useCallback(async () => {
    if (
      !preparedGridData ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    ) {
      return
    }
    const range = getActiveSelectionRange()
    const rows: string[] = []
    const payloadCells: ClipboardCellPayload[][] = []
    for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
      const cols: string[] = []
      const payloadRow: ClipboardCellPayload[] = []
      for (let col = range.colStart; col <= range.colEnd; col += 1) {
        const sourceCell = preparedGridData.cellMatrix.get(row)?.get(col)
        cols.push(sourceCell?.value ?? "")
        payloadRow.push({
          value: sourceCell?.value ?? "",
          formula: sourceCell?.formula ?? "",
        })
      }
      payloadCells.push(payloadRow)
      rows.push(cols.join("\t"))
    }
    const plainText = rows.join("\n")
    const payload: ClipboardPayload = {
      rowCount: payloadCells.length,
      colCount: payloadCells[0]?.length ?? 0,
      cells: payloadCells,
    }
    clipboardRef.current = {
      plainText,
      payload,
    }
    if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
      try {
        const item = new ClipboardItem({
          "text/plain": new Blob([plainText], { type: "text/plain" }),
          "application/x-planar-cells": new Blob([JSON.stringify(payload)], {
            type: "application/x-planar-cells",
          }),
        })
        await navigator.clipboard.write([item])
        return
      } catch {
        // fallback to plain text copy
      }
    }
    await navigator.clipboard.writeText(plainText)
  }, [getActiveSelectionRange, preparedGridData])

  const handleCut = useCallback(async () => {
    await handleCopy()
    await clearSelectedValues()
  }, [clearSelectedValues, handleCopy])

  const applyClipboardPayload = useCallback(
    async (row: number, col: number, payload: ClipboardPayload) => {
      const tasks: Array<() => Promise<void>> = []
      for (let rowOffset = 0; rowOffset < payload.rowCount; rowOffset += 1) {
        const line = payload.cells[rowOffset] ?? []
        for (let colOffset = 0; colOffset < payload.colCount; colOffset += 1) {
          const cell = line[colOffset] ?? { value: "", formula: "" }
          const targetRow = row + rowOffset
          const targetCol = col + colOffset
          const nextValue = cell.formula || cell.value || ""
          tasks.push(() => updateCell(targetRow, targetCol, nextValue))
        }
      }
      await runCellUpdateBatch(tasks)
    },
    [updateCell]
  )

  const handlePasteAt = useCallback(
    async (row: number, col: number) => {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        return
      }
      if (navigator.clipboard.read) {
        try {
          const items = await navigator.clipboard.read()
          for (const item of items) {
            if (!item.types.includes("application/x-planar-cells")) {
              continue
            }
            const blob = await item.getType("application/x-planar-cells")
            const raw = await blob.text()
            const parsed = JSON.parse(raw) as ClipboardPayload
            if (
              parsed &&
              Number.isFinite(parsed.rowCount) &&
              Number.isFinite(parsed.colCount) &&
              Array.isArray(parsed.cells)
            ) {
              await applyClipboardPayload(row, col, parsed)
              return
            }
          }
        } catch {
          // continue to plain-text fallback
        }
      }
      const text = await navigator.clipboard.readText()
      if (!text) {
        return
      }
      const internal = clipboardRef.current
      if (
        internal &&
        internal.payload.rowCount > 0 &&
        text === internal.plainText
      ) {
        await applyClipboardPayload(row, col, internal.payload)
        return
      }

      const matrix = parseClipboardText(text)
      const payload: ClipboardPayload = {
        rowCount: matrix.length,
        colCount: matrix[0]?.length ?? 0,
        cells: matrix.map((line) =>
          line.map((value) => ({
            value: value ?? "",
            formula: "",
          }))
        ),
      }
      await applyClipboardPayload(row, col, payload)
    },
    [applyClipboardPayload]
  )

  const handleMoveSelectionTo = useCallback(
    async (
      source: {
        rowStart: number
        rowEnd: number
        colStart: number
        colEnd: number
      },
      destinationTopLeftRow: number,
      destinationTopLeftCol: number
    ) => {
      if (!preparedGridData) {
        return
      }
      const rowDelta = destinationTopLeftRow - source.rowStart
      const colDelta = destinationTopLeftCol - source.colStart
      if (rowDelta === 0 && colDelta === 0) {
        return
      }

      const payload: ClipboardPayload = {
        rowCount: source.rowEnd - source.rowStart + 1,
        colCount: source.colEnd - source.colStart + 1,
        cells: [],
      }
      for (let rowOffset = 0; rowOffset < payload.rowCount; rowOffset += 1) {
        const row: ClipboardCellPayload[] = []
        for (let colOffset = 0; colOffset < payload.colCount; colOffset += 1) {
          const sourceCell = preparedGridData.cellMatrix
            .get(source.rowStart + rowOffset)
            ?.get(source.colStart + colOffset)
          row.push({
            value: sourceCell?.value ?? "",
            formula: sourceCell?.formula ?? "",
          })
        }
        payload.cells.push(row)
      }

      const clearTasks: Array<() => Promise<void>> = []
      for (let row = source.rowStart; row <= source.rowEnd; row += 1) {
        for (let col = source.colStart; col <= source.colEnd; col += 1) {
          const targetRow = row
          const targetCol = col
          clearTasks.push(() => updateCell(targetRow, targetCol, ""))
        }
      }
      await runCellUpdateBatch(clearTasks)
      await applyClipboardPayload(
        destinationTopLeftRow,
        destinationTopLeftCol,
        payload
      )

      const movedRange = {
        rowStart: source.rowStart + rowDelta,
        rowEnd: source.rowEnd + rowDelta,
        colStart: source.colStart + colDelta,
        colEnd: source.colEnd + colDelta,
      }
      setSelectedRange(movedRange)
      void gridRef.current?.setCellsFocus?.(
        { x: movedRange.colStart - 1, y: movedRange.rowStart - 1 },
        { x: movedRange.colEnd - 1, y: movedRange.rowEnd - 1 },
        "rgCol",
        "rgRow"
      )
    },
    [applyClipboardPayload, preparedGridData, setSelectedRange, updateCell]
  )

  useEffect(() => {
    shortcutActionsRef.current = {
      copy: () => {
        void handleCopy()
      },
      cut: () => {
        void handleCut()
      },
      paste: (row, col) => {
        void handlePasteAt(row, col)
      },
    }
  }, [handleCopy, handleCut, handlePasteAt])

  const handleCreateKanban = useCallback(() => {
    if (!selectedRange || !sheet || !preparedGridData) {
      return
    }
    const headerRow = preparedGridData.cellMatrix.get(selectedRange.rowStart)
    const choices: string[] = []
    for (
      let col = selectedRange.colStart;
      col <= selectedRange.colEnd;
      col += 1
    ) {
      const label = toColumnLabel(col)
      const header = (headerRow?.get(col)?.value ?? "").trim()
      choices.push(`${label}${header ? ` (${header})` : ""}`)
    }
    const selected = window.prompt(
      `Choose status column for Kanban (${choices.join(", ")})`,
      toColumnLabel(selectedRange.colStart)
    )
    if (!selected) {
      return
    }
    const raw = selected.trim().toUpperCase()
    const byNumber = Number(raw)
    const statusCol = Number.isFinite(byNumber) ? byNumber : toColumnNumber(raw)
    if (
      !statusCol ||
      statusCol < selectedRange.colStart ||
      statusCol > selectedRange.colEnd
    ) {
      window.alert("Status column must be inside the selected range.")
      return
    }
    const name = window.prompt("Kanban name", "")
    createKanbanFromSelection(statusCol, name || undefined)
  }, [createKanbanFromSelection, preparedGridData, selectedRange, sheet])

  const activeKanbanRegionAtMenu = useMemo(() => {
    if (!menuContext) {
      return null
    }
    return (
      kanbanRegionsForSheet.find(
        (region) =>
          menuContext.row >= region.range.rowStart &&
          menuContext.row <= region.range.rowEnd &&
          menuContext.col >= region.range.colStart &&
          menuContext.col <= region.range.colEnd
      ) ?? null
    )
  }, [kanbanRegionsForSheet, menuContext])

  const rowEmailTargetAtMenu = useMemo(() => {
    if (!menuContext || !preparedGridData) {
      return null
    }
    const match = findFirstEmailInRow(
      preparedGridData.cellMatrix.get(menuContext.row)
    )
    if (!match) {
      return null
    }
    return {
      email: match.email,
      row: menuContext.row,
      vars: collectSnippetVarsForRow(preparedGridData, menuContext.row, {
        headerRowIndex: findTopContentRowInColumns(preparedGridData, {
          colStart: menuContext.colStart,
          colEnd: menuContext.colStart + menuContext.colCount - 1,
        }),
        colStart: menuContext.colStart,
        colEnd: menuContext.colStart + menuContext.colCount - 1,
      }),
    } satisfies EmailSendTarget
  }, [menuContext, preparedGridData])

  const selectedEmailTargets = useMemo(() => {
    if (!selectedRange || !preparedGridData) {
      return [] as EmailSendTarget[]
    }
    return extractEmailTargetsFromRange(preparedGridData, selectedRange)
  }, [preparedGridData, selectedRange])

  const emailTargetsAtMenu = useMemo(() => {
    if (selectedEmailTargets.length > 0) {
      return selectedEmailTargets
    }
    if (rowEmailTargetAtMenu) {
      return [rowEmailTargetAtMenu]
    }
    return [] as EmailSendTarget[]
  }, [rowEmailTargetAtMenu, selectedEmailTargets])

  const snippetChoices = useMemo(
    () => buildSnippetChoices(sendEmailTargets),
    [sendEmailTargets]
  )

  const insertSnippetAtCursor = useCallback(
    (snippet: string) => {
      if (activeSnippetField === "subject") {
        const input = sendEmailSubjectRef.current
        if (!input) {
          setSendEmailSubject((current) => `${current}${snippet}`)
          return
        }
        const start = input.selectionStart ?? sendEmailSubject.length
        const end = input.selectionEnd ?? sendEmailSubject.length
        setSendEmailSubject((current) => {
          const next = `${current.slice(0, start)}${snippet}${current.slice(end)}`
          window.requestAnimationFrame(() => {
            input.focus()
            const cursor = start + snippet.length
            input.setSelectionRange(cursor, cursor)
          })
          return next
        })
        return
      }

      const textarea = sendEmailMessageRef.current
      if (!textarea) {
        setSendEmailMessage((current) => `${current}${snippet}`)
        return
      }

      const start = textarea.selectionStart ?? sendEmailMessage.length
      const end = textarea.selectionEnd ?? sendEmailMessage.length
      setSendEmailMessage((current) => {
        const next = `${current.slice(0, start)}${snippet}${current.slice(end)}`
        window.requestAnimationFrame(() => {
          textarea.focus()
          const cursor = start + snippet.length
          textarea.setSelectionRange(cursor, cursor)
        })
        return next
      })
    },
    [activeSnippetField, sendEmailMessage.length, sendEmailSubject.length]
  )

  useEffect(() => {
    const onWindowPointerMove = (event: PointerEvent) => {
      const state = dragMoveStateRef.current
      if (!state || event.pointerId !== state.pointerId) {
        return
      }
      if (!state.isDragging) {
        const movedX = Math.abs(event.clientX - state.startClientX)
        const movedY = Math.abs(event.clientY - state.startClientY)
        if (movedX >= 4 || movedY >= 4) {
          state.isDragging = true
          setIsDraggingSelection(true)
        } else {
          return
        }
      }

      const target = event.target
      if (!(target instanceof Element)) {
        setDropPreview(null)
        return
      }
      const targetCell = getCellCoordsFromTarget(target)
      if (!targetCell) {
        setDropPreview(null)
        return
      }
      const rowSpan = state.sourceRange.rowEnd - state.sourceRange.rowStart
      const colSpan = state.sourceRange.colEnd - state.sourceRange.colStart
      setDropPreview({
        rowStart: targetCell.row,
        rowEnd: targetCell.row + rowSpan,
        colStart: targetCell.col,
        colEnd: targetCell.col + colSpan,
      })
    }
    const onWindowPointerUp = (event: PointerEvent) => {
      const state = dragMoveStateRef.current
      if (!state || event.pointerId !== state.pointerId) {
        return
      }
      dragMoveStateRef.current = null
      setIsDraggingSelection(false)
      const dropTarget = dropPreviewRangeRef.current
      setDropPreview(null)
      if (!state.isDragging) {
        return
      }
      if (!dropTarget) {
        return
      }
      void handleMoveSelectionTo(
        state.sourceRange,
        dropTarget.rowStart,
        dropTarget.colStart
      )
    }
    const onWindowPointerCancel = () => {
      dragMoveStateRef.current = null
      setIsDraggingSelection(false)
      setDropPreview(null)
    }

    window.addEventListener("pointermove", onWindowPointerMove)
    window.addEventListener("pointerup", onWindowPointerUp)
    window.addEventListener("pointercancel", onWindowPointerCancel)
    return () => {
      window.removeEventListener("pointermove", onWindowPointerMove)
      window.removeEventListener("pointerup", onWindowPointerUp)
      window.removeEventListener("pointercancel", onWindowPointerCancel)
    }
  }, [handleMoveSelectionTo, setDropPreview])

  if (!sheet || !preparedGridData || !columns) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Open an .xlsx file from File → Open...
      </div>
    )
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={gridContainerRef}
            className="sheet-grid h-full"
            onPointerDownCapture={(event) => {
              if (event.button !== 0) {
                return
              }
              const target = event.target
              if (!(target instanceof Element)) {
                return
              }
              const sourceCell = getCellCoordsFromTarget(target)
              if (!sourceCell) {
                return
              }
              const sourceRange = getActiveSelectionRange()
              if (
                sourceRange.rowStart === sourceRange.rowEnd &&
                sourceRange.colStart === sourceRange.colEnd
              ) {
                return
              }
              if (!isCellInsideRange(sourceCell, sourceRange)) {
                return
              }
              if (sourceCell.row !== sourceRange.rowStart) {
                return
              }
              dragMoveStateRef.current = {
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                sourceRange,
                isDragging: false,
              }
              setDropPreview(null)
            }}
            onMouseDownCapture={(event) => {
              if (event.button === 2) {
                event.preventDefault()
              }
            }}
            onContextMenuCapture={(event) => {
              const target = event.target
              if (!(target instanceof Element)) {
                setMenuContext(buildMenuContext(selectedRow, selectedCol))
                return
              }
              const directCell = getCellCoordsFromTarget(target)
              if (directCell) {
                setMenuContext(buildMenuContext(directCell.row, directCell.col))
                return
              }
              const rowHeaderViewport = target.closest(
                'revogr-viewport-scroll[row-header], [row-header="true"]'
              )
              if (rowHeaderViewport) {
                const rowHeaderCell = target.closest(".rgCell, .rgHeaderCell")
                const raw = (
                  rowHeaderCell?.textContent ??
                  target.textContent ??
                  ""
                ).trim()
                const rowIndex = Number(raw)
                if (Number.isFinite(rowIndex) && rowIndex >= 1) {
                  setMenuContext(buildMenuContext(rowIndex, selectedCol))
                  return
                }
                setMenuContext(buildMenuContext(selectedRow, selectedCol))
                return
              }
              const headerCell = target.closest("revogr-header .rgHeaderCell")
              if (!headerCell) {
                setMenuContext(buildMenuContext(selectedRow, selectedCol))
                return
              }
              const raw = (headerCell.textContent ?? "").trim()
              if (!raw) {
                setMenuContext(buildMenuContext(selectedRow, selectedCol))
                return
              }
              const colIndex = toColumnNumber(raw)
              if (colIndex) {
                setMenuContext(buildMenuContext(selectedRow, colIndex))
                return
              }
              setMenuContext(buildMenuContext(selectedRow, selectedCol))
            }}
            style={
              {
                "--planar-grid-font-size": `${Math.max(11, Math.round(12 * (zoom / 100)))}px`,
                "--planar-grid-row-height": `${Math.max(26, Math.round(28 * (zoom / 100)))}px`,
                cursor: isDraggingSelection ? "grabbing" : undefined,
              } as React.CSSProperties
            }
          >
            <RevoGrid
              key={sheet.name}
              ref={(element) => {
                gridRef.current = element as GridViewportElement | null
              }}
              theme="compact"
              resize
              rowHeaders
              hideAttribution
              canFocus
              range
              applyOnClose
              columns={columns}
              source={preparedGridData.source}
              rowSize={rowSize}
              onAftercolumnresize={handleAfterColumnResize}
              onAfterfocus={handleAfterFocus}
              onAfteredit={handleAfterEdit}
              onAftergridinit={() => {
                void syncGridDimensions()
                scheduleViewportSync()
                window.requestAnimationFrame(() => {
                  refreshKanbanBadgePositions()
                })
              }}
              onAftergridrender={() => {
                void syncGridDimensions()
                scheduleViewportSync()
                window.requestAnimationFrame(() => {
                  refreshKanbanBadgePositions()
                })
              }}
            onBeforefocuslost={(event) => {
              if (!sendEmailDialogOpen && !extendKanbanDialogOpen) {
                event.preventDefault()
              }
            }}
              onViewportscroll={handleViewportScroll}
            />
            <div className="kanban-label-layer" aria-hidden="true">
              {kanbanBadgePositions.map((badge) => (
                <span
                  key={badge.id}
                  className="kanban-label-chip"
                  style={{ left: `${badge.left}px`, top: `${badge.top}px` }}
                >
                  Kanban
                </span>
              ))}
            </div>
          </div>
        </ContextMenuTrigger>
        {menuContext ? (
          <ContextMenuContent>
            {selectedRange ? (
              <>
                <ContextMenuItem
                  onSelect={() => {
                    handleCreateKanban()
                  }}
                >
                  Create Kanban
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            ) : null}
            {emailTargetsAtMenu.length > 0 ? (
              <>
                <ContextMenuItem
                  onSelect={() => {
                    setSendEmailTargets(emailTargetsAtMenu)
                    setSendEmailSubject("Message from Planar")
                    setSendEmailMessage("")
                    setSendEmailDialogOpen(true)
                  }}
                >
                  Send Email
                  {emailTargetsAtMenu.length > 1
                    ? ` (${emailTargetsAtMenu.length})`
                    : ""}
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            ) : null}
            <ContextMenuItem
              onSelect={() => {
                void handleCut()
              }}
            >
              Cut
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void handleCopy()
              }}
            >
              Copy
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void handlePasteAt(menuContext.row, menuContext.col)
              }}
            >
              Paste
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                void insertRowsAt(menuContext.rowStart, menuContext.rowCount)
              }}
            >
              Insert {menuContext.rowCount} row
              {menuContext.rowCount > 1 ? "s" : ""} above
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void insertColsAt(menuContext.colStart, menuContext.colCount)
              }}
            >
              Insert {menuContext.colCount} column
              {menuContext.colCount > 1 ? "s" : ""} left
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void deleteRowsAt(menuContext.rowStart, menuContext.rowCount)
              }}
            >
              Delete row
              {menuContext.rowCount > 1 ? "s" : ""} {menuContext.rowStart}
              {menuContext.rowCount > 1
                ? `-${menuContext.rowStart + menuContext.rowCount - 1}`
                : ""}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void deleteColsAt(menuContext.colStart, menuContext.colCount)
              }}
            >
              Delete column
              {menuContext.colCount > 1 ? "s" : ""}{" "}
              {toColumnLabel(menuContext.colStart)}
              {menuContext.colCount > 1
                ? `-${toColumnLabel(menuContext.colStart + menuContext.colCount - 1)}`
                : ""}
            </ContextMenuItem>
            {activeKanbanRegionAtMenu ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onSelect={() => {
                    setExtendKanbanRegionId(activeKanbanRegionAtMenu.id)
                    setExtendKanbanAxis("rows")
                    setExtendKanbanAmount("1")
                    setExtendKanbanDialogOpen(true)
                  }}
                >
                  Extend Kanban Rows
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => {
                    setExtendKanbanRegionId(activeKanbanRegionAtMenu.id)
                    setExtendKanbanAxis("cols")
                    setExtendKanbanAmount("1")
                    setExtendKanbanDialogOpen(true)
                  }}
                >
                  Extend Kanban Columns
                </ContextMenuItem>
              </>
            ) : null}
          </ContextMenuContent>
        ) : null}
      </ContextMenu>
      <Dialog
        open={extendKanbanDialogOpen}
        onOpenChange={setExtendKanbanDialogOpen}
      >
        <DialogContent
          className="sm:max-w-sm"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Extend Kanban {extendKanbanAxis === "rows" ? "Rows" : "Columns"}
            </DialogTitle>
            <DialogDescription>
              Choose how many {extendKanbanAxis === "rows" ? "rows" : "columns"}{" "}
              to add.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <label
              className="text-xs text-muted-foreground"
              htmlFor="extend-kanban-amount"
            >
              Amount
            </label>
            <Input
              id="extend-kanban-amount"
              type="number"
              min={1}
              step={1}
              value={extendKanbanAmount}
              onChange={(event) => setExtendKanbanAmount(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExtendKanbanDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!extendKanbanRegionId) {
                  return
                }
                const parsedAmount = Number(extendKanbanAmount)
                const step = Number.isFinite(parsedAmount)
                  ? Math.floor(parsedAmount)
                  : NaN
                if (!Number.isInteger(step) || step < 1) {
                  toast.error("Amount must be a whole number greater than 0.")
                  return
                }
                void extendKanbanRegion(
                  extendKanbanRegionId,
                  extendKanbanAxis,
                  step
                )
                setExtendKanbanDialogOpen(false)
              }}
              disabled={!extendKanbanRegionId}
            >
              Extend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={sendEmailDialogOpen} onOpenChange={setSendEmailDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Email</DialogTitle>
            <DialogDescription>
              {sendEmailTargets.length > 1
                ? `Compose a message to ${sendEmailTargets.length} selected recipients.`
                : "Compose a message to the selected recipient."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">
                Recipients ({sendEmailTargets.length})
              </label>
              <div className="max-h-32 overflow-y-auto rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">
                {sendEmailTargets.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {sendEmailTargets.map((target) => (
                      <span
                        key={target.email}
                        className="rounded bg-background px-2 py-0.5 ring-1 ring-border"
                      >
                        {target.email}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    No recipients detected.
                  </span>
                )}
              </div>
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">Snippets</label>
              <div className="max-h-24 overflow-y-auto rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">
                {snippetChoices.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {snippetChoices.map((choice) => (
                      <button
                        key={choice.key}
                        type="button"
                        className="rounded bg-background px-2 py-0.5 ring-1 ring-border hover:bg-accent hover:text-accent-foreground"
                        onClick={() => insertSnippetAtCursor(`{${choice.key}}`)}
                        title={`Insert {${choice.key}}`}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    No snippet values detected for current recipients.
                  </span>
                )}
              </div>
            </div>
            <div className="grid gap-1">
              <label
                className="text-xs text-muted-foreground"
                htmlFor="send-email-subject"
              >
                Subject
              </label>
              <Input
                ref={sendEmailSubjectRef}
                id="send-email-subject"
                value={sendEmailSubject}
                onChange={(event) => setSendEmailSubject(event.target.value)}
                onFocus={() => setActiveSnippetField("subject")}
              />
            </div>
            <div className="grid gap-1">
              <label
                className="text-xs text-muted-foreground"
                htmlFor="send-email-message"
              >
                Message
              </label>
              <textarea
                ref={sendEmailMessageRef}
                id="send-email-message"
                className="min-h-32 rounded-md border border-input bg-background px-3 py-2 text-sm outline-hidden"
                value={sendEmailMessage}
                onChange={(event) => setSendEmailMessage(event.target.value)}
                onFocus={() => setActiveSnippetField("message")}
                placeholder="Write your message..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSendEmailDialogOpen(false)}
              disabled={isSendingEmail}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!workbook) {
                  return
                }
                setIsSendingEmail(true)
                try {
                  const recipientEmails = sendEmailTargets.map(
                    (target) => target.email
                  )
                  await sendFileEmail(workbook.id, {
                    recipients: recipientEmails,
                    targets: sendEmailTargets.map((target) => ({
                      email: target.email,
                      vars: target.vars,
                    })),
                    subject: sendEmailSubject.trim(),
                    message: sendEmailMessage,
                  })
                  toast.success(
                    sendEmailTargets.length > 1
                      ? `Emails queued for ${sendEmailTargets.length} recipients.`
                      : "Email queued."
                  )
                  setSendEmailDialogOpen(false)
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Failed to send email"
                  )
                } finally {
                  setIsSendingEmail(false)
                }
              }}
              disabled={
                !workbook ||
                isSendingEmail ||
                sendEmailTargets.length === 0 ||
                !sendEmailMessage.trim()
              }
            >
              {isSendingEmail ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
