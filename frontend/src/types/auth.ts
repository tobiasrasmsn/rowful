export type AuthUser = {
  id: string
  name: string
  email: string
  isAdmin: boolean
  createdAt: string
}

export type AuthBootstrap = {
  setupRequired: boolean
  inviteOnly: boolean
}

export type AuthSessionResponse = {
  authenticated: boolean
  user?: AuthUser
  csrfToken?: string
  bootstrap: AuthBootstrap
}

export type AllowlistEntry = {
  email: string
  createdAt: string
  invitedByEmail?: string
  claimedAt?: string
  claimedByEmail?: string
}

export type AllowlistResponse = {
  entries: AllowlistEntry[]
}
