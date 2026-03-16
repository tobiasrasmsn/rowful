import type {
  CellStyle,
  EmailProfileInput,
  EmailProfileResponse,
  EmailProfilesResponse,
  FolderEntry,
  FileSettings,
  FileSettingsResponse,
  FilesResponse,
  KanbanRegion,
  KanbanRegionsResponse,
  SendEmailRequest,
  SelectionTarget,
  Sheet,
  SheetResponse,
  UploadResponse,
} from "@/types/sheet"
import type {
  DomainCheckResponse,
  ManagedDomainResponse,
  ManagedDomainsResponse,
} from "@/types/domain"
import type {
  AllowlistResponse,
  AuthBootstrap,
  AuthSessionResponse,
} from "@/types/auth"
import type { SnapshotStatusResponse } from "@/types/snapshot"
import { getCSRFToken, handleUnauthorized } from "@/lib/authSession"

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/$/, "")

type ApiFetchOptions = {
  includeCSRF?: boolean
  suppressAuthRedirect?: boolean
}

async function apiFetch(
  input: string,
  init?: RequestInit,
  options: ApiFetchOptions = {}
): Promise<Response> {
  const requestInit = init ?? {}
  const method = (requestInit.method ?? "GET").toUpperCase()
  const headers = new Headers(requestInit.headers)
  const shouldIncludeCSRF =
    options.includeCSRF ?? !["GET", "HEAD", "OPTIONS"].includes(method)

  if (shouldIncludeCSRF) {
    const csrfToken = getCSRFToken()
    if (csrfToken) {
      headers.set("X-CSRF-Token", csrfToken)
    }
  }

  const response = await fetch(input, {
    credentials: "include",
    ...requestInit,
    headers,
  })

  if (response.status === 401 && !options.suppressAuthRedirect) {
    handleUnauthorized()
  }

  return response
}

async function parseJson<T>(response: Response): Promise<T> {
  const bodyText = await response.text()
  const contentType = response.headers.get("content-type") ?? ""
  const isJson = contentType.toLowerCase().includes("application/json")

  let payload: unknown = null
  if (bodyText.length > 0 && isJson) {
    try {
      payload = JSON.parse(bodyText)
    } catch {
      // Fall back to status-based error handling below.
    }
  }

  if (!response.ok) {
    const apiMessage =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: unknown }).error
        : null
    const message =
      typeof apiMessage === "string" && apiMessage.length > 0
        ? apiMessage
        : `Request failed (HTTP ${response.status})`
    throw new Error(message)
  }

  if (payload === null) {
    if (bodyText.length === 0) {
      throw new Error("Empty response from server")
    }
    throw new Error(`Unexpected response format (HTTP ${response.status})`)
  }

  return payload as T
}

export async function uploadWorkbook(
  file: File,
  folderId?: string
): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append("file", file)
  if (folderId) {
    formData.append("folderId", folderId)
  }

  const response = await apiFetch(`${API_BASE_URL}/api/upload`, {
    method: "POST",
    body: formData,
  })

  return parseJson<UploadResponse>(response)
}

export async function fetchSheet(
  workbookId: string,
  sheetName?: string,
  window?: {
    rowStart?: number
    rowCount?: number
    colStart?: number
    colCount?: number
  }
): Promise<SheetResponse> {
  const params = new URLSearchParams()
  if (sheetName) {
    params.set("sheet", sheetName)
  }
  if (window?.rowStart) {
    params.set("rowStart", String(window.rowStart))
  }
  if (window?.rowCount) {
    params.set("rowCount", String(window.rowCount))
  }
  if (window?.colStart) {
    params.set("colStart", String(window.colStart))
  }
  if (window?.colCount) {
    params.set("colCount", String(window.colCount))
  }

  const url = `${API_BASE_URL}/api/sheet/${workbookId}${params.size > 0 ? `?${params.toString()}` : ""}`
  const response = await apiFetch(url)

  return parseJson<SheetResponse>(response)
}

export async function fetchSheetWindow(
  workbookId: string,
  payload: {
    sheet: string
    rowStart: number
    rowCount: number
    colStart: number
    colCount: number
  }
): Promise<SheetResponse> {
  return fetchSheet(workbookId, payload.sheet, payload)
}

export async function updateCell(
  workbookId: string,
  payload: { sheet: string; row: number; col: number; value: string }
): Promise<SheetResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/cell`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<SheetResponse>(response)
}

export async function applyStyle(
  workbookId: string,
  payload: { sheet: string; target: SelectionTarget; patch: Partial<CellStyle> }
): Promise<{ status: string }> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/style`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<{ status: string }>(response)
}

