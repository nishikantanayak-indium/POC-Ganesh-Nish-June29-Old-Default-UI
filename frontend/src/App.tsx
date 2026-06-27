import { useEffect, useState, useCallback } from 'react'
import { Network, Upload, GitBranch, MessageSquare, Zap, Trash2, RefreshCw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'

import UploadZone from './components/UploadZone'
import KnowledgeGraph from './components/KnowledgeGraph'
import ElementsTable from './components/ElementsTable'
import TraceabilityView from './components/TraceabilityView'
import ChatWindow from './components/ChatWindow'
import PipelineSummaryBadge from './components/PipelineSummaryBadge'

import { fetchStatus, fetchElements, fetchCoverage, resetGraph } from './api/client'
import type {
  AppStatus, GraphNode, CoverageResult, PipelineSummary, PipelineStep, SSEEvent
} from './types'

type Tab = 'upload' | 'elements' | 'graph' | 'traceability'

const INITIAL_STEPS: PipelineStep[] = [
  { id: 'parse',    label: 'Parse Documents',         icon: '📄', status: 'idle' },
  { id: 'extract',  label: 'Extract Elements (LLM)',   icon: '🔍', status: 'idle' },
  { id: 'graph',    label: 'Build Knowledge Graph',    icon: '🕸️', status: 'idle' },
  { id: 'vector',   label: 'Index Semantic Vectors',   icon: '🔢', status: 'idle' },
  { id: 'coverage', label: 'Assess Coverage',          icon: '📊', status: 'idle' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('upload')
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [elements, setElements] = useState<GraphNode[]>([])
  const [coverage, setCoverage] = useState<CoverageResult[]>([])
  const [steps, setSteps] = useState<PipelineStep[]>(INITIAL_STEPS)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [summary, setSummary] = useState<PipelineSummary | null>(null)
  const [graphRefresh, setGraphRefresh] = useState(0)
  const [resetConfirm, setResetConfirm] = useState(false)

  // Load status on mount
  useEffect(() => {
    fetchStatus()
      .then(s => {
        setStatus(s)
        if (s.has_data) {
          loadExistingData()
        }
      })
      .catch(console.error)
  }, [])

  const loadExistingData = useCallback(async () => {
    try {
      const [elems, cov] = await Promise.all([fetchElements(), fetchCoverage()])
      setElements(elems)
      setCoverage(cov)
    } catch (e) {
      console.error('Failed to load existing data', e)
    }
  }, [])

  const handleSSEEvent = useCallback((evt: SSEEvent) => {
    if (evt.type === 'pipeline_complete') {
      setSummary(evt.summary)
      setPipelineRunning(false)
      setGraphRefresh(n => n + 1)
      loadExistingData()
      fetchStatus().then(setStatus).catch(console.error)
      return
    }

    setSteps(prev => {
      const next = [...prev]
      const idx = next.findIndex(s => s.id === evt.step)
      if (idx === -1) return prev

      if (evt.type === 'step_start') {
        next[idx] = { ...next[idx], status: 'running', message: evt.label }
      } else if (evt.type === 'step_progress') {
        next[idx] = {
          ...next[idx],
          status: 'running',
          message: evt.message,
          progress: { current: evt.current, total: evt.total },
        }
      } else if (evt.type === 'step_complete') {
        next[idx] = { ...next[idx], status: 'complete', count: evt.count, elapsed: evt.elapsed }
      } else if (evt.type === 'error') {
        next[idx] = { ...next[idx], status: 'error', message: evt.message }
      }
      return next
    })
  }, [loadExistingData])

  const handlePipelineStart = useCallback(() => {
    setPipelineRunning(true)
    setSummary(null)
    setSteps(INITIAL_STEPS)
  }, [])

  const handleReset = async () => {
    if (!resetConfirm) { setResetConfirm(true); return }
    await resetGraph()
    setResetConfirm(false)
    setElements([])
    setCoverage([])
    setSummary(null)
    setSteps(INITIAL_STEPS)
    setStatus(null)
    setGraphRefresh(n => n + 1)
    fetchStatus().then(setStatus).catch(console.error)
  }

  const hasData = status?.has_data || elements.length > 0

  const tabs: { id: Tab; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { id: 'upload',       label: 'Upload',        icon: <Upload size={14} /> },
    { id: 'elements',     label: 'Elements',      icon: <Zap size={14} />,        disabled: !hasData },
    { id: 'graph',        label: 'Graph',         icon: <Network size={14} />,    disabled: !hasData },
    { id: 'traceability', label: 'Traceability',  icon: <GitBranch size={14} />,  disabled: !hasData },
  ]

  return (
    <div className="flex flex-col h-screen bg-bg overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <Network size={14} className="text-white" />
          </div>
          <span className="font-semibold text-white tracking-tight">GraphRAG</span>
          <span className="text-muted text-xs font-mono">Procurement Intelligence</span>
        </div>

        <div className="flex items-center gap-2">
          {status && (
            <div className="flex items-center gap-3 mr-3">
              <Stat label="Nodes" value={status.nodes} />
              <Stat label="Edges" value={status.edges} />
            </div>
          )}
          {hasData && (
            <button
              onClick={handleReset}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                resetConfirm
                  ? 'bg-danger/20 text-danger border border-danger/40'
                  : 'bg-card text-muted hover:text-white border border-border',
              )}
            >
              <Trash2 size={12} />
              {resetConfirm ? 'Confirm wipe?' : 'Wipe DB'}
            </button>
          )}
          {resetConfirm && (
            <button
              onClick={() => setResetConfirm(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-card text-muted border border-border hover:text-white"
            >
              Cancel
            </button>
          )}
        </div>
      </header>

      {/* ── Tab bar ────────────────────────────────────────────────── */}
      <nav className="flex items-center gap-1 px-6 pt-3 pb-0 border-b border-border bg-surface shrink-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => !t.disabled && setTab(t.id)}
            disabled={t.disabled}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg transition-all border-b-2 -mb-px',
              t.id === tab
                ? 'text-white border-primary bg-bg'
                : t.disabled
                ? 'text-border border-transparent cursor-not-allowed'
                : 'text-muted border-transparent hover:text-white hover:border-border',
            )}
          >
            {t.icon}
            {t.label}
            {t.id === 'elements' && elements.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-mono">
                {elements.length}
              </span>
            )}
            {t.id === 'traceability' && coverage.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-success/20 text-success text-xs font-mono">
                {coverage.length}
              </span>
            )}
          </button>
        ))}

        {summary && (
          <div className="ml-auto mb-1">
            <PipelineSummaryBadge summary={summary} />
          </div>
        )}
      </nav>

      {/* ── Content ────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            {tab === 'upload' && (
              <UploadZone
                steps={steps}
                pipelineRunning={pipelineRunning}
                onPipelineStart={handlePipelineStart}
                onSSEEvent={handleSSEEvent}
                hasData={hasData}
                onLoadExisting={loadExistingData}
              />
            )}
            {tab === 'elements' && <ElementsTable elements={elements} />}
            {tab === 'graph' && <KnowledgeGraph refreshKey={graphRefresh} />}
            {tab === 'traceability' && <TraceabilityView coverage={coverage} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ── Floating chat ───────────────────────────────────────────── */}
      <ChatWindow disabled={!hasData} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-white font-mono text-sm font-semibold">{value.toLocaleString()}</div>
      <div className="text-muted text-xs">{label}</div>
    </div>
  )
}
