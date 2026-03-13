import { create } from "zustand"

import {
  applyStyle as applyStyleRequest,
  clearFormattingRange,
  clearValuesRange,
  createWorkbook as createWorkbookRequest,
  createSheet as createSheetRequest,
  deleteCols as deleteColsRequest,
  deleteRows as deleteRowsRequest,
  deleteSheet as deleteSheetRequest,
  fetchSheet,
  fetchFileSettings,
  fetchSheetWindow,
  insertCols as insertColsRequest,
  insertRows as insertRowsRequest,
  listFiles,
  listRecentFiles,
  openFile,
  removeFile,
  renameFile,
  resizeSheet as resizeSheetRequest,
  renameSheet as renameSheetRequest,
  saveKanbanRegions as saveKanbanRegionsRequest,
  updateCell as updateCellRequest,
  updateFileSettings,
  uploadWorkbook,
} from "@/api/client"
import { isValueValidForNumFmt } from "@/lib/cellFormat"
import { DEFAULT_FILE_SETTINGS } from "@/lib/fileSettings"
import { setLastOpenedSheetForFile } from "@/lib/sheetPrefs"
import type {
  Cell,
  CellRange,
  CellStyle,
  FileSettings,
  FileEntry,
  KanbanRegion,
  SMTPSettings,
  SelectionTarget,
  Sheet,
  Workbook,
} from "@/types/sheet"

type SelectionMode = "cell" | "row" | "column" | "sheet"
type SelectedCell = {
  address: string
  value: string
  formula: string
}
type ViewportWindow = {
  rowStart: number
  rowCount: number
  colStart: number
  colCount: number
  force?: boolean
}
type HistoryEntry = {
  kind: "cells"
  sheetName: string
  cells: Array<{
    row: number
    col: number
    before: Cell | null
    after: Cell | null
  }>
}
type CellUpdateInput = {
  row: number
  col: number
  value: string
}

type SheetState = {
  workbook: Workbook | null
  sheet: Sheet | null
  files: FileEntry[]
  recentFiles: FileEntry[]
  selectedSheetName: string
  activeWorkspaceTab: string
  selectionMode: SelectionMode
  selectedRange: CellRange | null
  selectedRow: number
  selectedCol: number
  selectedCell: SelectedCell
  selectedStyle: CellStyle
  historyPast: HistoryEntry[]
  historyFuture: HistoryEntry[]
  isLoading: boolean
  error: string | null
  zoom: number
  sheetFontFamily: string
  search: string
  fileSettings: FileSettings
  kanbanRegions: KanbanRegion[]
  createWorkbook: (name?: string) => Promise<void>
  uploadFile: (file: File) => Promise<void>
  openWorkbookByID: (id: string) => Promise<void>
  loadSheet: (sheetName: string) => Promise<void>
  setActiveWorkspaceTab: (tab: string) => void
  createSheet: () => Promise<void>
  addRows: (count?: number) => Promise<void>
  addCols: (count?: number) => Promise<void>
  insertRowsAt: (start?: number, count?: number) => Promise<void>
  insertColsAt: (start?: number, count?: number) => Promise<void>
  deleteRowsAt: (start?: number, count?: number) => Promise<void>
  deleteColsAt: (start?: number, count?: number) => Promise<void>
  renameSheet: (oldName: string, newName: string) => Promise<void>
  deleteSheet: (sheetName: string) => Promise<void>
  ensureWindow: (
    window: ViewportWindow & { sheetName?: string }
  ) => Promise<void>
  updateCell: (row: number, col: number, value: string) => Promise<void>
  updateCells: (updates: CellUpdateInput[]) => Promise<void>
  selectCell: (row: number, col: number, value: string, formula: string) => void
  selectRow: (row: number) => void
  selectColumn: (col: number) => void
  selectAll: () => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  applyStyle: (patch: Partial<CellStyle>) => Promise<void>
  clearFormatting: () => Promise<void>
  clearSelectedValues: () => Promise<void>
  setNumberFormat: (kind: string) => Promise<void>
  setZoom: (zoom: number) => void
  refreshFiles: () => Promise<void>
  refreshRecentFiles: () => Promise<void>
  renameStoredFile: (id: string, name: string) => Promise<void>
  deleteStoredFile: (id: string) => Promise<void>
  setSelectedCell: (cell: SelectedCell) => void
  setSelectedRange: (range: CellRange | null) => void
  setSearch: (value: string) => void
  setFileCurrency: (currency: string) => Promise<void>
  saveEmailSettings: (email: SMTPSettings) => Promise<void>
  setSheetFontFamily: (fontFamily: string) => void
  setViewportWindow: (window: ViewportWindow) => void
  createKanbanFromSelection: (
    statusCol: number,
    name?: string
  ) => Promise<KanbanRegion | null>
  extendKanbanRegion: (
    regionId: string,
    axis: "rows" | "cols",
    amount?: number
  ) => Promise<void>
  setKanbanStatusOrder: (
    regionId: string,
    statusOrder: string[]
  ) => Promise<void>
  setKanbanTitleCol: (regionId: string, titleCol: number) => Promise<void>
  setKanbanVisibleCols: (
    regionId: string,
    visibleCols: number[]
  ) => Promise<void>
  setKanbanCardColorConfig: (
    regionId: string,
    patch: Partial<{
      cardColorEnabled: boolean
      cardColorMode: "cards" | "columns"
      cardColorByCol: number
      cardColorMap: Record<
        string,
        "none" | "green" | "red" | "yellow" | "purple"
      >
    }>
  ) => Promise<void>
  createKanbanCard: (
    regionId: string,
    options?: {
      status?: string
      title?: string
    }
  ) => Promise<number | null>
  moveKanbanCard: (
    regionId: string,
    sourceRow: number,
    targetStatus: string,
    targetIndex: number
  ) => Promise<void>
}

const DEFAULT_WINDOW: ViewportWindow = {
  rowStart: 1,
  rowCount: 200,
  colStart: 1,
  colCount: 60,
}
const CACHE_ROW_PADDING = 800
const CACHE_COL_PADDING = 24
const MAX_HISTORY_RANGE_AREA = 4096
const CELL_UPDATE_BATCH_CONCURRENCY = 4
const SHEET_FONT_FAMILIES_STORAGE_KEY = "rowful:sheet-font-families:v1"
const DEFAULT_SHEET_FONT_FAMILY = "Calibri"
let clearValuesInFlight = false
let refreshFilesDebounceTimer: ReturnType<typeof setTimeout> | null = null

const EMPTY_CELL: SelectedCell = {
  address: "A1",
  value: "",
  formula: "",
}

const EMPTY_STYLE: CellStyle = {}

type PersistedSheetFontsByWorkbook = Record<string, Record<string, string>>
type KanbanCardColor = "none" | "green" | "red" | "yellow" | "purple"

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

const toAddress = (row: number, col: number) => `${toColumnLabel(col)}${row}`

const parseFormulaInput = (value: string) => {
  if (!value.startsWith("=")) {
    return null
  }
  const formula = value.slice(1).trim()
  return formula ? formula : null
}

const hasMultiCellRange = (range: CellRange | null) => {
  if (!range) {
    return false
  }
  return range.rowStart !== range.rowEnd || range.colStart !== range.colEnd
}

const normalizeCellRange = (range: CellRange): CellRange => ({
  rowStart: Math.min(range.rowStart, range.rowEnd),
  rowEnd: Math.max(range.rowStart, range.rowEnd),
  colStart: Math.min(range.colStart, range.colEnd),
  colEnd: Math.max(range.colStart, range.colEnd),
})

const formatPatch = (kind: string): Partial<CellStyle> => {
  switch (kind) {
    case "number":
      return { numFmt: "0.00" }
    case "percent":
      return { numFmt: "0.00%" }
    case "currency":
      return { numFmt: "$#,##0.00" }
    case "date":
      return { numFmt: "yyyy-mm-dd" }
    case "scientific":
      return { numFmt: "0.00E+00" }
    case "text":
    default:
      return { numFmt: "@" }
  }
}

const formatKindLabel = (kind: string) => {
  switch (kind) {
    case "number":
      return "Number"
    case "percent":
      return "Percent"
    case "currency":
      return "Currency"
    case "date":
      return "Date"
    case "scientific":
      return "Scientific"
    case "text":
    default:
      return "Plain Text"
  }
}

const numFmtLabel = (numFmt?: string) => {
  switch (numFmt) {
    case "0.00":
      return "Number"
    case "0.00%":
      return "Percent"
    case "$#,##0.00":
      return "Currency"
    case "yyyy-mm-dd":
      return "Date"
    case "0.00E+00":
      return "Scientific"
    default:
      return "Plain Text"
  }
}

const cloneCell = (cell: Cell | null | undefined): Cell | null => {
  if (!cell) {
    return null
  }
  return typeof structuredClone === "function"
    ? structuredClone(cell)
    : (JSON.parse(JSON.stringify(cell)) as Cell)
}

const cloneStyle = (style: CellStyle | undefined): CellStyle | undefined => {
  if (!style) {
    return undefined
  }
  return typeof structuredClone === "function"
    ? structuredClone(style)
    : (JSON.parse(JSON.stringify(style)) as CellStyle)
}

const findCell = (sheet: Sheet | null, row: number, col: number) =>
  sheet?.rows.find((r) => r.index === row)?.cells.find((c) => c.col === col)

const readCellValue = (sheet: Sheet | null, row: number, col: number) =>
  findCell(sheet, row, col)?.value ?? ""

const readValueFromWindowPayload = (
  payload: { sheet: Sheet },
  row: number,
  col: number
) =>
  payload.sheet.rows
    .find((sheetRow) => sheetRow.index === row)
    ?.cells.find((cell) => cell.col === col)?.value ?? ""

const readCellFromWindowPayload = (
  payload: { sheet: Sheet },
  row: number,
  col: number
) =>
  payload.sheet.rows
    .find((sheetRow) => sheetRow.index === row)
    ?.cells.find((cell) => cell.col === col) ?? null

const defaultKanbanTitleCol = (range: CellRange, statusCol: number) => {
  for (let col = range.colStart; col <= range.colEnd; col += 1) {
    if (col !== statusCol) {
      return col
    }
  }
  return statusCol
}

const KANBAN_CARD_COLORS: KanbanCardColor[] = [
  "none",
  "green",
  "red",
  "yellow",
  "purple",
]

const normalizeKanbanCardColorMap = (
  map: unknown
): Record<string, KanbanCardColor> => {
  if (!map || typeof map !== "object") {
    return {}
  }
  const result: Record<string, KanbanCardColor> = {}
  for (const [key, rawValue] of Object.entries(
    map as Record<string, unknown>
  )) {
    if (typeof key !== "string") {
      continue
    }
    if (rawValue === "orange") {
      result[key] = "yellow"
      continue
    }
    if (
      typeof rawValue !== "string" ||
      !KANBAN_CARD_COLORS.includes(rawValue as KanbanCardColor)
    ) {
      continue
    }
    result[key] = rawValue as KanbanCardColor
  }
  return result
}

