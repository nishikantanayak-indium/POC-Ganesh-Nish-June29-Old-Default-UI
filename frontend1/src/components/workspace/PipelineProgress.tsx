import { Boxes, Check, FileSearch, Share2, ShieldCheck, Sparkles, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatElapsed } from '@/lib/formatters'
import type { PipelineStep, StepId, StepStatus } from '@/types/analysis'

const STEP_ICONS: Record<StepId, LucideIcon> = {
  parse: FileSearch,
  extract: Sparkles,
  graph: Share2,
  vector: Boxes,
  coverage: ShieldCheck,
}

const STATUS_STYLES: Record<StepStatus, { chip: string; icon: string; connector: string }> = {
  pending: {
    chip: 'border-border bg-surface text-ink-subtle dark:border-border-dark dark:bg-surface-dark-subtle dark:text-ink-subtle',
    icon: 'text-ink-subtle',
    connector: 'bg-border dark:bg-border-dark',
  },
  running: {
    chip: 'border-accent-200 bg-accent-50 text-accent-700 dark:border-accent-800 dark:bg-accent-900/30 dark:text-accent-200',
    icon: 'text-accent-600 dark:text-accent-300',
    connector: 'bg-accent-300 dark:bg-accent-700',
  },
  done: {
    chip: 'border-success-100 bg-success-50 text-success-700 dark:border-success-700/40 dark:bg-success-700/20 dark:text-success-400',
    icon: 'text-success-600 dark:text-success-400',
    connector: 'bg-success-300 dark:bg-success-700',
  },
  error: {
    chip: 'border-danger-100 bg-danger-50 text-danger-700 dark:border-danger-700/40 dark:bg-danger-700/20 dark:text-danger-400',
    icon: 'text-danger-600 dark:text-danger-400',
    connector: 'bg-danger-300 dark:bg-danger-700',
  },
}

interface PipelineProgressProps {
  steps: PipelineStep[]
}

export function PipelineProgress({ steps }: PipelineProgressProps) {
  return (
    <div className="flex items-stretch">
      {steps.map((step, i) => {
        const Icon = STEP_ICONS[step.id]
        const styles = STATUS_STYLES[step.status]
        const isLast = i === steps.length - 1

        return (
          <div key={step.id} className="flex flex-1 items-center">
            <div
              className={cn(
                'flex min-w-[92px] flex-1 flex-col items-center gap-1.5 rounded-md border px-2 py-2 text-center transition-colors',
                styles.chip,
              )}
            >
              <div className="relative">
                {step.status === 'running' && (
                  <span className="absolute inset-0 -m-1 animate-pulse rounded-full bg-accent-400/30" />
                )}
                {step.status === 'done' ? (
                  <Check className={cn('h-4 w-4', styles.icon)} />
                ) : step.status === 'error' ? (
                  <X className={cn('h-4 w-4', styles.icon)} />
                ) : (
                  <Icon className={cn('relative h-4 w-4', styles.icon)} />
                )}
              </div>
              <span className="text-xs font-medium leading-tight">{step.label}</span>
              {(step.count !== undefined || step.elapsed !== undefined) && (
                <span className="text-[11px] leading-tight text-ink-subtle">
                  {step.count !== undefined ? `${step.count} items` : null}
                  {step.count !== undefined && step.elapsed !== undefined ? ' · ' : null}
                  {step.elapsed !== undefined ? formatElapsed(step.elapsed) : null}
                </span>
              )}
            </div>
            {!isLast && <div className={cn('mx-1 h-px flex-none w-3 sm:w-6', styles.connector)} />}
          </div>
        )
      })}
    </div>
  )
}
