let csrfToken: string | null = null
let unauthorizedHandler: (() => void) | null = null

export function getCSRFToken() {
  return csrfToken
}

export function setCSRFToken(nextToken: string | null) {
  csrfToken = nextToken
}

export function registerUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export function handleUnauthorized() {
  unauthorizedHandler?.()
}
