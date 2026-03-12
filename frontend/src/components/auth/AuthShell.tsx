import type { ReactNode } from "react"
import { Link } from "react-router-dom"

export function AuthShell({
  title,
  description,
  alternateLabel,
  alternateHref,
  alternateText,
  children,
}: {
  title: string
  description: string
  alternateLabel: string
  alternateHref: string
  alternateText: string
  children: ReactNode
}) {
  return (
    <div className="auth-shell-background relative flex min-h-svh items-center justify-center overflow-hidden px-4 py-12">
      <div className="auth-shell-overlay absolute inset-0" />
      <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-border/80 bg-card/95 shadow-2xl shadow-primary/10 backdrop-blur">
        <div className="border-b border-border/80 px-6 py-6">
          <div className="text-xs font-semibold tracking-[0.22em] text-primary uppercase">
            Planar
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>

        <div className="px-6 py-6">{children}</div>

        <div className="border-t border-border/80 bg-muted/50 px-6 py-4 text-sm text-muted-foreground">
          {alternateLabel}{" "}
          <Link
            className="font-medium text-primary hover:text-primary/80"
            to={alternateHref}
          >
            {alternateText}
          </Link>
        </div>
      </div>
    </div>
  )
}
