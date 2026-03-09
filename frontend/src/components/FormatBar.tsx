import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  Bold,
  Eraser,
  Italic,
  MoreHorizontal,
  Palette,
  Redo2,
  Strikethrough,
  Type,
  Underline,
  Undo2,
  WrapText,
  Settings2,
} from "lucide-react"

import { useSheetStore } from "@/store/sheetStore"
import { sendFileTestEmail } from "@/api/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const FONT_OPTIONS = ["Arial", "Calibri", "Geist Variable", "Times New Roman", "Courier New"]
const ZOOM_OPTIONS = [50, 75, 90, 100, 110, 125, 150, 200]
const CURRENCY_OPTIONS = ["USD", "EUR", "GBP", "PLN", "JPY", "CAD"]
const NUM_FMT_TO_KIND: Record<string, string> = {
  "@": "text",
  "0.00": "number",
  "0.00%": "percent",
  "$#,##0.00": "currency",
  "yyyy-mm-dd": "date",
  "0.00E+00": "scientific",
}

export function FormatBar() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState("general")
  const workbook = useSheetStore((state) => state.workbook)
  const selectedStyle = useSheetStore((state) => state.selectedStyle)
  const fileSettings = useSheetStore((state) => state.fileSettings)
  const currency = fileSettings.currency
  const selectionMode = useSheetStore((state) => state.selectionMode)
  const historyPast = useSheetStore((state) => state.historyPast)
  const historyFuture = useSheetStore((state) => state.historyFuture)
  const zoom = useSheetStore((state) => state.zoom)
  const undo = useSheetStore((state) => state.undo)
  const redo = useSheetStore((state) => state.redo)
  const applyStyle = useSheetStore((state) => state.applyStyle)
  const clearFormatting = useSheetStore((state) => state.clearFormatting)
  const setFileCurrency = useSheetStore((state) => state.setFileCurrency)
  const saveEmailSettings = useSheetStore((state) => state.saveEmailSettings)
  const setNumberFormat = useSheetStore((state) => state.setNumberFormat)
  const setZoom = useSheetStore((state) => state.setZoom)
  const [emailDraft, setEmailDraft] = useState(fileSettings.email)
  const [testRecipient, setTestRecipient] = useState(fileSettings.email.fromEmail)
  const [isSavingEmail, setIsSavingEmail] = useState(false)
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false)

  useEffect(() => {
    if (settingsOpen) {
      setEmailDraft(fileSettings.email)
      setTestRecipient(fileSettings.email.fromEmail)
      setSettingsTab("general")
    }
  }, [fileSettings.email, settingsOpen])

  return (
    <div className="flex h-10 items-center gap-1 overflow-x-auto border-b border-border bg-muted/25 px-2 text-xs">
      <Button size="icon-sm" variant="outline" onClick={() => void undo()} disabled={historyPast.length === 0}>
        <Undo2 className="size-4" />
      </Button>
      <Button size="icon-sm" variant="outline" onClick={() => void redo()} disabled={historyFuture.length === 0}>
        <Redo2 className="size-4" />
      </Button>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <select
        className="h-7 w-16 rounded-md border border-input bg-background px-1.5 text-[11px]"
        value={String(zoom)}
        onChange={(event) => setZoom(Number(event.target.value))}
      >
        {ZOOM_OPTIONS.map((value) => (
          <option key={value} value={value}>{value}%</option>
        ))}
      </select>
      <select
        className="h-7 w-30 rounded-md border border-input bg-background px-1.5"
        value={selectedStyle.numFmt || "@"}
        onChange={(event) => {
          const value = event.target.value
          void setNumberFormat(NUM_FMT_TO_KIND[value] ?? "text")
        }}
      >
        <option value="@">Plain Text</option>
        <option value="0.00">Number</option>
        <option value="0.00%">Percent</option>
        <option value="$#,##0.00">Currency</option>
        <option value="yyyy-mm-dd">Date</option>
        <option value="0.00E+00">Scientific</option>
      </select>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={!workbook} title="File settings">
            <Settings2 className="size-4" />
            Settings
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>File Settings</DialogTitle>
            <DialogDescription>
              Configure workbook-specific preferences.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-[320px]">
            <Tabs
              orientation="vertical"
              value={settingsTab}
              onValueChange={setSettingsTab}
              className="h-full gap-4"
            >
              <TabsList variant="line" className="w-40 shrink-0 items-stretch rounded-lg border bg-muted/40 p-2">
                <TabsTrigger value="general" className="justify-start text-sm">General</TabsTrigger>
                <TabsTrigger value="communication" className="justify-start text-sm">Communication</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="mt-0 space-y-3">
                <div className="grid gap-2">
                  <label className="text-xs text-muted-foreground" htmlFor="file-currency-select">
                    Currency
                  </label>
                  <select
                    id="file-currency-select"
                    className="h-9 w-full rounded-md border border-input bg-background px-2"
                    value={currency}
                    onChange={(event) => void setFileCurrency(event.target.value)}
                    disabled={!workbook}
                  >
                    {CURRENCY_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Forced for all currency formatted cells in this file.
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="communication" className="mt-0 space-y-3">
                <div className="space-y-1">
                  <h4 className="text-sm font-medium">Email</h4>
                  <p className="text-xs text-muted-foreground">SMTP settings stored per file.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2 grid gap-1">
                    <label className="text-xs text-muted-foreground" htmlFor="smtp-host">SMTP Host</label>
                    <Input
                      id="smtp-host"
                      value={emailDraft.host}
                      onChange={(event) =>
                        setEmailDraft((current) => ({ ...current, host: event.target.value }))
                      }
                      placeholder="smtp.example.com"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground" htmlFor="smtp-port">SMTP Port</label>
                    <Input
                      id="smtp-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={String(emailDraft.port)}
                      onChange={(event) =>
                        setEmailDraft((current) => ({
                          ...current,
                          port: Number(event.target.value) || 587,
                        }))
                      }
                    />
                  </div>
                  <div className="flex items-end gap-2 pb-2">
                    <input
                      id="smtp-use-tls"
                      type="checkbox"
                      checked={emailDraft.useTLS}
                      onChange={(event) =>
                        setEmailDraft((current) => ({ ...current, useTLS: event.target.checked }))
                      }
                    />
                    <label className="text-xs text-muted-foreground" htmlFor="smtp-use-tls">Use TLS</label>
                  </div>
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground" htmlFor="smtp-username">Username</label>
                    <Input
                      id="smtp-username"
                      value={emailDraft.username}
                      onChange={(event) =>
                        setEmailDraft((current) => ({ ...current, username: event.target.value }))
                      }
                      placeholder="smtp-user"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground" htmlFor="smtp-password">Password</label>
                    <Input
                      id="smtp-password"
                      type="password"
                      value={emailDraft.password}
                      onChange={(event) =>
                        setEmailDraft((current) => ({ ...current, password: event.target.value }))
                      }
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground" htmlFor="smtp-from-name">From Name</label>
                    <Input
                      id="smtp-from-name"
                      value={emailDraft.fromName}
                      onChange={(event) =>
                        setEmailDraft((current) => ({ ...current, fromName: event.target.value }))
                      }
                      placeholder="Finance Bot"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground" htmlFor="smtp-from-email">From Email</label>
                    <Input
                      id="smtp-from-email"
                      type="email"
                      value={emailDraft.fromEmail}
                      onChange={(event) =>
                        setEmailDraft((current) => ({ ...current, fromEmail: event.target.value }))
                      }
                      placeholder="noreply@example.com"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="flex w-full items-end justify-between gap-2">
                    <div className="grid flex-1 gap-1">
                      <label className="text-xs text-muted-foreground" htmlFor="smtp-test-recipient">
                        Test recipient
                      </label>
                      <Input
                        id="smtp-test-recipient"
                        type="email"
                        value={testRecipient}
                        onChange={(event) => setTestRecipient(event.target.value)}
                        placeholder="you@example.com"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        if (!workbook) {
                          return
                        }
                        setIsSendingTestEmail(true)
                        try {
                          await saveEmailSettings(emailDraft)
                          await sendFileTestEmail(workbook.id, { to: testRecipient.trim() })
                          toast.success("Test email sent.")
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Failed to send test email")
                        } finally {
                          setIsSendingTestEmail(false)
                        }
                      }}
                      disabled={!workbook || isSendingTestEmail || isSavingEmail}
                    >
                      {isSendingTestEmail ? "Sending..." : "Send Test Email"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={async () => {
                        setIsSavingEmail(true)
                        try {
                          await saveEmailSettings(emailDraft)
                        } finally {
                          setIsSavingEmail(false)
                        }
                      }}
                      disabled={!workbook || isSavingEmail || isSendingTestEmail}
                    >
                      {isSavingEmail ? "Saving..." : "Save Email Settings"}
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      <select
        className="h-7 w-30 rounded-md border border-input bg-background px-1.5"
        value={selectedStyle.fontFamily || "Calibri"}
        onChange={(event) => void applyStyle({ fontFamily: event.target.value })}
        title="Font family"
      >
        {FONT_OPTIONS.map((font) => (
          <option key={font} value={font}>{font}</option>
        ))}
      </select>

      <input
        className="h-7 w-12 rounded-md border border-input bg-background px-1.5 text-center"
        type="number"
        min={8}
        max={72}
        value={selectedStyle.fontSize || 11}
        onChange={(event) => void applyStyle({ fontSize: Number(event.target.value) || 11 })}
        title="Font size"
      />

      <Button
        size="icon-sm"
        variant={selectedStyle.bold ? "default" : "outline"}
        onClick={() => void applyStyle({ bold: !selectedStyle.bold })}
        title="Bold"
      >
        <Bold className="size-4" />
      </Button>
      <Button
        size="icon-sm"
        variant={selectedStyle.italic ? "default" : "outline"}
        onClick={() => void applyStyle({ italic: !selectedStyle.italic })}
        title="Italic"
      >
        <Italic className="size-4" />
      </Button>
      <Button
        size="icon-sm"
        variant={selectedStyle.underline ? "default" : "outline"}
        onClick={() => void applyStyle({ underline: !selectedStyle.underline })}
        title="Underline"
      >
        <Underline className="size-4" />
      </Button>
      <Button
        size="icon-sm"
        variant={selectedStyle.strike ? "default" : "outline"}
        onClick={() => void applyStyle({ strike: !selectedStyle.strike })}
        title="Strikethrough"
      >
        <Strikethrough className="size-4" />
      </Button>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <label className="relative inline-flex">
        <Button size="icon-sm" variant="outline" title="Text color">
          <Type className="size-4" />
          <span
            className="absolute right-1 bottom-1 size-2 rounded-full border border-border"
            style={{ backgroundColor: selectedStyle.fontColor || "#000000" }}
          />
        </Button>
        <input
          className="absolute inset-0 cursor-pointer opacity-0"
          type="color"
          value={selectedStyle.fontColor || "#000000"}
          onChange={(event) => void applyStyle({ fontColor: event.target.value })}
          title="Text color"
        />
      </label>
      <label className="relative inline-flex">
        <Button size="icon-sm" variant="outline" title="Fill color">
          <Palette className="size-4" />
          <span
            className="absolute right-1 bottom-1 size-2 rounded-full border border-border"
            style={{ backgroundColor: selectedStyle.fillColor || "#ffffff" }}
          />
        </Button>
        <input
          className="absolute inset-0 cursor-pointer opacity-0"
          type="color"
          value={selectedStyle.fillColor || "#ffffff"}
          onChange={(event) => void applyStyle({ fillColor: event.target.value })}
          title="Fill color"
        />
      </label>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="outline" title="More formatting">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Text Alignment</DropdownMenuLabel>
          <DropdownMenuItem
            className={selectedStyle.hAlign === "left" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ hAlign: "left" })}
          >
            Left
          </DropdownMenuItem>
          <DropdownMenuItem
            className={selectedStyle.hAlign === "center" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ hAlign: "center" })}
          >
            Center
          </DropdownMenuItem>
          <DropdownMenuItem
            className={selectedStyle.hAlign === "right" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ hAlign: "right" })}
          >
            Right
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Vertical</DropdownMenuLabel>
          <DropdownMenuItem
            className={selectedStyle.vAlign === "top" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ vAlign: "top" })}
          >
            Top
          </DropdownMenuItem>
          <DropdownMenuItem
            className={selectedStyle.vAlign === "center" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ vAlign: "center" })}
          >
            Middle
          </DropdownMenuItem>
          <DropdownMenuItem
            className={selectedStyle.vAlign === "bottom" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ vAlign: "bottom" })}
          >
            Bottom
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Borders</DropdownMenuLabel>
          <DropdownMenuItem
            className={selectedStyle.border === "none" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ border: "none" })}
          >
            None
          </DropdownMenuItem>
          <DropdownMenuItem
            className={selectedStyle.border === "all" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ border: "all" })}
          >
            All
          </DropdownMenuItem>
          <DropdownMenuItem
            className={selectedStyle.border === "outer" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ border: "outer" })}
          >
            Outer
          </DropdownMenuItem>
          <DropdownMenuItem
            className={selectedStyle.border === "inner" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ border: "inner" })}
          >
            Inner
          </DropdownMenuItem>
          <DropdownMenuItem
            className={selectedStyle.border === "bottom" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ border: "bottom" })}
          >
            Bottom
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Overflow</DropdownMenuLabel>
          <DropdownMenuItem
            className={selectedStyle.overflow === "clip" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ overflow: "clip" })}
          >
            Clip
          </DropdownMenuItem>
          <DropdownMenuItem
            className={selectedStyle.overflow === "wrap" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ overflow: "wrap" })}
          >
            Wrap
          </DropdownMenuItem>
          <DropdownMenuItem
            className={selectedStyle.overflow === "overflow" ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ overflow: "overflow" })}
          >
            Overflow
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            className={selectedStyle.wrapText ? "font-semibold" : undefined}
            onClick={() => void applyStyle({ wrapText: !selectedStyle.wrapText })}
          >
            <WrapText className="mr-2 size-4" />
            {selectedStyle.wrapText ? "Disable Wrap Text" : "Enable Wrap Text"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        size="icon-sm"
        variant={selectedStyle.wrapText ? "default" : "outline"}
        onClick={() => void applyStyle({ wrapText: !selectedStyle.wrapText })}
        title="Wrap text"
      >
        <WrapText className="size-4" />
      </Button>

      <Button
        size="icon-sm"
        variant="outline"
        onClick={() => void clearFormatting()}
        title="Clear formatting"
      >
        <Eraser className="size-4" />
      </Button>

      <span className="ml-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {selectionMode === "sheet"
          ? "Sheet Selected"
          : selectionMode === "column"
            ? "Column Selected"
            : "Cell Selected"}
      </span>
    </div>
  )
}
