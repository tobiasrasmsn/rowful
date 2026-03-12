import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from "react"
import { DragDropIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "sonner"

import { useSheetStore } from "@/store/sheetStore"
import type { KanbanRegion } from "@/types/sheet"
import { Button } from "./ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog"
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
const CARD_COLORS = ["none", "green", "red", "yellow", "purple"] as const
type CardColor = (typeof CARD_COLORS)[number]

const colorDotClass: Record<CardColor, string> = {
  none: "bg-transparent",
  green: "bg-success",
  red: "bg-destructive",
  yellow: "bg-warning",
  purple: "bg-primary",
}

const COLOR_KEYWORDS: Record<Exclude<CardColor, "none">, string[]> = {
  green: [
    "done",
    "complete",
    "completed",
    "success",
    "successful",
    "resolved",
    "approved",
    "closed",
    "finish",
    "finished",
    "ready",
    "ok",
    "pass",
    "passed",
    "shipped",
    "deployed",
    "live",
  ],
  red: [
    "not",
    "todo",
    "to do",
    "backlog",
    "blocked",
    "blocker",
    "stuck",
    "failed",
    "fail",
    "error",
    "critical",
    "urgent",
    "rejected",
    "cancel",
    "canceled",
    "cancelled",
    "overdue",
    "missed",
  ],
  yellow: [
    "progress",
    "in progress",
    "doing",
    "active",
    "pending",
    "ongoing",
    "wip",
    "started",
    "running",
    "processing",
    "working",
    "next",
    "soon",
    "attention",
  ],
  purple: [
    "review",
    "in review",
    "qa",
    "testing",
    "test",
    "verify",
    "verification",
    "wait",
    "waiting",
    "hold",
    "on hold",
    "paused",
    "planning",
    "refine",
    "triage",
  ],
}

const suggestCardColor = (value: string): CardColor => {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!normalized) {
    return "none"
  }
  const padded = ` ${normalized} `
  for (const keyword of COLOR_KEYWORDS.red) {
    if (padded.includes(` ${keyword} `) || normalized.includes(keyword)) {
      return "red"
    }
  }
  for (const keyword of COLOR_KEYWORDS.green) {
    if (padded.includes(` ${keyword} `) || normalized.includes(keyword)) {
      return "green"
    }
  }
  for (const keyword of COLOR_KEYWORDS.yellow) {
    if (padded.includes(` ${keyword} `) || normalized.includes(keyword)) {
      return "yellow"
    }
  }
  for (const keyword of COLOR_KEYWORDS.purple) {
    if (padded.includes(` ${keyword} `) || normalized.includes(keyword)) {
      return "purple"
    }
  }
  return "none"
}

