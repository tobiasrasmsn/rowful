import type {
  CellStyle,
  FileSettings,
  FileSettingsResponse,
  FilesResponse,
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

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "")

async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.json()
  if (!response.ok) {
    const message =
      typeof payload?.error === "string" ? payload.error : "Request failed"
    throw new Error(message)
  }
  return payload as T
}

export async function uploadWorkbook(file: File): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append("file", file)

  const response = await fetch(`${API_BASE_URL}/api/upload`, {
    method: "POST",
    body: formData,
  })

  return parseJson<UploadResponse>(response)
}

export async function fetchSheet(
  workbookId: string,
  sheetName?: string,
  window?: { rowStart?: number; rowCount?: number; colStart?: number; colCount?: number }
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
  const response = await fetch(url)

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
  const response = await fetch(`${API_BASE_URL}/api/sheet/${workbookId}/cell`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<SheetResponse>(response)
}

export async function applyStyle(
  workbookId: string,
  payload: { sheet: string; target: SelectionTarget; patch: Partial<CellStyle> }
): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/api/sheet/${workbookId}/style`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<{ status: string }>(response)
}

export async function clearFormattingRange(
  workbookId: string,
  payload: { sheet: string; target: SelectionTarget }
): Promise<{ status: string }> {
  const response = await fetch(
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
  const response = await fetch(`${API_BASE_URL}/api/sheet/${workbookId}/clear-values`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<{ status: string }>(response)
}

export async function saveSheet(
  workbookId: string,
  payload: { sheet: Sheet }
): Promise<SheetResponse> {
  const response = await fetch(`${API_BASE_URL}/api/sheet/${workbookId}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<SheetResponse>(response)
}

export async function createSheet(
  workbookId: string,
  payload: { name: string }
): Promise<SheetResponse> {
  const response = await fetch(`${API_BASE_URL}/api/sheet/${workbookId}/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<SheetResponse>(response)
}

export async function resizeSheet(
  workbookId: string,
  payload: { sheet: string; addRows?: number; addCols?: number },
  window?: { rowStart?: number; rowCount?: number; colStart?: number; colCount?: number }
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

  const response = await fetch(
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
  window?: { rowStart?: number; rowCount?: number; colStart?: number; colCount?: number }
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
  const response = await fetch(
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
  window?: { rowStart?: number; rowCount?: number; colStart?: number; colCount?: number }
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
  const response = await fetch(
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
  window?: { rowStart?: number; rowCount?: number; colStart?: number; colCount?: number }
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
  const response = await fetch(
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
  window?: { rowStart?: number; rowCount?: number; colStart?: number; colCount?: number }
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
  const response = await fetch(
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
  const response = await fetch(`${API_BASE_URL}/api/sheet/${workbookId}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<SheetResponse>(response)
}

export async function deleteSheet(
  workbookId: string,
  payload: { name: string }
): Promise<SheetResponse> {
  const response = await fetch(`${API_BASE_URL}/api/sheet/${workbookId}/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<SheetResponse>(response)
}

export async function listFiles(): Promise<FilesResponse> {
  const response = await fetch(`${API_BASE_URL}/api/files`)
  return parseJson<FilesResponse>(response)
}

export async function listRecentFiles(limit = 10): Promise<FilesResponse> {
  const response = await fetch(`${API_BASE_URL}/api/files/recent?limit=${limit}`)
  return parseJson<FilesResponse>(response)
}

export async function openFile(
  fileId: string,
  window?: { rowStart?: number; rowCount?: number; colStart?: number; colCount?: number }
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
  const response = await fetch(
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
  const response = await fetch(`${API_BASE_URL}/api/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<{ status: string }>(response)
}

export async function removeFile(fileId: string): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/api/files/${fileId}`, {
    method: "DELETE",
  })
  return parseJson<{ status: string }>(response)
}

export async function fetchFileSettings(fileId: string): Promise<FileSettingsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/files/${fileId}/settings`)
  return parseJson<FileSettingsResponse>(response)
}

export async function updateFileSettings(
  fileId: string,
  settings: FileSettings
): Promise<FileSettingsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/files/${fileId}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  })
  return parseJson<FileSettingsResponse>(response)
}

export async function sendFileEmail(
  fileId: string,
  payload: SendEmailRequest
): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/api/files/${fileId}/email/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<{ status: string }>(response)
}

export async function sendFileTestEmail(
  fileId: string,
  payload: { to: string }
): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/api/files/${fileId}/email/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseJson<{ status: string }>(response)
}

export async function listManagedDomains(): Promise<ManagedDomainsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/domains`)
  return parseJson<ManagedDomainsResponse>(response)
}

export async function checkManagedDomain(
  domain: string
): Promise<DomainCheckResponse> {
  const response = await fetch(`${API_BASE_URL}/api/domains/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain }),
  })
  return parseJson<DomainCheckResponse>(response)
}

export async function createManagedDomain(
  domain: string
): Promise<ManagedDomainResponse> {
  const response = await fetch(`${API_BASE_URL}/api/domains`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain }),
  })
  return parseJson<ManagedDomainResponse>(response)
}
