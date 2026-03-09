export type ManagedDomain = {
  domain: string
  createdAt: string
}

export type DomainDNSRecord = {
  type: string
  value: string
}

export type DomainCheckResult = {
  domain: string
  expectedIps: string[]
  resolvedRecords: DomainDNSRecord[]
  matchingRecords: DomainDNSRecord[]
  dnsConfigured: boolean
}

export type ManagedDomainsResponse = {
  domains: ManagedDomain[]
}

export type DomainCheckResponse = {
  check: DomainCheckResult
}

export type ManagedDomainResponse = {
  domain: ManagedDomain
  check: DomainCheckResult
}
