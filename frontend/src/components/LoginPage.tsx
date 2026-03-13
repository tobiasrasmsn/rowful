import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"

import { AuthShell } from "@/components/auth/AuthShell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuthStore } from "@/store/authStore"

export function LoginPage() {
  const login = useAuthStore((state) => state.login)
  const bootstrap = useAuthStore((state) => state.bootstrap)
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const nextPath = (location.state as { from?: { pathname?: string } } | null)
    ?.from?.pathname

  return (
    <AuthShell
      title="Welcome back!"
      description="Please sign in to continue."
      alternateLabel="Need an account?"
      alternateHref="/signup"
      alternateText="Sign up"
    >
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setError(null)
          setIsSubmitting(true)
          try {
            await login({ email, password })
            navigate(nextPath && nextPath !== "/login" ? nextPath : "/", {
              replace: true,
            })
          } catch (submitError) {
            setError(
              submitError instanceof Error
                ? submitError.message
                : "Failed to sign in"
            )
          } finally {
            setIsSubmitting(false)
          }
        }}
      >
        <div className="space-y-2">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor="login-email"
          >
            Email
          </label>
          <Input
            id="login-email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            className="h-10 rounded-lg focus-within:ring-0!"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-2">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor="login-password"
          >
            Password
          </label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            className="h-10 rounded-lg focus-within:ring-0!"
          />
        </div>

        {error ? <div className="text-sm text-destructive">{error}</div> : null}

        <Button
          className="h-10 w-full cursor-pointer rounded-lg font-semibold"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  )
}
