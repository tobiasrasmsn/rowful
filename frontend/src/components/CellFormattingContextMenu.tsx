import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Italic,
  Strikethrough,
  Underline,
} from "lucide-react"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuShortcut,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import { Separator } from "@/components/ui/separator"
import { useSheetStore } from "@/store/sheetStore"
import type { SelectionTarget } from "@/types/sheet"
import { Kbd } from "./ui/kbd"

const NUMBER_FORMAT_OPTIONS = [
  { value: "text", label: "Plain Text" },
  { value: "number", label: "Number" },
  { value: "percent", label: "Percent" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "scientific", label: "Scientific" },
] as const

const ALIGNMENT_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
] as const

const NUM_FMT_TO_KIND: Record<string, string> = {
  "@": "text",
  "0.00": "number",
  "0.00%": "percent",
  "$#,##0.00": "currency",
  "yyyy-mm-dd": "date",
  "0.00E+00": "scientific",
}

const rgbToHex = ([red, green, blue]: [number, number, number]) =>
  `#${[red, green, blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`

const FALLBACK_TEXT_COLOR = rgbToHex([17, 24, 39])
const FALLBACK_SURFACE_COLOR = rgbToHex([255, 255, 255])

const extractHexColor = (value: string) => {
  const components = value.match(/[\d.]+/g)
  if (!components || components.length < 3) {
    return null
  }

  return rgbToHex([
    Math.round(Number(components[0])),
    Math.round(Number(components[1])),
    Math.round(Number(components[2])),
  ])
}

const resolveThemeColor = (
  className: string,
  property: "color" | "backgroundColor",
  fallback: string
) => {
  if (typeof document === "undefined") {
    return fallback
  }

  const element = document.createElement("div")
  element.className = className
  element.style.position = "absolute"
  element.style.pointerEvents = "none"
  element.style.opacity = "0"
  document.body.appendChild(element)
  const resolved = extractHexColor(getComputedStyle(element)[property])
  element.remove()

  return resolved ?? fallback
}

const stopEvent = (event: SyntheticEvent) => {
  event.stopPropagation()
}

const handleSizeInputKeyDown = (
  event: KeyboardEvent<HTMLInputElement>,
  commit: () => void
) => {
  event.stopPropagation()
  if (event.key === "Enter") {
    event.preventDefault()
    commit()
  }
  if (event.key === "Escape") {
    event.preventDefault()
    ;(event.currentTarget as HTMLInputElement).blur()
  }
}

const getNumberFormatKind = (numFmt?: string) =>
  NUM_FMT_TO_KIND[numFmt ?? "@"] ?? "text"

const TOOLBAR_SECTION_CLASS_NAME = "flex shrink-0 items-center gap-1.5"
const TOOLBAR_LABEL_CLASS_NAME = "text-xs font-medium text-muted-foreground"
const TOOLBAR_FIELD_CLASS_NAME =
  "h-7 rounded-md border border-input bg-background px-2.5 text-[13px] outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
const TOOLBAR_ICON_BUTTON_CLASS_NAME = "h-7 w-7 rounded-md px-0"
const TOOLBAR_ACTION_BUTTON_CLASS_NAME = "h-7 rounded-md px-2.5 text-xs"
const TOOLBAR_TOGGLE_CLASS_NAME =
  "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
const TOOLBAR_TOGGLE_ACTIVE_CLASS_NAME =
  "border-border bg-muted text-foreground hover:bg-muted hover:text-foreground"
const TOOLBAR_COLOR_SWATCH_CLASS_NAME =
  "relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-input bg-background"

const getCurrentSelectionTarget = (): SelectionTarget => {
  const state = useSheetStore.getState()
  if (state.selectionMode === "sheet") {
    return { mode: "sheet" }
  }
  if (state.selectionMode === "row") {
    return { mode: "row", row: state.selectedRow }
  }
  if (state.selectionMode === "column") {
    return { mode: "column", col: state.selectedCol }
  }
  const range = state.selectedRange
  if (
    range &&
    (range.rowStart !== range.rowEnd || range.colStart !== range.colEnd)
  ) {
    return {
      mode: "range",
      range: {
        rowStart: Math.min(range.rowStart, range.rowEnd),
        rowEnd: Math.max(range.rowStart, range.rowEnd),
        colStart: Math.min(range.colStart, range.colEnd),
        colEnd: Math.max(range.colStart, range.colEnd),
      },
    }
  }
  return { mode: "cell", row: state.selectedRow, col: state.selectedCol }
}

