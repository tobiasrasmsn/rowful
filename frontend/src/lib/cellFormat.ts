import type { CellStyle } from "@/types/sheet"

const NUMBER_FORMATS = new Set(["0.00", "0.00%", "$#,##0.00", "0.00E+00"])
const DEFAULT_CURRENCY = "USD"

const numberFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const currencyFormatterCache = new Map<string, Intl.NumberFormat>()

const normalizeCurrency = (currency?: string) => {
  const normalized = currency?.trim().toUpperCase()
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : DEFAULT_CURRENCY
}

const getCurrencyFormatter = (currency?: string) => {
  const normalized = normalizeCurrency(currency)
  if (!currencyFormatterCache.has(normalized)) {
    currencyFormatterCache.set(
      normalized,
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: normalized,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    )
  }
  return currencyFormatterCache.get(normalized)!
}

const cleanNumericInput = (value: string) => value.trim().replace(/,/g, "")

const parseNumericValue = (value: string) => {
  const normalized = cleanNumericInput(value)
  if (normalized === "") {
    return null
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const parseDateValue = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (isoDateOnly) {
    const year = Number(isoDateOnly[1])
    const month = Number(isoDateOnly[2])
    const day = Number(isoDateOnly[3])
    const date = new Date(year, month - 1, day)
    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return date
    }
    return null
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed
}

const formatDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const isBlankValue = (value: string) => value.trim() === ""

export const isValueValidForNumFmt = (value: string, numFmt?: string) => {
  if (!numFmt || numFmt === "@") {
    return true
  }
  if (isBlankValue(value)) {
    return true
  }
  if (NUMBER_FORMATS.has(numFmt)) {
    return parseNumericValue(value) !== null
  }
  if (numFmt === "yyyy-mm-dd") {
    return parseDateValue(value) !== null
  }
  return true
}

export const formatValueByNumFmt = (
  value: string,
  numFmt?: string,
  options?: { currency?: string }
) => {
  if (!numFmt || numFmt === "@") {
    return value
  }
  if (isBlankValue(value)) {
    return value
  }

  if (numFmt === "yyyy-mm-dd") {
    const parsedDate = parseDateValue(value)
    if (!parsedDate) {
      return value
    }
    return formatDate(parsedDate)
  }

  const parsedNumber = parseNumericValue(value)
  if (parsedNumber === null) {
    return value
  }

  switch (numFmt) {
    case "0.00":
      return numberFormatter.format(parsedNumber)
    case "0.00%":
      return percentFormatter.format(parsedNumber)
    case "$#,##0.00":
      return getCurrencyFormatter(options?.currency).format(parsedNumber)
    case "0.00E+00":
      return parsedNumber.toExponential(2).replace("e", "E")
    default:
      return value
  }
}

export const renderCellDisplayValue = (
  value: string,
  style?: CellStyle,
  fallbackDisplay?: string,
  options?: { currency?: string }
) => {
  const numFmt = style?.numFmt
  if (numFmt && numFmt !== "@") {
    const formatted = formatValueByNumFmt(value, numFmt, options)
    if (formatted !== value || !fallbackDisplay) {
      return formatted
    }
    return fallbackDisplay
  }
  return fallbackDisplay || value
}
