type FileNameParts = {
  baseName: string
  extension: string
}

const splitFileName = (fileName: string): FileNameParts => {
  const trimmed = fileName.trim()
  const lastDot = trimmed.lastIndexOf(".")

  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return {
      baseName: trimmed,
      extension: "",
    }
  }

  return {
    baseName: trimmed.slice(0, lastDot),
    extension: trimmed.slice(lastDot),
  }
}

export const getDisplayFileName = (fileName: string) => splitFileName(fileName).baseName

export const buildRenamedFileName = (currentFileName: string, nextBaseName: string) => {
  const trimmedBaseName = nextBaseName.trim()
  if (!trimmedBaseName) {
    return currentFileName
  }

  const { extension } = splitFileName(currentFileName)
  return `${trimmedBaseName}${extension}`
}

const padTimestampPart = (value: number) => value.toString().padStart(2, "0")

export const buildUntitledSpreadsheetName = (date = new Date()) => {
  const year = date.getFullYear()
  const month = padTimestampPart(date.getMonth() + 1)
  const day = padTimestampPart(date.getDate())
  const hours = padTimestampPart(date.getHours())
  const minutes = padTimestampPart(date.getMinutes())
  const seconds = padTimestampPart(date.getSeconds())

  return `Untitled spreadsheet ${year}-${month}-${day} ${hours}.${minutes}.${seconds}`
}
