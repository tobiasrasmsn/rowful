import { useEffect, useMemo, useState } from "react"

import {
  addAllowlistEntry,
  deleteAllowlistEntry,
  listAllowlistEntries,
} from "@/api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

export function AdminAccessPage() {
  const [entries, setEntries] = useState<AllowlistEntry[]>([])
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const pendingCount = useMemo(
    () => entries.filter((entry) => !entry.claimedAt).length,
    [entries]
  )

  const refresh = async () => {
    const response = await listAllowlistEntries()
    setEntries(response.entries)
  }

  useEffect(() => {
    void (async () => {
      try {
        await refresh()
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load allowlist")
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <section className="overflow-hidden rounded-[28px] border border-border bg-card">
          <div className="grid gap-6 border-b border-border bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(234,88,12,0.08))] px-5 py-6 md:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
            <div>
              <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Invite-only sign up
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                Whitelist the exact email addresses allowed to register.
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                After the first admin account is created, self-service sign up stays closed unless an email address is added here.
              </p>
            </div>

            <div className="rounded-[24px] border border-border/80 bg-background/90 p-4 shadow-sm">
              <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Add email
              </div>
              <div className="mt-3 space-y-3">
                <Input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="person@example.com"
                />
                <Button
                  className="w-full"
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
                  {isSubmitting ? "Saving..." : "Allow sign up"}
                </Button>
              </div>
            </div>
          </div>

          <div className="px-5 py-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  Allowlist
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {pendingCount} pending {pendingCount === 1 ? "invite" : "invites"}
                </div>
              </div>
              <Button type="button" variant="outline" onClick={() => void refresh()} disabled={isLoading}>
                Refresh
              </Button>
            </div>

            {error ? <div className="mb-4 text-sm text-rose-600">{error}</div> : null}

            <div className="overflow-hidden rounded-2xl border border-border">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Added</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-muted-foreground" colSpan={4}>
                        Loading access list...
                      </td>
                    </tr>
                  ) : entries.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-muted-foreground" colSpan={4}>
                        No emails have been whitelisted yet
                      </td>
                    </tr>
                  ) : (
                    entries.map((entry) => {
                      const claimed = Boolean(entry.claimedAt)
                      return (
                        <tr key={entry.email} className="border-t border-border align-top">
                          <td className="px-4 py-3 font-medium">{entry.email}</td>
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
