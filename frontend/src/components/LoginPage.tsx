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

  const nextPath = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname

  return (
    <AuthShell
      title="Sign in"
      description="Use the account hosted on this Planar instance. Sessions stay server-side in a secure HttpOnly cookie."
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
            navigate(nextPath && nextPath !== "/login" ? nextPath : "/", { replace: true })
          } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "Failed to sign in")
          } finally {
            setIsSubmitting(false)
          }
        }}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="login-email">
            Email
          </label>
          <Input
            id="login-email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="login-password">
            Password
          </label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
          />
        </div>

        {error ? <div className="text-sm text-rose-600">{error}</div> : null}

        <Button className="w-full" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
        {bootstrap.setupRequired ? (
          <>
            No account exists yet. The first sign-up becomes the instance admin. <Link className="font-medium text-sky-700" to="/signup">Create it here</Link>.
          </>
        ) : (
          <>Sign-ups are invite-only after bootstrap. If you do not have access yet, ask the admin to whitelist your email.</>
        )}
      </div>
    </AuthShell>
  )
}