export async function clearFormattingRange(
  workbookId: string,
  payload: { sheet: string; target: SelectionTarget }
): Promise<{ status: string }> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/clear-formatting`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<{ status: string }>(response)
}

export async function clearValuesRange(
  workbookId: string,
  payload: { sheet: string; target: SelectionTarget }
): Promise<{ status: string }> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/clear-values`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<{ status: string }>(response)
}

export async function saveSheet(
  workbookId: string,
  payload: { sheet: Sheet }
): Promise<SheetResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<SheetResponse>(response)
}

export async function createSheet(
  workbookId: string,
  payload: { name: string }
): Promise<SheetResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/create`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<SheetResponse>(response)
}

export async function saveKanbanRegions(
  workbookId: string,
  payload: { kanbanRegions: KanbanRegion[] }
): Promise<KanbanRegionsResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/kanban`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<KanbanRegionsResponse>(response)
}

export async function resizeSheet(
  workbookId: string,
  payload: { sheet: string; addRows?: number; addCols?: number },
  window?: {
    rowStart?: number
    rowCount?: number
    colStart?: number
    colCount?: number
  }
): Promise<SheetResponse> {
  const params = new URLSearchParams()
  if (window?.rowStart) {
    params.set("rowStart", String(window.rowStart))
  }
  if (window?.rowCount) {
    params.set("rowCount", String(window.rowCount))
  }
  if (window?.colStart) {
    params.set("colStart", String(window.colStart))
  }
  if (window?.colCount) {
    params.set("colCount", String(window.colCount))
  }

  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/resize${params.size > 0 ? `?${params.toString()}` : ""}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<SheetResponse>(response)
}

export async function deleteRows(
  workbookId: string,
  payload: { sheet: string; start: number; count: number },
  window?: {
    rowStart?: number
    rowCount?: number
    colStart?: number
    colCount?: number
  }
): Promise<SheetResponse> {
  const params = new URLSearchParams()
  if (window?.rowStart) {
    params.set("rowStart", String(window.rowStart))
  }
  if (window?.rowCount) {
    params.set("rowCount", String(window.rowCount))
  }
  if (window?.colStart) {
    params.set("colStart", String(window.colStart))
  }
  if (window?.colCount) {
    params.set("colCount", String(window.colCount))
  }
  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/delete-rows${params.size > 0 ? `?${params.toString()}` : ""}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<SheetResponse>(response)
}

export async function insertRows(
  workbookId: string,
  payload: { sheet: string; start: number; count: number },
  window?: {
    rowStart?: number
    rowCount?: number
    colStart?: number
    colCount?: number
  }
): Promise<SheetResponse> {
  const params = new URLSearchParams()
  if (window?.rowStart) {
    params.set("rowStart", String(window.rowStart))
  }
  if (window?.rowCount) {
    params.set("rowCount", String(window.rowCount))
  }
  if (window?.colStart) {
    params.set("colStart", String(window.colStart))
  }
  if (window?.colCount) {
    params.set("colCount", String(window.colCount))
  }
  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/insert-rows${params.size > 0 ? `?${params.toString()}` : ""}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<SheetResponse>(response)
}

export async function deleteCols(
  workbookId: string,
  payload: { sheet: string; start: number; count: number },
  window?: {
    rowStart?: number
    rowCount?: number
    colStart?: number
    colCount?: number
  }
): Promise<SheetResponse> {
  const params = new URLSearchParams()
  if (window?.rowStart) {
    params.set("rowStart", String(window.rowStart))
  }
  if (window?.rowCount) {
    params.set("rowCount", String(window.rowCount))
  }
  if (window?.colStart) {
    params.set("colStart", String(window.colStart))
  }
  if (window?.colCount) {
    params.set("colCount", String(window.colCount))
  }
  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/delete-cols${params.size > 0 ? `?${params.toString()}` : ""}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<SheetResponse>(response)
}

export async function insertCols(
  workbookId: string,
  payload: { sheet: string; start: number; count: number },
  window?: {
    rowStart?: number
    rowCount?: number
    colStart?: number
    colCount?: number
  }
): Promise<SheetResponse> {
  const params = new URLSearchParams()
  if (window?.rowStart) {
    params.set("rowStart", String(window.rowStart))
  }
  if (window?.rowCount) {
    params.set("rowCount", String(window.rowCount))
  }
  if (window?.colStart) {
    params.set("colStart", String(window.colStart))
  }
  if (window?.colCount) {
    params.set("colCount", String(window.colCount))
  }
  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/insert-cols${params.size > 0 ? `?${params.toString()}` : ""}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<SheetResponse>(response)
}