const useCellFormattingControls = () => {
  const { resolvedTheme } = useTheme()
  const selectedStyle = useSheetStore((state) => state.selectedStyle)
  const applyStyle = useSheetStore((state) => state.applyStyle)
  const setNumberFormat = useSheetStore((state) => state.setNumberFormat)
  const clearFormatting = useSheetStore((state) => state.clearFormatting)
  const themeColorClassName =
    resolvedTheme === "light"
      ? "text-foreground"
      : `${resolvedTheme} text-foreground`
  const themeSurfaceClassName =
    resolvedTheme === "light"
      ? "bg-background"
      : `${resolvedTheme} bg-background`
  const defaultFontColor = useMemo(
    () => resolveThemeColor(themeColorClassName, "color", FALLBACK_TEXT_COLOR),
    [themeColorClassName]
  )
  const defaultFillColor = useMemo(
    () =>
      resolveThemeColor(
        themeSurfaceClassName,
        "backgroundColor",
        FALLBACK_SURFACE_COLOR
      ),
    [themeSurfaceClassName]
  )
  const currentFontSize = selectedStyle.fontSize || 11
  const currentNumberFormat = getNumberFormatKind(selectedStyle.numFmt)

  const applyAlignment = (value: "left" | "center" | "right") => {
    void applyStyle({ hAlign: value })
  }

  return {
    selectedStyle,
    applyStyle,
    setNumberFormat,
    clearFormatting,
    defaultFontColor,
    defaultFillColor,
    currentFontSize,
    currentNumberFormat,
    applyAlignment,
  }
}

