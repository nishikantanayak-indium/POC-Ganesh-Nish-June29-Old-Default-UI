import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5 dark:border-border-dark', className)}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink dark:text-white">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted dark:text-ink-subtle">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
