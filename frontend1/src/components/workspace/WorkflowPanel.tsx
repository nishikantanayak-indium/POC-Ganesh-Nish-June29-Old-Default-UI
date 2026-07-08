import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronUp, File as FileIcon, Play, UploadCloud, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PipelineProgress } from './PipelineProgress'
import { runPipeline } from '@/api/workspaces'
import { useWorkspaceJobs } from '@/store/pipelineStore'
import { runTrackedPipelineJob } from '@/lib/pipelineJobRunner'
import { cn } from '@/lib/utils'
import { formatElapsed } from '@/lib/formatters'
import type { PipelineJob } from '@/types/analysis'

interface WorkflowPanelProps {
  workspaceId: string
  workspaceName?: string
  onPipelineComplete?: () => void
}

export function WorkflowPanel({ workspaceId, workspaceName, onPipelineComplete }: WorkflowPanelProps) {
  const [files, setFiles] = useState<File[]>([])
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const jobs = useWorkspaceJobs(workspaceId)
  const isRunning = jobs.some((j) => j.status === 'running')

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return
    const next = Array.from(incoming).filter((f) => /\.(pdf|docx)$/i.test(f.name))
    setFiles((prev) => [...prev, ...next])
  }, [])

  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index))

  const runJob = async () => {
    if (files.length === 0 || isRunning) return
    const runFiles = files
    setFiles([])

    await runTrackedPipelineJob({
      workspaceId,
      workspaceName,
      fileNames: runFiles.map((f) => f.name),
      stream: (onEvent, signal) => runPipeline(workspaceId, runFiles, onEvent, signal),
      onPipelineComplete,
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload &amp; Run Pipeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragActive(false)
              addFiles(e.dataTransfer.files)
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-10 text-center transition-colors dark:border-border-dark',
              dragActive
                ? 'border-accent-400 bg-accent-50 dark:bg-accent-900/20'
                : 'hover:border-accent-300 hover:bg-surface-subtle dark:hover:bg-surface-dark-subtle',
            )}
          >
            <UploadCloud className="h-8 w-8 text-ink-subtle" />
            <p className="text-sm font-medium text-ink dark:text-ink-inverted">
              Drag and drop files, or click to browse
            </p>
            <p className="text-xs text-ink-subtle">Accepts .pdf and .docx</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.docx"
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <ul className="space-y-1.5">
              {files.map((file, i) => (
                <li
                  key={`${file.name}-${i}`}
                  className="flex items-center justify-between rounded-md border border-border bg-surface-subtle px-3 py-1.5 text-sm dark:border-border-dark dark:bg-surface-dark-subtle"
                >
                  <span className="flex items-center gap-2 truncate">
                    <FileIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
                    <span className="truncate">{file.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="ml-2 shrink-0 text-ink-subtle hover:text-danger-600"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-subtle">
              {files.length > 0 ? `${files.length} file(s) queued` : 'No files queued'}
            </span>
            <Button onClick={runJob} disabled={files.length === 0 || isRunning} loading={isRunning}>
              <Play className="h-4 w-4" />
              Run Pipeline
            </Button>
          </div>
        </CardContent>
      </Card>

      {jobs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ink dark:text-ink-inverted">Run History</h3>
          <AnimatePresence initial={false}>
            {jobs.map((job) => (
              <motion.div
                key={job.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <JobCard job={job} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function JobCard({ job }: { job: PipelineJob }) {
  const [logsOpen, setLogsOpen] = useState(false)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Run #{job.runNumber}</CardTitle>
            <p className="mt-0.5 text-xs text-ink-subtle">{job.fileNames.join(', ')}</p>
          </div>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              job.status === 'running' && 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-200',
              job.status === 'done' && 'bg-success-50 text-success-700 dark:bg-success-700/20 dark:text-success-400',
              job.status === 'error' && 'bg-danger-50 text-danger-700 dark:bg-danger-700/20 dark:text-danger-400',
            )}
          >
            {job.status === 'running' ? 'Running' : job.status === 'done' ? 'Complete' : 'Failed'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <PipelineProgress steps={job.steps} />

        {job.summary && (
          <div className="flex flex-wrap gap-2">
            {[
              ['Documents', job.summary.documents],
              ['Elements', job.summary.elements],
              ['Nodes', job.summary.nodes],
              ['Edges', job.summary.edges],
              ['Coverage Items', job.summary.coverage_items],
              ['Elapsed', formatElapsed(job.summary.elapsed)],
            ].map(([label, value]) => (
              <span
                key={label as string}
                className="rounded-md border border-border bg-surface-subtle px-2 py-1 text-xs text-ink-muted dark:border-border-dark dark:bg-surface-dark-subtle dark:text-ink-subtle"
              >
                <span className="font-medium text-ink dark:text-ink-inverted">{value}</span> {label}
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setLogsOpen((o) => !o)}
          className="flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink dark:text-ink-subtle dark:hover:text-ink-inverted"
        >
          {logsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {logsOpen ? 'Hide logs' : `Show logs (${job.logs.length})`}
        </button>

        <AnimatePresence initial={false}>
          {logsOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <ScrollArea className="h-40 rounded-md border border-border bg-slate-950 dark:border-border-dark">
                <div className="p-3 font-mono text-xs leading-relaxed text-slate-300">
                  {job.logs.map((line, i) => (
                    <div key={i} className={cn(line.level === 'error' && 'text-danger-400')}>
                      <span className="text-slate-500">[{line.time}]</span> {line.text}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  )
}
