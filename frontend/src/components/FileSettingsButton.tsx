import { useEffect, useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Settings02Icon } from "@hugeicons/core-free-icons"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { listEmailProfiles, sendFileTestEmail } from "@/api/client"
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
import type { EmailProfile } from "@/types/sheet"

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
  const setFileEmailProfile = useSheetStore(
    (state) => state.setFileEmailProfile
  )
  const sheetFontFamily = useSheetStore((state) => state.sheetFontFamily)
  const setSheetFontFamily = useSheetStore((state) => state.setSheetFontFamily)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState("general")
  const [emailProfiles, setEmailProfiles] = useState<EmailProfile[]>([])
  const [testRecipient, setTestRecipient] = useState("")
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false)
  const [isSavingEmailProfile, setIsSavingEmailProfile] = useState(false)
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false)

  const selectedEmailProfile = useMemo(
    () =>
      emailProfiles.find(
        (profile) => profile.id === fileSettings.emailProfileId
      ) ?? null,
    [emailProfiles, fileSettings.emailProfileId]
  )

  useEffect(() => {
    if (!open) {
      return
    }
    setSettingsTab("general")
    setIsLoadingProfiles(true)
    void (async () => {
      try {
        const response = await listEmailProfiles()
        setEmailProfiles(response.profiles)
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load email profiles"
        )
      } finally {
        setIsLoadingProfiles(false)
      }
    })()
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    setTestRecipient(selectedEmailProfile?.smtp.fromEmail ?? "")
  }, [open, selectedEmailProfile])

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
            "h-7 gap-2 rounded-t-lg rounded-b-none border border-b-0 border-border bg-muted/35 px-3 py-1 text-sm shadow-none! hover:bg-muted/55 md:px-4",
            open && "-mb-px bg-card hover:bg-card",
            className
          )}
        >
          <HugeiconsIcon icon={Settings02Icon} className="size-4" />
          <span className="hidden md:inline">Settings</span>
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
              <TabsTrigger
                value="communication"
                className="justify-start text-sm"
              >
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
                  Choose one of your reusable email profiles for this file.
                </p>
              </div>
              <div className="grid gap-3">
                <div className="grid gap-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="file-email-profile-select"
                  >
                    Email profile
                  </label>
                  <select
                    id="file-email-profile-select"
                    className="h-9 w-full rounded-md border border-input bg-background px-2"
                    value={fileSettings.emailProfileId}
                    onChange={(event) => {
                      setIsSavingEmailProfile(true)
                      void (async () => {
                        try {
                          await setFileEmailProfile(event.target.value)
                        } finally {
                          setIsSavingEmailProfile(false)
                        }
                      })()
                    }}
                    disabled={
                      !workbook ||
                      isLoadingProfiles ||
                      isSavingEmailProfile ||
                      isSendingTestEmail
                    }
                  >
                    <option value="">No profile selected</option>
                    {emailProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.nickname}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Manage SMTP credentials from your Email Profiles page.
                  </p>
                </div>

                {selectedEmailProfile ? (
                  <div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">
                        {selectedEmailProfile.nickname}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {selectedEmailProfile.smtp.useTLS ? "TLS" : "No TLS"} ·{" "}
                        {selectedEmailProfile.smtp.host}:
                        {selectedEmailProfile.smtp.port}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      From {selectedEmailProfile.smtp.fromName || "-"} &lt;
                      {selectedEmailProfile.smtp.fromEmail || "-"}&gt;
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                    {isLoadingProfiles
                      ? "Loading email profiles..."
                      : emailProfiles.length === 0
                        ? "No email profiles yet. Create one first, then select it here."
                        : "Select an email profile to use for sends from this file."}
                  </div>
                )}
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
                    disabled={
                      !workbook ||
                      !fileSettings.emailProfileId ||
                      isSendingTestEmail ||
                      isSavingEmailProfile
                    }
                  >
                    {isSendingTestEmail ? "Sending..." : "Send Test Email"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOpen(false)
                      navigate("/email-profiles")
                    }}
                  >
                    Manage Profiles
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
