export type SnapshotSettings = {
  enabled: boolean
  endpoint: string
  region: string
  bucket: string
  prefix: string
  accessKeyId: string
  secretAccessKey?: string
  hasSecretAccessKey: boolean
  usePathStyle: boolean
  scheduleIntervalHours: number
  retentionCount: number
  lastSnapshotAt?: string
  lastSuccessAt?: string
  nextRunAt?: string
  lastError?: string
  updatedAt: string
}

export type SnapshotRun = {
  id: string
  status: "running" | "success" | "failed"
  trigger: "manual" | "scheduled" | string
  objectKey?: string
  sizeBytes: number
  startedAt: string
  completedAt?: string
  error?: string
}

export type SnapshotStatusResponse = {
  settings: SnapshotSettings
  runs: SnapshotRun[]
  isRunning: boolean
  isRestoring: boolean
  targets: string[]
}
