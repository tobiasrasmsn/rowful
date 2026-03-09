import { useEffect, useState } from "react"
import { ShieldCheckIcon, GlobeIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import {
  checkManagedDomain,
  createManagedDomain,
  listManagedDomains,
} from "@/api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DomainCheckResult, ManagedDomain } from "@/types/domain"

const formatDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "-"
  }
  return date.toLocaleString()
}

function RecordList({
  title,
  items,
  emptyLabel,
}: {
  title: string
  items: Array<{ type: string; value: string }>
  emptyLabel: string
}) {
  return (
    <div className="rounded-xl border border-border bg-background/80 p-3">
      <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {title}
      </div>
      <div className="mt-2 space-y-2">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground">{emptyLabel}</div>
        ) : (
          items.map((item) => (
            <div
              key={`${item.type}-${item.value}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-3 py-2 text-sm"
            >
              <span className="font-medium">{item.type}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {item.value}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function DomainsPage() {
  const [domains, setDomains] = useState<ManagedDomain[]>([])
  const [domain, setDomain] = useState("")
  const [check, setCheck] = useState<DomainCheckResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isChecking, setIsChecking] = useState(false)
  const [isProvisioning, setIsProvisioning] = useState(false)

  const refreshDomains = async () => {
    const response = await listManagedDomains()
    setDomains(response.domains)
  }

  useEffect(() => {
    setIsLoading(true)
    void (async () => {
      try {
        const response = await listManagedDomains()
        setDomains(response.domains)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load domains")
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  const runCheck = async () => {
    const trimmed = domain.trim()
    if (!trimmed) {
      toast.error("Enter a domain first")
      return
    }

    setIsChecking(true)
    try {
      const response = await checkManagedDomain(trimmed)
      setCheck(response.check)
      if (response.check.dnsConfigured) {
        toast.success("DNS looks correct")
      } else {
        toast.error("DNS does not point to this VPS yet")
      }
    } catch (error) {
      setCheck(null)
      toast.error(error instanceof Error ? error.message : "DNS check failed")
    } finally {
      setIsChecking(false)
    }
  }

  const provision = async () => {
    if (!check?.dnsConfigured) {
      return
    }

    setIsProvisioning(true)
    try {
      const response = await createManagedDomain(check.domain)
      setDomain("")
      setCheck(response.check)
      await refreshDomains()
      toast.success(`Caddy is now managing ${response.domain.domain}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Provisioning failed")
    } finally {
      setIsProvisioning(false)
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <section className="overflow-hidden rounded-[28px] border border-border bg-card">
          <div className="grid gap-6 border-b border-border bg-[linear-gradient(135deg,rgba(2,132,199,0.08),rgba(15,23,42,0.03))] px-5 py-6 md:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200/70 bg-white/80 px-3 py-1 text-[0.72rem] font-medium tracking-[0.18em] text-sky-800 uppercase">
                <ShieldCheckIcon className="size-3.5" />
                Domain Routing
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                Point your domain at this VPS, then let Caddy take over HTTPS.
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                The flow is gated on DNS. Planar checks the live A and AAAA
                records first, and only after they point at this server does it
                reload Caddy so the domain serves the app and Let&apos;s Encrypt can
                issue a certificate.
              </p>
            </div>

            <div className="rounded-[24px] border border-border/80 bg-background/90 p-4 shadow-sm">
              <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Add Domain
              </div>
              <div className="mt-3 space-y-3">
                <Input
                  value={domain}
                  onChange={(event) => {
                    setDomain(event.target.value)
                    setCheck(null)
                  }}
                  placeholder="app.example.com"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => void runCheck()}
                  disabled={isChecking || isProvisioning}
                >
                  {isChecking ? "Checking DNS..." : "1. Check DNS"}
                </Button>
                {check ? (
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => void provision()}
                    disabled={!check.dnsConfigured || isProvisioning}
                  >
                    {isProvisioning
                      ? "Provisioning..."
                      : "2. Enable Routing + HTTPS"}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-4 px-5 py-5 md:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
            <div className="space-y-4">
              <div className="rounded-[24px] border border-border bg-background/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                      DNS Verification
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {check
                        ? `Latest lookup for ${check.domain}`
                        : "Run a lookup before provisioning"}
                    </div>
                  </div>
                  <div
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      check?.dnsConfigured
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {check
                      ? check.dnsConfigured
                        ? "Ready for Caddy"
                        : "Waiting on DNS"
                      : "No lookup yet"}
                  </div>
                </div>

                {check ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <RecordList
                      title="Server IPs"
                      items={check.expectedIps.map((value) => ({
                        type: netType(value),
                        value,
                      }))}
                      emptyLabel="This server has no configured public IPs yet."
                    />
                    <RecordList
                      title="Live DNS"
                      items={check.resolvedRecords}
                      emptyLabel="No A or AAAA records were found."
                    />
                    <div className="md:col-span-2">
                      <RecordList
                        title="Matching Records"
                        items={check.matchingRecords}
                        emptyLabel="No DNS record currently points at this VPS."
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[24px] border border-border bg-background/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                    Managed Domains
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Active Caddy sites stored by Planar
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    void (async () => {
                      try {
                        await refreshDomains()
                      } catch (error) {
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "Failed to load domains"
                        )
                      }
                    })()
                  }}
                  disabled={isLoading}
                >
                  <RefreshCwIcon className="size-4" />
                </Button>
              </div>

              <div className="mt-4 space-y-3">
                {isLoading ? (
                  <div className="rounded-xl border border-border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    Loading domains...
                  </div>
                ) : domains.length === 0 ? (
                  <div className="rounded-xl border border-border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    No managed domains yet
                  </div>
                ) : (
                  domains.map((item) => (
                    <div
                      key={item.domain}
                      className="rounded-xl border border-border bg-card px-4 py-3"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <GlobeIcon className="size-4 text-sky-700" />
                        {item.domain}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Added {formatDate(item.createdAt)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function netType(value: string) {
  return value.includes(":") ? "AAAA" : "A"
}