const normalizeKanbanRegions = (regions: KanbanRegion[]): KanbanRegion[] =>
  regions.map((region) => {
    const allCols = Array.from(
      { length: region.range.colEnd - region.range.colStart + 1 },
      (_, idx) => region.range.colStart + idx
    )
    const safeTitleCol =
      typeof region.titleCol === "number"
        ? region.titleCol
        : defaultKanbanTitleCol(region.range, region.statusCol)
    const safeColorByCol =
      typeof region.cardColorByCol === "number"
        ? region.cardColorByCol
        : safeTitleCol
    return {
      ...region,
      titleCol: safeTitleCol,
      statusOrder: Array.isArray(region.statusOrder) ? region.statusOrder : [],
      visibleCols: Array.isArray(region.visibleCols)
        ? Array.from(
            new Set(
              region.visibleCols.filter(
                (col) =>
                  typeof col === "number" &&
                  col >= region.range.colStart &&
                  col <= region.range.colEnd
              )
            )
          )
        : allCols,
      cardColorEnabled: Boolean(region.cardColorEnabled),
      cardColorMode: region.cardColorMode === "columns" ? "columns" : "cards",
      cardColorByCol:
        safeColorByCol >= region.range.colStart &&
        safeColorByCol <= region.range.colEnd
          ? safeColorByCol
          : safeTitleCol,
      cardColorMap: normalizeKanbanCardColorMap(region.cardColorMap),
    }
  })

const insertKanbanRowsLocally = (
  regions: KanbanRegion[],
  options: {
    sheetName: string
    regionId: string
    startRow: number
    count: number
    statusToAdd?: string
  }
) =>
  normalizeKanbanRegions(
    regions.map((region) => {
      if (region.sheetName !== options.sheetName) {
        return region
      }

      let nextRegion = region

      if (region.id === options.regionId) {
        nextRegion = {
          ...region,
          range: {
            ...region.range,
            rowEnd: region.range.rowEnd + options.count,
          },
          statusOrder: options.statusToAdd
            ? Array.from(new Set([...region.statusOrder, options.statusToAdd]))
            : region.statusOrder,
        }
      } else if (options.startRow <= region.range.rowStart) {
        nextRegion = {
          ...region,
          range: {
            ...region.range,
            rowStart: region.range.rowStart + options.count,
            rowEnd: region.range.rowEnd + options.count,
          },
        }
      } else if (options.startRow <= region.range.rowEnd) {
        nextRegion = {
          ...region,
          range: {
            ...region.range,
            rowEnd: region.range.rowEnd + options.count,
          },
        }
      }

      return nextRegion
    })
  )

const mergeRows = (currentRows: Sheet["rows"], incomingRows: Sheet["rows"]) => {
  const rowMap = new Map<number, Map<number, Cell>>()

  for (const row of currentRows) {
    const cells = new Map<number, Cell>()
    for (const cell of row.cells) {
      cells.set(cell.col, cell)
    }
    rowMap.set(row.index, cells)
  }

  for (const row of incomingRows) {
    const cells = rowMap.get(row.index) ?? new Map<number, Cell>()
    for (const cell of row.cells) {
      cells.set(cell.col, cell)
    }
    rowMap.set(row.index, cells)
  }

  return Array.from(rowMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([index, cells]) => ({
      index,
      cells: Array.from(cells.values()).sort((a, b) => a.col - b.col),
    }))
}

const mergeSheetWindow = (current: Sheet | null, incoming: Sheet): Sheet => {
  if (!current || current.name !== incoming.name) {
    return incoming
  }
  return {
    ...current,
    index: incoming.index,
    maxRow: incoming.maxRow,
    maxCol: incoming.maxCol,
    rows: mergeRows(current.rows, incoming.rows),
  }
}

const upsertCellLocal = (
  sheet: Sheet | null,
  row: number,
  col: number,
  patch: Partial<Cell> & {
    value?: string
    display?: string
    formula?: string
    type?: string
  }
) => {
  if (!sheet) {
    return sheet
  }

  const rows = sheet.rows.map((sheetRow) => ({
    index: sheetRow.index,
    cells: sheetRow.cells.map((cell) => ({ ...cell })),
  }))
  let rowNode = rows.find((sheetRow) => sheetRow.index === row)
  if (!rowNode) {
    rowNode = { index: row, cells: [] }
    rows.push(rowNode)
  }

  let cell = rowNode.cells.find((sheetCell) => sheetCell.col === col)
  if (!cell) {
    cell = {
      address: toAddress(row, col),
      row,
      col,
      type: patch.type ?? "blank",
      value: patch.value ?? "",
      display: patch.display ?? patch.value ?? "",
      formula: patch.formula ?? "",
      style: patch.style,
    }
    rowNode.cells.push(cell)
  } else {
    Object.assign(cell, patch)
    cell.address = toAddress(row, col)
    cell.row = row
    cell.col = col
  }

  rowNode.cells.sort((a, b) => a.col - b.col)
  rows.sort((a, b) => a.index - b.index)

  return {
    ...sheet,
    maxRow: Math.max(sheet.maxRow, row),
    maxCol: Math.max(sheet.maxCol, col),
    rows,
  }
}

const patchLoadedCells = (
  sheet: Sheet | null,
  target: SelectionTarget,
  updater: (cell: Cell) => Cell,
  createMissing = false
) => {
  if (!sheet) {
    return sheet
  }

  const rows = sheet.rows.map((sheetRow) => ({
    index: sheetRow.index,
    cells: sheetRow.cells.map((cell) => ({ ...cell })),
  }))
  const rowMap = new Map(rows.map((row) => [row.index, row]))

  const visit = (row: number, col: number) => {
    let rowNode = rowMap.get(row)
    if (!rowNode) {
      if (!createMissing) {
        return
      }
      rowNode = { index: row, cells: [] }
      rowMap.set(row, rowNode)
      rows.push(rowNode)
    }

    let cell = rowNode.cells.find((sheetCell) => sheetCell.col === col)
    if (!cell) {
      if (!createMissing) {
        return
      }
      cell = {
        address: toAddress(row, col),
        row,
        col,
        type: "blank",
        value: "",
        display: "",
        formula: "",
        style: {},
      }
      rowNode.cells.push(cell)
    }

    const next = updater({ ...cell })
    const idx = rowNode.cells.findIndex((sheetCell) => sheetCell.col === col)
    rowNode.cells[idx] = next
    rowNode.cells.sort((a, b) => a.col - b.col)
  }

  if (target.mode === "sheet") {
    for (const row of rows) {
      for (const cell of row.cells) {
        visit(row.index, cell.col)
      }
    }
  } else if (target.mode === "column" && target.col) {
    for (const row of rows) {
      visit(row.index, target.col)
    }
  } else if (target.mode === "row" && target.row) {
    const selectedRow = rows.find((sheetRow) => sheetRow.index === target.row)
    for (const cell of selectedRow?.cells ?? []) {
      visit(target.row, cell.col)
    }
  } else if (target.mode === "range" && target.range) {
    for (
      let row = target.range.rowStart;
      row <= target.range.rowEnd;
      row += 1
    ) {
      for (
        let col = target.range.colStart;
        col <= target.range.colEnd;
        col += 1
      ) {
        visit(row, col)
      }
    }
  } else if (target.row && target.col) {
    visit(target.row, target.col)
  }

  rows.sort((a, b) => a.index - b.index)
  return { ...sheet, rows }
}

const selectionArea = (target: SelectionTarget) => {
  if (target.mode === "range" && target.range) {
    return (
      (target.range.rowEnd - target.range.rowStart + 1) *
      (target.range.colEnd - target.range.colStart + 1)
    )
  }
  return target.mode === "cell" ? 1 : Number.POSITIVE_INFINITY
}

const collectHistoryCoordinates = (
  sheet: Sheet | null,
  target: SelectionTarget
) => {
  if (!sheet) {
    return [] as Array<{ row: number; col: number }>
  }

  if (target.mode === "cell" && target.row && target.col) {
    return [{ row: target.row, col: target.col }]
  }

  if (
    target.mode === "range" &&
    target.range &&
    selectionArea(target) <= MAX_HISTORY_RANGE_AREA
  ) {
    const coords: Array<{ row: number; col: number }> = []
    for (
      let row = target.range.rowStart;
      row <= target.range.rowEnd;
      row += 1
    ) {
      for (
        let col = target.range.colStart;
        col <= target.range.colEnd;
        col += 1
      ) {
        coords.push({ row, col })
      }
    }
    return coords
  }

  return []
}

const buildHistoryEntryForCoordinates = (
  sheetName: string,
  beforeSheet: Sheet | null,
  afterSheet: Sheet | null,
  coords: Array<{ row: number; col: number }>
): HistoryEntry | null => {
  if (coords.length === 0) {
    return null
  }

  const cells = coords
    .map(({ row, col }) => ({
      row,
      col,
      before: cloneCell(findCell(beforeSheet, row, col)),
      after: cloneCell(findCell(afterSheet, row, col)),
    }))
    .filter(
      ({ before, after }) => JSON.stringify(before) !== JSON.stringify(after)
    )

  if (cells.length === 0) {
    return null
  }

  return {
    kind: "cells",
    sheetName,
    cells,
  }
}

const buildHistoryEntry = (
  sheetName: string,
  beforeSheet: Sheet | null,
  afterSheet: Sheet | null,
  target: SelectionTarget
): HistoryEntry | null => {
  const coords = collectHistoryCoordinates(beforeSheet ?? afterSheet, target)
  return buildHistoryEntryForCoordinates(
    sheetName,
    beforeSheet,
    afterSheet,
    coords
  )
}

const restoreHistoryCellsLocal = (
  sheet: Sheet | null,
  snapshots: HistoryEntry["cells"],
  key: "before" | "after"
) => {
  let nextSheet = sheet
  for (const snapshot of snapshots) {
    const nextCell = snapshot[key]
    nextSheet = upsertCellLocal(nextSheet, snapshot.row, snapshot.col, {
      value: nextCell?.value ?? "",
      display: nextCell?.display ?? nextCell?.value ?? "",
      formula: nextCell?.formula ?? "",
      type: nextCell?.type ?? "blank",
      style: cloneStyle(nextCell?.style),
    })
    if (!nextCell) {
      nextSheet = patchLoadedCells(
        nextSheet,
        { mode: "cell", row: snapshot.row, col: snapshot.col },
        (cell) => ({
          ...cell,
          value: "",
          display: "",
          formula: "",
          type: "blank",
          style: {},
        }),
        true
      )
    }
  }
  return nextSheet
}

const hasStyleValue = (style: CellStyle | undefined) =>
  Boolean(style && Object.keys(style).length > 0)

