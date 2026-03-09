import type { FileSettings } from "@/types/sheet"

export const DEFAULT_FILE_SETTINGS: FileSettings = {
  currency: "USD",
  email: {
    host: "",
    port: 587,
    username: "",
    password: "",
    fromEmail: "",
    fromName: "",
    useTLS: true,
  },
}