export function KanbanView({ region }: KanbanViewProps) {
  const sheet = useSheetStore((state) => state.sheet)
  const updateCell = useSheetStore((state) => state.updateCell)
  const moveKanbanCard = useSheetStore((state) => state.moveKanbanCard)
  const setKanbanStatusOrder = useSheetStore(
    (state) => state.setKanbanStatusOrder
  )
  const setKanbanTitleCol = useSheetStore((state) => state.setKanbanTitleCol)
  const setKanbanVisibleCols = useSheetStore(
    (state) => state.setKanbanVisibleCols
  )
  const setKanbanCardColorConfig = useSheetStore(
    (state) => state.setKanbanCardColorConfig
  )
  const [draggingRow, setDraggingRow] = useState<number | null>(null)
  const [draggingStatus, setDraggingStatus] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<{
    x: number
    y: number
    row: number
  } | null>(null)
  const [dragCursorOffset, setDragCursorOffset] = useState<{
    x: number
    y: number
  } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
  const visibleCols = useMemo(() => {
    const configured = Array.isArray(region.visibleCols)
      ? region.visibleCols.filter(
          (col) => col >= region.range.colStart && col <= region.range.colEnd
        )
      : []
    return configured.length > 0 ? configured : titleColOptions
  }, [
    region.range.colEnd,
    region.range.colStart,
    region.visibleCols,
    titleColOptions,
  ])
  const cardColorByCol = useMemo(() => {
    if (
      region.cardColorByCol >= region.range.colStart &&
      region.cardColorByCol <= region.range.colEnd
    ) {
      return region.cardColorByCol
    }
    return titleCol
  }, [
    region.cardColorByCol,
    region.range.colEnd,
    region.range.colStart,
    titleCol,
  ])
  const cardColorValues = useMemo(() => {
    const values = new Set<string>()
    for (const row of rows) {
      const value = matrix.get(row)?.get(cardColorByCol)?.trim() ?? ""
      if (value) {
        values.add(value)
      }
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [cardColorByCol, matrix, rows])
  const cardColorMap = useMemo(() => {
    const map: Record<string, CardColor> = {}
    for (const [key, value] of Object.entries(region.cardColorMap ?? {})) {
      map[key] = CARD_COLORS.includes(value as CardColor)
        ? (value as CardColor)
        : "none"
    }
    return map
  }, [region.cardColorMap])

  const moveDroppedCard = (
    event: DragEvent<HTMLElement>,
    targetStatus: string,
    targetIndex: number
  ) => {
    const payload = parsePayload(event.dataTransfer.getData("application/json"))
    if (!payload || payload.kind !== "card") {
      return false
    }
    void moveKanbanCard(region.id, payload.row, targetStatus, targetIndex)
    return true
  }

  const autoAssignCardColors = useCallback((values: string[]) => {
    const map: Record<string, CardColor> = {}
    for (const value of values) {
      map[value] = suggestCardColor(value)
    }
    return map
  }, [])

  const inferredCardColorMap = useMemo(() => {
    if (!region.cardColorEnabled) {
      return cardColorMap
    }
    const next = { ...cardColorMap }
    for (const value of cardColorValues) {
      if (!(value in next)) {
        next[value] = suggestCardColor(value)
      }
    }
    return next
  }, [cardColorMap, cardColorValues, region.cardColorEnabled])

  useEffect(() => {
    if (!region.cardColorEnabled) {
      return
    }
    const missingValues = cardColorValues.filter(
      (value) => !(value in cardColorMap)
    )
    if (missingValues.length === 0) {
      return
    }
    void setKanbanCardColorConfig(region.id, {
      cardColorMap: {
        ...cardColorMap,
        ...autoAssignCardColors(missingValues),
      },
    })
  }, [
    autoAssignCardColors,
    cardColorMap,
    cardColorValues,
    region.cardColorEnabled,
    region.id,
    setKanbanCardColorConfig,
  ])

  if (!sheet || sheet.name !== region.sheetName) {
    return null
  }

  const cardColorForRow = (row: number): CardColor => {
    if (!region.cardColorEnabled) {
      return "none"
    }
    const value = matrix.get(row)?.get(cardColorByCol)?.trim() ?? ""
    if (!value) {
      return "none"
    }
    return inferredCardColorMap[value] ?? "none"
  }

  const renderCardBody = (row: number, interactive: boolean) => (
    <>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex w-full flex-row items-center justify-between border-b px-3 py-2 text-sm font-medium text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-2">
            {region.cardColorEnabled && cardColorForRow(row) !== "none" ? (
              <span
                className={`inline-block size-2.5 shrink-0 rounded-full ${colorDotClass[cardColorForRow(row)]}`}
              />
            ) : null}
            <span className="truncate">
              {matrix.get(row)?.get(titleCol) || `Row ${row}`}
            </span>
          </span>
          <span className="cursor-grab text-muted-foreground">
            <HugeiconsIcon icon={DragDropIcon} className="size-4" />
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-4">
        {Array.from(visibleCols).map((col) => {
          const value = matrix.get(row)?.get(col) ?? ""
          const label =
            labels[col - region.range.colStart] || toColumnLabel(col)
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{region.name}</span>
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                Settings
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Kanban Settings</DialogTitle>
                <DialogDescription>
                  Configure card title, visible fields, and optional card color
                  coding.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <label className="flex items-center justify-between gap-2 text-xs font-normal text-muted-foreground">
                  <span>Card title field</span>
                  <select
                    className="h-8 min-w-56 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                    value={titleCol}
                    onChange={(event) => {
                      const col = Number(event.target.value)
                      if (Number.isFinite(col)) {
                        void setKanbanTitleCol(region.id, col)
                      }
                    }}
                  >
                    {titleColOptions.map((col) => (
                      <option key={col} value={col}>
                        {toColumnLabel(col)} -{" "}
                        {labels[col - region.range.colStart] ||
                          toColumnLabel(col)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3">
                  <div className="text-xs font-normal text-muted-foreground">
                    Card fields
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {titleColOptions.map((col) => {
                      const checked = visibleCols.includes(col)
                      const label =
                        labels[col - region.range.colStart] ||
                        toColumnLabel(col)
                      return (
                        <label
                          key={col}
                          className="flex items-center gap-2 rounded border border-border bg-background px-2 py-1 text-xs font-normal text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...visibleCols, col]
                                : visibleCols.filter((value) => value !== col)
                              void setKanbanVisibleCols(region.id, next)
                            }}
                          />
                          <span>
                            {toColumnLabel(col)} - {label}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={region.cardColorEnabled}
                    onChange={(event) => {
                      const enabled = event.target.checked
                      if (!enabled) {
                        void setKanbanCardColorConfig(region.id, {
                          cardColorEnabled: false,
                        })
                        return
                      }
                      void setKanbanCardColorConfig(region.id, {
                        cardColorEnabled: true,
                        cardColorByCol: cardColorByCol,
                        cardColorMap: {
                          ...inferredCardColorMap,
                          ...autoAssignCardColors(cardColorValues),
                        },
                      })
                    }}
                  />
                  Enable card color dots
                </label>
                <label className="flex items-center justify-between gap-2 text-xs font-normal text-muted-foreground">
                  <span>Color by field</span>
                  <select
                    disabled={!region.cardColorEnabled}
                    className="h-8 min-w-56 rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    value={cardColorByCol}
                    onChange={(event) => {
                      const col = Number(event.target.value)
                      if (!Number.isFinite(col)) {
                        return
                      }
                      void setKanbanCardColorConfig(region.id, {
                        cardColorByCol: col,
                        cardColorMap: {
                          ...inferredCardColorMap,
                          ...autoAssignCardColors(
                            Array.from(
                              new Set(
                                rows
                                  .map(
                                    (row) =>
                                      matrix.get(row)?.get(col)?.trim() ?? ""
                                  )
                                  .filter(Boolean)
                              )
                            )
                          ),
                        },
                      })
                    }}
                  >
                    {titleColOptions.map((col) => (
                      <option key={col} value={col}>
                        {toColumnLabel(col)} -{" "}
                        {labels[col - region.range.colStart] ||
                          toColumnLabel(col)}
                      </option>
                    ))}
                  </select>
                </label>
                {region.cardColorEnabled ? (
                  <div className="rounded-md border border-border bg-muted/20 p-2">
                    <div className="mb-2 text-xs font-normal text-muted-foreground">
                      Value colors for {toColumnLabel(cardColorByCol)}
                    </div>
                    {cardColorValues.length === 0 ? (
                      <div className="text-xs font-normal text-muted-foreground">
                        No values found in this field.
                      </div>
                    ) : (
                      <div className="grid max-h-64 gap-2 overflow-auto pr-1 md:grid-cols-2">
                        {cardColorValues.map((value) => (
                          <label
                            key={value}
                            className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1 text-xs font-normal text-foreground"
                          >
                            <span className="truncate" title={value}>
                              {value}
                            </span>
                            <select
                              className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                              value={inferredCardColorMap[value] ?? "none"}
                              onChange={(event) => {
                                const next = event.target.value as CardColor
                                if (!CARD_COLORS.includes(next)) {
                                  return
                                }
                                void setKanbanCardColorConfig(region.id, {
                                  cardColorMap: {
                                    ...inferredCardColorMap,
                                    [value]: next,
                                  },
                                })
                              }}
                            >
                              {CARD_COLORS.map((color) => (
                                <option key={color} value={color}>
                                  {color}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="flex flex-row gap-3">
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
                  if (!payload) {
                    return
                  }
                  if (payload.kind === "card") {
                    void moveKanbanCard(
                      region.id,
                      payload.row,
                      status,
                      cards.length
                    )
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
                  void setKanbanStatusOrder(
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
                    <HugeiconsIcon icon={DragDropIcon} className="size-4" />
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
                          toast.error(
                            "Move or clear all cards in this status before deleting the column."
                          )
                          return
                        }
                        void setKanbanStatusOrder(
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
                    event.stopPropagation()
                    moveDroppedCard(event, status, cards.length)
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
                        const rect = event.currentTarget.getBoundingClientRect()
                        const cursorOffset = {
                          x: event.clientX - rect.left,
                          y: event.clientY - rect.top,
                        }
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
                        setDragCursorOffset(cursorOffset)
                        setDragPreview({
                          x: event.clientX - cursorOffset.x,
                          y: event.clientY - cursorOffset.y,
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
                                x: event.clientX - (dragCursorOffset?.x ?? 0),
                                y: event.clientY - (dragCursorOffset?.y ?? 0),
                              }
                            : current
                        )
                      }}
                      onDragEnd={() => {
                        setDraggingRow(null)
                        setDragPreview(null)
                        setDragCursorOffset(null)
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        moveDroppedCard(event, status, cardIndex)
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