const persistCellSnapshot = async (
  workbookId: string,
  sheetName: string,
  row: number,
  col: number,
  snapshot: Cell | null
) => {
  if (!snapshot) {
    await clearValuesRange(workbookId, {
      sheet: sheetName,
      target: { mode: "cell", row, col },
    })
    await clearFormattingRange(workbookId, {
      sheet: sheetName,
      target: { mode: "cell", row, col },
    })
    return
  }

  await updateCellRequest(workbookId, {
    sheet: sheetName,
    row,
    col,
    value: snapshot.formula ? `=${snapshot.formula}` : (snapshot.value ?? ""),
  })
  await clearFormattingRange(workbookId, {
    sheet: sheetName,
    target: { mode: "cell", row, col },
  })
  if (hasStyleValue(snapshot.style)) {
    await applyStyleRequest(workbookId, {
      sheet: sheetName,
      target: { mode: "cell", row, col },
      patch: snapshot.style ?? {},
    })
  }
}

const getSelectionTarget = (state: {
  selectionMode: SelectionMode
  selectedRow: number
  selectedCol: number
  selectedRange: CellRange | null
}): SelectionTarget => {
  if (state.selectionMode === "sheet") {
    return { mode: "sheet" }
  }
  if (state.selectionMode === "row") {
    return { mode: "row", row: state.selectedRow }
  }
  if (state.selectionMode === "column") {
    return { mode: "column", col: state.selectedCol }
  }
  if (hasMultiCellRange(state.selectedRange) && state.selectedRange) {
    return { mode: "range", range: normalizeCellRange(state.selectedRange) }
  }
  return { mode: "cell", row: state.selectedRow, col: state.selectedCol }
}

const getLoadedCellsForTarget = (
  sheet: Sheet | null,
  target: SelectionTarget
) => {
  if (!sheet) {
    return [] as Cell[]
  }
  if (target.mode === "sheet") {
    return sheet.rows.flatMap((row) => row.cells)
  }
  if (target.mode === "column" && target.col) {
    return sheet.rows
      .map((row) => row.cells.find((cell) => cell.col === target.col))
      .filter((cell): cell is Cell => Boolean(cell))
  }
  if (target.mode === "row" && target.row) {
    return sheet.rows.find((row) => row.index === target.row)?.cells ?? []
  }
  if (target.mode === "range" && target.range) {
    const { rowStart, rowEnd, colStart, colEnd } = target.range
    return sheet.rows
      .filter((row) => row.index >= rowStart && row.index <= rowEnd)
      .flatMap((row) =>
        row.cells.filter((cell) => cell.col >= colStart && cell.col <= colEnd)
      )
  }
  if (target.mode === "cell" && target.row && target.col) {
    const cell = findCell(sheet, target.row, target.col)
    return cell ? [cell] : []
  }
  return []
}

const sheetStyleFromSelection = (
  sheet: Sheet | null,
  mode: SelectionMode,
  row: number,
  col: number,
  range: CellRange | null
): CellStyle => {
  if (!sheet) {
    return {}
  }
  if (mode === "sheet") {
    for (const currentRow of sheet.rows) {
      for (const cell of currentRow.cells) {
        if (cell.style) {
          return cell.style
        }
      }
    }
    return {}
  }
  if (mode === "column") {
    for (const currentRow of sheet.rows) {
      const cell = currentRow.cells.find(
        (currentCell) => currentCell.col === col
      )
      if (cell?.style) {
        return cell.style
      }
    }
    return {}
  }
  if (mode === "row") {
    const selectedRow = sheet.rows.find(
      (currentRow) => currentRow.index === row
    )
    for (const cell of selectedRow?.cells ?? []) {
      if (cell.style) {
        return cell.style
      }
    }
    return {}
  }
  if (hasMultiCellRange(range) && range) {
    for (const currentRow of sheet.rows) {
      if (
        currentRow.index < range.rowStart ||
        currentRow.index > range.rowEnd
      ) {
        continue
      }
      const cell = currentRow.cells.find(
        (currentCell) =>
          currentCell.col >= range.colStart &&
          currentCell.col <= range.colEnd &&
          currentCell.style
      )
      if (cell?.style) {
        return cell.style
      }
    }
    return {}
  }
  return findCell(sheet, row, col)?.style ?? {}
}

const windowKey = (sheetName: string, window: ViewportWindow) =>
  `${sheetName}:${window.rowStart}:${window.rowCount}:${window.colStart}:${window.colCount}`

const parseWindowKey = (key: string) => {
  const [sheetName, rowStart, rowCount, colStart, colCount] = key.split(":")
  const rowStartValue = Number(rowStart)
  const rowCountValue = Number(rowCount)
  const colStartValue = Number(colStart)
  const colCountValue = Number(colCount)
  if (
    !sheetName ||
    !Number.isFinite(rowStartValue) ||
    !Number.isFinite(rowCountValue) ||
    !Number.isFinite(colStartValue) ||
    !Number.isFinite(colCountValue)
  ) {
    return null
  }
  return {
    sheetName,
    window: {
      rowStart: rowStartValue,
      rowCount: rowCountValue,
      colStart: colStartValue,
      colCount: colCountValue,
    },
  }
}

const normalizeWindow = (
  sheet: Sheet | null,
  window: ViewportWindow
): ViewportWindow => {
  const rowStart = Math.max(1, window.rowStart)
  const colStart = Math.max(1, window.colStart)
  const maxRow = sheet?.maxRow ?? rowStart
  const maxCol = sheet?.maxCol ?? colStart
  return {
    rowStart,
    rowCount: Math.max(
      1,
      Math.min(window.rowCount, Math.max(1, maxRow - rowStart + 1))
    ),
    colStart,
    colCount: Math.max(
      1,
      Math.min(window.colCount, Math.max(1, maxCol - colStart + 1))
    ),
    force: window.force,
  }
}

const readPersistedSheetFonts = (): PersistedSheetFontsByWorkbook => {
  if (typeof window === "undefined") {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(SHEET_FONT_FAMILIES_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") {
      return {}
    }
    const result: PersistedSheetFontsByWorkbook = {}
    for (const [workbookId, rawBySheet] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (!rawBySheet || typeof rawBySheet !== "object") {
        continue
      }
      const bySheet: Record<string, string> = {}
      for (const [sheetName, rawFont] of Object.entries(
        rawBySheet as Record<string, unknown>
      )) {
        if (!sheetName || typeof rawFont !== "string") {
          continue
        }
        const value = rawFont.trim()
        if (!value) {
          continue
        }
        bySheet[sheetName] = value
      }
      if (Object.keys(bySheet).length > 0) {
        result[workbookId] = bySheet
      }
    }
    return result
  } catch {
    return {}
  }
}

const writePersistedSheetFonts = (
  workbookId: string,
  bySheet: Record<string, string>
) => {
  if (!workbookId || typeof window === "undefined") {
    return
  }
  const all = readPersistedSheetFonts()
  all[workbookId] = bySheet
  try {
    window.localStorage.setItem(
      SHEET_FONT_FAMILIES_STORAGE_KEY,
      JSON.stringify(all)
    )
  } catch {
    // ignore storage failures
  }
}

const getPersistedSheetFontFamily = (workbookId: string, sheetName: string) => {
  const byWorkbook = readPersistedSheetFonts()[workbookId]
  return byWorkbook?.[sheetName] || DEFAULT_SHEET_FONT_FAMILY
}

const renamePersistedSheetFont = (
  workbookId: string,
  oldName: string,
  newName: string
) => {
  if (!workbookId || !oldName || !newName || oldName === newName) {
    return
  }
  const all = readPersistedSheetFonts()
  const byWorkbook = { ...(all[workbookId] ?? {}) }
  if (!(oldName in byWorkbook)) {
    return
  }
  byWorkbook[newName] = byWorkbook[oldName]
  delete byWorkbook[oldName]
  writePersistedSheetFonts(workbookId, byWorkbook)
}

const deletePersistedSheetFont = (workbookId: string, sheetName: string) => {
  if (!workbookId || !sheetName) {
    return
  }
  const all = readPersistedSheetFonts()
  const byWorkbook = { ...(all[workbookId] ?? {}) }
  if (!(sheetName in byWorkbook)) {
    return
  }
  delete byWorkbook[sheetName]
  writePersistedSheetFonts(workbookId, byWorkbook)
}

