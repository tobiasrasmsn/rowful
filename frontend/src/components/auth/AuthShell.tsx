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
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.14),transparent_28%),linear-gradient(180deg,#f8fafc,#eef2ff)] px-4 py-12">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_0%,rgba(15,23,42,0.04)_50%,transparent_100%)]" />
      <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur">
        <div className="border-b border-slate-200/80 px-6 py-6">
          <div className="text-xs font-semibold tracking-[0.22em] text-sky-700 uppercase">
            Planar
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        </div>

        <div className="px-6 py-6">{children}</div>

        <div className="border-t border-slate-200/80 bg-slate-50/80 px-6 py-4 text-sm text-slate-600">
          {alternateLabel}{" "}
          <Link className="font-medium text-sky-700 hover:text-sky-800" to={alternateHref}>
            {alternateText}
          </Link>
        </div>
      </div>
    </div>
  )
}
