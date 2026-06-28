import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, Loader2, Circle } from 'lucide-react'
import clsx from 'clsx'
import type { PipelineStep } from '../types'

interface Props {
  steps: PipelineStep[]
}

export default function PipelineProgress({ steps }: Props) {
  const completed = steps.filter(s => s.status === 'complete').length
  const total = steps.length
  const pct = total > 0 ? (completed / total) * 100 : 0

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-foreground">Pipeline Progress</h2>
          <span className="text-sm font-mono text-muted">{completed}/{total}</span>
        </div>
        <div className="h-1.5 bg-card rounded-full overflow-hidden border border-border">
          <motion.div
            className="h-full bg-primary rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
      </div>

      <div className="space-y-3">
        {steps.map((step, i) => (
          <StepCard key={step.id} step={step} index={i} />
        ))}
      </div>
    </div>
  )
}

function StepCard({ step, index }: { step: PipelineStep; index: number }) {
  const isRunning = step.status === 'running'
  const isComplete = step.status === 'complete'
  const isError = step.status === 'error'
  const isIdle = step.status === 'idle'

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={clsx(
        'rounded-xl border p-4 transition-all duration-300',
        isRunning && 'border-primary/50 bg-primary/5 step-running',
        isComplete && 'border-success/30 bg-success/5',
        isError && 'border-danger/30 bg-danger/5',
        isIdle && 'border-border bg-card',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Step icon */}
        <div className={clsx(
          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-base',
          isRunning ? 'bg-primary/20' : isComplete ? 'bg-success/20' : isError ? 'bg-danger/20' : 'bg-border/30',
        )}>
          {step.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={clsx(
              'text-sm font-medium',
              isComplete ? 'text-foreground' : isRunning ? 'text-foreground' : 'text-muted',
            )}>
              {step.label}
            </span>
            <StatusIcon status={step.status} />
          </div>

          {/* Progress bar for running step */}
          {isRunning && step.progress && step.progress.total > 0 && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-muted mb-1">
                <span>{step.progress.current} / {step.progress.total}</span>
                <span>{Math.round((step.progress.current / step.progress.total) * 100)}%</span>
              </div>
              <div className="h-1 bg-border rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-primary rounded-full"
                  animate={{ width: `${(step.progress.current / step.progress.total) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          )}

          {/* Message */}
          <AnimatePresence mode="wait">
            {step.message && (
              <motion.p
                key={step.message}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="text-xs text-muted mt-1.5 truncate"
              >
                {step.message}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Completion stats */}
          {isComplete && (
            <div className="flex items-center gap-3 mt-2">
              {step.count !== undefined && (
                <span className="text-xs font-mono bg-success/20 text-success px-2 py-0.5 rounded-full">
                  {step.count} items
                </span>
              )}
              {step.elapsed !== undefined && (
                <span className="text-xs text-muted font-mono">{step.elapsed}s</span>
              )}
            </div>
          )}

          {isError && step.message && (
            <p className="text-xs text-danger mt-1">{step.message}</p>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function StatusIcon({ status }: { status: PipelineStep['status'] }) {
  if (status === 'complete') return <CheckCircle2 size={16} className="text-success shrink-0" />
  if (status === 'error')    return <XCircle size={16} className="text-danger shrink-0" />
  if (status === 'running')  return <Loader2 size={16} className="text-primary shrink-0 animate-spin" />
  return <Circle size={16} className="text-border shrink-0" />
}