const scheduleRefreshFiles = (refresh: () => Promise<void>, delayMs = 350) => {
  if (typeof window === "undefined") {
    void refresh()
    return
  }
  if (refreshFilesDebounceTimer) {
    window.clearTimeout(refreshFilesDebounceTimer)
  }
  refreshFilesDebounceTimer = window.setTimeout(() => {
    refreshFilesDebounceTimer = null
    void refresh()
  }, delayMs)
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const normalizeCellUpdates = (updates: CellUpdateInput[]) => {
  const deduped = new Map<string, CellUpdateInput>()
  for (const update of updates) {
    if (
      !Number.isInteger(update.row) ||
      !Number.isInteger(update.col) ||
      update.row < 1 ||
      update.col < 1
    ) {
      continue
    }
    deduped.set(`${update.row}:${update.col}`, {
      row: update.row,
      col: update.col,
      value: update.value,
    })
  }
  return Array.from(deduped.values())
}

const buildCellUpdateVerificationWindow = (
  updates: Array<{ row: number; col: number }>
) => {
  if (updates.length === 0) {
    return null
  }

  let rowStart = updates[0].row
  let rowEnd = updates[0].row
  let colStart = updates[0].col
  let colEnd = updates[0].col

  for (const update of updates.slice(1)) {
    rowStart = Math.min(rowStart, update.row)
    rowEnd = Math.max(rowEnd, update.row)
    colStart = Math.min(colStart, update.col)
    colEnd = Math.max(colEnd, update.col)
  }

  return {
    rowStart,
    rowCount: rowEnd - rowStart + 1,
    colStart,
    colCount: colEnd - colStart + 1,
  }
}

const cellMatchesPersistedUpdate = (
  sheet: Sheet | null,
  update: { row: number; col: number; value: string; formula: string | null }
) => {
  const persistedCell = findCell(sheet, update.row, update.col)
  if (update.formula) {
    return persistedCell?.formula === update.formula
  }
  return (persistedCell?.value ?? "") === update.value
}

const runTaskBatch = async (
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

const persistKanbanRegions = async (
  workbookId: string,
  regions: KanbanRegion[]
) => {
  const payload = await saveKanbanRegionsRequest(workbookId, {
    kanbanRegions: regions,
  })
  return normalizeKanbanRegions(payload.kanbanRegions)
}

const expandWindow = (
  sheet: Sheet | null,
  window: ViewportWindow,
  rowPadding: number,
  colPadding: number
): ViewportWindow =>
  normalizeWindow(sheet, {
    rowStart: Math.max(1, window.rowStart - rowPadding),
    rowCount: window.rowCount + rowPadding * 2,
    colStart: Math.max(1, window.colStart - colPadding),
    colCount: window.colCount + colPadding * 2,
  })

const trimSheetToWindow = (sheet: Sheet | null, keepWindow: ViewportWindow) => {
  if (!sheet) {
    return sheet
  }

  const rowEnd = keepWindow.rowStart + keepWindow.rowCount - 1
  const colEnd = keepWindow.colStart + keepWindow.colCount - 1

  return {
    ...sheet,
    rows: sheet.rows
      .filter((row) => row.index >= keepWindow.rowStart && row.index <= rowEnd)
      .map((row) => ({
        ...row,
        cells: row.cells.filter(
          (cell) => cell.col >= keepWindow.colStart && cell.col <= colEnd
        ),
      }))
      .filter((row) => row.cells.length > 0),
  }
}

const windowsOverlap = (left: ViewportWindow, right: ViewportWindow) => {
  const leftRowEnd = left.rowStart + left.rowCount - 1
  const rightRowEnd = right.rowStart + right.rowCount - 1
  const leftColEnd = left.colStart + left.colCount - 1
  const rightColEnd = right.colStart + right.colCount - 1

  return !(
    leftRowEnd < right.rowStart ||
    rightRowEnd < left.rowStart ||
    leftColEnd < right.colStart ||
    rightColEnd < left.colStart
  )
}

const pruneLoadedWindows = (
  loadedWindows: string[],
  sheetName: string,
  keepWindow: ViewportWindow
) =>
  loadedWindows.filter((key) => {
    const parsed = parseWindowKey(key)
    return (
      parsed?.sheetName === sheetName &&
      windowsOverlap(parsed.window, keepWindow)
    )
  })

export const useSheetStore = create<
  SheetState & {
    loadedWindows: string[]
    loadingWindows: string[]
    viewportWindow: ViewportWindow
  }
>((set, get) => ({
  workbook: null,
  sheet: null,
  files: [],
  recentFiles: [],
  selectedSheetName: "",
  activeWorkspaceTab: "",
  selectionMode: "cell",
  selectedRange: null,
  selectedRow: 1,
  selectedCol: 1,
  selectedCell: EMPTY_CELL,
  selectedStyle: EMPTY_STYLE,
  historyPast: [],
  historyFuture: [],
  isLoading: false,
  error: null,
  zoom: 100,
  sheetFontFamily: DEFAULT_SHEET_FONT_FAMILY,
  search: "",
  fileSettings: DEFAULT_FILE_SETTINGS,
  kanbanRegions: [],
  loadedWindows: [],
  loadingWindows: [],
  viewportWindow: DEFAULT_WINDOW,

  createWorkbook: async (name) => {
    set({ isLoading: true, error: null })
    try {
      const trimmedName = name?.trim()
      const payload = await createWorkbookRequest(
        trimmedName ? { name: trimmedName } : undefined
      )
      set({
        workbook: payload.workbook,
        sheet: payload.sheet,
        fileSettings: DEFAULT_FILE_SETTINGS,
        selectedSheetName: payload.sheet.name,
        activeWorkspaceTab: payload.sheet.name,
        selectionMode: "cell",
        selectedRange: null,
        selectedRow: 1,
        selectedCol: 1,
        selectedCell: EMPTY_CELL,
        selectedStyle: {},
        historyPast: [],
        historyFuture: [],
        loadedWindows: [windowKey(payload.sheet.name, DEFAULT_WINDOW)],
        loadingWindows: [],
        viewportWindow: DEFAULT_WINDOW,
        sheetFontFamily: getPersistedSheetFontFamily(
          payload.workbook.id,
          payload.sheet.name
        ),
        kanbanRegions: normalizeKanbanRegions(payload.kanbanRegions),
        isLoading: false,
      })
      setLastOpenedSheetForFile(payload.workbook.id, payload.sheet.name)
      try {
        const settingsPayload = await fetchFileSettings(payload.workbook.id)
        if (get().workbook?.id === payload.workbook.id) {
          set({ fileSettings: settingsPayload.settings })
        }
      } catch {
        // keep defaults if settings are unavailable
      }
      await Promise.all([get().refreshFiles(), get().refreshRecentFiles()])
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to create file",
      })
    }
  },

  uploadFile: async (file) => {
    set({ isLoading: true, error: null })
    try {
      const payload = await uploadWorkbook(file)
      set({
        workbook: payload.workbook,
        sheet: payload.sheet,
        fileSettings: DEFAULT_FILE_SETTINGS,
        selectedSheetName: payload.sheet.name,
        activeWorkspaceTab: payload.sheet.name,
        selectionMode: "cell",
        selectedRange: null,
        selectedRow: 1,
        selectedCol: 1,
        selectedCell: EMPTY_CELL,
        selectedStyle: {},
        historyPast: [],
        historyFuture: [],
        loadedWindows: [windowKey(payload.sheet.name, DEFAULT_WINDOW)],
        loadingWindows: [],
        viewportWindow: DEFAULT_WINDOW,
        sheetFontFamily: getPersistedSheetFontFamily(
          payload.workbook.id,
          payload.sheet.name
        ),
        kanbanRegions: normalizeKanbanRegions(payload.kanbanRegions),
        isLoading: false,
      })
      setLastOpenedSheetForFile(payload.workbook.id, payload.sheet.name)
      try {
        const settingsPayload = await fetchFileSettings(payload.workbook.id)
        if (get().workbook?.id === payload.workbook.id) {
          set({ fileSettings: settingsPayload.settings })
        }
      } catch {
        // keep defaults if settings are unavailable
      }
      await Promise.all([get().refreshFiles(), get().refreshRecentFiles()])
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : "Upload failed",
      })
    }
  },

  openWorkbookByID: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const payload = await openFile(id, DEFAULT_WINDOW)
      set({
        workbook: payload.workbook,
        sheet: payload.sheet,
        fileSettings: DEFAULT_FILE_SETTINGS,
        selectedSheetName: payload.sheet.name,
        activeWorkspaceTab: payload.sheet.name,
        selectionMode: "cell",
        selectedRange: null,
        selectedRow: 1,
        selectedCol: 1,
        selectedCell: EMPTY_CELL,
        selectedStyle: {},
        historyPast: [],
        historyFuture: [],
        loadedWindows: [windowKey(payload.sheet.name, DEFAULT_WINDOW)],
        loadingWindows: [],
        viewportWindow: DEFAULT_WINDOW,
        sheetFontFamily: getPersistedSheetFontFamily(
          payload.workbook.id,
          payload.sheet.name
        ),
        kanbanRegions: normalizeKanbanRegions(payload.kanbanRegions),
        isLoading: false,
      })
      setLastOpenedSheetForFile(payload.workbook.id, payload.sheet.name)
      try {
        const settingsPayload = await fetchFileSettings(payload.workbook.id)
        if (get().workbook?.id === payload.workbook.id) {
          set({ fileSettings: settingsPayload.settings })
        }
      } catch {
        // keep defaults if settings are unavailable
      }
      await get().refreshRecentFiles()
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to open file",
      })
    }
  },

  loadSheet: async (sheetName) => {
    const state = get()
    if (!state.workbook) {
      return
    }

    set({ isLoading: true, error: null })
    try {
      const payload = await fetchSheet(
        state.workbook.id,
        sheetName,
        DEFAULT_WINDOW
      )
      set({
        workbook: payload.workbook,
        sheet: payload.sheet,
        selectedSheetName: payload.sheet.name,
        activeWorkspaceTab: payload.sheet.name,
        selectionMode: "cell",
        selectedRange: null,
        selectedRow: 1,
        selectedCol: 1,
        selectedCell: EMPTY_CELL,
        selectedStyle: {},
        historyPast: [],
        historyFuture: [],
        loadedWindows: [windowKey(payload.sheet.name, DEFAULT_WINDOW)],
        loadingWindows: [],
        viewportWindow: DEFAULT_WINDOW,
        sheetFontFamily: getPersistedSheetFontFamily(
          payload.workbook.id,
          payload.sheet.name
        ),
        kanbanRegions: normalizeKanbanRegions(payload.kanbanRegions),
        isLoading: false,
      })
      setLastOpenedSheetForFile(payload.workbook.id, payload.sheet.name)
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to load sheet",
      })
    }
  },

  setActiveWorkspaceTab: (tab) => {
    set({ activeWorkspaceTab: tab })
  },

  createSheet: async () => {
    const state = get()
    if (!state.workbook) {
      return
    }

    const existingNames = new Set(
      state.workbook.sheets.map((sheet) => sheet.name)
    )
    let counter = 1
    let nextName = `Sheet${counter}`
    while (existingNames.has(nextName)) {
      counter += 1
      nextName = `Sheet${counter}`
    }

    try {
      const payload = await createSheetRequest(state.workbook.id, {
        name: nextName,
      })
      set({
        workbook: payload.workbook,
        sheet: payload.sheet,
        selectedSheetName: payload.sheet.name,
        activeWorkspaceTab: payload.sheet.name,
        selectedCell: EMPTY_CELL,
        selectedStyle: {},
        selectedRange: null,
        historyPast: [],
        historyFuture: [],
        loadedWindows: [windowKey(payload.sheet.name, DEFAULT_WINDOW)],
        loadingWindows: [],
        viewportWindow: DEFAULT_WINDOW,
        sheetFontFamily: getPersistedSheetFontFamily(
          payload.workbook.id,
          payload.sheet.name
        ),
        kanbanRegions: normalizeKanbanRegions(payload.kanbanRegions),
        error: null,
      })
      setLastOpenedSheetForFile(payload.workbook.id, payload.sheet.name)
      await get().refreshFiles()
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to create sheet",
      })
    }
  },

  addRows: async (count = 1000) => {
    const state = get()
    if (!state.workbook || !state.sheet) {
      return
    }
    const addRows = Math.max(1, Math.floor(count))
    set({ error: null })
    try {
      const payload = await resizeSheetRequest(
        state.workbook.id,
        { sheet: state.sheet.name, addRows, addCols: 0 },
        state.viewportWindow
      )
      set({
        workbook: payload.workbook,
        sheet: mergeSheetWindow(get().sheet, payload.sheet),
      })
      await get().refreshFiles()
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to add rows",
      })
    }
  },

  addCols: async (count = 26) => {
    const state = get()
    if (!state.workbook || !state.sheet) {
      return
    }
    const addCols = Math.max(1, Math.floor(count))
    set({ error: null })
    try {
      const payload = await resizeSheetRequest(
        state.workbook.id,
        { sheet: state.sheet.name, addRows: 0, addCols },
        state.viewportWindow
      )
      set({
        workbook: payload.workbook,
        sheet: mergeSheetWindow(get().sheet, payload.sheet),
      })
      await get().refreshFiles()
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to add columns",
      })
    }
  },

  insertRowsAt: async (explicitStart, explicitCount) => {
    const state = get()
    if (!state.workbook || !state.sheet) {
      return
    }

    let start = explicitStart ?? state.selectedRow
    let count = explicitCount ?? 1
    if (
      explicitStart === undefined &&
      explicitCount === undefined &&
      state.selectionMode === "cell" &&
      state.selectedRange
    ) {
      start = state.selectedRange.rowStart
      count = state.selectedRange.rowEnd - state.selectedRange.rowStart + 1
    }
    if (
      explicitStart === undefined &&
      explicitCount === undefined &&
      state.selectionMode === "sheet"
    ) {
      start = 1
      count = 1
    }
    start = Math.max(1, start)
    count = Math.max(1, count)

    set({ error: null })
    try {
      const payload = await insertRowsRequest(
        state.workbook.id,
        { sheet: state.sheet.name, start, count },
        state.viewportWindow
      )
      set({
        workbook: payload.workbook,
        sheet: payload.sheet,
        selectionMode: "cell",
        selectedRange: null,
        selectedRow: start,
        selectedCell: EMPTY_CELL,
        selectedStyle: {},
      })
      await get().refreshFiles()
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to insert rows",
      })
    }
  },

  insertColsAt: async (explicitStart, explicitCount) => {
    const state = get()
    if (!state.workbook || !state.sheet) {
      return
    }

    let start = explicitStart ?? state.selectedCol
    let count = explicitCount ?? 1
    if (
      explicitStart === undefined &&
      explicitCount === undefined &&
      state.selectionMode === "column"
    ) {
      start = state.selectedCol
      count = 1
    } else if (
      explicitStart === undefined &&
      explicitCount === undefined &&
      state.selectionMode === "cell" &&
      state.selectedRange
    ) {
      start = state.selectedRange.colStart
      count = state.selectedRange.colEnd - state.selectedRange.colStart + 1
    } else if (
      explicitStart === undefined &&
      explicitCount === undefined &&
      state.selectionMode === "sheet"
    ) {
      start = 1
      count = 1
    }
    start = Math.max(1, start)
    count = Math.max(1, count)

    set({ error: null })
    try {
      const payload = await insertColsRequest(
        state.workbook.id,
        { sheet: state.sheet.name, start, count },
        state.viewportWindow
      )
      set({
        workbook: payload.workbook,
        sheet: payload.sheet,
        selectionMode: "cell",
        selectedRange: null,
        selectedCol: start,
        selectedCell: EMPTY_CELL,
        selectedStyle: {},
      })
      await get().refreshFiles()
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to insert columns",
      })
    }
  },

  deleteRowsAt: async (explicitStart, explicitCount) => {
    const state = get()
    if (!state.workbook || !state.sheet) {
      return
    }

    let start = explicitStart ?? state.selectedRow
    let count = explicitCount ?? 1
    if (
      explicitStart === undefined &&
      explicitCount === undefined &&
      state.selectionMode === "cell" &&
      state.selectedRange
    ) {
      start = state.selectedRange.rowStart
      count = state.selectedRange.rowEnd - state.selectedRange.rowStart + 1
    }
    if (
      explicitStart === undefined &&
      explicitCount === undefined &&
      state.selectionMode === "sheet"
    ) {
      start = 1
      count = state.sheet.maxRow
    }
    start = Math.max(1, start)
    count = Math.max(1, count)

    set({ error: null })
    try {
      const payload = await deleteRowsRequest(
        state.workbook.id,
        { sheet: state.sheet.name, start, count },
        state.viewportWindow
      )
      set({
        workbook: payload.workbook,
        sheet: payload.sheet,
        selectionMode: "cell",
        selectedRange: null,
        selectedRow: Math.min(start, payload.sheet.maxRow),
        selectedCell: EMPTY_CELL,
        selectedStyle: {},
      })
      await get().refreshFiles()
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to delete rows",
      })
    }
  },

  deleteColsAt: async (explicitStart, explicitCount) => {
    const state = get()
    if (!state.workbook || !state.sheet) {
      return
    }

    let start = explicitStart ?? state.selectedCol
    let count = explicitCount ?? 1
    if (
      explicitStart === undefined &&
      explicitCount === undefined &&
      state.selectionMode === "column"
    ) {
      start = state.selectedCol
      count = 1
    } else if (
      explicitStart === undefined &&
      explicitCount === undefined &&
      state.selectionMode === "cell" &&
      state.selectedRange
    ) {
      start = state.selectedRange.colStart
      count = state.selectedRange.colEnd - state.selectedRange.colStart + 1
    } else if (
      explicitStart === undefined &&
      explicitCount === undefined &&
      state.selectionMode === "sheet"
    ) {
      start = 1
      count = state.sheet.maxCol
    }
    start = Math.max(1, start)
    count = Math.max(1, count)

    set({ error: null })
    try {
      const payload = await deleteColsRequest(
        state.workbook.id,
        { sheet: state.sheet.name, start, count },
        state.viewportWindow
      )
      set({
        workbook: payload.workbook,
        sheet: payload.sheet,
        selectionMode: "cell",
        selectedRange: null,
        selectedCol: Math.min(start, payload.sheet.maxCol),
        selectedCell: EMPTY_CELL,
        selectedStyle: {},
      })
      await get().refreshFiles()
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to delete columns",
      })
    }
  },

  renameSheet: async (oldName, newName) => {
    const state = get()
    if (!state.workbook) {
      return
    }

    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) {
      return
    }

    try {
      const payload = await renameSheetRequest(state.workbook.id, {
        oldName,
        newName: trimmed,
      })
      set({
        workbook: payload.workbook,
        sheet: payload.sheet,
        selectedSheetName: payload.sheet.name,
        activeWorkspaceTab:
          state.activeWorkspaceTab === oldName
            ? payload.sheet.name
            : state.activeWorkspaceTab,
        loadedWindows: [windowKey(payload.sheet.name, DEFAULT_WINDOW)],
        loadingWindows: [],
        viewportWindow: DEFAULT_WINDOW,
        sheetFontFamily: getPersistedSheetFontFamily(
          payload.workbook.id,
          payload.sheet.name
        ),
        kanbanRegions: normalizeKanbanRegions(payload.kanbanRegions),
        error: null,
      })
      renamePersistedSheetFont(payload.workbook.id, oldName, payload.sheet.name)
      setLastOpenedSheetForFile(payload.workbook.id, payload.sheet.name)
      await get().refreshFiles()
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to rename sheet",
      })
    }
  },

  deleteSheet: async (sheetName) => {
    const state = get()
    if (!state.workbook) {
      return
    }

    try {
      const payload = await deleteSheetRequest(state.workbook.id, {
        name: sheetName,
      })
      set({
        workbook: payload.workbook,
        sheet: payload.sheet,
        selectedSheetName: payload.sheet.name,
        activeWorkspaceTab: payload.sheet.name,
        selectedCell: EMPTY_CELL,
        selectedStyle: {},
        historyPast: [],
        historyFuture: [],
        loadedWindows: [windowKey(payload.sheet.name, DEFAULT_WINDOW)],
        loadingWindows: [],
        viewportWindow: DEFAULT_WINDOW,
        sheetFontFamily: getPersistedSheetFontFamily(
          payload.workbook.id,
          payload.sheet.name
        ),
        kanbanRegions: normalizeKanbanRegions(payload.kanbanRegions),
        error: null,
      })
      deletePersistedSheetFont(state.workbook.id, sheetName)
      setLastOpenedSheetForFile(payload.workbook.id, payload.sheet.name)
      await get().refreshFiles()
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to delete sheet",
      })
    }
  },

  ensureWindow: async ({ sheetName, force, ...requestedWindow }) => {
    const state = get()
    const workbookId = state.workbook?.id
    const activeSheet = state.sheet
    const targetSheet = sheetName ?? activeSheet?.name
    if (
      !workbookId ||
      !targetSheet ||
      !activeSheet ||
      activeSheet.name !== targetSheet
    ) {
      return
    }

    const window = normalizeWindow(activeSheet, { ...requestedWindow, force })
    const key = windowKey(targetSheet, window)
    if (
      (!force && state.loadedWindows.includes(key)) ||
      state.loadingWindows.includes(key)
    ) {
      return
    }

    set({ loadingWindows: [...state.loadingWindows, key] })
    try {
      const payload = await fetchSheetWindow(workbookId, {
        sheet: targetSheet,
        ...window,
      })
      const latest = get()
      if (latest.sheet?.name !== payload.sheet.name) {
        return
      }
      const mergedSheet = mergeSheetWindow(latest.sheet, payload.sheet)
      const keepWindow = expandWindow(
        mergedSheet,
        latest.viewportWindow,
        CACHE_ROW_PADDING,
        CACHE_COL_PADDING
      )
      set({
        workbook: payload.workbook,
        sheet: trimSheetToWindow(mergedSheet, keepWindow),
        loadedWindows: Array.from(
          new Set([
            ...pruneLoadedWindows(
              latest.loadedWindows,
              payload.sheet.name,
              keepWindow
            ),
            key,
          ])
        ),
        loadingWindows: latest.loadingWindows.filter((item) => item !== key),
      })
    } catch (error) {
      set({
        loadingWindows: get().loadingWindows.filter((item) => item !== key),
        error:
          error instanceof Error
            ? error.message
            : "Failed to load sheet window",
      })
    }
  },

  updateCell: async (row, col, value) => {
    const state = get()
    if (!state.sheet || !state.workbook) {
      return
    }

    const existingCell = findCell(state.sheet, row, col)
    const numFmt = existingCell?.style?.numFmt
    const formula = parseFormulaInput(value)
    if (!formula && !isValueValidForNumFmt(value, numFmt)) {
      set({
        error: `Invalid value for ${numFmtLabel(numFmt)} format at ${toAddress(row, col)}.`,
      })
      return
    }

    const optimistic = upsertCellLocal(state.sheet, row, col, {
      value: formula ? (existingCell?.value ?? "") : value,
      display: formula
        ? (existingCell?.display ?? existingCell?.value ?? "")
        : value,
      formula: formula ?? "",
      type: formula ? "formula" : value.trim() ? "string" : "blank",
    })
    const historyEntry = buildHistoryEntry(
      state.sheet.name,
      state.sheet,
      optimistic,
      { mode: "cell", row, col }
    )

    set({
      sheet: optimistic,
      historyPast: historyEntry
        ? [...state.historyPast, historyEntry]
        : state.historyPast,
      historyFuture: [],
      selectedCell:
        state.selectedCell.address === toAddress(row, col)
          ? {
              ...state.selectedCell,
              value: formula ? (existingCell?.value ?? "") : value,
              formula: formula ?? "",
            }
          : state.selectedCell,
      selectedRange: null,
      selectedStyle: sheetStyleFromSelection(
        optimistic,
        state.selectionMode,
        state.selectedRow,
        state.selectedCol,
        state.selectedRange
      ),
      error: null,
    })

    const requestPayload = {
      sheet: state.sheet.name,
      row,
      col,
      value,
    }
    let attemptError: unknown = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const payload = await updateCellRequest(
          state.workbook.id,
          requestPayload
        )
        let mergedSheet = mergeSheetWindow(get().sheet, payload.sheet)
        let workbook = payload.workbook
        try {
          const latest = get()
          const refreshedViewport = await fetchSheetWindow(state.workbook.id, {
            sheet: state.sheet.name,
            ...latest.viewportWindow,
          })
          workbook = refreshedViewport.workbook
          mergedSheet = mergeSheetWindow(get().sheet, refreshedViewport.sheet)
        } catch {
          // Fall back to the edited-cell response if the viewport refresh fails.
        }
        set({
          workbook,
          sheet: mergedSheet,
        })
        scheduleRefreshFiles(() => get().refreshFiles())
        return
      } catch (error) {
        attemptError = error
        if (attempt < 1) {
          await sleep(120)
          continue
        }
      }
    }
    try {
      const verificationPayload = await fetchSheetWindow(state.workbook.id, {
        sheet: state.sheet.name,
        rowStart: row,
        rowCount: 1,
        colStart: col,
        colCount: 1,
      })
      const persistedValue = readValueFromWindowPayload(
        verificationPayload,
        row,
        col
      )
      const persistedCell = readCellFromWindowPayload(
        verificationPayload,
        row,
        col
      )
      if (
        (!formula && persistedValue === value) ||
        (formula && persistedCell?.formula === formula)
      ) {
        set({
          workbook: verificationPayload.workbook,
          sheet: mergeSheetWindow(get().sheet, verificationPayload.sheet),
          error: null,
        })
        scheduleRefreshFiles(() => get().refreshFiles())
        return
      }
    } catch {
      // ignore verification failure and surface original error below
    }

    set({
      error:
        attemptError instanceof Error
          ? attemptError.message
          : "Failed to persist cell change",
    })
  },

  updateCells: async (updates) => {
    const state = get()
    if (!state.sheet || !state.workbook) {
      return
    }
    const sheet = state.sheet
    const workbook = state.workbook

    const normalizedUpdates = normalizeCellUpdates(updates)
    if (normalizedUpdates.length === 0) {
      return
    }

    let optimistic: Sheet = sheet
    const preparedUpdates: Array<{
      row: number
      col: number
      value: string
      formula: string | null
      selectedValue: string
    }> = []

    for (const update of normalizedUpdates) {
      const existingCell = findCell(optimistic, update.row, update.col)
      const numFmt = existingCell?.style?.numFmt
      const formula = parseFormulaInput(update.value)
      if (!formula && !isValueValidForNumFmt(update.value, numFmt)) {
        set({
          error: `Invalid value for ${numFmtLabel(numFmt)} format at ${toAddress(update.row, update.col)}.`,
        })
        return
      }

      const selectedValue = formula ? (existingCell?.value ?? "") : update.value
      optimistic =
        upsertCellLocal(optimistic, update.row, update.col, {
          value: selectedValue,
          display: formula
            ? (existingCell?.display ?? existingCell?.value ?? "")
            : update.value,
          formula: formula ?? "",
          type: formula ? "formula" : update.value.trim() ? "string" : "blank",
        }) ?? optimistic
      preparedUpdates.push({
        ...update,
        formula,
        selectedValue,
      })
    }

    const historyEntry = buildHistoryEntryForCoordinates(
      state.sheet.name,
      state.sheet,
      optimistic,
      preparedUpdates.map(({ row, col }) => ({ row, col }))
    )
    const selectedCellUpdate = preparedUpdates.find(
      (update) =>
        state.selectedCell.address === toAddress(update.row, update.col)
    )

    set({
      sheet: optimistic,
      historyPast: historyEntry
        ? [...state.historyPast, historyEntry]
        : state.historyPast,
      historyFuture: [],
      selectedCell: selectedCellUpdate
        ? {
            ...state.selectedCell,
            value: selectedCellUpdate.selectedValue,
            formula: selectedCellUpdate.formula ?? "",
          }
        : state.selectedCell,
      selectedStyle: sheetStyleFromSelection(
        optimistic,
        state.selectionMode,
        state.selectedRow,
        state.selectedCol,
        state.selectedRange
      ),
      error: null,
    })

    const failures: unknown[] = []
    await runTaskBatch(
      preparedUpdates.map((update) => async () => {
        let attemptError: unknown = null
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await updateCellRequest(workbook.id, {
              sheet: sheet.name,
              row: update.row,
              col: update.col,
              value: update.value,
            })
            return
          } catch (error) {
            attemptError = error
            if (attempt < 1) {
              await sleep(120)
            }
          }
        }
        failures.push(attemptError)
      })
    )

    let verifiedSheet: Sheet | null = null
    try {
      const latest = get()
      const refreshedViewport = await fetchSheetWindow(workbook.id, {
        sheet: sheet.name,
        ...latest.viewportWindow,
      })
      verifiedSheet = mergeSheetWindow(get().sheet, refreshedViewport.sheet)
      set({
        workbook: refreshedViewport.workbook,
        sheet: verifiedSheet,
      })
    } catch {
      // Fall back to the optimistic state if the viewport refresh fails.
    }

    if (failures.length > 0) {
      const matchesRefreshedSheet =
        verifiedSheet &&
        preparedUpdates.every((update) =>
          cellMatchesPersistedUpdate(verifiedSheet, update)
        )
      if (matchesRefreshedSheet) {
        scheduleRefreshFiles(() => get().refreshFiles())
        return
      }

      const verificationWindow =
        buildCellUpdateVerificationWindow(preparedUpdates)
      if (verificationWindow) {
        try {
          const verificationPayload = await fetchSheetWindow(workbook.id, {
            sheet: sheet.name,
            ...verificationWindow,
          })
          const mergedVerificationSheet = mergeSheetWindow(
            get().sheet,
            verificationPayload.sheet
          )
          const allUpdatesPersisted = preparedUpdates.every((update) =>
            cellMatchesPersistedUpdate(mergedVerificationSheet, update)
          )
          if (allUpdatesPersisted) {
            set({
              workbook: verificationPayload.workbook,
              sheet: mergedVerificationSheet,
              error: null,
            })
            scheduleRefreshFiles(() => get().refreshFiles())
            return
          }
        } catch {
          // Ignore verification failures and surface the original persistence error.
        }
      }

      const firstError = failures[0]
      set({
        error:
          firstError instanceof Error
            ? firstError.message
            : "Failed to persist cell changes",
      })
      return
    }

    scheduleRefreshFiles(() => get().refreshFiles())
  },

  selectCell: (row, col, value, formula) => {
    const sheet = get().sheet
    set({
      selectionMode: "cell",
      selectedRow: row,
      selectedCol: col,
      selectedCell: {
        address: toAddress(row, col),
        value,
        formula,
      },
      selectedRange: null,
      selectedStyle: sheetStyleFromSelection(sheet, "cell", row, col, null),
    })
  },

  selectRow: (row) => {
    const sheet = get().sheet
    set({
      selectionMode: "row",
      selectedRow: row,
      selectedCell: {
        address: `${row}:${row}`,
        value: "",
        formula: "",
      },
      selectedRange: null,
      selectedStyle: sheetStyleFromSelection(sheet, "row", row, 1, null),
    })
  },

  selectColumn: (col) => {
    const sheet = get().sheet
    const colLabel = toColumnLabel(col)
    set({
      selectionMode: "column",
      selectedCol: col,
      selectedCell: {
        address: `${colLabel}:${colLabel}`,
        value: "",
        formula: "",
      },
      selectedRange: null,
      selectedStyle: sheetStyleFromSelection(sheet, "column", 1, col, null),
    })
  },

  selectAll: () => {
    const sheet = get().sheet
    set({
      selectionMode: "sheet",
      selectedCell: {
        address: "ALL",
        value: "",
        formula: "",
      },
      selectedRange: null,
      selectedStyle: sheetStyleFromSelection(sheet, "sheet", 1, 1, null),
    })
  },

  undo: async () => {
    const state = get()
    const entry = state.historyPast[state.historyPast.length - 1]
    if (!entry || !state.workbook || !state.sheet || entry.kind !== "cells") {
      return
    }

    const optimistic = restoreHistoryCellsLocal(
      state.sheet,
      entry.cells,
      "before"
    )

    set({
      sheet: optimistic,
      historyPast: state.historyPast.slice(0, -1),
      historyFuture: [...state.historyFuture, entry],
      selectedStyle: sheetStyleFromSelection(
        optimistic,
        state.selectionMode,
        state.selectedRow,
        state.selectedCol,
        state.selectedRange
      ),
      error: null,
    })

    try {
      for (const cell of entry.cells) {
        await persistCellSnapshot(
          state.workbook.id,
          entry.sheetName,
          cell.row,
          cell.col,
          cell.before
        )
      }
      void get().ensureWindow({
        ...get().viewportWindow,
        sheetName: entry.sheetName,
        force: true,
      })
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to persist undo",
      })
    }
  },

  redo: async () => {
    const state = get()
    const entry = state.historyFuture[state.historyFuture.length - 1]
    if (!entry || !state.workbook || !state.sheet || entry.kind !== "cells") {
      return
    }

    const optimistic = restoreHistoryCellsLocal(
      state.sheet,
      entry.cells,
      "after"
    )

    set({
      sheet: optimistic,
      historyPast: [...state.historyPast, entry],
      historyFuture: state.historyFuture.slice(0, -1),
      selectedStyle: sheetStyleFromSelection(
        optimistic,
        state.selectionMode,
        state.selectedRow,
        state.selectedCol,
        state.selectedRange
      ),
      error: null,
    })

    try {
      for (const cell of entry.cells) {
        await persistCellSnapshot(
          state.workbook.id,
          entry.sheetName,
          cell.row,
          cell.col,
          cell.after
        )
      }
      void get().ensureWindow({
        ...get().viewportWindow,
        sheetName: entry.sheetName,
        force: true,
      })
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to persist redo",
      })
    }
  },

  applyStyle: async (patch) => {
    const state = get()
    if (!state.sheet || !state.workbook) {
      return
    }

    const target = getSelectionTarget(state)
    const createMissing =
      target.mode === "cell" ||
      (target.mode === "range" &&
        selectionArea(target) <= MAX_HISTORY_RANGE_AREA)
    const optimistic = patchLoadedCells(
      state.sheet,
      target,
      (cell) => ({
        ...cell,
        style: { ...(cell.style ?? {}), ...patch },
      }),
      createMissing
    )
    const historyEntry = buildHistoryEntry(
      state.sheet.name,
      state.sheet,
      optimistic,
      target
    )

    set({
      sheet: optimistic,
      selectedStyle: { ...(state.selectedStyle ?? {}), ...patch },
      error: null,
      historyPast: historyEntry
        ? [...state.historyPast, historyEntry]
        : state.historyPast,
      historyFuture: [],
    })

    try {
      await applyStyleRequest(state.workbook.id, {
        sheet: state.sheet.name,
        target,
        patch,
      })
      void get().ensureWindow({
        ...get().viewportWindow,
        sheetName: state.sheet.name,
        force: true,
      })
      await get().refreshFiles()
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : "Failed to persist style changes",
      })
    }
  },

  clearFormatting: async () => {
    const state = get()
    if (!state.sheet || !state.workbook) {
      return
    }

    const target = getSelectionTarget(state)
    const optimistic = patchLoadedCells(state.sheet, target, (cell) => ({
      ...cell,
      style: {},
    }))
    const historyEntry = buildHistoryEntry(
      state.sheet.name,
      state.sheet,
      optimistic,
      target
    )

    set({
      sheet: optimistic,
      selectedStyle: {},
      error: null,
      historyPast: historyEntry
        ? [...state.historyPast, historyEntry]
        : state.historyPast,
      historyFuture: [],
    })

    try {
      await clearFormattingRange(state.workbook.id, {
        sheet: state.sheet.name,
        target,
      })
      void get().ensureWindow({
        ...get().viewportWindow,
        sheetName: state.sheet.name,
        force: true,
      })
      await get().refreshFiles()
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to clear formatting",
      })
    }
  },

  clearSelectedValues: async () => {
    if (clearValuesInFlight) {
      return
    }
    const state = get()
    if (!state.sheet || !state.workbook) {
      return
    }

    const target = getSelectionTarget(state)
    const optimistic = patchLoadedCells(state.sheet, target, (cell) => ({
      ...cell,
      value: "",
      display: "",
      formula: "",
      type: "blank",
    }))

    set({
      sheet: optimistic,
      selectedCell:
        target.mode === "cell"
          ? { ...state.selectedCell, value: "", formula: "" }
          : state.selectedCell,
      selectedStyle: sheetStyleFromSelection(
        optimistic,
        state.selectionMode,
        state.selectedRow,
        state.selectedCol,
        state.selectedRange
      ),
      error: null,
      historyFuture: [],
    })

    clearValuesInFlight = true
    try {
      await clearValuesRange(state.workbook.id, {
        sheet: state.sheet.name,
        target,
      })
      void get().ensureWindow({
        ...get().viewportWindow,
        sheetName: state.sheet.name,
        force: true,
      })
      await get().refreshFiles()
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to clear values",
      })
    } finally {
      clearValuesInFlight = false
    }
  },

  setNumberFormat: async (kind) => {
    const state = get()
    if (!state.sheet) {
      return
    }

    const patch = formatPatch(kind)
    const nextNumFmt = patch.numFmt
    if (!nextNumFmt || nextNumFmt === "@") {
      set({ error: null })
      await get().applyStyle(patch)
      return
    }

    const target = getSelectionTarget(state)
    const loadedCells = getLoadedCellsForTarget(state.sheet, target)
    const invalidSample = loadedCells.find(
      (cell) => !isValueValidForNumFmt(cell.value ?? "", nextNumFmt)
    )

    if (invalidSample) {
      set({
        error: `Cannot apply ${formatKindLabel(kind)} format. Selected cells include incompatible values (example: ${invalidSample.address}="${invalidSample.value}").`,
      })
      return
    }

    set({ error: null })
    await get().applyStyle(patch)
  },

  setZoom: (zoom) => {
    set({ zoom: Math.max(25, Math.min(300, zoom)) })
  },

  refreshFiles: async () => {
    try {
      const payload = await listFiles()
      set({ files: payload.files })
    } catch {
      // ignore background refresh errors
    }
  },

  refreshRecentFiles: async () => {
    try {
      const payload = await listRecentFiles(12)
      set({ recentFiles: payload.files })
    } catch {
      // ignore background refresh errors
    }
  },

  renameStoredFile: async (id, name) => {
    try {
      await renameFile(id, { name })
      await Promise.all([get().refreshFiles(), get().refreshRecentFiles()])
      const current = get().workbook
      if (current?.id === id) {
        set({ workbook: { ...current, fileName: name } })
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to rename file",
      })
    }
  },

  deleteStoredFile: async (id) => {
    try {
      await removeFile(id)
      const current = get().workbook
      const clearCurrentWorkbook = current?.id === id
      set({
        workbook: clearCurrentWorkbook ? null : current,
        sheet: clearCurrentWorkbook ? null : get().sheet,
        activeWorkspaceTab: clearCurrentWorkbook
          ? ""
          : get().activeWorkspaceTab,
        fileSettings: clearCurrentWorkbook
          ? DEFAULT_FILE_SETTINGS
          : get().fileSettings,
        kanbanRegions: clearCurrentWorkbook ? [] : get().kanbanRegions,
      })
      await Promise.all([get().refreshFiles(), get().refreshRecentFiles()])
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to delete file",
      })
    }
  },

  setSelectedCell: (cell) => {
    set({ selectedCell: cell })
  },

  setSelectedRange: (range) => {
    const state = get()
    const normalizedRange = range ? normalizeCellRange(range) : null
    set({
      selectedRange: normalizedRange,
      selectedStyle: sheetStyleFromSelection(
        state.sheet,
        state.selectionMode,
        state.selectedRow,
        state.selectedCol,
        normalizedRange
      ),
    })
  },

  createKanbanFromSelection: async (statusCol, name) => {
    const state = get()
    if (!state.workbook || !state.sheet || !state.selectedRange) {
      return null
    }
    const range = state.selectedRange
    if (statusCol < range.colStart || statusCol > range.colEnd) {
      return null
    }
    const statusValues = new Set<string>()
    for (let row = range.rowStart + 1; row <= range.rowEnd; row += 1) {
      const value = readCellValue(state.sheet, row, statusCol).trim()
      if (value) {
        statusValues.add(value)
      }
    }
    const now = new Date().toISOString()
    const next: KanbanRegion = {
      id: `kanban_${Math.random().toString(36).slice(2, 10)}`,
      name:
        name?.trim() ||
        `Kanban ${state.kanbanRegions.filter((r) => r.sheetName === state.sheet?.name).length + 1}`,
      sheetName: state.sheet.name,
      range: {
        rowStart: range.rowStart,
        rowEnd: range.rowEnd,
        colStart: range.colStart,
        colEnd: range.colEnd,
      },
      statusCol,
      titleCol: defaultKanbanTitleCol(range, statusCol),
      statusOrder: Array.from(statusValues),
      visibleCols: Array.from(
        { length: range.colEnd - range.colStart + 1 },
        (_, idx) => range.colStart + idx
      ),
      cardColorEnabled: false,
      cardColorMode: "cards",
      cardColorByCol: defaultKanbanTitleCol(range, statusCol),
      cardColorMap: {},
      createdAt: now,
    }
    const regions = [...state.kanbanRegions, next]
    const previousRegions = state.kanbanRegions
    set({
      kanbanRegions: regions,
      activeWorkspaceTab: `kanban:${next.id}`,
      error: null,
    })
    try {
      const savedRegions = await persistKanbanRegions(
        state.workbook.id,
        regions
      )
      set({ kanbanRegions: savedRegions })
      return savedRegions.find((region) => region.id === next.id) ?? next
    } catch (error) {
      set({
        kanbanRegions: previousRegions,
        activeWorkspaceTab: state.activeWorkspaceTab,
        error:
          error instanceof Error ? error.message : "Failed to save kanban view",
      })
      return null
    }
  },

  extendKanbanRegion: async (regionId, axis, amount = 1) => {
    const state = get()
    if (!state.workbook || !state.sheet) {
      return
    }
    const byId = state.kanbanRegions.find((region) => region.id === regionId)
    if (!byId || byId.sheetName !== state.sheet.name) {
      return
    }
    const step = Math.max(1, Math.floor(amount))
    if (axis === "rows") {
      const needed = byId.range.rowEnd + step - state.sheet.maxRow
      if (needed > 0) {
        await get().addRows(needed)
      }
    } else {
      const needed = byId.range.colEnd + step - state.sheet.maxCol
      if (needed > 0) {
        await get().addCols(needed)
      }
    }

    const latest = get()
    const regions = latest.kanbanRegions.map((region) => {
      if (region.id !== regionId) {
        return region
      }
      return {
        ...region,
        range: {
          ...region.range,
          rowEnd:
            axis === "rows" ? region.range.rowEnd + step : region.range.rowEnd,
          colEnd:
            axis === "cols" ? region.range.colEnd + step : region.range.colEnd,
        },
      }
    })
    const workbookId = latest.workbook?.id
    if (!workbookId) {
      return
    }
    const previousRegions = latest.kanbanRegions
    set({ kanbanRegions: regions, error: null })
    try {
      const savedRegions = await persistKanbanRegions(workbookId, regions)
      set({ kanbanRegions: savedRegions })
    } catch (error) {
      set({
        kanbanRegions: previousRegions,
        error:
          error instanceof Error ? error.message : "Failed to save kanban view",
      })
    }
  },

  setKanbanStatusOrder: async (regionId, statusOrder) => {
    const state = get()
    if (!state.workbook) {
      return
    }
    const unique = Array.from(
      new Set(statusOrder.map((status) => status.trim()).filter(Boolean))
    )
    const regions = state.kanbanRegions.map((region) =>
      region.id === regionId ? { ...region, statusOrder: unique } : region
    )
    set({ kanbanRegions: regions, error: null })
    try {
      const savedRegions = await persistKanbanRegions(
        state.workbook.id,
        regions
      )
      set({ kanbanRegions: savedRegions })
    } catch (error) {
      set({
        kanbanRegions: state.kanbanRegions,
        error:
          error instanceof Error ? error.message : "Failed to save kanban view",
      })
    }
  },

  setKanbanTitleCol: async (regionId, titleCol) => {
    const state = get()
    if (!state.workbook || !state.sheet) {
      return
    }
    const regions = state.kanbanRegions.map((region) => {
      if (region.id !== regionId) {
        return region
      }
      if (titleCol < region.range.colStart || titleCol > region.range.colEnd) {
        return region
      }
      return { ...region, titleCol }
    })
    set({ kanbanRegions: regions, error: null })
    try {
      const savedRegions = await persistKanbanRegions(
        state.workbook.id,
        regions
      )
      set({ kanbanRegions: savedRegions })
    } catch (error) {
      set({
        kanbanRegions: state.kanbanRegions,
        error:
          error instanceof Error ? error.message : "Failed to save kanban view",
      })
    }
  },

  setKanbanVisibleCols: async (regionId, visibleCols) => {
    const state = get()
    if (!state.workbook) {
      return
    }
    const regions = state.kanbanRegions.map((region) => {
      if (region.id !== regionId) {
        return region
      }
      const unique = Array.from(
        new Set(
          visibleCols.filter(
            (col) =>
              Number.isFinite(col) &&
              col >= region.range.colStart &&
              col <= region.range.colEnd
          )
        )
      )
      return {
        ...region,
        visibleCols: unique.length > 0 ? unique : [region.titleCol],
      }
    })
    set({ kanbanRegions: regions, error: null })
    try {
      const savedRegions = await persistKanbanRegions(
        state.workbook.id,
        regions
      )
      set({ kanbanRegions: savedRegions })
    } catch (error) {
      set({
        kanbanRegions: state.kanbanRegions,
        error:
          error instanceof Error ? error.message : "Failed to save kanban view",
      })
    }
  },

  setKanbanCardColorConfig: async (regionId, patch) => {
    const state = get()
    if (!state.workbook) {
      return
    }
    const regions = state.kanbanRegions.map((region) => {
      if (region.id !== regionId) {
        return region
      }
      const nextEnabled =
        typeof patch.cardColorEnabled === "boolean"
          ? patch.cardColorEnabled
          : region.cardColorEnabled
      const nextColorMode =
        patch.cardColorMode === "columns"
          ? "columns"
          : patch.cardColorMode === "cards"
            ? "cards"
            : region.cardColorMode
      const requestedCol =
        typeof patch.cardColorByCol === "number"
          ? patch.cardColorByCol
          : region.cardColorByCol
      const nextColorByCol =
        requestedCol >= region.range.colStart &&
        requestedCol <= region.range.colEnd
          ? requestedCol
          : region.cardColorByCol
      const nextColorMap =
        patch.cardColorMap === undefined
          ? region.cardColorMap
          : normalizeKanbanCardColorMap(patch.cardColorMap)
      return {
        ...region,
        cardColorEnabled: nextEnabled,
        cardColorMode: nextColorMode,
        cardColorByCol: nextColorByCol,
        cardColorMap: nextColorMap,
      }
    })
    set({ kanbanRegions: regions, error: null })
    try {
      const savedRegions = await persistKanbanRegions(
        state.workbook.id,
        regions
      )
      set({ kanbanRegions: savedRegions })
    } catch (error) {
      set({
        kanbanRegions: state.kanbanRegions,
        error:
          error instanceof Error ? error.message : "Failed to save kanban view",
      })
    }
  },

  createKanbanCard: async (regionId, options) => {
    const state = get()
    if (!state.workbook || !state.sheet) {
      return null
    }

    const region = state.kanbanRegions.find(
      (item) => item.id === regionId && item.sheetName === state.sheet?.name
    )
    if (!region) {
      return null
    }

    const row = region.range.rowEnd + 1
    const normalizedStatus =
      options?.status?.trim() && options.status !== "No status"
        ? options.status.trim()
        : ""
    const normalizedTitle = options?.title?.trim() || "New card"

    set({ error: null })

    try {
      const payload = await insertRowsRequest(
        state.workbook.id,
        { sheet: state.sheet.name, start: row, count: 1 },
        state.viewportWindow
      )

      const nextRegions = insertKanbanRowsLocally(state.kanbanRegions, {
        sheetName: state.sheet.name,
        regionId,
        startRow: row,
        count: 1,
        statusToAdd: normalizedStatus || undefined,
      })

      set({
        workbook: payload.workbook,
        sheet: payload.sheet,
        kanbanRegions: nextRegions,
        selectionMode: "cell",
        selectedRange: null,
        selectedRow: row,
        selectedCol: region.titleCol,
        selectedCell: EMPTY_CELL,
        selectedStyle: {},
        error: null,
      })

      try {
        const savedRegions = await persistKanbanRegions(
          state.workbook.id,
          nextRegions
        )
        set({ kanbanRegions: savedRegions })
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? `${error.message}. Card was created, but kanban layout changes may not persist yet.`
              : "Card was created, but kanban layout changes may not persist yet.",
        })
      }

      const initialValues = new Map<number, string>([
        [region.titleCol, normalizedTitle],
      ])
      if (normalizedStatus) {
        initialValues.set(region.statusCol, normalizedStatus)
      }

      for (const [col, value] of initialValues) {
        await get().updateCell(row, col, value)
      }

      await get().refreshFiles()
      return row
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : "Failed to create kanban card",
      })
      return null
    }
  },

  moveKanbanCard: async (regionId, sourceRow, targetStatus, targetIndex) => {
    const state = get()
    if (!state.workbook || !state.sheet) {
      return
    }
    const region = state.kanbanRegions.find(
      (item) => item.id === regionId && item.sheetName === state.sheet?.name
    )
    if (!region) {
      return
    }

    const allRows = Array.from(
      { length: Math.max(0, region.range.rowEnd - region.range.rowStart) },
      (_, idx) => region.range.rowStart + 1 + idx
    )
    if (!allRows.includes(sourceRow)) {
      return
    }
    const sourceStatus =
      readCellValue(state.sheet, sourceRow, region.statusCol).trim() ||
      "No status"
    const normalizedTargetStatus = targetStatus.trim() || "No status"

    const order = [
      ...region.statusOrder,
      ...Array.from(
        new Set(
          allRows
            .map(
              (row) =>
                readCellValue(state.sheet, row, region.statusCol).trim() ||
                "No status"
            )
            .filter((status) => !region.statusOrder.includes(status))
        )
      ),
    ]

    const groups = new Map<string, number[]>()
    for (const status of order) {
      groups.set(status, [])
    }
    for (const row of allRows) {
      const status =
        readCellValue(state.sheet, row, region.statusCol).trim() || "No status"
      if (!groups.has(status)) {
        groups.set(status, [])
      }
      groups.get(status)?.push(row)
    }

    const sourceGroup = groups.get(sourceStatus) ?? []
    const sourceAt = sourceGroup.indexOf(sourceRow)
    if (sourceAt === -1) {
      return
    }
    sourceGroup.splice(sourceAt, 1)

    const targetGroup = groups.get(normalizedTargetStatus) ?? []
    const nextTargetIndex = Math.max(
      0,
      Math.min(targetIndex, targetGroup.length)
    )
    targetGroup.splice(nextTargetIndex, 0, sourceRow)
    groups.set(normalizedTargetStatus, targetGroup)

    const nextOrder = Array.from(groups.keys())
    const finalRows = nextOrder.flatMap((status) => groups.get(status) ?? [])
    if (finalRows.length !== allRows.length) {
      return
    }

    const rowSnapshots = new Map<number, Record<number, string>>()
    for (const row of allRows) {
      const snapshot: Record<number, string> = {}
      for (
        let col = region.range.colStart;
        col <= region.range.colEnd;
        col += 1
      ) {
        snapshot[col] = readCellValue(state.sheet, row, col)
      }
      rowSnapshots.set(row, snapshot)
    }
    const movedSnapshot = rowSnapshots.get(sourceRow)
    if (movedSnapshot) {
      movedSnapshot[region.statusCol] =
        normalizedTargetStatus === "No status" ? "" : normalizedTargetStatus
      rowSnapshots.set(sourceRow, movedSnapshot)
    }

    for (let idx = 0; idx < allRows.length; idx += 1) {
      const destRow = allRows[idx]
      const fromRow = finalRows[idx]
      const sourceValues = rowSnapshots.get(fromRow)
      if (!sourceValues) {
        continue
      }
      for (
        let col = region.range.colStart;
        col <= region.range.colEnd;
        col += 1
      ) {
        await get().updateCell(destRow, col, sourceValues[col] ?? "")
      }
    }

    const regions = get().kanbanRegions.map((item) =>
      item.id === region.id
        ? {
            ...item,
            statusOrder: Array.from(
              new Set([
                ...item.statusOrder,
                ...nextOrder.filter((status) => status !== "No status"),
              ])
            ),
          }
        : item
    )
    set({ kanbanRegions: regions, error: null })
    try {
      const savedRegions = await persistKanbanRegions(
        state.workbook.id,
        regions
      )
      set({ kanbanRegions: savedRegions })
    } catch (error) {
      set({
        kanbanRegions: state.kanbanRegions,
        error:
          error instanceof Error ? error.message : "Failed to save kanban view",
      })
    }
  },

  setSearch: (value) => {
    set({ search: value })
  },

  setFileCurrency: async (currency) => {
    const workbookId = get().workbook?.id
    if (!workbookId) {
      return
    }
    const current = get().fileSettings
    const optimistic: FileSettings = { ...current, currency }
    set({ fileSettings: optimistic, error: null })
    try {
      const payload = await updateFileSettings(workbookId, optimistic)
      set({ fileSettings: payload.settings })
    } catch (error) {
      set({
        fileSettings: current,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update file settings",
      })
    }
  },

  saveEmailSettings: async (email) => {
    const workbookId = get().workbook?.id
    if (!workbookId) {
      return
    }
    const current = get().fileSettings
    const optimistic: FileSettings = { ...current, email }
    set({ fileSettings: optimistic, error: null })
    try {
      const payload = await updateFileSettings(workbookId, optimistic)
      set({ fileSettings: payload.settings })
    } catch (error) {
      set({
        fileSettings: current,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update email settings",
      })
    }
  },

  setSheetFontFamily: (fontFamily) => {
    const state = get()
    const trimmed = fontFamily.trim()
    if (!trimmed) {
      return
    }
    set({ sheetFontFamily: trimmed })
    const workbookId = state.workbook?.id
    const sheetName = state.sheet?.name
    if (!workbookId || !sheetName) {
      return
    }
    const all = readPersistedSheetFonts()
    const nextByWorkbook = { ...(all[workbookId] ?? {}), [sheetName]: trimmed }
    writePersistedSheetFonts(workbookId, nextByWorkbook)
  },

  setViewportWindow: (window) => {
    const state = get()
    const normalized = normalizeWindow(state.sheet, window)
    const keepWindow = expandWindow(
      state.sheet,
      normalized,
      CACHE_ROW_PADDING,
      CACHE_COL_PADDING
    )
    set({
      viewportWindow: normalized,
      sheet: trimSheetToWindow(state.sheet, keepWindow),
      loadedWindows: state.sheet
        ? pruneLoadedWindows(state.loadedWindows, state.sheet.name, keepWindow)
        : state.loadedWindows,
    })
  },
}))

export function resetSheetStore() {
  useSheetStore.setState({
    workbook: null,
    sheet: null,
    files: [],
    recentFiles: [],
    selectedSheetName: "",
    activeWorkspaceTab: "",
    selectionMode: "cell",
    selectedRange: null,
    selectedRow: 1,
    selectedCol: 1,
    selectedCell: EMPTY_CELL,
    selectedStyle: EMPTY_STYLE,
    historyPast: [],
    historyFuture: [],
    isLoading: false,
    error: null,
    zoom: 100,
    sheetFontFamily: DEFAULT_SHEET_FONT_FAMILY,
    search: "",
    fileSettings: DEFAULT_FILE_SETTINGS,
    kanbanRegions: [],
    loadedWindows: [],
    loadingWindows: [],
    viewportWindow: DEFAULT_WINDOW,
  })
}
