import { useCallback, useEffect, useMemo, useState } from "react"

import {
  addAllowlistEntry,
  deleteAllowlistEntry,
  fetchSignupPolicy,
  fetchSnapshotStatus,
  restoreSnapshotRun,
  listAllowlistEntries,
  runSnapshotNow,
  updateSignupPolicy,
  updateSnapshotSettings,
} from "@/api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuthStore } from "@/store/authStore"
import type { AllowlistEntry } from "@/types/auth"
import type { SnapshotRun, SnapshotSettings } from "@/types/snapshot"

const DEFAULT_SNAPSHOT_SETTINGS: SnapshotSettings = {
  enabled: false,
  endpoint: "",
  region: "",
  bucket: "",
  prefix: "snapshots",
  accessKeyId: "",
  hasSecretAccessKey: false,
  usePathStyle: false,
  scheduleIntervalHours: 24,
  retentionCount: 14,
  updatedAt: new Date(0).toISOString(),
}

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

const formatBytes = (value: number) => {
  if (!value || value <= 0) {
    return "-"
  }
  const units = ["B", "KB", "MB", "GB", "TB"]
  let current = value
  let unitIndex = 0
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }
  return `${current.toFixed(current >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
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

const getSnapshotStatusLabel = (run?: SnapshotRun) => {
  if (!run) {
    return "Not run yet"
  }
  if (run.status === "running") {
    return "Running"
  }
  if (run.status === "success") {
    return "Healthy"
  }
  return "Needs attention"
}

export function AdminAccessPage() {
  const bootstrap = useAuthStore((state) => state.bootstrap)
  const setBootstrap = useAuthStore((state) => state.setBootstrap)
  const [entries, setEntries] = useState<AllowlistEntry[]>([])
  const [snapshotSettings, setSnapshotSettings] = useState<SnapshotSettings>(
    DEFAULT_SNAPSHOT_SETTINGS
  )
  const [snapshotSecret, setSnapshotSecret] = useState("")
  const [clearSnapshotSecret, setClearSnapshotSecret] = useState(false)
  const [snapshotRuns, setSnapshotRuns] = useState<SnapshotRun[]>([])
  const [snapshotTargets, setSnapshotTargets] = useState<string[]>([])
  const [isSnapshotRunning, setIsSnapshotRunning] = useState(false)
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [snapshotNotice, setSnapshotNotice] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSavingPolicy, setIsSavingPolicy] = useState(false)
  const [isSavingSnapshots, setIsSavingSnapshots] = useState(false)
  const [isStartingSnapshot, setIsStartingSnapshot] = useState(false)
  const [isRestoringSnapshot, setIsRestoringSnapshot] = useState(false)

  const pendingCount = useMemo(
    () => entries.filter((entry) => !entry.claimedAt).length,
    [entries]
  )
  const latestSnapshotRun = snapshotRuns[0]

  const refreshAll = useCallback(async () => {
    const [policy, allowlist, snapshots] = await Promise.all([
      fetchSignupPolicy(),
      listAllowlistEntries(),
      fetchSnapshotStatus(),
    ])
    setBootstrap(policy)
    setEntries(allowlist.entries)
    setSnapshotSettings(snapshots.settings)
    setSnapshotSecret("")
    setClearSnapshotSecret(false)
    setSnapshotRuns(snapshots.runs)
    setSnapshotTargets(snapshots.targets)
    setIsSnapshotRunning(snapshots.isRunning)
    setIsRestoringSnapshot(snapshots.isRestoring)
  }, [setBootstrap])

  const refreshSnapshots = useCallback(async () => {
    const snapshots = await fetchSnapshotStatus()
    setSnapshotSettings(snapshots.settings)
    setSnapshotRuns(snapshots.runs)
    setSnapshotTargets(snapshots.targets)
    setIsSnapshotRunning(snapshots.isRunning)
    setIsRestoringSnapshot(snapshots.isRestoring)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await refreshAll()
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
  }, [refreshAll])

  useEffect(() => {
    if (!isSnapshotRunning) {
      return
    }
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          await refreshSnapshots()
        } catch (loadError) {
          setSnapshotError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to refresh snapshot status"
          )
        }
      })()
    }, 5000)
    return () => window.clearTimeout(timeout)
  }, [isSnapshotRunning, refreshSnapshots])

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
                onClick={() => void refreshAll()}
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
                    await refreshAll()
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
                                  await refreshAll()
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

        <section className="overflow-hidden rounded-[28px] border border-border bg-card">
          <div className="access-hero-surface grid gap-6 border-b border-border px-5 py-6 md:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.9fr)]">
            <div>
              <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Snapshots
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                Back up Rowful to S3-compatible object storage.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                The scheduler runs inside the backend service, which keeps
                automatic snapshots working the same way on raw VPS installs and
                on Coolify or Dokploy deployments using the platform compose
                file.
              </p>
            </div>

            <div className="rounded-[24px] border border-border/80 bg-background/90 p-4 shadow-sm shadow-primary/10">
              <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Snapshot health
              </div>
              <div className="mt-3 inline-flex rounded-full border border-border bg-muted/50 px-3 py-1 text-sm font-medium">
                {getSnapshotStatusLabel(latestSnapshotRun)}
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {isSnapshotRunning
                  ? "A snapshot is currently being packed and uploaded."
                  : isRestoringSnapshot
                    ? "A snapshot restore is currently replacing the live data."
                  : snapshotSettings.enabled
                    ? `Automatic snapshots run every ${snapshotSettings.scheduleIntervalHours} hour${snapshotSettings.scheduleIntervalHours === 1 ? "" : "s"}.`
                    : "Automatic snapshots are currently disabled."}
              </p>
            </div>
          </div>

          <div className="grid gap-4 border-b border-border px-5 py-5 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-background/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Automatic snapshots</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    When enabled, the backend schedules recurring snapshot jobs
                    without relying on host-level cron configuration.
                  </p>
                </div>
                <Button
                  type="button"
                  variant={snapshotSettings.enabled ? "default" : "outline"}
              disabled={isSavingSnapshots}
                  onClick={() =>
                    setSnapshotSettings((current) => ({
                      ...current,
                      enabled: !current.enabled,
                    }))
                  }
                >
                  {snapshotSettings.enabled ? "On" : "Off"}
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-background/70 p-4">
              <div className="text-sm font-semibold">Detected snapshot targets</div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                The backend will snapshot the live SQLite copy plus the app data
                roots it can see in the container or VPS runtime.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {snapshotTargets.length === 0 ? (
                  <span className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                    No targets detected yet
                  </span>
                ) : (
                  snapshotTargets.map((target) => (
                    <span
                      key={target}
                      className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
                    >
                      {target}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 border-b border-border px-5 py-5 md:grid-cols-2">
            <div className="space-y-4 rounded-2xl border border-border bg-background/70 p-4">
              <div>
                <label className="text-sm font-semibold" htmlFor="snapshot-endpoint">
                  S3 endpoint
                </label>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Leave blank for AWS S3. For Cloudflare R2 use your account
                  endpoint, like `https://&lt;accountid&gt;.r2.cloudflarestorage.com`.
                </p>
                <Input
                  id="snapshot-endpoint"
                  value={snapshotSettings.endpoint}
                  onChange={(event) =>
                    setSnapshotSettings((current) => ({
                      ...current,
                      endpoint: event.target.value,
                    }))
                  }
                  placeholder="https://accountid.r2.cloudflarestorage.com"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold" htmlFor="snapshot-region">
                    Region
                  </label>
                  <Input
                    id="snapshot-region"
                    value={snapshotSettings.region}
                    onChange={(event) =>
                      setSnapshotSettings((current) => ({
                        ...current,
                        region: event.target.value,
                      }))
                    }
                    placeholder="us-east-1 or auto"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold" htmlFor="snapshot-bucket">
                    Bucket
                  </label>
                  <Input
                    id="snapshot-bucket"
                    value={snapshotSettings.bucket}
                    onChange={(event) =>
                      setSnapshotSettings((current) => ({
                        ...current,
                        bucket: event.target.value,
                      }))
                    }
                    placeholder="rowful-backups"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold" htmlFor="snapshot-prefix">
                  Object prefix
                </label>
                <Input
                  id="snapshot-prefix"
                  value={snapshotSettings.prefix}
                  onChange={(event) =>
                    setSnapshotSettings((current) => ({
                      ...current,
                      prefix: event.target.value,
                    }))
                  }
                  placeholder="snapshots"
                />
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-border bg-background/70 p-4">
              <div>
                <label className="text-sm font-semibold" htmlFor="snapshot-access-key">
                  Access key ID
                </label>
                <Input
                  id="snapshot-access-key"
                  value={snapshotSettings.accessKeyId}
                  onChange={(event) =>
                    setSnapshotSettings((current) => ({
                      ...current,
                      accessKeyId: event.target.value,
                    }))
                  }
                  placeholder="AKIA... or R2 access key"
                />
              </div>

              <div>
                <label className="text-sm font-semibold" htmlFor="snapshot-secret-key">
                  Secret access key
                </label>
                <Input
                  id="snapshot-secret-key"
                  type="password"
                  value={snapshotSecret}
                  onChange={(event) => {
                    setSnapshotSecret(event.target.value)
                    if (event.target.value.trim()) {
                      setClearSnapshotSecret(false)
                    }
                  }}
                  placeholder={
                    snapshotSettings.hasSecretAccessKey && !clearSnapshotSecret
                      ? "Stored securely already. Enter a new value to rotate it."
                      : "Paste the secret access key"
                  }
                />
                <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    id="snapshot-clear-secret"
                    type="checkbox"
                    checked={clearSnapshotSecret}
                    onChange={(event) => {
                      setClearSnapshotSecret(event.target.checked)
                      if (event.target.checked) {
                        setSnapshotSecret("")
                      }
                    }}
                  />
                  <label htmlFor="snapshot-clear-secret">
                    Clear the stored secret on next save
                  </label>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold" htmlFor="snapshot-interval">
                    Interval (hours)
                  </label>
                  <Input
                    id="snapshot-interval"
                    type="number"
                    min={1}
                    max={720}
                    value={snapshotSettings.scheduleIntervalHours}
                    onChange={(event) =>
                      setSnapshotSettings((current) => ({
                        ...current,
                        scheduleIntervalHours:
                          Number.parseInt(event.target.value, 10) || 0,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold" htmlFor="snapshot-retention">
                    Keep latest
                  </label>
                  <Input
                    id="snapshot-retention"
                    type="number"
                    min={1}
                    max={365}
                    value={snapshotSettings.retentionCount}
                    onChange={(event) =>
                      setSnapshotSettings((current) => ({
                        ...current,
                        retentionCount:
                          Number.parseInt(event.target.value, 10) || 0,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  id="snapshot-path-style"
                  type="checkbox"
                  checked={snapshotSettings.usePathStyle}
                  onChange={(event) =>
                    setSnapshotSettings((current) => ({
                      ...current,
                      usePathStyle: event.target.checked,
                    }))
                  }
                />
                <label htmlFor="snapshot-path-style">
                  Force path-style S3 URLs for providers like MinIO
                </label>
              </div>
            </div>
          </div>

          <div className="grid gap-4 border-b border-border px-5 py-5 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="rounded-2xl border border-border bg-background/70 p-4 text-sm leading-6 text-muted-foreground">
              Last attempt: {formatDate(snapshotSettings.lastSnapshotAt)}
              <br />
              Last success: {formatDate(snapshotSettings.lastSuccessAt)}
              <br />
              Next scheduled run: {formatDate(snapshotSettings.nextRunAt)}
              {snapshotSettings.lastError ? (
                <>
                  <br />
                  Latest error: {snapshotSettings.lastError}
                </>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={isSavingSnapshots || isStartingSnapshot}
              onClick={() => void refreshSnapshots()}
            >
              Refresh status
            </Button>
            <Button
              type="button"
              disabled={isSavingSnapshots || isStartingSnapshot}
              onClick={async () => {
                setSnapshotError(null)
                setSnapshotNotice(null)
                setIsSavingSnapshots(true)
                try {
                  const response = await updateSnapshotSettings({
                    enabled: snapshotSettings.enabled,
                    endpoint: snapshotSettings.endpoint,
                    region: snapshotSettings.region,
                    bucket: snapshotSettings.bucket,
                    prefix: snapshotSettings.prefix,
                    accessKeyId: snapshotSettings.accessKeyId,
                    secretAccessKey: snapshotSecret,
                    clearSecretAccessKey: clearSnapshotSecret,
                    usePathStyle: snapshotSettings.usePathStyle,
                    scheduleIntervalHours:
                      snapshotSettings.scheduleIntervalHours,
                    retentionCount: snapshotSettings.retentionCount,
                  })
                  setSnapshotSettings(response.settings)
                  setSnapshotSecret("")
                  setClearSnapshotSecret(false)
                  setSnapshotRuns(response.runs)
                  setSnapshotTargets(response.targets)
                  setIsSnapshotRunning(response.isRunning)
                  setIsRestoringSnapshot(response.isRestoring)
                  setSnapshotNotice("Snapshot settings saved.")
                } catch (saveError) {
                  setSnapshotError(
                    saveError instanceof Error
                      ? saveError.message
                      : "Failed to save snapshot settings"
                  )
                } finally {
                  setIsSavingSnapshots(false)
                }
              }}
            >
              {isSavingSnapshots ? "Saving..." : "Save snapshot settings"}
            </Button>
          </div>

          <div className="px-5 py-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  Recent runs
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Manual runs use the same background worker as the automatic
                  schedule.
                </div>
              </div>
              <Button
                type="button"
                disabled={isStartingSnapshot || isSavingSnapshots}
                onClick={async () => {
                  setSnapshotError(null)
                  setSnapshotNotice(null)
                  setIsStartingSnapshot(true)
                  try {
                    const response = await runSnapshotNow()
                    setSnapshotSettings(response.settings)
                    setSnapshotRuns(response.runs)
                    setSnapshotTargets(response.targets)
                    setIsSnapshotRunning(response.isRunning)
                    setIsRestoringSnapshot(response.isRestoring)
                    setSnapshotNotice(
                      "Snapshot job started. Status will refresh while it runs."
                    )
                  } catch (runError) {
                    setSnapshotError(
                      runError instanceof Error
                        ? runError.message
                        : "Failed to start snapshot job"
                    )
                  } finally {
                    setIsStartingSnapshot(false)
                  }
                }}
              >
                {isStartingSnapshot ? "Starting..." : "Run snapshot now"}
              </Button>
            </div>

            {snapshotError ? (
              <div className="mb-4 text-sm text-destructive">
                {snapshotError}
              </div>
            ) : null}
            {snapshotNotice ? (
              <div className="mb-4 text-sm text-emerald-700 dark:text-emerald-400">
                {snapshotNotice}
              </div>
            ) : null}
            <div className="mb-4 rounded-2xl border border-amber-300/60 bg-amber-50/70 px-4 py-3 text-sm leading-6 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200">
              Restoring a snapshot replaces the current database and app data
              with the exact contents of that backup.
            </div>

            <div className="overflow-hidden rounded-2xl border border-border">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Started</th>
                    <th className="px-4 py-3 font-medium">Trigger</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Size</th>
                    <th className="px-4 py-3 font-medium">Object</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshotRuns.length === 0 ? (
                    <tr>
                      <td
                        className="px-4 py-8 text-center text-muted-foreground"
                        colSpan={6}
                      >
                        No snapshots have run yet
                      </td>
                    </tr>
                  ) : (
                    snapshotRuns.map((run) => (
                      <tr
                        key={run.id}
                        className="border-t border-border align-top"
                      >
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(run.startedAt)}
                        </td>
                        <td className="px-4 py-3 capitalize">{run.trigger}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {run.status === "running"
                            ? "Running"
                            : run.status === "success"
                              ? `Finished ${formatDate(run.completedAt)}`
                              : `Failed${run.error ? `: ${run.error}` : ""}`}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatBytes(run.sizeBytes)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {run.objectKey || "-"}
                        </td>
                        <td className="px-4 py-3">
                          {run.status === "success" && run.objectKey ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={
                                isRestoringSnapshot ||
                                isSnapshotRunning ||
                                isSavingSnapshots ||
                                isStartingSnapshot
                              }
                              onClick={async () => {
                                const confirmed = window.confirm(
                                  `Restore the full app state from the snapshot started at ${formatDate(run.startedAt)}? This replaces the current data.`
                                )
                                if (!confirmed) {
                                  return
                                }

                                setSnapshotError(null)
                                setSnapshotNotice(null)
                                setIsRestoringSnapshot(true)
                                try {
                                  const response = await restoreSnapshotRun(
                                    run.id
                                  )
                                  setSnapshotSettings(response.settings)
                                  setSnapshotRuns(response.runs)
                                  setSnapshotTargets(response.targets)
                                  setIsSnapshotRunning(response.isRunning)
                                  setIsRestoringSnapshot(response.isRestoring)
                                  setSnapshotNotice(
                                    "Snapshot restored. Reloading the app state..."
                                  )
                                  window.setTimeout(() => {
                                    window.location.reload()
                                  }, 800)
                                } catch (restoreError) {
                                  setSnapshotError(
                                    restoreError instanceof Error
                                      ? restoreError.message
                                      : "Failed to restore snapshot"
                                  )
                                  setIsRestoringSnapshot(false)
                                }
                              }}
                            >
                              {isRestoringSnapshot ? "Restoring..." : "Restore"}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    ))
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
