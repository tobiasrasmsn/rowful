import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react"

import { useSheetStore } from "@/store/sheetStore"
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

export function CellInspector() {
  const selectedCell = useSheetStore((state) => state.selectedCell)
  const selectedRow = useSheetStore((state) => state.selectedRow)
  const selectedCol = useSheetStore((state) => state.selectedCol)
  const selectedRange = useSheetStore((state) => state.selectedRange)
  const selectionMode = useSheetStore((state) => state.selectionMode)
  const updateCell = useSheetStore((state) => state.updateCell)
  const isMultiCellSelection =
    selectionMode === "cell" &&
    selectedRange &&
    (selectedRange.rowStart !== selectedRange.rowEnd ||
      selectedRange.colStart !== selectedRange.colEnd)
  const isSingleCellSelection = selectionMode === "cell" && !isMultiCellSelection
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

  return (
    <div className="flex h-fit items-center border-b border-border bg-card">
      <Input
        value={selectedLabel}
        readOnly
        className="w-28 rounded-none border-none bg-transparent text-center font-mono focus-visible:ring-0 focus-visible:outline-0"
      />
      <Input
        value={isSingleCellSelection ? draftValue : formulaValue}
        readOnly={!isSingleCellSelection}
        onChange={
          isSingleCellSelection ? (event) => setDraftValue(event.target.value) : undefined
        }
        onKeyDown={isSingleCellSelection ? handleInspectorKeyDown : undefined}
        className="rounded-none border-y-0 border-r-0 border-l bg-transparent font-mono focus-visible:ring-0 focus-visible:outline-0"
      />
    </div>
  )
}
