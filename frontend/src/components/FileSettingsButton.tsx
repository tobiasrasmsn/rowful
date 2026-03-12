import { useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Settings02Icon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"

import { sendFileTestEmail } from "@/api/client"
import { useSheetStore } from "@/store/sheetStore"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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

const FONT_OPTIONS = [
  "Arial",
  "Calibri",
  "Geist Variable",
  "Times New Roman",
  "Courier New",
]

const CURRENCY_OPTIONS = ["USD", "EUR", "GBP", "PLN", "JPY", "CAD"]

type FileSettingsButtonProps = {
  className?: string
}

export function FileSettingsButton({ className }: FileSettingsButtonProps) {
  const workbook = useSheetStore((state) => state.workbook)
  const fileSettings = useSheetStore((state) => state.fileSettings)
  const currency = fileSettings.currency
  const setFileCurrency = useSheetStore((state) => state.setFileCurrency)
  const saveEmailSettings = useSheetStore((state) => state.saveEmailSettings)
  const sheetFontFamily = useSheetStore((state) => state.sheetFontFamily)
  const setSheetFontFamily = useSheetStore((state) => state.setSheetFontFamily)
  const [open, setOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState("general")
  const [emailDraft, setEmailDraft] = useState(fileSettings.email)
  const [testRecipient, setTestRecipient] = useState(fileSettings.email.fromEmail)
  const [isSavingEmail, setIsSavingEmail] = useState(false)
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    setEmailDraft(fileSettings.email)
    setTestRecipient(fileSettings.email.fromEmail)
    setSettingsTab("general")
  }, [fileSettings.email, open])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={!workbook}
          title="File settings"
          aria-label="File settings"
          className={cn(
            "h-7 gap-2 rounded-t-lg rounded-b-none border border-b-0 border-border bg-muted/35 px-4 py-1 text-sm shadow-none! hover:bg-muted/55",
            open && "-mb-px bg-card hover:bg-card",
            className
          )}
        >
          <HugeiconsIcon icon={Settings02Icon} className="size-4" />
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
            <TabsList
              variant="line"
              className="w-40 shrink-0 items-stretch rounded-lg border bg-muted/40 p-2"
            >
              <TabsTrigger value="general" className="justify-start text-sm">
                General
              </TabsTrigger>
              <TabsTrigger value="communication" className="justify-start text-sm">
                Communication
              </TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="mt-0 space-y-3">
              <div className="grid gap-2">
                <label
                  className="text-xs text-muted-foreground"
                  htmlFor="file-currency-select"
                >
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
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Forced for all currency formatted cells in this file.
                </p>
              </div>
              <div className="grid gap-2">
                <label
                  className="text-xs text-muted-foreground"
                  htmlFor="grid-font-family-select"
                >
                  Grid font
                </label>
                <select
                  id="grid-font-family-select"
                  className="h-9 w-full rounded-md border border-input bg-background px-2"
                  value={sheetFontFamily}
                  onChange={(event) => setSheetFontFamily(event.target.value)}
                  disabled={!workbook}
                >
                  {FONT_OPTIONS.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Forced visually for all cells in this sheet.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="communication" className="mt-0 space-y-3">
              <div className="space-y-1">
                <h4 className="text-sm font-medium">Email</h4>
                <p className="text-xs text-muted-foreground">
                  SMTP settings stored per file.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2 grid gap-1">
                  <label className="text-xs text-muted-foreground" htmlFor="smtp-host">
                    SMTP Host
                  </label>
                  <Input
                    id="smtp-host"
                    value={emailDraft.host}
                    onChange={(event) =>
                      setEmailDraft((current) => ({
                        ...current,
                        host: event.target.value,
                      }))
                    }
                    placeholder="smtp.example.com"
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-muted-foreground" htmlFor="smtp-port">
                    SMTP Port
                  </label>
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
                      setEmailDraft((current) => ({
                        ...current,
                        useTLS: event.target.checked,
                      }))
                    }
                  />
                  <label className="text-xs text-muted-foreground" htmlFor="smtp-use-tls">
                    Use TLS
                  </label>
                </div>
                <div className="grid gap-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="smtp-username"
                  >
                    Username
                  </label>
                  <Input
                    id="smtp-username"
                    value={emailDraft.username}
                    onChange={(event) =>
                      setEmailDraft((current) => ({
                        ...current,
                        username: event.target.value,
                      }))
                    }
                    placeholder="smtp-user"
                  />
                </div>
                <div className="grid gap-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="smtp-password"
                  >
                    Password
                  </label>
                  <Input
                    id="smtp-password"
                    type="password"
                    value={emailDraft.password}
                    onChange={(event) =>
                      setEmailDraft((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    placeholder="••••••••"
                  />
                </div>
                <div className="grid gap-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="smtp-from-name"
                  >
                    From Name
                  </label>
                  <Input
                    id="smtp-from-name"
                    value={emailDraft.fromName}
                    onChange={(event) =>
                      setEmailDraft((current) => ({
                        ...current,
                        fromName: event.target.value,
                      }))
                    }
                    placeholder="Finance Bot"
                  />
                </div>
                <div className="grid gap-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="smtp-from-email"
                  >
                    From Email
                  </label>
                  <Input
                    id="smtp-from-email"
                    type="email"
                    value={emailDraft.fromEmail}
                    onChange={(event) =>
                      setEmailDraft((current) => ({
                        ...current,
                        fromEmail: event.target.value,
                      }))
                    }
                    placeholder="noreply@example.com"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <div className="flex w-full items-end justify-between gap-2">
                  <div className="grid flex-1 gap-1">
                    <label
                      className="text-xs text-muted-foreground"
                      htmlFor="smtp-test-recipient"
                    >
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
                        await sendFileTestEmail(workbook.id, {
                          to: testRecipient.trim(),
                        })
                        toast.success("Test email sent.")
                      } catch (error) {
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "Failed to send test email"
                        )
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
  )
}
