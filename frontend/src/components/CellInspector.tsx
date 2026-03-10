import { useMemo } from "react"

import { useSheetStore } from "@/store/sheetStore"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"

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
  const selectedRange = useSheetStore((state) => state.selectedRange)
  const selectionMode = useSheetStore((state) => state.selectionMode)
  const isMultiCellSelection =
    selectionMode === "cell" &&
    selectedRange &&
    (selectedRange.rowStart !== selectedRange.rowEnd ||
      selectedRange.colStart !== selectedRange.colEnd)

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

  const selectedLabel = useMemo(() => {
    if (isMultiCellSelection && selectedRange) {
      return `${toColumnLabel(selectedRange.colStart)}${selectedRange.rowStart}:${toColumnLabel(selectedRange.colEnd)}${selectedRange.rowEnd}`
    }
    return selectedCell.address
  }, [isMultiCellSelection, selectedCell.address, selectedRange])

  return (
    <div className="flex h-12 items-center gap-2 border-b border-border bg-card px-2">
      <Input
        value={selectedLabel}
        readOnly
        className="w-28 text-center font-mono"
      />
      <Separator orientation="vertical" className="h-6" />
      <Input value={formulaValue} readOnly className="font-mono" />
    </div>
  )
}