export async function renameSheet(
  workbookId: string,
  payload: { oldName: string; newName: string }
): Promise<SheetResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/rename`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<SheetResponse>(response)
}

export async function deleteSheet(
  workbookId: string,
  payload: { name: string }
): Promise<SheetResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/sheet/${workbookId}/delete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<SheetResponse>(response)
}

export async function listFiles(): Promise<FilesResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/files`)
  return parseJson<FilesResponse>(response)
}

export async function createWorkbook(payload?: {
  name?: string
  folderId?: string
}): Promise<UploadResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  })
  return parseJson<UploadResponse>(response)
}

export async function listRecentFiles(limit = 10): Promise<FilesResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/files/recent?limit=${limit}`
  )
  return parseJson<FilesResponse>(response)
}

export async function openFile(
  fileId: string,
  window?: {
    rowStart?: number
    rowCount?: number
    colStart?: number
    colCount?: number
  }
): Promise<SheetResponse> {
  const params = new URLSearchParams()
  if (window?.rowStart) {
    params.set("rowStart", String(window.rowStart))
  }
  if (window?.rowCount) {
    params.set("rowCount", String(window.rowCount))
  }
  if (window?.colStart) {
    params.set("colStart", String(window.colStart))
  }
  if (window?.colCount) {
    params.set("colCount", String(window.colCount))
  }
  const response = await apiFetch(
    `${API_BASE_URL}/api/files/${fileId}/open${params.size > 0 ? `?${params.toString()}` : ""}`,
    {
      method: "POST",
    }
  )
  return parseJson<SheetResponse>(response)
}

export async function renameFile(
  fileId: string,
  payload: { name: string }
): Promise<{ status: string }> {
  const response = await apiFetch(`${API_BASE_URL}/api/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<{ status: string }>(response)
}

export async function removeFile(fileId: string): Promise<{ status: string }> {
  const response = await apiFetch(`${API_BASE_URL}/api/files/${fileId}`, {
    method: "DELETE",
  })
  return parseJson<{ status: string }>(response)
}

export async function moveFile(
  fileId: string,
  payload: { folderId?: string }
): Promise<{ status: string }> {
  const response = await apiFetch(`${API_BASE_URL}/api/files/${fileId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<{ status: string }>(response)
}

export async function createFolder(payload: {
  name: string
  parentId?: string
}): Promise<FolderEntry> {
  const response = await apiFetch(`${API_BASE_URL}/api/files/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<FolderEntry>(response)
}

export async function renameFolder(
  folderId: string,
  payload: { name: string }
): Promise<FolderEntry> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/files/folders/${folderId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<FolderEntry>(response)
}

export async function moveFolder(
  folderId: string,
  payload: { parentId?: string }
): Promise<FolderEntry> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/files/folders/${folderId}/move`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<FolderEntry>(response)
}

export async function removeFolder(
  folderId: string
): Promise<{ status: string }> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/files/folders/${folderId}`,
    {
      method: "DELETE",
    }
  )
  return parseJson<{ status: string }>(response)
}

export async function downloadFileBlob(
  fileId: string,
  options: { format: "xlsx" | "csv"; sheet?: string }
): Promise<Blob> {
  const params = new URLSearchParams({ format: options.format })
  if (options.sheet) {
    params.set("sheet", options.sheet)
  }

  const response = await apiFetch(
    `${API_BASE_URL}/api/files/${fileId}/download?${params.toString()}`,
    undefined,
    { includeCSRF: false }
  )

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? ""
    if (contentType.toLowerCase().includes("application/json")) {
      const payload = (await response.json()) as { error?: unknown }
      const message =
        typeof payload.error === "string" && payload.error.length > 0
          ? payload.error
          : `Request failed (HTTP ${response.status})`
      throw new Error(message)
    }
    throw new Error(`Request failed (HTTP ${response.status})`)
  }

  return response.blob()
}

export async function fetchFileSettings(
  fileId: string
): Promise<FileSettingsResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/files/${fileId}/settings`
  )
  return parseJson<FileSettingsResponse>(response)
}

export async function updateFileSettings(
  fileId: string,
  settings: FileSettings
): Promise<FileSettingsResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/files/${fileId}/settings`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    }
  )
  return parseJson<FileSettingsResponse>(response)
}

