import { useMemo } from "react"
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

const BAYER_MATRIX = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
].map((row) => row.map((value) => (value + 0.5) / 64))

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "forrest", label: "Forrest", icon: LeafIcon },
  { value: "blossom", label: "Blossom", icon: HeartIcon },
  { value: "matcha", label: "Matcha", icon: SproutIcon },
] as const

const hashString = (value: string) => {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }
  return hash >>> 0
}

const createPRNG = (seed: number) => {
  let currentSeed = seed || 1
  return () => {
    currentSeed = (currentSeed * 16807) % 2147483647
    return (currentSeed - 1) / 2147483646
  }
}

function HashAvatar({
  seed,
  size = 40,
  gridRes = 16,
  className,
}: {
  seed: string
  size?: number
  gridRes?: number
  className?: string
}) {
  const { bg, rects } = useMemo(() => {
    const hashedSeed = hashString(seed || "rowful")
    const random = createPRNG(hashedSeed)
    const baseHue = random() * 360
    const bg = `hsl(${baseHue}, 90%, 15%)`
    const fg = `hsl(${baseHue + (random() * 40 - 20)}, 100%, 80%)`
    const angle = random() * Math.PI * 2
    const cosAngle = Math.cos(angle)
    const sinAngle = Math.sin(angle)
    const center = gridRes / 2
    const maxDistance = (gridRes / 2) * Math.sqrt(2)
    const contrastMultiplier = 1.2
    const generatedRects: React.ReactNode[] = []

    for (let y = 0; y < gridRes; y += 1) {
      for (let x = 0; x < gridRes; x += 1) {
        const dx = x - center
        const dy = y - center
        const dotProduct = dx * cosAngle + dy * sinAngle
        let gradientValue = (dotProduct + maxDistance) / (maxDistance * 2)
        gradientValue = (gradientValue - 0.5) * contrastMultiplier + 0.5
        const threshold = BAYER_MATRIX[y % 8][x % 8]

        if (gradientValue > threshold) {
          generatedRects.push(
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={fg}
            />
          )
        }
      }
    }

    return { bg, rects: generatedRects }
  }, [gridRes, seed])

  return (
    <div
      className={cn("inline-block overflow-hidden shadow-sm", className)}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 6,
      }}
    >
      <svg
        viewBox={`0 0 ${gridRes} ${gridRes}`}
        width="100%"
        height="100%"
        shapeRendering="crispEdges"
        style={{
          display: "block",
          backgroundColor: bg,
        }}
      >
        {rects}
      </svg>
    </div>
  )
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
  const avatarSeed = user?.id || user?.email || label || "rowful"
  const selectedTheme = theme === "system" ? resolvedTheme : theme

  return (
    <div className={cn("px-2 py-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex size-9 items-center justify-center rounded-full"
            aria-label="Open user menu"
          >
            <HashAvatar
              seed={avatarSeed}
              size={32}
              className="transition-transform duration-200 hover:scale-[1.03]"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56">
          <PopoverHeader>
            <div className="flex items-center gap-3">
              <HashAvatar seed={avatarSeed} size={44} className="shrink-0" />
              <div className="min-w-0">
                <PopoverTitle className="truncate">
                  {label ?? "Unknown user"}
                </PopoverTitle>
                <p className="truncate text-xs text-muted-foreground">
                  {user?.email}
                </p>
              </div>
            </div>
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
