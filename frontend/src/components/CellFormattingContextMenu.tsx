import {
  useMemo,
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
import { useSheetStore } from "@/store/sheetStore"
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

export function CellFormattingPanel() {
  const { resolvedTheme } = useTheme()
  const selectedStyle = useSheetStore((state) => state.selectedStyle)
  const applyStyle = useSheetStore((state) => state.applyStyle)
  const setNumberFormat = useSheetStore((state) => state.setNumberFormat)
  const themeColorClassName =
    resolvedTheme === "dark" ? "dark text-foreground" : "text-foreground"
  const themeSurfaceClassName =
    resolvedTheme === "dark" ? "dark bg-background" : "bg-background"
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
  const [fontSizeDraft, setFontSizeDraft] = useState(
    String(selectedStyle.fontSize || 11)
  )
  const currentFontSize = selectedStyle.fontSize || 11
  const currentNumberFormat = getNumberFormatKind(selectedStyle.numFmt)

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

  const applyAlignment = (value: "left" | "center" | "right") => {
    void applyStyle({ hAlign: value })
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
