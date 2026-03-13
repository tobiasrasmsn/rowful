const LAST_OPENED_SHEETS_KEY = "rowful:last-opened-sheets"

const readMap = (): Record<string, string> => {
  if (typeof window === "undefined") {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(LAST_OPENED_SHEETS_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => typeof key === "string" && typeof value === "string"
      )
    )
  } catch {
    return {}
  }
}

const writeMap = (map: Record<string, string>) => {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.localStorage.setItem(LAST_OPENED_SHEETS_KEY, JSON.stringify(map))
  } catch {
    // ignore storage write failures
  }
}

export const getLastOpenedSheetForFile = (fileID: string): string | null => {
  if (!fileID) {
    return null
  }

  const map = readMap()
  return map[fileID] ?? null
}

export const setLastOpenedSheetForFile = (
  fileID: string,
  sheetName: string
) => {
  if (!fileID || !sheetName) {
    return
  }

  const map = readMap()
  map[fileID] = sheetName
  writeMap(map)
}