export function CellFormattingPanel() {
  const {
    selectedStyle,
    applyStyle,
    setNumberFormat,
    defaultFontColor,
    defaultFillColor,
    currentFontSize,
    currentNumberFormat,
    applyAlignment,
  } = useCellFormattingControls()
  const [fontSizeDraft, setFontSizeDraft] = useState(
    String(currentFontSize)
  )

  useEffect(() => {
    setFontSizeDraft(String(currentFontSize))
  }, [currentFontSize])

  const commitFontSize = () => {
    const next = Number(fontSizeDraft)
    if (!Number.isFinite(next) || next < 1) {
      setFontSizeDraft(String(currentFontSize))
      return
    }
    void applyStyle({ fontSize: next })
  }

  const bumpFontSize = (delta: number) => {
    const next = Math.max(1, currentFontSize + delta)
    setFontSizeDraft(String(next))
    void applyStyle({ fontSize: next })
  }

  return (
    <div
      className="space-y-3 p-3"
      onClick={stopEvent}
      onPointerDown={stopEvent}
      onKeyDown={stopEvent}
    >
      <div className="space-y-1">
        <ContextMenuLabel className="px-0 py-0">Cell Type</ContextMenuLabel>
        <select
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={currentNumberFormat}
          onChange={(event) => void setNumberFormat(event.target.value)}
        >
          {NUMBER_FORMAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <ContextMenuLabel className="px-0 py-0">Font Size</ContextMenuLabel>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            onClick={() => bumpFontSize(-1)}
          >
            -
          </Button>
          <input
            className="h-8 w-16 rounded-md border border-input bg-background px-2 text-center text-sm"
            type="number"
            min={1}
            value={fontSizeDraft}
            onChange={(event) => setFontSizeDraft(event.target.value)}
            onBlur={commitFontSize}
            onKeyDown={(event) => handleSizeInputKeyDown(event, commitFontSize)}
          />
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            onClick={() => bumpFontSize(1)}
          >
            +
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <ContextMenuLabel className="px-0 py-0">Style</ContextMenuLabel>
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="xs"
            variant={selectedStyle.bold ? "default" : "outline"}
            onClick={() => void applyStyle({ bold: !selectedStyle.bold })}
          >
            Bold
          </Button>
          <Button
            type="button"
            size="xs"
            variant={selectedStyle.italic ? "default" : "outline"}
            onClick={() => void applyStyle({ italic: !selectedStyle.italic })}
          >
            Italic
          </Button>
          <Button
            type="button"
            size="xs"
            variant={selectedStyle.underline ? "default" : "outline"}
            onClick={() =>
              void applyStyle({ underline: !selectedStyle.underline })
            }
          >
            Underline
          </Button>
          <Button
            type="button"
            size="xs"
            variant={selectedStyle.strike ? "default" : "outline"}
            onClick={() => void applyStyle({ strike: !selectedStyle.strike })}
          >
            Strike
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <ContextMenuLabel className="px-0 py-0">Text Color</ContextMenuLabel>
          <Button
            type="button"
            size="xs"
            variant={selectedStyle.fontColor ? "outline" : "default"}
            onClick={() => void applyStyle({ fontColor: "" })}
          >
            Theme
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5">
          <span className="text-sm">
            {selectedStyle.fontColor?.toUpperCase() || "Theme default"}
          </span>
          <input
            className="h-8 w-10 cursor-pointer rounded border border-input bg-background p-1"
            type="color"
            value={selectedStyle.fontColor || defaultFontColor}
            onChange={(event) =>
              void applyStyle({ fontColor: event.target.value })
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <ContextMenuLabel className="px-0 py-0">Background</ContextMenuLabel>
          <Button
            type="button"
            size="xs"
            variant={selectedStyle.fillColor ? "outline" : "default"}
            onClick={() => void applyStyle({ fillColor: "" })}
          >
            None
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5">
          <span className="text-sm">
            {selectedStyle.fillColor?.toUpperCase() || "No fill"}
          </span>
          <input
            className="h-8 w-10 cursor-pointer rounded border border-input bg-background p-1"
            type="color"
            value={selectedStyle.fillColor || defaultFillColor}
            onChange={(event) =>
              void applyStyle({ fillColor: event.target.value })
            }
          />
        </div>
      </div>

      <div className="space-y-1">
        <ContextMenuLabel className="px-0 py-0">Alignment</ContextMenuLabel>
        <div className="flex gap-1">
          {ALIGNMENT_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="xs"
              variant={
                selectedStyle.hAlign === option.value ? "default" : "outline"
              }
              className="flex-1"
              onClick={() =>
                applyAlignment(option.value as "left" | "center" | "right")
              }
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CellFormattingToolbar() {
  const {
    selectedStyle,
    defaultFontColor,
    defaultFillColor,
    currentFontSize,
    currentNumberFormat,
  } = useCellFormattingControls()
  const applyStyleToTarget = useSheetStore((state) => state.applyStyleToTarget)
  const setNumberFormatForTarget = useSheetStore(
    (state) => state.setNumberFormatForTarget
  )
  const clearFormattingForTarget = useSheetStore(
    (state) => state.clearFormattingForTarget
  )
  const [fontSizeDraft, setFontSizeDraft] = useState(
    String(currentFontSize)
  )
  const selectionTargetRef = useRef<SelectionTarget | null>(null)

  useEffect(() => {
    setFontSizeDraft(String(currentFontSize))
  }, [currentFontSize])

  const snapshotSelectionTarget = () => {
    selectionTargetRef.current = getCurrentSelectionTarget()
  }

  const getFrozenSelectionTarget = () =>
    selectionTargetRef.current ?? getCurrentSelectionTarget()

  const commitFontSize = () => {
    const next = Number(fontSizeDraft)
    if (!Number.isFinite(next) || next < 1) {
      setFontSizeDraft(String(currentFontSize))
      return
    }
    void applyStyleToTarget(getFrozenSelectionTarget(), { fontSize: next })
  }

  const bumpFontSize = (delta: number) => {
    const next = Math.max(1, currentFontSize + delta)
    setFontSizeDraft(String(next))
    void applyStyleToTarget(getFrozenSelectionTarget(), { fontSize: next })
  }

  return (
    <div
      className="border-b border-border bg-card px-3 py-2"
      onPointerDownCapture={snapshotSelectionTarget}
    >
      <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className={TOOLBAR_SECTION_CLASS_NAME}>
          <span className={TOOLBAR_LABEL_CLASS_NAME}>Type</span>
          <select
            aria-label="Cell type"
            className={`${TOOLBAR_FIELD_CLASS_NAME} min-w-[8.75rem]`}
            value={currentNumberFormat}
            onChange={(event) =>
              void setNumberFormatForTarget(
                getFrozenSelectionTarget(),
                event.target.value
              )
            }
          >
            {NUMBER_FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <Separator orientation="vertical" className="h-5 shrink-0" />

        <div className={TOOLBAR_SECTION_CLASS_NAME}>
          <span className={TOOLBAR_LABEL_CLASS_NAME}>Size</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Decrease font size"
            className={`${TOOLBAR_ICON_BUTTON_CLASS_NAME} ${TOOLBAR_TOGGLE_CLASS_NAME}`}
            onClick={() => bumpFontSize(-1)}
          >
            -
          </Button>
          <input
            aria-label="Font size"
            className={`${TOOLBAR_FIELD_CLASS_NAME} w-14 px-2 text-center tabular-nums`}
            type="number"
            min={1}
            value={fontSizeDraft}
            onChange={(event) => setFontSizeDraft(event.target.value)}
            onBlur={commitFontSize}
            onKeyDown={(event) => handleSizeInputKeyDown(event, commitFontSize)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Increase font size"
            className={`${TOOLBAR_ICON_BUTTON_CLASS_NAME} ${TOOLBAR_TOGGLE_CLASS_NAME}`}
            onClick={() => bumpFontSize(1)}
          >
            +
          </Button>
        </div>

        <Separator orientation="vertical" className="h-5 shrink-0" />

        <div className={TOOLBAR_SECTION_CLASS_NAME}>
          <Button
            type="button"
            size="sm"
            variant={selectedStyle.bold ? "default" : "outline"}
            className={`${TOOLBAR_ICON_BUTTON_CLASS_NAME} ${
              selectedStyle.bold
                ? TOOLBAR_TOGGLE_ACTIVE_CLASS_NAME
                : TOOLBAR_TOGGLE_CLASS_NAME
            }`}
            aria-label="Bold"
            title="Bold"
            onClick={() =>
              void applyStyleToTarget(getFrozenSelectionTarget(), {
                bold: !selectedStyle.bold,
              })
            }
          >
            <Bold />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={selectedStyle.italic ? "default" : "outline"}
            className={`${TOOLBAR_ICON_BUTTON_CLASS_NAME} ${
              selectedStyle.italic
                ? TOOLBAR_TOGGLE_ACTIVE_CLASS_NAME
                : TOOLBAR_TOGGLE_CLASS_NAME
            }`}
            aria-label="Italic"
            title="Italic"
            onClick={() =>
              void applyStyleToTarget(getFrozenSelectionTarget(), {
                italic: !selectedStyle.italic,
              })
            }
          >
            <Italic />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={selectedStyle.underline ? "default" : "outline"}
            className={`${TOOLBAR_ICON_BUTTON_CLASS_NAME} ${
              selectedStyle.underline
                ? TOOLBAR_TOGGLE_ACTIVE_CLASS_NAME
                : TOOLBAR_TOGGLE_CLASS_NAME
            }`}
            aria-label="Underline"
            title="Underline"
            onClick={() =>
              void applyStyleToTarget(getFrozenSelectionTarget(), {
                underline: !selectedStyle.underline,
              })
            }
          >
            <Underline />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={selectedStyle.strike ? "default" : "outline"}
            className={`${TOOLBAR_ICON_BUTTON_CLASS_NAME} ${
              selectedStyle.strike
                ? TOOLBAR_TOGGLE_ACTIVE_CLASS_NAME
                : TOOLBAR_TOGGLE_CLASS_NAME
            }`}
            aria-label="Strikethrough"
            title="Strikethrough"
            onClick={() =>
              void applyStyleToTarget(getFrozenSelectionTarget(), {
                strike: !selectedStyle.strike,
              })
            }
          >
            <Strikethrough />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-5 shrink-0" />

        <div className={TOOLBAR_SECTION_CLASS_NAME}>
          <span className={TOOLBAR_LABEL_CLASS_NAME}>Text</span>
          <label className={TOOLBAR_COLOR_SWATCH_CLASS_NAME}>
            <span
              aria-hidden="true"
              className="h-4 w-4 rounded-sm border border-black/10"
              style={{
                backgroundColor: selectedStyle.fontColor || defaultFontColor,
              }}
            />
            <input
              aria-label="Text color"
              className="absolute inset-0 cursor-pointer opacity-0"
              type="color"
              value={selectedStyle.fontColor || defaultFontColor}
              onChange={(event) =>
                void applyStyleToTarget(getFrozenSelectionTarget(), {
                  fontColor: event.target.value,
                })
              }
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant={selectedStyle.fontColor ? "outline" : "default"}
            className={`${TOOLBAR_ACTION_BUTTON_CLASS_NAME} ${
              selectedStyle.fontColor
                ? TOOLBAR_TOGGLE_CLASS_NAME
                : TOOLBAR_TOGGLE_ACTIVE_CLASS_NAME
            }`}
            onClick={() =>
              void applyStyleToTarget(getFrozenSelectionTarget(), {
                fontColor: "",
              })
            }
          >
            Theme
          </Button>
        </div>

        <Separator orientation="vertical" className="h-5 shrink-0" />

        <div className={TOOLBAR_SECTION_CLASS_NAME}>
          <span className={TOOLBAR_LABEL_CLASS_NAME}>Fill</span>
          <label className={TOOLBAR_COLOR_SWATCH_CLASS_NAME}>
            <span
              aria-hidden="true"
              className="h-4 w-4 rounded-sm border border-black/10"
              style={{
                backgroundColor: selectedStyle.fillColor || defaultFillColor,
              }}
            />
            <input
              aria-label="Fill color"
              className="absolute inset-0 cursor-pointer opacity-0"
              type="color"
              value={selectedStyle.fillColor || defaultFillColor}
              onChange={(event) =>
                void applyStyleToTarget(getFrozenSelectionTarget(), {
                  fillColor: event.target.value,
                })
              }
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant={selectedStyle.fillColor ? "outline" : "default"}
            className={`${TOOLBAR_ACTION_BUTTON_CLASS_NAME} ${
              selectedStyle.fillColor
                ? TOOLBAR_TOGGLE_CLASS_NAME
                : TOOLBAR_TOGGLE_ACTIVE_CLASS_NAME
            }`}
            onClick={() =>
              void applyStyleToTarget(getFrozenSelectionTarget(), {
                fillColor: "",
              })
            }
          >
            None
          </Button>
        </div>

        <Separator orientation="vertical" className="h-5 shrink-0" />

        <div className={TOOLBAR_SECTION_CLASS_NAME}>
          {ALIGNMENT_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={
                selectedStyle.hAlign === option.value ? "default" : "outline"
              }
              className={`${TOOLBAR_ICON_BUTTON_CLASS_NAME} ${
                selectedStyle.hAlign === option.value
                  ? TOOLBAR_TOGGLE_ACTIVE_CLASS_NAME
                  : TOOLBAR_TOGGLE_CLASS_NAME
              }`}
              aria-label={`Align ${option.label.toLowerCase()}`}
              title={`Align ${option.label}`}
              onClick={() =>
                void applyStyleToTarget(getFrozenSelectionTarget(), {
                  hAlign: option.value as "left" | "center" | "right",
                })
              }
            >
              {option.value === "left" ? (
                <AlignLeft />
              ) : option.value === "center" ? (
                <AlignCenter />
              ) : (
                <AlignRight />
              )}
            </Button>
          ))}
        </div>

        <Separator orientation="vertical" className="h-5 shrink-0" />

        <Button
          type="button"
          size="sm"
          variant="outline"
          className={`${TOOLBAR_ACTION_BUTTON_CLASS_NAME} ${TOOLBAR_TOGGLE_CLASS_NAME} shrink-0`}
          onClick={() =>
            void clearFormattingForTarget(getFrozenSelectionTarget())
          }
        >
          <Eraser />
          Clear
        </Button>
      </div>
    </div>
  )
}

type CellFormattingContextMenuProps = {
  shortcutLabel?: string
}

export function CellFormattingContextMenu({
  shortcutLabel,
}: CellFormattingContextMenuProps) {
  const clearFormatting = useSheetStore((state) => state.clearFormatting)

  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <span>Formatting</span>
          {shortcutLabel ? (
            <ContextMenuShortcut className="mr-2">
              <Kbd>{shortcutLabel}</Kbd>
            </ContextMenuShortcut>
          ) : null}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-72 p-0">
          <CellFormattingPanel />
          <ContextMenuSeparator />
          <ContextMenuItem
            inset
            onSelect={(event) => {
              event.preventDefault()
              void clearFormatting()
            }}
          >
            Clear Formatting
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  )
}
