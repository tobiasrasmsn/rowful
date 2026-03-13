import { useLocation, useNavigate } from "react-router-dom"
import { MoonIcon, SunIcon } from "lucide-react"

import { useAuthStore } from "@/store/authStore"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"

type UserActionsPopoverProps = {
  className?: string
}

function getInitial(nameOrEmail?: string) {
  const trimmed = nameOrEmail?.trim()
  if (!trimmed) {
    return "?"
  }
  return trimmed[0]?.toUpperCase() ?? "?"
}

export function UserActionsPopover({ className }: UserActionsPopoverProps) {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const { resolvedTheme, setTheme } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()

  const isFilesPage = location.pathname.startsWith("/files")
  const isDomainsPage = location.pathname.startsWith("/domains")
  const label = user?.name ?? user?.email
  const isDarkTheme = resolvedTheme === "dark"

  return (
    <div className={cn("px-2 py-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex size-9 items-center justify-center rounded-full border border-border bg-muted text-sm font-medium text-foreground hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:outline-none"
            aria-label="Open user menu"
          >
            {getInitial(label)}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56">
          <PopoverHeader>
            <PopoverTitle>{label ?? "Unknown user"}</PopoverTitle>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </PopoverHeader>

          {user?.isAdmin ? (
            <Button
              variant={isDomainsPage ? "secondary" : "ghost"}
              className="w-full justify-start"
              onClick={() => navigate("/domains")}
            >
              Domains
            </Button>
          ) : null}
          <Button
            variant={isFilesPage ? "secondary" : "ghost"}
            className="w-full justify-start"
            onClick={() => navigate("/files")}
          >
            Browse Files
          </Button>
          <Separator className="my-1" />
          <Button
            variant="ghost"
            className="w-full justify-between"
            onClick={() => setTheme(isDarkTheme ? "light" : "dark")}
          >
            <span className="flex items-center gap-2">
              {isDarkTheme ? (
                <MoonIcon className="size-4" />
              ) : (
                <SunIcon className="size-4" />
              )}
              Theme
            </span>
            <span className="text-xs text-muted-foreground">
              {isDarkTheme ? "Dark" : "Light"}
            </span>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-destructive hover:text-destructive"
            onClick={async () => {
              await logout()
              navigate("/login", { replace: true })
            }}
          >
            Sign out
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  )
}
