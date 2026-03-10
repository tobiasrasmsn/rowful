export type CellStyle = {
  fontFamily?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  fontColor?: string
  fillColor?: string
  hAlign?: string
  vAlign?: string
  border?: string
  overflow?: string
  wrapText?: boolean
  numFmt?: string
}

export type Cell = {
  address: string
  row: number
  col: number
  type: string
  value: string
  display?: string
  formula?: string
  style?: CellStyle
}

export type Row = {
  index: number
  cells: Cell[]
}

export type Sheet = {
  name: string
  index: number
  maxRow: number
  maxCol: number
  rows: Row[]
}

export type CellRange = {
  rowStart: number
  rowEnd: number
  colStart: number
  colEnd: number
}

export type KanbanRegion = {
  id: string
  name: string
  sheetName: string
  range: CellRange
  statusCol: number
  titleCol: number
  statusOrder: string[]
  cardColorEnabled: boolean
  cardColorByCol: number
  cardColorMap: Record<string, "none" | "green" | "red" | "yellow" | "purple">
  createdAt: string
}

export type SheetMeta = {
  name: string
  index: number
  maxRow: number
  maxCol: number
}

export type Workbook = {
  id: string
  fileName: string
  fileHash: string
  sheets: SheetMeta[]
  activeSheet: string
  createdAt: string
}

export type SMTPSettings = {
  host: string
  port: number
  username: string
  password: string
  fromEmail: string
  fromName: string
  useTLS: boolean
}

export type FileSettings = {
  currency: string
  email: SMTPSettings
}

export type FileSettingsResponse = {
  settings: FileSettings
}

export type SendEmailRequest = {
  to?: string
  recipients?: string[]
  targets?: Array<{
    email: string
    vars?: Record<string, string>
  }>
  subject?: string
  message?: string
}

export type UploadResponse = {
  workbook: Workbook
  sheet: Sheet
  kanbanRegions: KanbanRegion[]
}

export type SheetResponse = {
  workbook: Workbook
  sheet: Sheet
  kanbanRegions: KanbanRegion[]
}

export type KanbanRegionsResponse = {
  kanbanRegions: KanbanRegion[]
}

export type FileEntry = {
  id: string
  fileName: string
  filePath: string
  fileHash: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

export type FilesResponse = {
  files: FileEntry[]
}

export type ErrorResponse = {
  error: string
}

export type SelectionTarget = {
  mode: "cell" | "row" | "column" | "sheet" | "range"
  row?: number
  col?: number
  range?: CellRange | null
}
