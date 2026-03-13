import { useEffect, useMemo, useState } from "react"
import { MailIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import {
  createEmailProfile,
  deleteEmailProfile,
  listEmailProfiles,
  updateEmailProfile,
} from "@/api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { EmailProfile, EmailProfileInput } from "@/types/sheet"

const emptyDraft = (): EmailProfileInput => ({
  nickname: "",
  smtp: {
    host: "",
    port: 587,
    username: "",
    password: "",
    fromEmail: "",
    fromName: "",
    useTLS: true,
  },
})

const formatDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "-"
  }
  return date.toLocaleString()
}

export function EmailProfilesPage() {
  const [profiles, setProfiles] = useState<EmailProfile[]>([])
  const [draft, setDraft] = useState<EmailProfileInput>(emptyDraft)
  const [activeProfileId, setActiveProfileId] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [profiles, activeProfileId]
  )

  const refreshProfiles = async () => {
    const response = await listEmailProfiles()
    setProfiles(response.profiles)
    return response.profiles
  }

  useEffect(() => {
    setIsLoading(true)
    void (async () => {
      try {
        const nextProfiles = await refreshProfiles()
        if (nextProfiles[0]) {
          setActiveProfileId(nextProfiles[0].id)
          setDraft({
            nickname: nextProfiles[0].nickname,
            smtp: nextProfiles[0].smtp,
          })
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load email profiles"
        )
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  const startCreate = () => {
    setActiveProfileId("")
    setDraft(emptyDraft())
  }

  const startEdit = (profile: EmailProfile) => {
    setActiveProfileId(profile.id)
    setDraft({
      nickname: profile.nickname,
      smtp: profile.smtp,
    })
  }

  const saveProfile = async () => {
    setIsSaving(true)
    try {
      const response = activeProfileId
        ? await updateEmailProfile(activeProfileId, draft)
        : await createEmailProfile(draft)
      const nextProfiles = await refreshProfiles()
      setActiveProfileId(response.profile.id)
      setDraft({
        nickname: response.profile.nickname,
        smtp: response.profile.smtp,
      })
      toast.success(
        activeProfileId ? "Email profile updated" : "Email profile created"
      )
      if (nextProfiles.length === 0) {
        startCreate()
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save email profile"
      )
    } finally {
      setIsSaving(false)
    }
  }

  const removeProfile = async () => {
    if (!activeProfile) {
      return
    }
    const confirmed = window.confirm(
      `Delete the email profile "${activeProfile.nickname}"?`
    )
    if (!confirmed) {
      return
    }

    setIsDeleting(true)
    try {
      await deleteEmailProfile(activeProfile.id)
      const nextProfiles = await refreshProfiles()
      if (nextProfiles[0]) {
        startEdit(nextProfiles[0])
      } else {
        startCreate()
      }
      toast.success("Email profile deleted")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to delete email profile"
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <section className="overflow-hidden rounded-[28px] border border-border bg-card">
          <div className="grid gap-6 border-b border-border px-5 py-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[0.72rem] font-medium tracking-[0.18em] text-primary uppercase">
                <MailIcon className="size-3.5" />
                Email Profiles
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                Save SMTP credentials once, then reuse them across every file.
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Each profile stores a nickname plus the sender and SMTP details.
                File settings now only need a quick profile selection.
              </p>
            </div>

            <div className="rounded-[24px] border border-border/80 bg-background/90 p-4 shadow-sm shadow-primary/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                    Saved Profiles
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {profiles.length} profile{profiles.length === 1 ? "" : "s"}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setIsLoading(true)
                    void refreshProfiles()
                      .catch((error) => {
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "Failed to refresh email profiles"
                        )
                      })
                      .finally(() => setIsLoading(false))
                  }}
                  disabled={isLoading}
                >
                  <RefreshCwIcon className="size-4" />
                  Refresh
                </Button>
              </div>
              <div className="mt-4 space-y-2">
                <Button
                  type="button"
                  className="w-full justify-start"
                  variant={!activeProfileId ? "secondary" : "outline"}
                  onClick={startCreate}
                >
                  <PlusIcon className="size-4" />
                  New Profile
                </Button>
                <div className="max-h-72 space-y-2 overflow-auto">
                  {profiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => startEdit(profile)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                        activeProfileId === profile.id
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{profile.nickname}</div>
                        <div className="text-xs text-muted-foreground">
                          {profile.smtp.useTLS ? "TLS" : "No TLS"}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {profile.smtp.fromEmail || profile.smtp.username || "-"}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {profile.smtp.host}:{profile.smtp.port}
                      </div>
                    </button>
                  ))}
                  {!isLoading && profiles.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                      No profiles yet.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 px-5 py-5 md:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
            <div className="rounded-[24px] border border-border bg-background/70 p-4">
              <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                {activeProfileId ? "Edit Profile" : "Create Profile"}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="col-span-2 grid gap-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="email-profile-nickname"
                  >
                    Nickname
                  </label>
                  <Input
                    id="email-profile-nickname"
                    value={draft.nickname}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        nickname: event.target.value,
                      }))
                    }
                    placeholder="Finance Bot"
                  />
                </div>
                <div className="col-span-2 grid gap-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="email-profile-host"
                  >
                    SMTP Host
                  </label>
                  <Input
                    id="email-profile-host"
                    value={draft.smtp.host}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        smtp: {
                          ...current.smtp,
                          host: event.target.value,
                        },
                      }))
                    }
                    placeholder="smtp.example.com"
                  />
                </div>
                <div className="grid gap-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="email-profile-port"
                  >
                    SMTP Port
                  </label>
                  <Input
                    id="email-profile-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={String(draft.smtp.port)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        smtp: {
                          ...current.smtp,
                          port: Number(event.target.value) || 587,
                        },
                      }))
                    }
                  />
                </div>
                <div className="flex items-end gap-2 pb-2">
                  <input
                    id="email-profile-use-tls"
                    type="checkbox"
                    checked={draft.smtp.useTLS}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        smtp: {
                          ...current.smtp,
                          useTLS: event.target.checked,
                        },
                      }))
                    }
                  />
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="email-profile-use-tls"
                  >
                    Use TLS
                  </label>
                </div>
                <div className="grid gap-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="email-profile-username"
                  >
                    Username
                  </label>
                  <Input
                    id="email-profile-username"
                    value={draft.smtp.username}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        smtp: {
                          ...current.smtp,
                          username: event.target.value,
                        },
                      }))
                    }
                    placeholder="smtp-user"
                  />
                </div>
                <div className="grid gap-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="email-profile-password"
                  >
                    Password
                  </label>
                  <Input
                    id="email-profile-password"
                    type="password"
                    value={draft.smtp.password}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        smtp: {
                          ...current.smtp,
                          password: event.target.value,
                        },
                      }))
                    }
                    placeholder="••••••••"
                  />
                </div>
                <div className="grid gap-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="email-profile-from-name"
                  >
                    From Name
                  </label>
                  <Input
                    id="email-profile-from-name"
                    value={draft.smtp.fromName}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        smtp: {
                          ...current.smtp,
                          fromName: event.target.value,
                        },
                      }))
                    }
                    placeholder="Finance Bot"
                  />
                </div>
                <div className="grid gap-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="email-profile-from-email"
                  >
                    From Email
                  </label>
                  <Input
                    id="email-profile-from-email"
                    type="email"
                    value={draft.smtp.fromEmail}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        smtp: {
                          ...current.smtp,
                          fromEmail: event.target.value,
                        },
                      }))
                    }
                    placeholder="noreply@example.com"
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {activeProfile
                    ? `Last updated ${formatDate(activeProfile.updatedAt)}`
                    : "Create a shared sender profile for reuse in file settings."}
                </div>
                <div className="flex gap-2">
                  {activeProfile ? (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => void removeProfile()}
                      disabled={isDeleting || isSaving}
                    >
                      <Trash2Icon className="size-4" />
                      Delete
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    onClick={() => void saveProfile()}
                    disabled={isSaving || isDeleting}
                  >
                    {isSaving
                      ? "Saving..."
                      : activeProfileId
                        ? "Save Changes"
                        : "Create Profile"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-border bg-background/70 p-4">
              <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Active Details
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-xl border border-border bg-card px-3 py-2">
                  <div className="text-xs text-muted-foreground">Profile</div>
                  <div className="mt-1 font-medium">
                    {activeProfile?.nickname || draft.nickname || "-"}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card px-3 py-2">
                  <div className="text-xs text-muted-foreground">Server</div>
                  <div className="mt-1 font-medium">
                    {draft.smtp.host || "-"}:{draft.smtp.port}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card px-3 py-2">
                  <div className="text-xs text-muted-foreground">Sender</div>
                  <div className="mt-1 font-medium">
                    {draft.smtp.fromName || "-"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {draft.smtp.fromEmail || "-"}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card px-3 py-2">
                  <div className="text-xs text-muted-foreground">Security</div>
                  <div className="mt-1 font-medium">
                    {draft.smtp.useTLS ? "TLS enabled" : "TLS disabled"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Username: {draft.smtp.username || "-"}
                  </div>
                </div>
                {activeProfile ? (
                  <div className="text-xs text-muted-foreground">
                    Created {formatDate(activeProfile.createdAt)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