export async function listEmailProfiles(): Promise<EmailProfilesResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/email-profiles`)
  return parseJson<EmailProfilesResponse>(response)
}

export async function createEmailProfile(
  profile: EmailProfileInput
): Promise<EmailProfileResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/email-profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile }),
  })
  return parseJson<EmailProfileResponse>(response)
}

export async function updateEmailProfile(
  profileId: string,
  profile: EmailProfileInput
): Promise<EmailProfileResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/email-profiles/${profileId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
    }
  )
  return parseJson<EmailProfileResponse>(response)
}

export async function deleteEmailProfile(
  profileId: string
): Promise<{ status: string }> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/email-profiles/${profileId}`,
    {
      method: "DELETE",
    }
  )
  return parseJson<{ status: string }>(response)
}

export async function sendFileEmail(
  fileId: string,
  payload: SendEmailRequest
): Promise<{ status: string }> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/files/${fileId}/email/send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<{ status: string }>(response)
}

export async function sendFileTestEmail(
  fileId: string,
  payload: { to: string }
): Promise<{ status: string }> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/files/${fileId}/email/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  return parseJson<{ status: string }>(response)
}

export async function listManagedDomains(): Promise<ManagedDomainsResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/domains`)
  return parseJson<ManagedDomainsResponse>(response)
}

export async function checkManagedDomain(
  domain: string
): Promise<DomainCheckResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/domains/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain }),
  })
  return parseJson<DomainCheckResponse>(response)
}

export async function createManagedDomain(
  domain: string
): Promise<ManagedDomainResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/domains`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain }),
  })
  return parseJson<ManagedDomainResponse>(response)
}

export async function fetchAuthSession(): Promise<AuthSessionResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/auth/session`,
    undefined,
    { suppressAuthRedirect: true, includeCSRF: false }
  )
  return parseJson<AuthSessionResponse>(response)
}

export async function login(payload: {
  email: string
  password: string
}): Promise<AuthSessionResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { suppressAuthRedirect: true, includeCSRF: false }
  )
  return parseJson<AuthSessionResponse>(response)
}

export async function signup(payload: {
  name: string
  email: string
  password: string
}): Promise<AuthSessionResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/auth/signup`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { suppressAuthRedirect: true, includeCSRF: false }
  )
  return parseJson<AuthSessionResponse>(response)
}

export async function logout(): Promise<AuthSessionResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/auth/logout`,
    { method: "POST" },
    { suppressAuthRedirect: true }
  )
  return parseJson<AuthSessionResponse>(response)
}

export async function listAllowlistEntries(): Promise<AllowlistResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/admin/allowlist`)
  return parseJson<AllowlistResponse>(response)
}

export async function fetchSignupPolicy(): Promise<AuthBootstrap> {
  const response = await apiFetch(`${API_BASE_URL}/api/admin/signup-policy`)
  return parseJson<AuthBootstrap>(response)
}

export async function updateSignupPolicy(payload: {
  signupsEnabled: boolean
  inviteOnly: boolean
}): Promise<AuthBootstrap> {
  const response = await apiFetch(`${API_BASE_URL}/api/admin/signup-policy`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<AuthBootstrap>(response)
}

export async function addAllowlistEntry(
  email: string
): Promise<{ email: string }> {
  const response = await apiFetch(`${API_BASE_URL}/api/admin/allowlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  })
  return parseJson<{ email: string }>(response)
}

export async function deleteAllowlistEntry(
  email: string
): Promise<{ status: string }> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/admin/allowlist?email=${encodeURIComponent(email)}`,
    { method: "DELETE" }
  )
  return parseJson<{ status: string }>(response)
}

export async function fetchSnapshotStatus(): Promise<SnapshotStatusResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/admin/snapshots`)
  return parseJson<SnapshotStatusResponse>(response)
}

export async function updateSnapshotSettings(payload: {
  enabled: boolean
  endpoint: string
  region: string
  bucket: string
  prefix: string
  accessKeyId: string
  secretAccessKey: string
  clearSecretAccessKey: boolean
  usePathStyle: boolean
  scheduleIntervalHours: number
  retentionCount: number
}): Promise<SnapshotStatusResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/admin/snapshots`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<SnapshotStatusResponse>(response)
}

export async function runSnapshotNow(): Promise<SnapshotStatusResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/admin/snapshots/run`, {
    method: "POST",
  })
  return parseJson<SnapshotStatusResponse>(response)
}

export async function restoreSnapshotRun(
  runId: string
): Promise<SnapshotStatusResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/admin/snapshots/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId }),
  })
  return parseJson<SnapshotStatusResponse>(response)
}
