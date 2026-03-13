import { create } from "zustand"

import {
  fetchAuthSession,
  login as loginRequest,
  logout as logoutRequest,
  signup as signupRequest,
} from "@/api/client"
import { registerUnauthorizedHandler, setCSRFToken } from "@/lib/authSession"
import { resetSheetStore } from "@/store/sheetStore"
import type { AuthBootstrap, AuthUser } from "@/types/auth"

type AuthStatus = "loading" | "authenticated" | "guest"

type AuthState = {
  status: AuthStatus
  user: AuthUser | null
  bootstrap: AuthBootstrap
  managedDomainsEnabled: boolean
  isReady: boolean
  initialize: () => Promise<void>
  refreshSession: () => Promise<void>
  login: (payload: { email: string; password: string }) => Promise<void>
  signup: (payload: { name: string; email: string; password: string }) => Promise<void>
  logout: () => Promise<void>
  handleUnauthorized: () => void
}

const GUEST_BOOTSTRAP: AuthBootstrap = {
  setupRequired: false,
  inviteOnly: false,
}

function applyGuestState() {
  setCSRFToken(null)
  resetSheetStore()
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  bootstrap: GUEST_BOOTSTRAP,
  managedDomainsEnabled: true,
  isReady: false,

  initialize: async () => {
    registerUnauthorizedHandler(() => {
      useAuthStore.getState().handleUnauthorized()
    })
    await useAuthStore.getState().refreshSession()
  },

  refreshSession: async () => {
    try {
      const response = await fetchAuthSession()
      setCSRFToken(response.csrfToken ?? null)
      if (response.authenticated && response.user) {
        set({
          status: "authenticated",
          user: response.user,
          bootstrap: response.bootstrap,
          managedDomainsEnabled: response.managedDomainsEnabled,
          isReady: true,
        })
        return
      }
      applyGuestState()
      set({
        status: "guest",
        user: null,
        bootstrap: response.bootstrap,
        managedDomainsEnabled: response.managedDomainsEnabled,
        isReady: true,
      })
    } catch {
      applyGuestState()
      set({
        status: "guest",
        user: null,
        bootstrap: GUEST_BOOTSTRAP,
        managedDomainsEnabled: true,
        isReady: true,
      })
    }
  },

  login: async (payload) => {
    const response = await loginRequest(payload)
    setCSRFToken(response.csrfToken ?? null)
    set({
      status: "authenticated",
      user: response.user ?? null,
      bootstrap: response.bootstrap,
      managedDomainsEnabled: response.managedDomainsEnabled,
      isReady: true,
    })
  },

  signup: async (payload) => {
    const response = await signupRequest(payload)
    setCSRFToken(response.csrfToken ?? null)
    set({
      status: "authenticated",
      user: response.user ?? null,
      bootstrap: response.bootstrap,
      managedDomainsEnabled: response.managedDomainsEnabled,
      isReady: true,
    })
  },

  logout: async () => {
    try {
      const response = await logoutRequest()
      set({
        bootstrap: response.bootstrap,
        managedDomainsEnabled: response.managedDomainsEnabled,
      })
    } finally {
      applyGuestState()
      set({
        status: "guest",
        user: null,
        isReady: true,
      })
    }
  },

  handleUnauthorized: () => {
    applyGuestState()
    set({
      status: "guest",
      user: null,
      isReady: true,
    })
  },
}))
