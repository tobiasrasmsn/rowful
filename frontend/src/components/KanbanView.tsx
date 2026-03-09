import { useMemo, useState } from "react"
import { toast } from "sonner"

import { useSheetStore } from "@/store/sheetStore"
import type { KanbanRegion } from "@/types/sheet"
import { Input } from "./ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"

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

type KanbanViewProps = {
  region: KanbanRegion
}

type DragCardPayload = {
  kind: "card"
  row: number
  status: string
}

type DragColumnPayload = {
  kind: "column"
  status: string
}

const parsePayload = (
  raw: string
): DragCardPayload | DragColumnPayload | null => {
  try {
    const parsed = JSON.parse(raw) as DragCardPayload | DragColumnPayload
    if (!parsed || typeof parsed !== "object") {
      return null
    }
    if (
      parsed.kind === "card" &&
      typeof parsed.row === "number" &&
      typeof parsed.status === "string"
    ) {
      return parsed
    }
    if (parsed.kind === "column" && typeof parsed.status === "string") {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

const EMPTY_STATUS_VALUE = "__KANBAN_EMPTY_STATUS__"

export function KanbanView({ region }: KanbanViewProps) {
  const sheet = useSheetStore((state) => state.sheet)
  const updateCell = useSheetStore((state) => state.updateCell)
  const moveKanbanCard = useSheetStore((state) => state.moveKanbanCard)
  const setKanbanStatusOrder = useSheetStore(
    (state) => state.setKanbanStatusOrder
  )
  const setKanbanTitleCol = useSheetStore((state) => state.setKanbanTitleCol)
  const [draggingRow, setDraggingRow] = useState<number | null>(null)
  const [draggingStatus, setDraggingStatus] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<{
    x: number
    y: number
    row: number
  } | null>(null)

  const matrix = useMemo(() => {
    const data = new Map<number, Map<number, string>>()
    for (const row of sheet?.rows ?? []) {
      const rowMap = new Map<number, string>()
      for (const cell of row.cells) {
        rowMap.set(cell.col, cell.value ?? "")
      }
      data.set(row.index, rowMap)
    }
    return data
  }, [sheet?.rows])

  const labels = useMemo(() => {
    const row = matrix.get(region.range.rowStart)
    return Array.from(
      { length: region.range.colEnd - region.range.colStart + 1 },
      (_, idx) => {
        const col = region.range.colStart + idx
        return row?.get(col)?.trim() || toColumnLabel(col)
      }
    )
  }, [
    matrix,
    region.range.colEnd,
    region.range.colStart,
    region.range.rowStart,
  ])

  const rows = useMemo(
    () =>
      Array.from(
        { length: Math.max(0, region.range.rowEnd - region.range.rowStart) },
        (_, idx) => region.range.rowStart + 1 + idx
      ),
    [region.range.rowEnd, region.range.rowStart]
  )

  const statuses = useMemo(() => {
    const values = new Set<string>()
    for (const row of rows) {
      const status = matrix.get(row)?.get(region.statusCol)?.trim()
      if (status) {
        values.add(status)
      }
    }
    const inData = Array.from(values)
    const configured = (region.statusOrder ?? []).filter(Boolean)
    const merged = [
      ...configured,
      ...inData.filter((status) => !configured.includes(status)),
    ]
    return merged.length > 0 ? merged : ["No status"]
  }, [matrix, region.statusCol, region.statusOrder, rows])

  const cardsByStatus = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const status of statuses) {
      map.set(status, [])
    }
    for (const row of rows) {
      const raw = matrix.get(row)?.get(region.statusCol)?.trim()
      const status = raw || "No status"
      if (!map.has(status)) {
        map.set(status, [])
      }
      map.get(status)?.push(row)
    }
    return map
  }, [matrix, region.statusCol, rows, statuses])

  const defaultTitleCol = useMemo(() => {
    for (
      let col = region.range.colStart;
      col <= region.range.colEnd;
      col += 1
    ) {
      if (col !== region.statusCol) {
        return col
      }
    }
    return region.statusCol
  }, [region.range.colEnd, region.range.colStart, region.statusCol])
  const titleCol = useMemo(() => {
    if (
      region.titleCol >= region.range.colStart &&
      region.titleCol <= region.range.colEnd
    ) {
      return region.titleCol
    }
    return defaultTitleCol
  }, [
    defaultTitleCol,
    region.range.colEnd,
    region.range.colStart,
    region.titleCol,
  ])
  const titleColOptions = useMemo(
    () =>
      Array.from(
        { length: region.range.colEnd - region.range.colStart + 1 },
        (_, idx) => region.range.colStart + idx
      ),
    [region.range.colEnd, region.range.colStart]
  )

  if (!sheet || sheet.name !== region.sheetName) {
    return null
  }

  const renderCardBody = (row: number, interactive: boolean) => (
    <>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex w-full flex-row items-center justify-between border-b px-3 py-2 text-sm font-medium text-muted-foreground">
          {matrix.get(row)?.get(titleCol) || `Row ${row}`}
          <span className="cursor-grab text-xs text-muted-foreground">::</span>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-4">
        {Array.from(
          { length: region.range.colEnd - region.range.colStart + 1 },
          (_, idx) => region.range.colStart + idx
        ).map((col, idx) => {
          const value = matrix.get(row)?.get(col) ?? ""
          const label = labels[idx] || toColumnLabel(col)
          const isStatus = col === region.statusCol
          return (
            <div key={`${row}:${col}`} className="mb-1.5">
              <div className="w-fit translate-x-2 rounded-t-md border-x border-t px-2 py-0.5 text-[11px] text-muted-foreground">
                {label}
              </div>
              {isStatus ? (
                <Select
                  value={value || EMPTY_STATUS_VALUE}
                  disabled={!interactive}
                  onValueChange={(nextValue) => {
                    if (!interactive) {
                      return
                    }
                    void updateCell(
                      row,
                      col,
                      nextValue === EMPTY_STATUS_VALUE ? "" : nextValue
                    )
                  }}
                >
                  <SelectTrigger className="h-8 w-full rounded-md bg-transparent text-sm focus-visible:border-input focus-visible:ring-0 focus-visible:outline-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statuses.map((statusOption) => (
                      <SelectItem
                        key={statusOption}
                        value={
                          statusOption === "No status"
                            ? EMPTY_STATUS_VALUE
                            : statusOption
                        }
                      >
                        {statusOption}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={value}
                  disabled={!interactive}
                  className="bg-transparent focus-visible:border-input focus-visible:ring-0 focus-visible:outline-none"
                  onChange={(event) => {
                    if (!interactive) {
                      return
                    }
                    void updateCell(row, col, event.target.value)
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </>
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-2 text-sm font-medium">
        <div className="flex items-center justify-between">
          <span>{region.name}</span>
          <label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            Card title field
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
              value={titleCol}
              onChange={(event) => {
                const col = Number(event.target.value)
                if (Number.isFinite(col)) {
                  setKanbanTitleCol(region.id, col)
                }
              }}
            >
              {titleColOptions.map((col) => (
                <option key={col} value={col}>
                  {toColumnLabel(col)} -{" "}
                  {labels[col - region.range.colStart] || toColumnLabel(col)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="grid min-w-max grid-flow-col gap-3">
          {statuses.map((status) => {
            const cards = cardsByStatus.get(status) ?? []
            const canDeleteStatus =
              status !== "No status" &&
              region.statusOrder.includes(status) &&
              cards.length === 0
            return (
              <div
                key={status}
                className="flex w-72 min-w-72 flex-col rounded-xl border border-border bg-background"
                onDragOver={(event) => {
                  event.preventDefault()
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const payload = parsePayload(
                    event.dataTransfer.getData("application/json")
                  )
                  if (!payload || payload.kind !== "column") {
                    return
                  }
                  const from = statuses.indexOf(payload.status)
                  const to = statuses.indexOf(status)
                  if (from < 0 || to < 0 || from === to) {
                    return
                  }
                  const next = [...statuses]
                  const [moved] = next.splice(from, 1)
                  next.splice(to, 0, moved)
                  setKanbanStatusOrder(
                    region.id,
                    next.filter((item) => item !== "No status")
                  )
                }}
              >
                <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-medium">
                  <span
                    className="mr-2 inline-block cursor-grab text-muted-foreground"
                    draggable
                    onDragStart={(event) => {
                      setDraggingStatus(status)
                      event.dataTransfer.effectAllowed = "move"
                      event.dataTransfer.setData(
                        "application/json",
                        JSON.stringify({
                          kind: "column",
                          status,
                        } satisfies DragColumnPayload)
                      )
                    }}
                    onDragEnd={() => setDraggingStatus(null)}
                  >
                    ::
                  </span>
                  <span>{status}</span>
                  {status !== "No status" ? (
                    <button
                      type="button"
                      className="float-right rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!canDeleteStatus}
                      title={
                        canDeleteStatus
                          ? `Delete "${status}" column`
                          : "Status can only be deleted when no cards use it"
                      }
                      onClick={() => {
                        if (cards.length > 0) {
                          toast.error("Move or clear all cards in this status before deleting the column.")
                          return
                        }
                        setKanbanStatusOrder(
                          region.id,
                          region.statusOrder.filter((item) => item !== status)
                        )
                      }}
                    >
                      x
                    </button>
                  ) : null}
                </div>
                <div
                  className="flex min-h-16 flex-col gap-2 p-2"
                  onDragOver={(event) => {
                    event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const payload = parsePayload(
                      event.dataTransfer.getData("application/json")
                    )
                    if (!payload || payload.kind !== "card") {
                      return
                    }
                    void moveKanbanCard(
                      region.id,
                      payload.row,
                      status,
                      cards.length
                    )
                  }}
                >
                  {cards.map((row, cardIndex) => (
                    <div
                      key={row}
                      draggable
                      className={`rounded-lg border border-border bg-card ${
                        draggingRow === row ? "opacity-40" : ""
                      }`}
                      onDragStart={(event) => {
                        const transparentPixel =
                          document.createElement("canvas")
                        transparentPixel.width = 1
                        transparentPixel.height = 1
                        const img = new Image()
                        img.src = transparentPixel.toDataURL()
                        event.dataTransfer.setDragImage(img, 0, 0)
                        event.dataTransfer.effectAllowed = "move"
                        event.dataTransfer.setData(
                          "application/json",
                          JSON.stringify({
                            kind: "card",
                            row,
                            status,
                          } satisfies DragCardPayload)
                        )
                        setDraggingRow(row)
                        setDragPreview({
                          x: event.clientX + 12,
                          y: event.clientY + 12,
                          row,
                        })
                      }}
                      onDrag={(event) => {
                        if (event.clientX === 0 && event.clientY === 0) {
                          return
                        }
                        setDragPreview((current) =>
                          current
                            ? {
                                ...current,
                                x: event.clientX + 12,
                                y: event.clientY + 12,
                              }
                            : current
                        )
                      }}
                      onDragEnd={() => {
                        setDraggingRow(null)
                        setDragPreview(null)
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        const payload = parsePayload(
                          event.dataTransfer.getData("application/json")
                        )
                        if (!payload || payload.kind !== "card") {
                          return
                        }
                        void moveKanbanCard(
                          region.id,
                          payload.row,
                          status,
                          cardIndex
                        )
                      }}
                    >
                      {renderCardBody(row, true)}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {(draggingRow || draggingStatus) && (
        <div className="border-t border-border px-4 py-1 text-xs text-muted-foreground">
          Drag and drop to reorder {draggingStatus ? "columns" : "cards"}.
        </div>
      )}
      {dragPreview ? (
        <div
          className="pointer-events-none fixed z-[120] w-72 rounded-lg border border-border bg-card p-2 shadow-xl"
          style={{
            left: `${dragPreview.x}px`,
            top: `${dragPreview.y}px`,
          }}
        >
          {renderCardBody(dragPreview.row, false)}
        </div>
      ) : null}
    </div>
  )
}
