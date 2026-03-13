import { useLocation, useNavigate } from "react-router-dom"
import {
  CheckIcon,
  HeartIcon,
  LeafIcon,
  MoonIcon,
  SproutIcon,
  SunIcon,
} from "lucide-react"

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

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "forrest", label: "Forrest", icon: LeafIcon },
  { value: "blossom", label: "Blossom", icon: HeartIcon },
  { value: "matcha", label: "Matcha", icon: SproutIcon },
] as const

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
  const { theme, resolvedTheme, setTheme } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()

  const isFilesPage = location.pathname.startsWith("/files")
  const isDomainsPage = location.pathname.startsWith("/domains")
  const isEmailProfilesPage = location.pathname.startsWith("/email-profiles")
  const label = user?.name ?? user?.email
  const selectedTheme = theme === "system" ? resolvedTheme : theme

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
          <Button
            variant={isEmailProfilesPage ? "secondary" : "ghost"}
            className="w-full justify-start"
            onClick={() => navigate("/email-profiles")}
          >
            Email Profiles
          </Button>
          <Separator className="my-1" />
          <div className="space-y-1">
            <p className="px-2 pt-1 text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
              Theme
            </p>
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon
              const isActive = selectedTheme === option.value

              return (
                <Button
                  key={option.value}
                  variant={isActive ? "secondary" : "ghost"}
                  className="w-full justify-between"
                  onClick={() => setTheme(option.value)}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="size-4" />
                    {option.label}
                  </span>
                  {isActive ? <CheckIcon className="size-4" /> : null}
                </Button>
              )
            })}
          </div>
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
