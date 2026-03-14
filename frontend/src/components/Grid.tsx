import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  RevoGrid,
  TextEditor,
  defineCustomElements,
  type AfterEditEvent,
  type BeforeSaveDataDetails,
  type ChangedRange,
  type ColumnDataSchemaModel,
  type ColumnRegular,
  type EditorCtr,
  type Editors,
  type FocusAfterRenderEvent,
  type InitialHeaderClick,
  type PluginProviders,
  type RangeArea,
  type ViewPortScrollEvent,
} from "@revolist/react-datagrid"

import { sendFileEmail } from "@/api/client"
import { renderCellDisplayValue } from "@/lib/cellFormat"
import {
  GRID_COPY_SELECTION_EVENT,
  GRID_NAVIGATE_TO_CELL_EVENT,
  GRID_PASTE_SELECTION_EVENT,
} from "@/lib/gridEvents"
import { useSheetStore } from "@/store/sheetStore"
import type { Cell, KanbanRegion, Sheet } from "@/types/sheet"
import {
  CellFormattingContextMenu,
  CellFormattingPanel,
} from "@/components/CellFormattingContextMenu"
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
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

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
  display: string
  displayValue: string
  previewValue: string
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
  scrollToCoordinate?: (cell: { x?: number; y?: number }) => Promise<void>
  scrollToRow?: (coordinate?: number) => Promise<void>
  scrollToColumnIndex?: (coordinate?: number) => Promise<void>
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
type FormattingAnchorTarget =
  | { kind: "cell" | "range"; row: number; col: number }
  | { kind: "row"; row: number }
  | { kind: "column"; col: number }
  | { kind: "sheet" }
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
type FormulaSelectionState = {
  targetRow: number
  targetCol: number
}
type FindMatch = {
  row: number
  col: number
}

const DEFAULT_COLUMN_WIDTH = 110
const MIN_COLUMN_WIDTH = 70
const CELL_PREVIEW_CHAR_LIMIT = 100
const PREVIEW_CHAR_WIDTH_PX = 6
const GRID_CELL_HORIZONTAL_PADDING_PX = 16
const MAX_COLUMN_WIDTH =
  CELL_PREVIEW_CHAR_LIMIT * PREVIEW_CHAR_WIDTH_PX +
  GRID_CELL_HORIZONTAL_PADDING_PX
const COLUMN_WIDTHS_STORAGE_KEY = "rowful:column-widths:v1"
const VISIBLE_ROW_OVERSCAN = 150
const VISIBLE_COL_OVERSCAN = 12
const FETCH_ROW_BLOCK = 400
const FETCH_COL_BLOCK = 32
const CELL_UPDATE_BATCH_CONCURRENCY = 12
const MIN_GRID_ROWS = 1000
const DEFAULT_KANBAN_STATUS = "Unassigned"
const FORMATTING_MENU_SHORTCUT_KEY = "f"
const FALLBACK_FORMATTING_MENU_SHORTCUT_LABEL = "Ctrl/Cmd+Shift+F"
const MIN_GRID_FONT_SIZE = 8
const MIN_GRID_ROW_HEIGHT = 18
const MIN_GRID_HEADER_HEIGHT = 24

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

const MIN_GRID_COLS = toColumnNumber("CV") ?? 100
const getGridRowCount = (maxRow: number) => Math.max(maxRow, MIN_GRID_ROWS, 1)
const getGridColCount = (maxCol: number) => Math.max(maxCol, MIN_GRID_COLS, 1)

const toCellPreviewDisplay = (value: string) => {
  if (value.length <= CELL_PREVIEW_CHAR_LIMIT) {
    return value
  }
  return `${value.slice(0, CELL_PREVIEW_CHAR_LIMIT).trimEnd()}…`
}

const hasRenderableStyle = (
  style: CellStyleValue | undefined
): style is NonNullable<CellStyleValue> =>
  Boolean(style && Object.keys(style).length > 0)

