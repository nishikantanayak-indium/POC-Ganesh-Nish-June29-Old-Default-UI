import { useRef, useState, useCallback } from 'react'
import { Upload, FileText, CheckCircle2, X } from 'lucide-react'
import clsx from 'clsx'
import { motion } from 'framer-motion'

import PipelineProgress from './PipelineProgress'
import { streamPipeline } from '../api/client'
import type { PipelineStep, SSEEvent } from '../types'

interface Props {
  workspaceId: string
  steps: PipelineStep[]
  pipelineRunning: boolean
  onPipelineStart: () => void
  onSSEEvent: (evt: SSEEvent) => void
  hasData: boolean
  onLoadExisting: () => void
}

export default function UploadZone({
  workspaceId, steps, pipelineRunning, onPipelineStart, onSSEEvent, hasData, onLoadExisting
}: Props) {
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return
    const valid = Array.from(incoming).filter(f =>
      f.name.endsWith('.pdf') || f.name.endsWith('.docx') || f.name.endsWith('.doc')
    )
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...valid.filter(f => !names.has(f.name))]
    })
  }, [])

  const removeFile = (name: string) => setFiles(prev => prev.filter(f => f.name !== name))

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }, [addFiles])

  const handleRun = () => {
    if (!files.length) return
    setError(null)
    onPipelineStart()
    cleanupRef.current = streamPipeline(
      workspaceId,
      files,
      (evt: unknown) => onSSEEvent(evt as SSEEvent),
      () => { cleanupRef.current = null },
      (err: string) => { setError(err); cleanupRef.current = null },
    )
  }

  const pipelineComplete = steps.every(s => s.status === 'complete' || s.status === 'error' || s.status === 'skipped')
  const anyRunning = steps.some(s => s.status === 'running')

  return (
    <div className="h-full flex gap-0 overflow-hidden">
      {/* Left: Upload panel */}
      <div className="w-[380px] shrink-0 flex flex-col gap-4 p-6 border-r border-border overflow-y-auto">
        {/* Restore banner */}
        {hasData && !pipelineRunning && !pipelineComplete && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-primary/30 bg-primary/10 p-4"
          >
            <div className="text-sm font-medium text-foreground mb-1">Graph already populated</div>
            <div className="text-xs text-muted mb-3">
              Existing data detected in Neo4j. Upload new documents to extend, or view current data.
            </div>
            <button
              onClick={onLoadExisting}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors font-medium"
            >
              Load existing data →
            </button>
          </motion.div>
        )}

        {/* Dropzone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={clsx(
            'relative border-2 border-dashed rounded-2xl p-8 cursor-pointer transition-all duration-200',
            'flex flex-col items-center justify-center gap-3 text-center min-h-[180px]',
            dragging
              ? 'border-primary bg-primary/10 scale-[1.01]'
              : 'border-border hover:border-primary/50 hover:bg-card',
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
            'w-12 h-12 rounded-xl flex items-center justify-center transition-all',
            dragging ? 'bg-primary' : 'bg-card border border-border',
          )}>
            <Upload size={20} className={dragging ? 'text-foreground' : 'text-muted'} />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Drop files here or click to browse</p>
            <p className="text-xs text-muted mt-1">PDF, DOCX — RFP, Contract, Risk Sheet</p>
          </div>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted font-medium uppercase tracking-wide">
              {files.length} file{files.length > 1 ? 's' : ''} queued
            </p>
            {files.map(f => (
              <div key={f.name} className="flex items-center gap-2 p-2.5 rounded-lg bg-card border border-border">
                <FileText size={14} className="text-primary shrink-0" />
                <span className="flex-1 text-sm text-foreground truncate font-mono text-xs">{f.name}</span>
                <span className="text-xs text-muted shrink-0">{(f.size / 1024).toFixed(0)}KB</span>
                <button onClick={() => removeFile(f.name)} className="text-border hover:text-danger transition-colors">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-danger/10 border border-danger/30 p-3 text-xs text-danger">
            {error}
          </div>
        )}

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={!files.length || pipelineRunning}
          className={clsx(
            'w-full py-3 rounded-xl text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2',
            files.length && !pipelineRunning
              ? 'bg-primary hover:bg-primary-dim text-white shadow-lg shadow-primary/25'
              : 'bg-card text-muted cursor-not-allowed border border-border',
          )}
        >
          {pipelineRunning ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Processing…
            </>
          ) : (
            <>
              <Upload size={14} />
              Run Pipeline
            </>
          )}
        </button>

        {pipelineComplete && !anyRunning && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2 text-success text-sm font-medium"
          >
            <CheckCircle2 size={16} />
            Pipeline complete — switch to Graph or Traceability tab
          </motion.div>
        )}
      </div>

      {/* Right: Pipeline progress */}
      <div className="flex-1 overflow-y-auto p-6">
        <PipelineProgress steps={steps} />
      </div>
    </div>
  )
}
