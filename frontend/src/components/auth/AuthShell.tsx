import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { FloatingPaths } from "@/components/floating-paths"

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
    <div className="grid min-h-svh grid-cols-1 items-center justify-center lg:grid-cols-2">
      <div className="col-span-1 hidden h-full w-full lg:flex">
        <div className="relative flex h-full w-full flex-col border-r bg-background p-10">
          <div className="z-10 flex flex-row items-center gap-2">
            <img
              src="/logo.png"
              alt="Rowful Logo"
              className="size-6 invert dark:invert-0"
            />
            <h2 className="text-2xl">Rowful</h2>
          </div>
          <div className="z-10 mt-auto">
            <blockquote className="space-y-2">
              <p className="text-lg">
                &ldquo;Open source and self-hostable spreadsheet
                application.&rdquo;
              </p>
            </blockquote>
          </div>
          <div className="absolute inset-0">
            <FloatingPaths position={0} />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center justify-center text-center">
            <h1 className="text-2xl font-medium">{title}</h1>
            <p className="mb-8 text-base text-muted-foreground">
              {description}
            </p>
          </div>

          <div>{children}</div>

          <div className="mt-6 text-center text-sm text-muted-foreground">
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
    </div>
  )
}
