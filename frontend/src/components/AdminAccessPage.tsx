import { useEffect, useMemo, useState } from "react"

import {
  addAllowlistEntry,
  deleteAllowlistEntry,
  fetchSignupPolicy,
  listAllowlistEntries,
  updateSignupPolicy,
} from "@/api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuthStore } from "@/store/authStore"
import type { AllowlistEntry } from "@/types/auth"

const formatDate = (value?: string) => {
  if (!value) {
    return "-"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "-"
  }
  return date.toLocaleString()
}

const getSignupModeLabel = (options: {
  setupRequired: boolean
  signupsEnabled: boolean
  inviteOnly: boolean
}) => {
  if (options.setupRequired) {
    return "Bootstrap"
  }
  if (options.inviteOnly) {
    return "Whitelist only"
  }
  if (options.signupsEnabled) {
    return "Open sign up"
  }
  return "Closed"
}

export function AdminAccessPage() {
  const bootstrap = useAuthStore((state) => state.bootstrap)
  const setBootstrap = useAuthStore((state) => state.setBootstrap)
  const [entries, setEntries] = useState<AllowlistEntry[]>([])
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSavingPolicy, setIsSavingPolicy] = useState(false)

  const pendingCount = useMemo(
    () => entries.filter((entry) => !entry.claimedAt).length,
    [entries]
  )

  const refresh = async () => {
    const [policy, allowlist] = await Promise.all([
      fetchSignupPolicy(),
      listAllowlistEntries(),
    ])
    setBootstrap(policy)
    setEntries(allowlist.entries)
  }

  useEffect(() => {
    void (async () => {
      try {
        await refresh()
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load access settings"
        )
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  const savePolicy = async (signupsEnabled: boolean, inviteOnly: boolean) => {
    setError(null)
    setIsSavingPolicy(true)
    try {
      const nextPolicy = await updateSignupPolicy({
        signupsEnabled,
        inviteOnly,
      })
      setBootstrap(nextPolicy)
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to update signup policy"
      )
    } finally {
      setIsSavingPolicy(false)
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <section className="overflow-hidden rounded-[28px] border border-border bg-card">
          <div className="access-hero-surface grid gap-6 border-b border-border px-5 py-6 md:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.9fr)]">
            <div>
              <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Admin access
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                Control who is allowed to create new accounts.
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                The first account becomes admin automatically. After that,
                sign-up stays closed unless you reopen it here.
              </p>
            </div>

            <div className="rounded-[24px] border border-border/80 bg-background/90 p-4 shadow-sm shadow-primary/10">
              <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Current mode
              </div>
              <div className="mt-3 inline-flex rounded-full border border-border bg-muted/50 px-3 py-1 text-sm font-medium">
                {getSignupModeLabel(bootstrap)}
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {bootstrap.inviteOnly
                  ? "Only emails on the whitelist can register."
                  : bootstrap.signupsEnabled
                    ? "Anyone can create an account right now."
                    : "New account creation is currently blocked."}
              </p>
            </div>
          </div>

          <div className="grid gap-4 border-b border-border px-5 py-5 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-background/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Allow sign up</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Reopen registration for new users. Turning this off closes
                    sign-up for everyone except the initial bootstrap admin.
                  </p>
                </div>
                <Button
                  type="button"
                  variant={bootstrap.signupsEnabled ? "default" : "outline"}
                  disabled={isLoading || isSavingPolicy}
                  onClick={() =>
                    void savePolicy(!bootstrap.signupsEnabled, false)
                  }
                >
                  {bootstrap.signupsEnabled ? "On" : "Off"}
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-background/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Whitelist only</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Restrict registration to exact email addresses you add
                    below. Enabling this also turns sign-up on.
                  </p>
                </div>
                <Button
                  type="button"
                  variant={bootstrap.inviteOnly ? "default" : "outline"}
                  disabled={isLoading || isSavingPolicy}
                  onClick={() =>
                    void savePolicy(
                      bootstrap.inviteOnly ? bootstrap.signupsEnabled : true,
                      !bootstrap.inviteOnly
                    )
                  }
                >
                  {bootstrap.inviteOnly ? "On" : "Off"}
                </Button>
              </div>
            </div>
          </div>

          <div className="px-5 py-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  Whitelist
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {pendingCount} pending{" "}
                  {pendingCount === 1 ? "entry" : "entries"}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void refresh()}
                disabled={isLoading}
              >
                Refresh
              </Button>
            </div>

            <div className="mb-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="person@example.com"
              />
              <Button
                type="button"
                disabled={isSubmitting}
                onClick={async () => {
                  setError(null)
                  setIsSubmitting(true)
                  try {
                    await addAllowlistEntry(email)
                    setEmail("")
                    await refresh()
                  } catch (submitError) {
                    setError(
                      submitError instanceof Error
                        ? submitError.message
                        : "Failed to add email"
                    )
                  } finally {
                    setIsSubmitting(false)
                  }
                }}
              >
                {isSubmitting ? "Saving..." : "Add email"}
              </Button>
            </div>

            <p className="mb-4 text-sm leading-6 text-muted-foreground">
              {bootstrap.inviteOnly
                ? "Whitelist mode is active. Only the emails listed here can create accounts."
                : "Whitelist entries are ready whenever you want to switch from open sign-up to whitelist-only access."}
            </p>

            {error ? (
              <div className="mb-4 text-sm text-destructive">{error}</div>
            ) : null}

            <div className="overflow-hidden rounded-2xl border border-border">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Added</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td
                        className="px-4 py-8 text-center text-muted-foreground"
                        colSpan={4}
                      >
                        Loading access list...
                      </td>
                    </tr>
                  ) : entries.length === 0 ? (
                    <tr>
                      <td
                        className="px-4 py-8 text-center text-muted-foreground"
                        colSpan={4}
                      >
                        No emails have been whitelisted yet
                      </td>
                    </tr>
                  ) : (
                    entries.map((entry) => {
                      const claimed = Boolean(entry.claimedAt)
                      return (
                        <tr
                          key={entry.email}
                          className="border-t border-border align-top"
                        >
                          <td className="px-4 py-3 font-medium">
                            {entry.email}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {formatDate(entry.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {claimed
                              ? `Claimed by ${entry.claimedByEmail ?? "user"} on ${formatDate(entry.claimedAt)}`
                              : "Pending"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={claimed}
                              onClick={async () => {
                                setError(null)
                                try {
                                  await deleteAllowlistEntry(entry.email)
                                  await refresh()
                                } catch (deleteError) {
                                  setError(
                                    deleteError instanceof Error
                                      ? deleteError.message
                                      : "Failed to delete email"
                                  )
                                }
                              }}
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
