import type { ReactNode } from 'react'

/** Shared chrome for root screens; detail screens keep their back navigation. */
export function MobilePageHeader({ title, detail, action, children, onTitleClick, titleExpanded, titleLabel }: {
  title: string; detail?: string; action?: ReactNode; children?: ReactNode
  onTitleClick?: () => void; titleExpanded?: boolean; titleLabel?: string
}) {
  return (
    <header className="mobile-page-header shrink-0">
      <div className="flex min-h-16 items-center gap-3 px-5 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] leading-8 font-semibold tracking-tight text-ink-900">
            {onTitleClick ? <button type="button" onClick={onTitleClick} aria-label={titleLabel ?? title}
              aria-haspopup="dialog" aria-expanded={titleExpanded} data-project-switcher
              className="flex min-h-11 max-w-full items-center gap-2 text-left">
              <span className="truncate">{title}</span>
              <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button> : title}
          </h1>
          {detail && <p className="mt-1 truncate text-[13px] leading-5 text-ink-500">{detail}</p>}
        </div>
        {action}
      </div>
      {children}
    </header>
  )
}