const buildPreparedCellStyle = (
  style: NonNullable<CellStyleValue>
): GridCellStyle => {
  const wrappingMode =
    style.wrapText || style.overflow === "wrap"
      ? "wrap"
      : style.overflow === "clip"
        ? "clip"
        : "overflow"
  const textDecoration = [
    style.underline ? "underline" : "",
    style.strike ? "line-through" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return {
    backgroundColor: style.fillColor || undefined,
    color: style.fontColor || undefined,
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
    textOverflow:
      wrappingMode === "wrap" || wrappingMode === "clip" ? "clip" : undefined,
    overflow: wrappingMode === "overflow" ? "visible" : "hidden",
    overflowWrap: wrappingMode === "wrap" ? "anywhere" : undefined,
    position: wrappingMode === "overflow" ? "relative" : undefined,
    whiteSpace: wrappingMode === "wrap" ? "normal" : "nowrap",
    zIndex: wrappingMode === "overflow" ? "1" : undefined,
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
    const border = "1px solid var(--color-primary)"
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
  const border = "2px dashed var(--color-primary)"
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
  const preparedCell = preparedGridData.cellMatrix.get(row)?.get(col)
  const baseStyle = preparedCell?.cellProperties?.style ?? {}
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
  columnLabels: Array.from(
    { length: getGridColCount(sheet.maxCol) },
    (_, idx) => toColumnLabel(idx + 1)
  ),
  loadedRows: new Set(),
  source: Array.from({ length: getGridRowCount(sheet.maxRow) }, () => ({})),
})

const applySheetRowsToPreparedGridData = (
  preparedGridData: PreparedGridData,
  rows: Sheet["rows"],
  currency: string
) => {
  for (const row of rows) {
    preparedGridData.loadedRows.add(row.index)
    const existingRowCells = preparedGridData.cellMatrix.get(row.index)
    const existingRowSource = preparedGridData.source[row.index - 1] ?? {}
    const rowCells = new Map<number, PreparedCell>()
    const rowSource: GridRow = {}
    let rowChanged = false

    for (const cell of row.cells) {
      const value = cell.value || ""
      const formula = cell.formula || ""
      const display = cell.display || ""
      const existing = existingRowCells?.get(cell.col)
      if (
        existing &&
        existing.value === value &&
        existing.formula === formula &&
        existing.style === cell.style &&
        existing.display === display
      ) {
        rowCells.set(cell.col, existing)
        rowSource[String(cell.col)] = toCellPreviewDisplay(
          existing.displayValue || existingRowSource[String(cell.col)] || ""
        )
        continue
      }

      rowChanged = true
      const displayValue = renderCellDisplayValue(value, cell.style, display, {
        currency,
      })
      const previewValue = toCellPreviewDisplay(displayValue)
      const cellProperties = hasRenderableStyle(cell.style)
        ? { style: buildPreparedCellStyle(cell.style) }
        : undefined

      rowCells.set(cell.col, {
        display,
        displayValue,
        previewValue,
        formula,
        style: cell.style,
        value,
        cellProperties,
      })
      rowSource[String(cell.col)] = displayValue
    }

    if (!rowChanged && (existingRowCells?.size ?? 0) !== rowCells.size) {
      rowChanged = true
    }

    preparedGridData.cellMatrix.set(row.index, rowCells)
    preparedGridData.source[row.index - 1] = rowChanged
      ? rowSource
      : existingRowSource
  }
}

const buildColumns = (
  preparedGridData: PreparedGridData,
  manualColumnSizes: ColumnSizeMap,
  cellPropertiesResolver: (
    row: number,
    col: number
  ) => { style: GridCellStyle },
  isKanbanStatusCell: (row: number, col: number) => boolean,
  statusColumnIndexes: Set<number>,
  statusCellEditor: EditorCtr
): ColumnRegular[] =>
  preparedGridData.columnLabels.map((label, idx) => {
    const col = idx + 1
    return {
      name: label,
      prop: String(col),
      size: manualColumnSizes[col] ?? DEFAULT_COLUMN_WIDTH,
      sortable: false,
      editor: statusColumnIndexes.has(col) ? statusCellEditor : undefined,
      cellTemplate: (_createElement, schema: ColumnDataSchemaModel) => {
        const row = schema.rowIndex + 1
        const prepared = preparedGridData.cellMatrix.get(row)?.get(col)
        const rawValue =
          prepared?.value ??
          (schema.value === undefined || schema.value === null
            ? ""
            : String(schema.value))
        if (isKanbanStatusCell(row, col) && !rawValue.trim()) {
          return DEFAULT_KANBAN_STATUS
        }
        if (prepared?.previewValue !== undefined) {
          return prepared.previewValue
        }
        const text =
          schema.value === undefined || schema.value === null
            ? ""
            : String(schema.value)
        return toCellPreviewDisplay(text)
      },
      cellProperties: (schema: ColumnDataSchemaModel) =>
        cellPropertiesResolver(schema.rowIndex + 1, col),
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

const viewportWindowKey = (window: ViewportWindow) =>
  `${window.rowStart}:${window.rowCount}:${window.colStart}:${window.colCount}`

const readViewportWindow = (
  grid: GridViewportElement,
  sheet: Sheet
): { visible: ViewportWindow; fetch: ViewportWindow } => {
  const maxRow = getGridRowCount(sheet.maxRow)
  const maxCol = getGridColCount(sheet.maxCol)
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

  const maxRow = getGridRowCount(sheet.maxRow)
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

const normalizeCellRange = (range: {
  rowStart: number
  rowEnd: number
  colStart: number
  colEnd: number
}) => ({
  rowStart: Math.min(range.rowStart, range.rowEnd),
  rowEnd: Math.max(range.rowStart, range.rowEnd),
  colStart: Math.min(range.colStart, range.colEnd),
  colEnd: Math.max(range.colStart, range.colEnd),
})

const formatCellRangeAddress = (range: {
  rowStart: number
  rowEnd: number
  colStart: number
  colEnd: number
}) => {
  const normalized = normalizeCellRange(range)
  const start = `${toColumnLabel(normalized.colStart)}${normalized.rowStart}`
  const end = `${toColumnLabel(normalized.colEnd)}${normalized.rowEnd}`
  return start === end ? start : `${start}:${end}`
}

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

const getRowHeaderIndexFromTarget = (target: Element) => {
  const rowHeaderViewport = target.closest(
    'revogr-viewport-scroll[row-header], [row-header="true"]'
  )
  if (!rowHeaderViewport) {
    return null
  }
  const rowHeaderCell = target.closest(".rgCell, .rgHeaderCell")
  const raw = (rowHeaderCell?.textContent ?? target.textContent ?? "").trim()
  const rowIndex = Number(raw)
  if (!Number.isFinite(rowIndex) || rowIndex < 1) {
    return null
  }
  return rowIndex
}

const getColumnHeaderCell = (container: Element, col: number) =>
  container.querySelector<HTMLElement>(
    `revogr-header .rgHeaderCell[data-rgCol="${col - 1}"]`
  )

const getRowHeaderCell = (container: Element, row: number) =>
  container.querySelector<HTMLElement>(
    `.rowHeaders .rgCell[data-rgRow="${row - 1}"]`
  )

const getBodyCell = (container: Element, row: number, col: number) =>
  container.querySelector<HTMLElement>(
    `.rgCell[data-rgRow="${row - 1}"][data-rgCol="${col - 1}"]`
  )

const getFirstVisibleBodyCellInRow = (container: Element, row: number) =>
  container.querySelector<HTMLElement>(`.rgCell[data-rgRow="${row - 1}"]`)

const getFirstVisibleBodyCellInColumn = (container: Element, col: number) =>
  container.querySelector<HTMLElement>(`.rgCell[data-rgCol="${col - 1}"]`)

const getSheetCornerHeaderCell = (container: Element) =>
  container.querySelector<HTMLElement>(
    ".rowHeaders revogr-header .rgHeaderCell"
  )

const parseClipboardText = (text: string) => {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop()
  }
  return lines.map((line) => line.split("\t"))
}

const getClosestWholeRepeatCount = (
  selectionCount: number,
  payloadCount: number
) => {
  const safeSelectionCount = Math.max(1, selectionCount)
  const safePayloadCount = Math.max(1, payloadCount)
  const lowerRepeat = Math.max(
    1,
    Math.floor(safeSelectionCount / safePayloadCount)
  )
  const upperRepeat = Math.max(
    1,
    Math.ceil(safeSelectionCount / safePayloadCount)
  )
  const lowerCount = lowerRepeat * safePayloadCount
  const upperCount = upperRepeat * safePayloadCount

  return safeSelectionCount - lowerCount <= upperCount - safeSelectionCount
    ? lowerRepeat
    : upperRepeat
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

const getKanbanStatusRegionsForCell = (
  regions: KanbanRegion[],
  row: number,
  col: number
) =>
  regions.filter(
    (region) =>
      col === region.statusCol &&
      row > region.range.rowStart &&
      row <= region.range.rowEnd
  )

const normalizeKanbanStatusValue = (value: string) => {
  const trimmed = value.trim()
  return trimmed || DEFAULT_KANBAN_STATUS
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
  const showGridLines = useSheetStore((state) => state.showGridLines)
  const isFindOpen = useSheetStore((state) => state.isFindOpen)
  const search = useSheetStore((state) => state.search)
  const findNavigationRequest = useSheetStore(
    (state) => state.findNavigationRequest
  )
  const findNavigationDirection = useSheetStore(
    (state) => state.findNavigationDirection
  )
  const setFindStatus = useSheetStore((state) => state.setFindStatus)
  const sheetFontFamily = useSheetStore((state) => state.sheetFontFamily)
  const selectCell = useSheetStore((state) => state.selectCell)
  const selectRow = useSheetStore((state) => state.selectRow)
  const selectColumn = useSheetStore((state) => state.selectColumn)
  const selectAll = useSheetStore((state) => state.selectAll)
  const selectionMode = useSheetStore((state) => state.selectionMode)
  const selectedRange = useSheetStore((state) => state.selectedRange)
  const selectedRow = useSheetStore((state) => state.selectedRow)
  const selectedCol = useSheetStore((state) => state.selectedCol)
  const setSelectedRange = useSheetStore((state) => state.setSelectedRange)
  const updateCell = useSheetStore((state) => state.updateCell)
  const updateCells = useSheetStore((state) => state.updateCells)
  const clearSelectedValues = useSheetStore(
    (state) => state.clearSelectedValues
  )
  const ensureWindow = useSheetStore((state) => state.ensureWindow)
  const setViewportWindow = useSheetStore((state) => state.setViewportWindow)
  const createKanbanFromSelection = useSheetStore(
    (state) => state.createKanbanFromSelection
  )
  const createKanbanCard = useSheetStore((state) => state.createKanbanCard)
  const extendKanbanRegion = useSheetStore((state) => state.extendKanbanRegion)
  const insertRowsAt = useSheetStore((state) => state.insertRowsAt)
  const insertColsAt = useSheetStore((state) => state.insertColsAt)
  const deleteRowsAt = useSheetStore((state) => state.deleteRowsAt)
  const deleteColsAt = useSheetStore((state) => state.deleteColsAt)
  const kanbanRegions = useSheetStore((state) => state.kanbanRegions)
  const rowSize = Math.max(MIN_GRID_ROW_HEIGHT, Math.round(28 * (zoom / 100)))
  const fontSize = Math.max(MIN_GRID_FONT_SIZE, Math.round(12 * (zoom / 100)))
  const headerHeight = Math.max(
    MIN_GRID_HEADER_HEIGHT,
    Math.round(34 * (zoom / 100))
  )
  const kanbanRegionsForSheet = useMemo(
    () => kanbanRegions.filter((region) => region.sheetName === sheet?.name),
    [kanbanRegions, sheet?.name]
  )

  const sheetKey = workbook && sheet ? `${workbook.id}::${sheet.name}` : ""
  const [manualColumnSizes, setManualColumnSizes] = useState<ColumnSizeMap>({})
  const gridRef = useRef<GridViewportElement | null>(null)
  const gridContainerRef = useRef<HTMLDivElement | null>(null)
  const preparedGridDataRef = useRef<PreparedGridData | null>(null)
  const preparedGridSheetKeyRef = useRef("")
  const viewportSyncFrameRef = useRef<number | null>(null)
  const viewportScrollFrameRef = useRef<number | null>(null)
  const viewportScrollEventRef = useRef<ViewPortScrollEvent | null>(null)
  const lastHandledFindNavigationRequestRef = useRef(0)
  const lastVisibleWindowKeyRef = useRef("")
  const lastFetchWindowKeyRef = useRef("")
  const lastRangeSelectionAtRef = useRef(0)
  const [menuContext, setMenuContext] = useState<GridContextMenuContext | null>(
    null
  )
  const [formattingPopoverOpen, setFormattingPopoverOpen] = useState(false)
  const [formattingPopoverAnchor, setFormattingPopoverAnchor] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const clipboardRef = useRef<{
    plainText: string
    payload: ClipboardPayload
  } | null>(null)
  const dragMoveStateRef = useRef<DragMoveState | null>(null)
  const dragHandleRangeRef = useRef<{
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  } | null>(null)
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
  const [, setDropPreviewRange] = useState<{
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
    "Message from Rowful"
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
  const [formulaSelection, setFormulaSelection] =
    useState<FormulaSelectionState | null>(null)
  const [activeSnippetField, setActiveSnippetField] = useState<
    "subject" | "message"
  >("message")
  const sendEmailSubjectRef = useRef<HTMLInputElement | null>(null)
  const sendEmailMessageRef = useRef<HTMLTextAreaElement | null>(null)
  const kanbanRegionsForSheetRef = useRef<KanbanRegion[]>([])
  const gridRowCount = sheet ? getGridRowCount(sheet.maxRow) : MIN_GRID_ROWS
  const gridColCount = sheet ? getGridColCount(sheet.maxCol) : MIN_GRID_COLS
  const statusColumnIndexes = useMemo(
    () => new Set(kanbanRegionsForSheet.map((region) => region.statusCol)),
    [kanbanRegionsForSheet]
  )

  const applyViewport = useCallback(
    (viewport: { visible: ViewportWindow; fetch: ViewportWindow }) => {
      const visibleKey = viewportWindowKey(viewport.visible)
      if (visibleKey !== lastVisibleWindowKeyRef.current) {
        lastVisibleWindowKeyRef.current = visibleKey
        setViewportWindow(viewport.visible)
      }
      const fetchKey = viewportWindowKey(viewport.fetch)
      if (fetchKey !== lastFetchWindowKeyRef.current) {
        lastFetchWindowKeyRef.current = fetchKey
        void ensureWindow(viewport.fetch)
      }
    },
    [ensureWindow, setViewportWindow]
  )

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

  const getFormattingAnchorTarget = useCallback((): FormattingAnchorTarget => {
    if (selectedRange) {
      return {
        kind: "range",
        row: selectedRange.rowStart,
        col: selectedRange.colStart,
      }
    }
    if (selectionMode === "row") {
      return { kind: "row", row: selectedRow }
    }
    if (selectionMode === "column") {
      return { kind: "column", col: selectedCol }
    }
    if (selectionMode === "sheet") {
      return { kind: "sheet" }
    }
    return { kind: "cell", row: selectedRow, col: selectedCol }
  }, [selectedCol, selectedRange, selectedRow, selectionMode])

  const formattingShortcutLabel = useMemo(() => {
    if (typeof navigator === "undefined") {
      return FALLBACK_FORMATTING_MENU_SHORTCUT_LABEL
    }
    return /Mac|iPhone|iPad/.test(navigator.platform)
      ? "Cmd+Shift+F"
      : "Ctrl+Shift+F"
  }, [])

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
          rowCount: getGridRowCount(sheet?.maxRow ?? 1),
          colStart: 1,
          colCount: getGridColCount(sheet?.maxCol ?? 1),
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
      if (selectionMode === "row") {
        return {
          row,
          col,
          rowStart: selectedRow,
          rowCount: 1,
          colStart: 1,
          colCount: getGridColCount(sheet?.maxCol ?? 1),
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
    [
      selectedCol,
      selectedRange,
      selectedRow,
      selectionMode,
      sheet?.maxCol,
      sheet?.maxRow,
    ]
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
      preparedGridSheetKeyRef.current = ""
      return null
    }

    const preparedSheetKey = `${sheetKey}:${sheet.maxRow}:${sheet.maxCol}`
    const current = preparedGridDataRef.current
    if (
      !current ||
      preparedGridSheetKeyRef.current !== preparedSheetKey ||
      current.source.length !== getGridRowCount(sheet.maxRow) ||
      current.columnLabels.length !== getGridColCount(sheet.maxCol)
    ) {
      preparedGridDataRef.current = createPreparedGridData(sheet)
      preparedGridSheetKeyRef.current = preparedSheetKey
    }

    const prepared =
      preparedGridDataRef.current ?? createPreparedGridData(sheet)
    preparedGridDataRef.current = prepared
    applySheetRowsToPreparedGridData(prepared, sheet.rows, currency)
    return prepared
  }, [currency, sheet, sheetKey])

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

  useEffect(() => {
    dragHandleRangeRef.current = dragHandleRange
  }, [dragHandleRange])

  useEffect(() => {
    kanbanRegionsForSheetRef.current = kanbanRegionsForSheet
  }, [kanbanRegionsForSheet])

  const isKanbanStatusCell = useCallback((row: number, col: number) => {
    return (
      getKanbanStatusRegionsForCell(kanbanRegionsForSheetRef.current, row, col)
        .length > 0
    )
  }, [])

  const commitGridCellValue = useCallback(
    async (row: number, col: number, value: string) => {
      const nextValue = isKanbanStatusCell(row, col)
        ? normalizeKanbanStatusValue(value)
        : value
      await updateCell(row, col, nextValue)
    },
    [isKanbanStatusCell, updateCell]
  )

  const getSelectionBounds = useCallback(() => {
    if (selectedRange) {
      return selectedRange
    }
    if (selectionMode === "sheet") {
      return {
        rowStart: 1,
        rowEnd: sheet?.maxRow ?? 1,
        colStart: 1,
        colEnd: sheet?.maxCol ?? 1,
      }
    }
    if (selectionMode === "row") {
      return {
        rowStart: selectedRow,
        rowEnd: selectedRow,
        colStart: 1,
        colEnd: sheet?.maxCol ?? 1,
      }
    }
    if (selectionMode === "column") {
      return {
        rowStart: 1,
        rowEnd: sheet?.maxRow ?? 1,
        colStart: selectedCol,
        colEnd: selectedCol,
      }
    }
    return {
      rowStart: selectedRow,
      rowEnd: selectedRow,
      colStart: selectedCol,
      colEnd: selectedCol,
    }
  }, [
    selectedCol,
    selectedRange,
    selectedRow,
    selectionMode,
    sheet?.maxCol,
    sheet?.maxRow,
  ])

  const clearKanbanAwareSelection = useCallback(async () => {
    const bounds = getSelectionBounds()
    const statusCells: Array<{ row: number; col: number }> = []

    for (const region of kanbanRegionsForSheetRef.current) {
      if (
        region.statusCol < bounds.colStart ||
        region.statusCol > bounds.colEnd
      ) {
        continue
      }
      const rowStart = Math.max(bounds.rowStart, region.range.rowStart + 1)
      const rowEnd = Math.min(bounds.rowEnd, region.range.rowEnd)
      for (let row = rowStart; row <= rowEnd; row += 1) {
        statusCells.push({ row, col: region.statusCol })
      }
    }

    await clearSelectedValues()
    if (statusCells.length === 0) {
      return
    }

    await runCellUpdateBatch(
      statusCells.map(
        ({ row, col }) =>
          () =>
            commitGridCellValue(row, col, "")
      )
    )
  }, [clearSelectedValues, commitGridCellValue, getSelectionBounds])

  const openFormattingPopoverAtSelection = useCallback(async () => {
    if (typeof window === "undefined") {
      return
    }

    const container = gridContainerRef.current
    if (!container) {
      return
    }

    const anchorTarget = getFormattingAnchorTarget()
    const grid = gridRef.current

    if (anchorTarget.kind === "cell" || anchorTarget.kind === "range") {
      await grid?.scrollToCoordinate?.({
        x: anchorTarget.col - 1,
        y: anchorTarget.row - 1,
      })
    } else if (anchorTarget.kind === "row") {
      await grid?.scrollToRow?.(anchorTarget.row - 1)
    } else if (anchorTarget.kind === "column") {
      await grid?.scrollToColumnIndex?.(anchorTarget.col - 1)
    }

    const resolveAnchorElement = (element: HTMLElement) => {
      switch (anchorTarget.kind) {
        case "cell":
        case "range":
          return (
            getBodyCell(element, anchorTarget.row, anchorTarget.col) ??
            getColumnHeaderCell(element, anchorTarget.col) ??
            getRowHeaderCell(element, anchorTarget.row)
          )
        case "row":
          return (
            getRowHeaderCell(element, anchorTarget.row) ??
            getFirstVisibleBodyCellInRow(element, anchorTarget.row)
          )
        case "column":
          return (
            getColumnHeaderCell(element, anchorTarget.col) ??
            getFirstVisibleBodyCellInColumn(element, anchorTarget.col)
          )
        case "sheet":
          return getSheetCornerHeaderCell(element)
      }
    }

    const setAnchorFromRect = (latestContainer: HTMLElement, rect: DOMRect) => {
      const containerRect = latestContainer.getBoundingClientRect()
      setFormattingPopoverAnchor({
        left: Math.max(0, rect.left - containerRect.left),
        top: Math.max(0, rect.top - containerRect.top),
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      })
      setFormattingPopoverOpen(true)
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve())
      })
      const latestContainer = gridContainerRef.current
      if (!latestContainer) {
        return
      }
      const target = resolveAnchorElement(latestContainer)
      if (target) {
        setAnchorFromRect(latestContainer, target.getBoundingClientRect())
        return
      }
    }

    const latestContainer = gridContainerRef.current
    if (!latestContainer) {
      return
    }
    const containerRect = latestContainer.getBoundingClientRect()
    setAnchorFromRect(
      latestContainer,
      new DOMRect(
        containerRect.left + containerRect.width / 2,
        containerRect.top +
          Math.min(56, Math.max(24, containerRect.height / 4)),
        1,
        1
      )
    )
  }, [getFormattingAnchorTarget])

  const beginFormulaSelection = useCallback(
    (row: number, col: number) => {
      const cell = preparedGridDataRef.current?.cellMatrix.get(row)?.get(col)
      const isEmpty =
        !cell?.value.trim() && !cell?.formula.trim() && !cell?.display.trim()
      if (!isEmpty) {
        return false
      }

      selectCell(row, col, cell?.value ?? "", cell?.formula ?? "")
      setSelectedRange(null)
      setFormulaSelection({
        targetRow: row,
        targetCol: col,
      })
      toast("Select cells to sum into this formula cell.")
      return true
    },
    [selectCell, setSelectedRange]
  )

  const statusCellEditor = useMemo(() => {
    const editor: EditorCtr = (column, save) => new TextEditor(column, save)
    return editor
  }, [])

  const gridEditors = useMemo(
    () =>
      ({
        "rowful-status-editor": statusCellEditor,
      }) satisfies Editors,
    [statusCellEditor]
  )

  const cellPropertiesResolver = useCallback(
    (row: number, col: number) => {
      if (!preparedGridData) {
        return { style: {} }
      }
      return resolveCellProperties(
        row,
        col,
        preparedGridData,
        kanbanRegionsForSheetRef.current,
        dragHandleRangeRef.current,
        dropPreviewRangeRef.current
      )
    },
    [preparedGridData]
  )

  const columns = useMemo(() => {
    if (!preparedGridData) {
      return null
    }
    return buildColumns(
      preparedGridData,
      manualColumnSizes,
      cellPropertiesResolver,
      isKanbanStatusCell,
      statusColumnIndexes,
      statusCellEditor
    )
  }, [
    cellPropertiesResolver,
    isKanbanStatusCell,
    manualColumnSizes,
    preparedGridData,
    statusCellEditor,
    statusColumnIndexes,
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
      applyViewport(viewport)
    })
  }, [applyViewport, sheet])

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
    providers.dimension.setItemCount(getGridRowCount(sheet.maxRow), "rgRow")
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
      if (viewportScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportScrollFrameRef.current)
        viewportScrollFrameRef.current = null
      }
    }
  }, [scheduleViewportSync, syncGridDimensions])

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
        { x: col - 1, y: Math.max(gridRowCount - 1, 0) },
        "rgCol",
        "rgRow"
      )
    },
    [gridRowCount, selectColumn, setSelectedRange]
  )

  const handleRowHeaderClick = useCallback(
    (row: number | null | undefined) => {
      if (!row || !Number.isFinite(row) || row < 1) {
        return
      }
      setSelectedRange(null)
      selectRow(row)
      void gridRef.current?.setCellsFocus?.(
        { x: 0, y: row - 1 },
        { x: Math.max(gridColCount - 1, 0), y: row - 1 },
        "rgCol",
        "rgRow"
      )
    },
    [gridColCount, selectRow, setSelectedRange]
  )

  const handleSelectAll = useCallback(() => {
    setSelectedRange(null)
    selectAll()
    void gridRef.current?.setCellsFocus?.(
      { x: 0, y: 0 },
      {
        x: Math.max(gridColCount - 1, 0),
        y: Math.max(gridRowCount - 1, 0),
      },
      "rgCol",
      "rgRow"
    )
  }, [gridColCount, gridRowCount, selectAll, setSelectedRange])

  const handleNavigateToCell = useCallback(
    (event: Event) => {
      const detail = (
        event as CustomEvent<{
          rowStart?: number
          rowEnd?: number
          colStart?: number
          colEnd?: number
        }>
      ).detail
      const rowStart = Math.round(Number(detail?.rowStart))
      const rowEndRaw = Math.round(Number(detail?.rowEnd))
      const colStart = Math.round(Number(detail?.colStart))
      const colEndRaw = Math.round(Number(detail?.colEnd))
      if (
        !Number.isFinite(rowStart) ||
        !Number.isFinite(colStart) ||
        rowStart < 1 ||
        colStart < 1
      ) {
        return
      }
      const maxRow = Math.max(gridRowCount, 1)
      const maxCol = Math.max(gridColCount, 1)
      const rowEnd =
        Number.isFinite(rowEndRaw) && rowEndRaw >= 1 ? rowEndRaw : rowStart
      const colEnd =
        Number.isFinite(colEndRaw) && colEndRaw >= 1 ? colEndRaw : colStart
      const boundedRowStart = Math.min(rowStart, maxRow)
      const boundedRowEnd = Math.min(rowEnd, maxRow)
      const boundedColStart = Math.min(colStart, maxCol)
      const boundedColEnd = Math.min(colEnd, maxCol)
      const focusStart = { x: boundedColStart - 1, y: boundedRowStart - 1 }
      const focusEnd = { x: boundedColEnd - 1, y: boundedRowEnd - 1 }

      const grid = gridRef.current
      if (!grid) {
        return
      }
      void (async () => {
        await ensureWindow({
          rowStart: boundedRowStart,
          rowCount: Math.max(1, boundedRowEnd - boundedRowStart + 1),
          colStart: boundedColStart,
          colCount: Math.max(1, boundedColEnd - boundedColStart + 1),
        })
        await grid.scrollToRow?.(focusStart.y)
        await grid.scrollToColumnIndex?.(focusStart.x)
        await grid.setCellsFocus?.(focusStart, focusEnd, "rgCol", "rgRow")
      })()
    },
    [ensureWindow, gridColCount, gridRowCount]
  )

  const focusGridCell = useCallback(async (row: number, col: number) => {
    const grid = gridRef.current
    if (!grid) {
      return
    }
    await grid.setCellsFocus?.(
      { x: col - 1, y: row - 1 },
      { x: col - 1, y: row - 1 },
      "rgCol",
      "rgRow"
    )
  }, [])

  const cancelFormulaSelection = useCallback(() => {
    if (!formulaSelection) {
      return
    }
    const target = formulaSelection
    const cell = preparedGridDataRef.current?.cellMatrix
      .get(target.targetRow)
      ?.get(target.targetCol)
    setFormulaSelection(null)
    setSelectedRange(null)
    selectCell(
      target.targetRow,
      target.targetCol,
      cell?.value ?? "",
      cell?.formula ?? ""
    )
    void focusGridCell(target.targetRow, target.targetCol)
  }, [focusGridCell, formulaSelection, selectCell, setSelectedRange])

  const finalizeFormulaSelection = useCallback(
    async (range: RangeArea | null) => {
      if (!formulaSelection || !range) {
        return false
      }

      const sourceRange = normalizeCellRange(rangeAreaToSelection(range))
      const isTargetOnlySelection =
        sourceRange.rowStart === formulaSelection.targetRow &&
        sourceRange.rowEnd === formulaSelection.targetRow &&
        sourceRange.colStart === formulaSelection.targetCol &&
        sourceRange.colEnd === formulaSelection.targetCol
      if (isTargetOnlySelection) {
        return true
      }
      if (
        isCellInsideRange(
          {
            row: formulaSelection.targetRow,
            col: formulaSelection.targetCol,
          },
          sourceRange
        )
      ) {
        toast.error("Select source cells outside the formula cell.")
        return true
      }

      const target = formulaSelection
      const formulaBody = `SUM(${formatCellRangeAddress(sourceRange)})`
      setFormulaSelection(null)
      setSelectedRange(null)
      selectCell(target.targetRow, target.targetCol, "", formulaBody)
      await commitGridCellValue(
        target.targetRow,
        target.targetCol,
        `=${formulaBody}`
      )
      await focusGridCell(target.targetRow, target.targetCol)
      return true
    },
    [
      commitGridCellValue,
      focusGridCell,
      formulaSelection,
      selectCell,
      setSelectedRange,
    ]
  )

  useEffect(() => {
    if (!formulaSelection) {
      return
    }
    const grid = gridRef.current
    if (!grid) {
      return
    }
    void (async () => {
      const providers = await grid.getProviders?.()
      providers?.selection.setEdit(false)
    })()
  }, [formulaSelection])

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) {
      return
    }

    const handleSelectionChange = (event: Event) => {
      const detail = (event as CustomEvent<ChangedRange>).detail
      if (formulaSelection) {
        return
      }
      syncSelection(detail.newRange)
    }
    const handleSetRange = (event: Event) => {
      const detail = (event as CustomEvent<RangeArea>).detail
      if (formulaSelection) {
        void finalizeFormulaSelection(detail)
        return
      }
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
      const rowIndex = getRowHeaderIndexFromTarget(target)
      if (rowIndex) {
        handleRowHeaderClick(rowIndex)
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
      void clearKanbanAwareSelection()
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
      if (formulaSelection && original.key === "Escape") {
        original.preventDefault()
        cancelFormulaSelection()
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
        void clearKanbanAwareSelection()
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
        return
      }
      if (original.shiftKey && key === FORMATTING_MENU_SHORTCUT_KEY) {
        original.preventDefault()
        void openFormattingPopoverAtSelection()
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
    window.addEventListener(
      GRID_NAVIGATE_TO_CELL_EVENT,
      handleNavigateToCell as EventListener
    )

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
      window.removeEventListener(
        GRID_NAVIGATE_TO_CELL_EVENT,
        handleNavigateToCell as EventListener
      )
    }
  }, [
    clearKanbanAwareSelection,
    cancelFormulaSelection,
    extendKanbanDialogOpen,
    finalizeFormulaSelection,
    formulaSelection,
    handleHeaderClick,
    handleNavigateToCell,
    handleRowHeaderClick,
    handleSelectAll,
    openFormattingPopoverAtSelection,
    sendEmailDialogOpen,
    selectedCol,
    selectedRow,
    syncSelection,
  ])

  const handleBeforeEditStart = useCallback(
    (event: CustomEvent<BeforeSaveDataDetails>) => {
      const detail = event.detail
      if (!("prop" in detail) || typeof detail.rowIndex !== "number") {
        return
      }
      const col = parseColNumber(detail.prop)
      if (!col) {
        return
      }
      const row = detail.rowIndex + 1
      const preparedCell = preparedGridDataRef.current?.cellMatrix
        .get(row)
        ?.get(col)
      if (preparedCell?.formula) {
        detail.val = `=${preparedCell.formula}`
        return
      }
      const value =
        detail.val === undefined || detail.val === null
          ? ""
          : String(detail.val)
      if (value !== "=") {
        return
      }
      if (!beginFormulaSelection(row, col)) {
        return
      }
      event.preventDefault()
    },
    [beginFormulaSelection]
  )

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
      void commitGridCellValue(detail.rowIndex + 1, col, value)
    },
    [commitGridCellValue]
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
    },
    [manualColumnSizes, sheetKey]
  )

  const handleViewportScroll = useCallback(
    (event: CustomEvent<ViewPortScrollEvent>) => {
      viewportScrollEventRef.current = event.detail
      if (viewportScrollFrameRef.current !== null) {
        return
      }
      const grid = gridRef.current
      if (!grid || !sheet) {
        return
      }
      viewportScrollFrameRef.current = window.requestAnimationFrame(() => {
        viewportScrollFrameRef.current = null
        const latestEvent = viewportScrollEventRef.current
        if (!latestEvent) {
          return
        }
        const nextGrid = gridRef.current
        if (!nextGrid || !sheet) {
          return
        }
        const viewport = readViewportWindowFromScroll(
          nextGrid,
          sheet,
          latestEvent,
          rowSize
        )
        applyViewport(viewport)
      })
    },
    [applyViewport, rowSize, sheet]
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
          "application/x-rowful-cells": new Blob([JSON.stringify(payload)], {
            type: "application/x-rowful-cells",
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
    async (
      row: number,
      col: number,
      payload: ClipboardPayload,
      targetRange?: {
        rowStart: number
        rowEnd: number
        colStart: number
        colEnd: number
      } | null
    ) => {
      const updates: Array<{ row: number; col: number; value: string }> = []
      const baseRange = targetRange ?? {
        rowStart: row,
        rowEnd: row,
        colStart: col,
        colEnd: col,
      }
      const repeatRowCount = getClosestWholeRepeatCount(
        baseRange.rowEnd - baseRange.rowStart + 1,
        payload.rowCount
      )
      const repeatColCount = getClosestWholeRepeatCount(
        baseRange.colEnd - baseRange.colStart + 1,
        payload.colCount
      )
      const totalRows = Math.max(1, payload.rowCount) * repeatRowCount
      const totalCols = Math.max(1, payload.colCount) * repeatColCount

      for (let rowOffset = 0; rowOffset < totalRows; rowOffset += 1) {
        const line =
          payload.cells[rowOffset % Math.max(1, payload.rowCount)] ?? []
        for (let colOffset = 0; colOffset < totalCols; colOffset += 1) {
          const cell = line[colOffset % Math.max(1, payload.colCount)] ?? {
            value: "",
            formula: "",
          }
          const targetRow = baseRange.rowStart + rowOffset
          const targetCol = baseRange.colStart + colOffset
          const nextValue = cell.formula || cell.value || ""
          updates.push({
            row: targetRow,
            col: targetCol,
            value: isKanbanStatusCell(targetRow, targetCol)
              ? normalizeKanbanStatusValue(nextValue)
              : nextValue,
          })
        }
      }
      await updateCells(updates)
    },
    [isKanbanStatusCell, updateCells]
  )

  const handlePasteAt = useCallback(
    async (row: number, col: number) => {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        return
      }
      const gridSelection = await gridRef.current?.getSelectedRange?.()
      const liveSelectionRange =
        gridSelection && hasMultiCellRange(gridSelection)
          ? rangeAreaToSelection(gridSelection)
          : null
      const fallbackSelectionRange = getActiveSelectionRange()
      const targetRange = isCellInsideRange(
        { row, col },
        liveSelectionRange ?? fallbackSelectionRange
      )
        ? (liveSelectionRange ?? fallbackSelectionRange)
        : null
      if (navigator.clipboard.read) {
        try {
          const items = await navigator.clipboard.read()
          for (const item of items) {
            if (!item.types.includes("application/x-rowful-cells")) {
              continue
            }
            const blob = await item.getType("application/x-rowful-cells")
            const raw = await blob.text()
            const parsed = JSON.parse(raw) as ClipboardPayload
            if (
              parsed &&
              Number.isFinite(parsed.rowCount) &&
              Number.isFinite(parsed.colCount) &&
              Array.isArray(parsed.cells)
            ) {
              await applyClipboardPayload(row, col, parsed, targetRange)
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
        await applyClipboardPayload(row, col, internal.payload, targetRange)
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
      await applyClipboardPayload(row, col, payload, targetRange)
    },
    [applyClipboardPayload, getActiveSelectionRange]
  )

  const findMatches = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query || !preparedGridData) {
      return [] as FindMatch[]
    }

    const matches: FindMatch[] = []
    for (const [row, cells] of preparedGridData.cellMatrix) {
      for (const [col, cell] of cells) {
        const haystacks = [cell.displayValue, cell.value, cell.formula]
        if (
          haystacks.some((value) => value.trim().toLowerCase().includes(query))
        ) {
          matches.push({ row, col })
        }
      }
    }

    return matches.sort((left, right) =>
      left.row === right.row ? left.col - right.col : left.row - right.row
    )
  }, [preparedGridData, search])

  const navigateToFindMatch = useCallback((match: FindMatch) => {
    window.dispatchEvent(
      new CustomEvent(GRID_NAVIGATE_TO_CELL_EVENT, {
        detail: {
          rowStart: match.row,
          rowEnd: match.row,
          colStart: match.col,
          colEnd: match.col,
        },
      })
    )
  }, [])

  const getPreferredFindMatchIndex = useCallback(
    (matches: FindMatch[]) => {
      if (matches.length === 0) {
        return -1
      }
      const exactIndex = matches.findIndex(
        (match) => match.row === selectedRow && match.col === selectedCol
      )
      if (exactIndex >= 0) {
        return exactIndex
      }
      const nextIndex = matches.findIndex(
        (match) =>
          match.row > selectedRow ||
          (match.row === selectedRow && match.col > selectedCol)
      )
      return nextIndex >= 0 ? nextIndex : 0
    },
    [selectedCol, selectedRow]
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
          clearTasks.push(() => commitGridCellValue(targetRow, targetCol, ""))
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
    [
      applyClipboardPayload,
      commitGridCellValue,
      preparedGridData,
      setSelectedRange,
    ]
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

  useEffect(() => {
    const handleExternalCopy = () => {
      void handleCopy()
    }
    const handleExternalPaste = () => {
      void handlePasteAt(selectedRow, selectedCol)
    }

    window.addEventListener(GRID_COPY_SELECTION_EVENT, handleExternalCopy)
    window.addEventListener(GRID_PASTE_SELECTION_EVENT, handleExternalPaste)

    return () => {
      window.removeEventListener(GRID_COPY_SELECTION_EVENT, handleExternalCopy)
      window.removeEventListener(GRID_PASTE_SELECTION_EVENT, handleExternalPaste)
    }
  }, [handleCopy, handlePasteAt, selectedCol, selectedRow])

  useEffect(() => {
    if (!isFindOpen || !search.trim()) {
      setFindStatus(0, -1)
      return
    }
    if (findMatches.length === 0) {
      setFindStatus(0, -1)
      return
    }

    const currentIndex = findMatches.findIndex(
      (match) => match.row === selectedRow && match.col === selectedCol
    )
    const targetIndex =
      currentIndex >= 0 ? currentIndex : getPreferredFindMatchIndex(findMatches)

    setFindStatus(findMatches.length, targetIndex)

    if (currentIndex < 0 && targetIndex >= 0) {
      navigateToFindMatch(findMatches[targetIndex])
    }
  }, [
    findMatches,
    getPreferredFindMatchIndex,
    isFindOpen,
    navigateToFindMatch,
    search,
    selectedCol,
    selectedRow,
    setFindStatus,
  ])

  useEffect(() => {
    if (!isFindOpen || !search.trim() || findMatches.length === 0) {
      return
    }
    if (
      findNavigationRequest === 0 ||
      lastHandledFindNavigationRequestRef.current === findNavigationRequest
    ) {
      return
    }
    lastHandledFindNavigationRequestRef.current = findNavigationRequest

    const currentIndex = findMatches.findIndex(
      (match) => match.row === selectedRow && match.col === selectedCol
    )
    const baseIndex =
      currentIndex >= 0 ? currentIndex : getPreferredFindMatchIndex(findMatches)
    if (baseIndex < 0) {
      return
    }

    const nextIndex =
      findNavigationDirection === "prev"
        ? (baseIndex - 1 + findMatches.length) % findMatches.length
        : (baseIndex + 1) % findMatches.length

    setFindStatus(findMatches.length, nextIndex)
    navigateToFindMatch(findMatches[nextIndex])
  }, [
    findMatches,
    findNavigationDirection,
    findNavigationRequest,
    getPreferredFindMatchIndex,
    isFindOpen,
    navigateToFindMatch,
    search,
    selectedCol,
    selectedRow,
    setFindStatus,
  ])

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
    void createKanbanFromSelection(statusCol, name || undefined)
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

  const handleCreateCardFromGrid = useCallback(async () => {
    if (!activeKanbanRegionAtMenu) {
      return
    }

    const nextStatus =
      menuContext && menuContext.row > activeKanbanRegionAtMenu.range.rowStart
        ? (preparedGridDataRef.current?.cellMatrix
            .get(menuContext.row)
            ?.get(activeKanbanRegionAtMenu.statusCol)?.value ?? "")
        : ""

    const row = await createKanbanCard(activeKanbanRegionAtMenu.id, {
      status: nextStatus,
    })
    if (row === null) {
      toast.error("Could not create a new card.")
    }
  }, [activeKanbanRegionAtMenu, createKanbanCard, menuContext])

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

  const handleExtendKanban = useCallback(async () => {
    if (!extendKanbanRegionId) {
      return
    }

    const parsedAmount = Number(extendKanbanAmount)
    const step = Number.isFinite(parsedAmount) ? Math.floor(parsedAmount) : NaN
    if (!Number.isInteger(step) || step < 1) {
      toast.error("Amount must be a whole number greater than 0.")
      return
    }

    const region = kanbanRegionsForSheetRef.current.find(
      (item) => item.id === extendKanbanRegionId
    )
    if (!region) {
      return
    }

    const previousRowEnd = region.range.rowEnd
    const statusCol = region.statusCol

    await extendKanbanRegion(extendKanbanRegionId, extendKanbanAxis, step)

    if (extendKanbanAxis === "rows") {
      await runCellUpdateBatch(
        Array.from({ length: step }, (_, index) => {
          const row = previousRowEnd + index + 1
          return () =>
            commitGridCellValue(row, statusCol, DEFAULT_KANBAN_STATUS)
        })
      )
    }

    setExtendKanbanDialogOpen(false)
  }, [
    commitGridCellValue,
    extendKanbanAmount,
    extendKanbanAxis,
    extendKanbanRegion,
    extendKanbanRegionId,
  ])

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
      <Popover
        open={formattingPopoverOpen}
        onOpenChange={(open) => {
          setFormattingPopoverOpen(open)
          if (!open) {
            setFormattingPopoverAnchor(null)
          }
        }}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={gridContainerRef}
              className={`sheet-grid relative h-full${
                formulaSelection ? " formula-selection" : ""
              }${showGridLines ? "" : " hide-grid-lines"}`}
              onPointerDownCapture={(event) => {
                setFormattingPopoverOpen(false)
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
                setFormattingPopoverOpen(false)
                const target = event.target
                if (!(target instanceof Element)) {
                  setMenuContext(buildMenuContext(selectedRow, selectedCol))
                  return
                }
                const directCell = getCellCoordsFromTarget(target)
                if (directCell) {
                  setMenuContext(
                    buildMenuContext(directCell.row, directCell.col)
                  )
                  return
                }
                const rowIndex = getRowHeaderIndexFromTarget(target)
                if (rowIndex) {
                  setMenuContext(buildMenuContext(rowIndex, selectedCol))
                  return
                }
                const rowHeaderViewport = target.closest(
                  'revogr-viewport-scroll[row-header], [row-header="true"]'
                )
                if (rowHeaderViewport) {
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
                  "--rowful-grid-font-size": `${fontSize}px`,
                  "--rowful-grid-row-height": `${rowSize}px`,
                  "--rowful-grid-header-height": `${headerHeight}px`,
                  "--rowful-grid-font-family": `${sheetFontFamily}, "Segoe UI", Arial, sans-serif`,
                  cursor: isDraggingSelection ? "grabbing" : undefined,
                } as React.CSSProperties
              }
            >
              {formattingPopoverAnchor ? (
                <PopoverAnchor asChild>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute"
                    style={{
                      left: formattingPopoverAnchor.left,
                      top: formattingPopoverAnchor.top,
                      width: formattingPopoverAnchor.width,
                      height: formattingPopoverAnchor.height,
                    }}
                  />
                </PopoverAnchor>
              ) : null}
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
                editors={gridEditors}
                source={preparedGridData.source}
                rowSize={rowSize}
                onAftercolumnresize={handleAfterColumnResize}
                onAfterfocus={handleAfterFocus}
                onBeforeeditstart={handleBeforeEditStart}
                onAfteredit={handleAfterEdit}
                onAftergridinit={() => {
                  void syncGridDimensions()
                  scheduleViewportSync()
                }}
                onAftergridrender={() => {
                  scheduleViewportSync()
                }}
                onBeforefocuslost={(event) => {
                  if (!sendEmailDialogOpen && !extendKanbanDialogOpen) {
                    event.preventDefault()
                  }
                }}
                onViewportscroll={handleViewportScroll}
              />
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
                      setSendEmailSubject("Message from Rowful")
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
              <CellFormattingContextMenu
                shortcutLabel={formattingShortcutLabel}
              />
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
                      void handleCreateCardFromGrid()
                    }}
                  >
                    Add Kanban Card
                  </ContextMenuItem>
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
        {formattingPopoverAnchor ? (
          <PopoverContent align="start" className="w-72 p-0" sideOffset={8}>
            <CellFormattingPanel />
          </PopoverContent>
        ) : null}
      </Popover>
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
                void handleExtendKanban()
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
