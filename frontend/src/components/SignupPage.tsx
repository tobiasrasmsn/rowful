import { useState } from "react"
import { useNavigate } from "react-router-dom"

import { AuthShell } from "@/components/auth/AuthShell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuthStore } from "@/store/authStore"

export function SignupPage() {
  const signup = useAuthStore((state) => state.signup)
  const bootstrap = useAuthStore((state) => state.bootstrap)
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSignupAvailable = bootstrap.setupRequired || bootstrap.signupsEnabled
  const description = bootstrap.setupRequired
    ? "Set up the first Rowful admin account."
    : bootstrap.inviteOnly
      ? "Create a Rowful account with a whitelisted email address."
      : bootstrap.signupsEnabled
        ? "Create a Rowful account to get started."
        : "Sign up is currently closed. Ask your admin to enable access."

  return (
    <AuthShell
      title="Create your account"
      description={description}
      alternateLabel="Already have an account?"
      alternateHref="/login"
      alternateText="Sign in"
    >
      {isSignupAvailable ? (
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault()
            setError(null)
            setIsSubmitting(true)
            try {
              await signup({ name, email, password })
              navigate("/", { replace: true })
            } catch (submitError) {
              setError(
                submitError instanceof Error
                  ? submitError.message
                  : "Failed to sign up"
              )
            } finally {
              setIsSubmitting(false)
            }
          }}
        >
          <div className="space-y-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="signup-name"
            >
              Name
            </label>
            <Input
              id="signup-name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="First & Last Name"
              className="h-10 rounded-lg focus-within:ring-0!"
            />
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="signup-email"
            >
              Email
            </label>
            <Input
              id="signup-email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="h-10 rounded-lg focus-within:ring-0!"
            />
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="signup-password"
            >
              Password
            </label>
            <Input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 12 characters"
              className="h-10 rounded-lg focus-within:ring-0!"
            />
          </div>

          {error ? (
            <div className="text-sm text-destructive">{error}</div>
          ) : null}

          <Button
            className="h-10 w-full cursor-pointer rounded-lg font-semibold"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? "Creating account..."
              : bootstrap.setupRequired
                ? "Create admin account"
                : "Create account"}
          </Button>
        </form>
      ) : (
        <div className="rounded-2xl border border-border bg-card/70 p-5 text-sm leading-6 text-muted-foreground">
          Sign up is disabled right now. An admin can reopen it from the admin
          access page whenever they want.
        </div>
      )}
    </AuthShell>
  )
}
