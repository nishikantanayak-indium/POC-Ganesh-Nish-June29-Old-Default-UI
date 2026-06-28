import { useRef, useState, useCallback, useEffect } from 'react'
import { Upload, FileText, X, ChevronDown, ChevronUp, Play, RotateCcw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'

import { streamPipeline } from '../api/client'
import type { PipelineStep, SSEEvent, LogLine, PipelineJob } from '../types'
import { usePipelineStore } from '../store/pipelineStore'

// ── Constants ─────────────────────────────────────────────────────────────────

const STEP_DEFS = [
  { id: 'parse',    label: 'Parse',    icon: '📄' },
  { id: 'extract',  label: 'Extract',  icon: '🔍' },
  { id: 'graph',    label: 'Graph',    icon: '🕸️' },
  { id: 'vector',   label: 'Vector',   icon: '🔢' },
  { id: 'coverage', label: 'Coverage', icon: '📊' },
] as const

function freshSteps(): PipelineStep[] {
  return STEP_DEFS.map(s => ({ id: s.id, label: s.label, icon: s.icon, status: 'idle' as const }))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sseToLog(evt: SSEEvent): LogLine | null {
  const ts = Date.now()
  switch (evt.type) {
    case 'step_start':
      return { ts, level: 'info', msg: `▶  ${evt.label}` }
    case 'step_progress':
      return { ts, level: 'info', msg: `   ${evt.message}` }
    case 'step_complete': {
      const def = STEP_DEFS.find(s => s.id === evt.step)
      return { ts, level: 'success', msg: `✓  ${def?.label ?? evt.step} — ${evt.count} item${evt.count !== 1 ? 's' : ''} (${evt.elapsed}s)` }
    }
    case 'pipeline_complete': {
      const s = evt.summary
      return { ts, level: 'success', msg: `🏁 Done — ${s.elements} elements · ${s.edges} edges · ${s.elapsed}s total` }
    }
    case 'error':
      return { ts, level: 'error', msg: `✗  [${evt.step}] ${evt.message}` }
    default:
      return null
  }
}

function applySSEToSteps(steps: PipelineStep[], evt: SSEEvent): PipelineStep[] {
  const next = [...steps]
  const stepId = 'step' in evt ? (evt as { step: string }).step : ''
  const idx = next.findIndex(s => s.id === stepId)
  if (idx < 0) return next

  if (evt.type === 'step_start') {
    next[idx] = { ...next[idx], status: 'running', message: evt.label }
  } else if (evt.type === 'step_progress') {
    // Detect coordination-wait phase from backend message so the UI can show a distinct state.
    const isCoordinating = /queued for cross-document|waiting for peer|pipeline.*in batch/i.test(evt.message)
    next[idx] = { ...next[idx],
      status: isCoordinating ? 'coordinating' : 'running',
      message: evt.message,
      progress: { current: evt.current, total: evt.total } }
  } else if (evt.type === 'step_complete') {
    next[idx] = { ...next[idx], status: 'complete', count: evt.count, elapsed: evt.elapsed }
  } else if (evt.type === 'error') {
    next[idx] = { ...next[idx], status: 'error', message: evt.message }
  }
  return next
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString('en-US', { hour12: false })
}

function fmtElapsed(start: number, end?: number) {
  const s = Math.round(((end ?? Date.now()) - start) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function fmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── StepStrip ─────────────────────────────────────────────────────────────────

function StepStrip({ steps }: { steps: PipelineStep[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {STEP_DEFS.map((def, i) => {
        const step = steps.find(s => s.id === def.id)
        const status = step?.status ?? 'idle'
        return (
          <div key={def.id} className="flex items-center gap-1">
            <div
              title={`${def.label}${step?.count !== undefined ? ` — ${step.count} items` : ''}`}
              className={clsx(
                'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono select-none transition-all',
                status === 'idle'          && 'bg-card border border-border text-border',
                status === 'running'       && 'bg-primary/15 border border-primary/40 text-primary',
                status === 'coordinating'  && 'bg-amber-500/10 border border-amber-500/40 text-amber-400',
                status === 'complete'      && 'bg-success/10 border border-success/30 text-success',
                status === 'error'         && 'bg-danger/10 border border-danger/30 text-danger',
                status === 'skipped'       && 'bg-card border border-border text-muted',
              )}
            >
              <span>{def.icon}</span>
              {status === 'running'      && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
              {status === 'coordinating' && <span className="text-[9px] animate-pulse">⏳</span>}
              {status === 'complete'     && <span>✓</span>}
              {status === 'error'        && <span>✗</span>}
            </div>
            {i < STEP_DEFS.length - 1 && (
              <span className={clsx('text-xs', status === 'complete' ? 'text-success/30' : 'text-border')}>—</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── LogViewer ─────────────────────────────────────────────────────────────────

function LogViewer({ logs, running }: { logs: LogLine[]; running: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (running) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length, running])

  return (
    <div className="mt-2.5 rounded-lg bg-[#0d1117] border border-white/[0.06] overflow-hidden">
      <div className="max-h-56 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
        {logs.length === 0
          ? <span className="text-slate-600">Waiting for first event…</span>
          : logs.map((line, i) => (
            <div key={i} className="flex gap-2.5 leading-[1.6]">
              <span className="shrink-0 text-slate-600 select-none">{fmtTime(line.ts)}</span>
              <span className={clsx(
                line.level === 'success' && 'text-emerald-400',
                line.level === 'error'   && 'text-red-400',
                line.level === 'warn'    && 'text-amber-400',
                line.level === 'info'    && 'text-slate-300',
              )}>
                {line.msg}
              </span>
            </div>
          ))
        }
        {running && (
          <div className="flex gap-2.5 leading-[1.6]">
            <span className="shrink-0 text-slate-600 select-none">{fmtTime(Date.now())}</span>
            <span className="text-slate-500 animate-pulse">█</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── JobCard ───────────────────────────────────────────────────────────────────

function JobCard({ job }: { job: PipelineJob }) {
  const running = job.status === 'running'
  const [logsOpen, setLogsOpen] = useState(running)

  useEffect(() => { if (running) setLogsOpen(true) }, [running])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        'rounded-xl border bg-card overflow-hidden transition-shadow',
        running           && 'border-primary/40 shadow-[0_0_12px_rgba(99,102,241,0.08)]',
        job.status === 'complete' && 'border-border',
        job.status === 'error'    && 'border-danger/30',
      )}
    >
      <div className="px-4 pt-3 pb-3.5 flex items-start gap-3">
        {/* Status indicator */}
        <div className={clsx(
          'mt-1 w-2 h-2 rounded-full shrink-0 transition-all',
          running                   ? 'bg-primary animate-pulse' : '',
          job.status === 'complete' ? 'bg-success' : '',
          job.status === 'error'    ? 'bg-danger' : '',
        )} />

        <div className="flex-1 min-w-0 space-y-2">
          {/* Header row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-mono text-muted">
              <span className="text-sm font-semibold text-white">Run #{job.runNumber}</span>
              <span>·</span>
              <span>{job.files.length} file{job.files.length !== 1 ? 's' : ''}</span>
              <span>·</span>
              <span>
                {running
                  ? <>{fmtElapsed(job.startedAt)} elapsed</>
                  : fmtElapsed(job.startedAt, job.finishedAt)
                }
              </span>
            </div>

            <span className={clsx(
              'text-xs font-mono px-2 py-0.5 rounded-full shrink-0',
              running                   && 'text-primary bg-primary/10',
              job.status === 'complete' && 'text-success bg-success/10',
              job.status === 'error'    && 'text-danger bg-danger/10',
            )}>
              {running ? 'Running' : job.status === 'complete' ? 'Complete' : 'Failed'}
            </span>
          </div>

          {/* File chips */}
          <div className="flex flex-wrap gap-1">
            {job.files.map(f => (
              <span key={f} className="text-xs font-mono text-slate-400 bg-surface border border-border/50 px-2 py-0.5 rounded">
                {f}
              </span>
            ))}
          </div>

          {/* Step strip */}
          <StepStrip steps={job.steps} />

          {/* Summary row */}
          {job.summary && (
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-success">✓ {job.summary.elements} elements</span>
              <span className="text-slate-600">·</span>
              <span className="text-success">✓ {job.summary.edges} edges</span>
              {job.summary.coverage_items > 0 && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="text-success">✓ {job.summary.coverage_items} coverage items</span>
                </>
              )}
              {job.summary.skipped > 0 && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="text-amber-500">{job.summary.skipped} skipped (already ingested)</span>
                </>
              )}
            </div>
          )}

          {/* Log toggle */}
          <button
            onClick={() => setLogsOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-white transition-colors"
          >
            {logsOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            <span className="font-mono">
              {logsOpen ? 'Hide' : 'View'} logs
              {job.logs.length > 0 && ` · ${job.logs.length} lines`}
            </span>
          </button>

          {/* Log panel */}
          <AnimatePresence>
            {logsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <LogViewer logs={job.logs} running={running} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface WorkflowPanelProps {
  workspaceId: string
  onSSEEvent: (evt: SSEEvent) => void
  hasData: boolean
  onLoadExisting: () => void
  onToast: (msg: string, type: 'success' | 'error') => void
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function WorkflowPanel({
  workspaceId, onSSEEvent, hasData, onLoadExisting, onToast,
}: WorkflowPanelProps) {
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [dragging, setDragging]         = useState(false)
  const { jobs, addJob, patchJob, nextRunNumber } = usePipelineStore()
  const inputRef    = useRef<HTMLInputElement>(null)
  const runningJobs = jobs.filter(j => j.status === 'running').length

  // ── File drop handling ────────────────────────────────────────────────────

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return
    const valid = Array.from(list).filter(f =>
      /\.(pdf|docx|doc)$/i.test(f.name)
    )
    setPendingFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...valid.filter(f => !names.has(f.name))]
    })
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }, [addFiles])

  // ── Run pipeline ──────────────────────────────────────────────────────────

  const handleRun = useCallback(() => {
    if (!pendingFiles.length) return

    const filesToProcess = [...pendingFiles]
    const num   = nextRunNumber()
    const jobId = `job-${num}-${Date.now()}`

    setPendingFiles([])

    const newJob: PipelineJob = {
      id: jobId, runNumber: num,
      files: filesToProcess.map(f => f.name),
      status: 'running',
      startedAt: Date.now(),
      steps: freshSteps(),
      logs: [],
    }
    // Prepend new job — functional update always works on latest state
    addJob(newJob)

    // Pure state patch — only updates the job matching jobId.
    // IMPORTANT: the fn passed here must be a pure state transform — no side
    // effects, no other setState calls inside it (React may run it multiple
    // times in concurrent mode).
    const patch = (fn: (j: PipelineJob) => PipelineJob) => patchJob(jobId, fn)

    streamPipeline(
      workspaceId,
      filesToProcess,

      // ── SSE event ─────────────────────────────────────────────────
      (raw) => {
        const evt = raw as SSEEvent
        const log  = sseToLog(evt)

        // ── Side effects first, OUTSIDE any state updater ──────────
        onSSEEvent(evt)
        if (evt.type === 'pipeline_complete') {
          onToast(
            `Run #${num} complete — ${evt.summary.elements} elements · ${evt.summary.edges} edges`,
            'success',
          )
        }

        // ── Pure state update — no side effects inside ──────────────
        if (evt.type === 'pipeline_complete') {
          patch(j => ({
            ...j,
            status:     'complete',
            finishedAt: Date.now(),
            summary:    evt.summary,
            logs:       log ? [...j.logs, log] : j.logs,
          }))
        } else {
          patch(j => ({
            ...j,
            steps: applySSEToSteps(j.steps, evt),
            logs:  log ? [...j.logs, log] : j.logs,
          }))
        }
      },

      // ── Stream closed without pipeline_complete ────────────────────
      () => {
        patch(j => {
          if (j.status !== 'running') return j
          const hadErrors = j.logs.some(l => l.level === 'error')
          return { ...j, status: hadErrors ? 'error' : 'complete', finishedAt: Date.now() }
        })
      },

      // ── Network / fetch error ──────────────────────────────────────
      (errMsg) => {
        patch(j => ({
          ...j,
          status:     'error',
          finishedAt: Date.now(),
          logs:       [...j.logs, { ts: Date.now(), level: 'error', msg: `✗  ${errMsg}` }],
        }))
        onToast(`Run #${num} failed — ${errMsg}`, 'error')
      },
    )
  }, [pendingFiles, onSSEEvent, onToast, addJob, patchJob, nextRunNumber])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">

        {/* Header */}
        <div>
          <h2 className="text-base font-semibold text-white">Ingestion Pipeline</h2>
          <p className="text-xs text-muted mt-0.5">
            Upload procurement documents — pipeline runs async and streams logs in real time.
          </p>
        </div>

        {/* Resume banner (only when no jobs yet this session) */}
        {hasData && jobs.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between gap-4"
          >
            <div>
              <p className="text-sm font-medium text-white">Graph data already present</p>
              <p className="text-xs text-muted mt-0.5">Resume from your last session or drop new documents below to extend it.</p>
            </div>
            <button
              onClick={onLoadExisting}
              className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors font-medium"
            >
              <RotateCcw size={11} />
              Resume
            </button>
          </motion.div>
        )}

        {/* Upload card */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={clsx(
              'border-2 border-dashed rounded-xl p-5 cursor-pointer transition-all duration-200',
              'flex items-center gap-4',
              dragging
                ? 'border-primary bg-primary/10'
                : 'border-border/60 hover:border-primary/40 hover:bg-surface',
            )}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc"
              className="hidden"
              onChange={e => addFiles(e.target.files)}
            />
            <div className={clsx(
              'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all',
              dragging ? 'bg-primary' : 'bg-surface border border-border',
            )}>
              <Upload size={15} className={dragging ? 'text-white' : 'text-muted'} />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Drop files or click to browse</p>
              <p className="text-xs text-muted">PDF, DOCX — RFP, Contract, Risk Sheet. Scanned PDFs supported via OCR.</p>
            </div>
          </div>

          {/* File chips */}
          <AnimatePresence>
            {pendingFiles.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden space-y-1.5"
              >
                {pendingFiles.map(f => (
                  <div key={f.name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border/60">
                    <FileText size={12} className="text-primary shrink-0" />
                    <span className="flex-1 text-xs font-mono text-white truncate">{f.name}</span>
                    <span className="text-xs text-muted font-mono shrink-0">{fmtSize(f.size)}</span>
                    <button
                      onClick={e => { e.stopPropagation(); setPendingFiles(p => p.filter(x => x.name !== f.name)) }}
                      className="text-border hover:text-danger transition-colors p-0.5 rounded"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={!pendingFiles.length}
            className={clsx(
              'w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2',
              pendingFiles.length
                ? 'bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20'
                : 'bg-surface text-muted cursor-not-allowed border border-border',
            )}
          >
            <Play size={13} fill="currentColor" />
            Run Pipeline{pendingFiles.length > 0 ? ` (${pendingFiles.length} file${pendingFiles.length !== 1 ? 's' : ''})` : ''}
          </button>
        </div>

        {/* Job history */}
        {jobs.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-0.5">
              <p className="text-xs font-semibold text-muted uppercase tracking-widest">Pipeline Runs</p>
              <div className="flex items-center gap-2 text-xs font-mono">
                {runningJobs > 0 && (
                  <span className="flex items-center gap-1 text-primary">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    {runningJobs} running
                  </span>
                )}
                <span className="text-muted">
                  {jobs.filter(j => j.status === 'complete').length}/{jobs.length} complete
                </span>
              </div>
            </div>
            {jobs.map(job => <JobCard key={job.id} job={job} />)}
          </div>
        )}

      </div>
    </div>
  )
}
