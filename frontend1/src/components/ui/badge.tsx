import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-slate-700 text-white',
        secondary: 'border-transparent bg-surface-muted text-ink-muted dark:bg-surface-dark-muted dark:text-ink-inverted',
        outline: 'border-border text-ink dark:border-border-dark dark:text-ink-inverted',
        success: 'border-transparent bg-success-100 text-success-700 dark:bg-success-700/20 dark:text-success-400',
        warning: 'border-transparent bg-warning-100 text-warning-700 dark:bg-warning-700/20 dark:text-warning-400',
        danger: 'border-transparent bg-danger-100 text-danger-700 dark:bg-danger-700/20 dark:text-danger-400',
        info: 'border-transparent bg-info-100 text-info-700 dark:bg-info-700/20 dark:text-info-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
