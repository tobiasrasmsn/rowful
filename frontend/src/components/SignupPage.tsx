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

  return (
    <AuthShell
      title="Create your account"
      description={
        bootstrap.setupRequired
          ? "Set up the first Planar admin account."
          : "Create a Planar account to get started."
      }
      alternateLabel="Already have an account?"
      alternateHref="/login"
      alternateText="Sign in"
    >
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
            placeholder="Planar Admin"
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

        {error ? <div className="text-sm text-destructive">{error}</div> : null}

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
    </AuthShell>
  )
}
