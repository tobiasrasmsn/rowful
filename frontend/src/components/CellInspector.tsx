import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Redo02Icon, Undo02Icon } from "@hugeicons/core-free-icons"

import { GRID_NAVIGATE_TO_CELL_EVENT } from "@/lib/gridEvents"
import { useSheetStore } from "@/store/sheetStore"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

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

const parseCellRef = (raw: string) => {
  const match = raw.trim().match(/^([A-Za-z]+)([1-9]\d*)$/)
  if (!match) {
    return null
  }
  const col = toColumnNumber(match[1])
  const row = Number(match[2])
  if (!col || !Number.isFinite(row) || row < 1) {
    return null
  }
  return {
    row,
    col,
  }
}

const parseCellAddressOrRange = (raw: string) => {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }
  const [leftRaw, rightRaw, extra] = trimmed.split(":")
  if (extra !== undefined) {
    return null
  }
  const left = parseCellRef(leftRaw)
  if (!left) {
    return null
  }
  if (!rightRaw) {
    return {
      rowStart: left.row,
      rowEnd: left.row,
      colStart: left.col,
      colEnd: left.col,
      address: `${toColumnLabel(left.col)}${left.row}`,
    }
  }
  const right = parseCellRef(rightRaw)
  if (!right) {
    return null
  }
  const rowStart = Math.min(left.row, right.row)
  const rowEnd = Math.max(left.row, right.row)
  const colStart = Math.min(left.col, right.col)
  const colEnd = Math.max(left.col, right.col)
  return {
    rowStart,
    rowEnd,
    colStart,
    colEnd,
    address: `${toColumnLabel(colStart)}${rowStart}:${toColumnLabel(colEnd)}${rowEnd}`,
  }
}

export function CellInspector() {
  const selectedCell = useSheetStore((state) => state.selectedCell)
  const selectedRow = useSheetStore((state) => state.selectedRow)
  const selectedCol = useSheetStore((state) => state.selectedCol)
  const selectedRange = useSheetStore((state) => state.selectedRange)
  const selectionMode = useSheetStore((state) => state.selectionMode)
  const updateCell = useSheetStore((state) => state.updateCell)
  const historyPast = useSheetStore((state) => state.historyPast)
  const historyFuture = useSheetStore((state) => state.historyFuture)
  const undo = useSheetStore((state) => state.undo)
  const redo = useSheetStore((state) => state.redo)
  const isMultiCellSelection =
    selectionMode === "cell" &&
    selectedRange &&
    (selectedRange.rowStart !== selectedRange.rowEnd ||
      selectedRange.colStart !== selectedRange.colEnd)
  const isSingleCellSelection =
    selectionMode === "cell" && !isMultiCellSelection
  const editableCellValue = useMemo(() => {
    if (!isSingleCellSelection) {
      return ""
    }
    if (selectedCell.formula) {
      return `=${selectedCell.formula}`
    }
    return selectedCell.value
  }, [isSingleCellSelection, selectedCell.formula, selectedCell.value])
  const [draftValue, setDraftValue] = useState(editableCellValue)

  useEffect(() => {
    setDraftValue(editableCellValue)
  }, [editableCellValue])

  const formulaValue = useMemo(() => {
    if (selectionMode === "sheet") {
      return "Entire sheet selected"
    }
    if (selectionMode === "column") {
      return `Column ${selectedCell.address} selected`
    }
    if (selectionMode === "row") {
      return `Row ${selectedCell.address} selected`
    }
    if (isMultiCellSelection && selectedRange) {
      const cellCount =
        (selectedRange.rowEnd - selectedRange.rowStart + 1) *
        (selectedRange.colEnd - selectedRange.colStart + 1)
      return `${cellCount} cells selected`
    }
    if (selectedCell.formula) {
      return `=${selectedCell.formula}`
    }
    return selectedCell.value
  }, [
    isMultiCellSelection,
    selectedCell.address,
    selectedCell.formula,
    selectedCell.value,
    selectedRange,
    selectionMode,
  ])

  const commitDraft = useCallback(async () => {
    if (!isSingleCellSelection) {
      return
    }
    if (draftValue === editableCellValue) {
      return
    }
    await updateCell(selectedRow, selectedCol, draftValue)
  }, [
    draftValue,
    editableCellValue,
    isSingleCellSelection,
    selectedCol,
    selectedRow,
    updateCell,
  ])

  const handleInspectorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation()
      if (event.key === "Enter") {
        event.preventDefault()
        void commitDraft()
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setDraftValue(editableCellValue)
      }
    },
    [commitDraft, editableCellValue]
  )

  const selectedLabel = useMemo(() => {
    if (isMultiCellSelection && selectedRange) {
      return `${toColumnLabel(selectedRange.colStart)}${selectedRange.rowStart}:${toColumnLabel(selectedRange.colEnd)}${selectedRange.rowEnd}`
    }
    return selectedCell.address
  }, [isMultiCellSelection, selectedCell.address, selectedRange])

  const [draftAddress, setDraftAddress] = useState(selectedLabel)

  useEffect(() => {
    setDraftAddress(selectedLabel)
  }, [selectedLabel])

  const commitAddress = useCallback(() => {
    const parsed = parseCellAddressOrRange(draftAddress)
    if (!parsed) {
      setDraftAddress(selectedLabel)
      return
    }
    setDraftAddress(parsed.address)
    if (typeof window === "undefined") {
      return
    }
    window.dispatchEvent(
      new CustomEvent(GRID_NAVIGATE_TO_CELL_EVENT, {
        detail: {
          rowStart: parsed.rowStart,
          rowEnd: parsed.rowEnd,
          colStart: parsed.colStart,
          colEnd: parsed.colEnd,
        },
      })
    )
  }, [draftAddress, selectedLabel])

  const handleAddressKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation()
      if (event.key === "Enter") {
        event.preventDefault()
        commitAddress()
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setDraftAddress(selectedLabel)
      }
    },
    [commitAddress, selectedLabel]
  )

  const handleAddressChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setDraftAddress(event.target.value)
    },
    []
  )

  return (
    <div className="flex h-10 items-center border-b border-border bg-card">
      <Input
        value={draftAddress}
        onChange={handleAddressChange}
        onBlur={commitAddress}
        onKeyDown={handleAddressKeyDown}
        className="w-28 rounded-none border-none bg-transparent text-center font-mono focus-visible:ring-0 focus-visible:outline-0"
      />
      <Input
        value={isSingleCellSelection ? draftValue : formulaValue}
        readOnly={!isSingleCellSelection}
        onChange={
          isSingleCellSelection
            ? (event) => setDraftValue(event.target.value)
            : undefined
        }
        onKeyDown={isSingleCellSelection ? handleInspectorKeyDown : undefined}
        className="min-w-0 flex-1 rounded-none border-y-0 border-r-0 border-l bg-transparent font-mono focus-visible:ring-0 focus-visible:outline-0"
      />
      <div className="flex items-center gap-1 border-l border-border px-2">
        <Button
          size="icon-sm"
          variant="outline"
          onClick={() => void undo()}
          disabled={historyPast.length === 0}
          title="Undo"
          aria-label="Undo"
        >
          <HugeiconsIcon icon={Undo02Icon} className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          onClick={() => void redo()}
          disabled={historyFuture.length === 0}
          title="Redo"
          aria-label="Redo"
        >
          <HugeiconsIcon icon={Redo02Icon} className="size-4" />
        </Button>
      </div>
    </div>
  )
}
