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
