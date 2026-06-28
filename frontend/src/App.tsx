import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Network, Upload, GitBranch, Zap, Trash2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'

import LandingPage from './components/LandingPage'
import WorkflowPanel from './components/WorkflowPanel'
import KnowledgeGraph from './components/KnowledgeGraph'
import ElementsTable from './components/ElementsTable'
import TraceabilityView from './components/TraceabilityView'
import ChatWindow from './components/ChatWindow'
import { ToastContainer, useToast } from './components/Toast'

import { usePipelineStore } from './store/pipelineStore'
import { fetchStatus, fetchElements, fetchCoverage, resetGraph } from './api/client'
import type { AppStatus, GraphNode, CoverageResult, SSEEvent } from './types'

type Tab = 'upload' | 'elements' | 'graph' | 'traceability'

export default function App() {
  // ── Landing page ─────────────────────────────────────────────────────────────
  const [entered, setEntered]   = useState(false)
  const [status, setStatus]     = useState<AppStatus | null>(null)

  // ── Tab state ─────────────────────────────────────────────────────────────────
  const [tab, setTab]           = useState<Tab>('upload')
  // Track which tabs have been visited so we can lazy-mount but then keep alive.
  // Once a tab mounts it stays in the DOM (display:none when inactive) so
  // React Flow / WorkflowPanel / Traceability never lose their local state.
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(new Set<Tab>(['upload']))

  const handleTabChange = useCallback((next: Tab) => {
    setTab(next)
    setVisitedTabs(prev => {
      if (prev.has(next)) return prev
      const s = new Set(prev)
      s.add(next)
      return s
    })
  }, [])

  // ── App data ──────────────────────────────────────────────────────────────────
  const [elements, setElements] = useState<GraphNode[]>([])
  const [coverage, setCoverage] = useState<CoverageResult[]>([])
  const [graphRefresh, setGraphRefresh] = useState(0)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [preloading, setPreloading]     = useState(false)

  // Running indicator derived from Zustand — no counter state needed in App
  const pipelineRunning = usePipelineStore(state => state.jobs.some(j => j.status === 'running'))

  const { toasts, addToast, removeToast } = useToast()

  // Debounce timer for data refreshes — when multiple pipelines complete within
  // 2 seconds of each other, we wait for the last one before fetching, so we
  // always read fully-committed Neo4j state rather than mid-write snapshots.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Bootstrap ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchStatus()
      .then(s => setStatus(s))
      .catch(() => setStatus({ has_data: false, nodes: 0, edges: 0, type_counts: {} }))
  }, [])

  const loadExistingData = useCallback(async () => {
    setPreloading(true)
    let loaded = false
    try {
      const elems = await fetchElements()
      setElements(elems)
      if (elems.length > 0) loaded = true
    } catch (e) {
      console.warn('Could not load elements:', e)
    }
    try {
      const cov = await fetchCoverage()
      setCoverage(cov)
    } catch (e) {
      console.warn('Could not load coverage:', e)
    }
    if (loaded) setGraphRefresh(n => n + 1)
    setPreloading(false)
  }, [])

  const handleEnter = useCallback((hasData: boolean) => {
    setEntered(true)
    if (hasData) {
      handleTabChange('graph')
      loadExistingData()
    }
  }, [loadExistingData, handleTabChange])

  // ── SSE side-effects (App-level only — store handles job state) ───────────────
  const handleSSEEvent = useCallback((evt: SSEEvent) => {
    if (evt.type === 'pipeline_complete') {
      setGraphRefresh(n => n + 1)

      // Debounce the data fetch: if another pipeline completes within 2 s,
      // cancel and restart the timer so we fetch once after all writes commit.
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null
        loadExistingData()
        fetchStatus().then(setStatus).catch(console.error)
      }, 2000)
    }
  }, [loadExistingData])

  // ── Reset ─────────────────────────────────────────────────────────────────────
  const handleReset = async () => {
    if (!resetConfirm) { setResetConfirm(true); return }
    await resetGraph()
    setResetConfirm(false)
    setElements([])
    setCoverage([])
    setStatus({ has_data: false, nodes: 0, edges: 0, type_counts: {} })
    setGraphRefresh(n => n + 1)
    usePipelineStore.getState().clearJobs()
    handleTabChange('upload')
    addToast('Graph wiped — ready for new documents', 'success')
    fetchStatus().then(setStatus).catch(console.error)
  }

  const hasData = status?.has_data || elements.length > 0

  // ── Landing page ─────────────────────────────────────────────────────────────
  if (!entered) {
    return (
      <AnimatePresence>
        <LandingPage status={status} onEnter={handleEnter} />
      </AnimatePresence>
    )
  }

  // ── Tab config ────────────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { id: 'upload',       label: 'Ingest',       icon: <Upload size={14} /> },
    { id: 'elements',     label: 'Elements',     icon: <Zap size={14} />,       disabled: !hasData },
    { id: 'graph',        label: 'Graph',        icon: <Network size={14} />,   disabled: !hasData },
    { id: 'traceability', label: 'Traceability', icon: <GitBranch size={14} />, disabled: !hasData },
  ]

  // Tab panel helper — absolute inset-0 fills the parent precisely;
  // display:none hides without unmounting so all component state is preserved.
  const tabStyle = (t: Tab): React.CSSProperties => ({
    position:  'absolute',
    inset:     0,
    display:   tab === t ? 'block' : 'none',
    overflow:  'hidden',
  })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col h-screen bg-bg overflow-hidden"
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface shrink-0">
        <button
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          onClick={() => setEntered(false)}
          title="Back to home"
        >
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <Network size={14} className="text-white" />
          </div>
          <span className="font-semibold text-white tracking-tight">GraphRAG</span>
          <span className="text-muted text-xs font-mono">Procurement Intelligence</span>
        </button>

        <div className="flex items-center gap-2">
          {preloading && (
            <span className="text-xs text-muted font-mono flex items-center gap-1.5 mr-2">
              <span className="w-3 h-3 border border-muted/30 border-t-muted rounded-full animate-spin inline-block" />
              Loading…
            </span>
          )}
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
            onClick={() => !t.disabled && handleTabChange(t.id)}
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

        {pipelineRunning && (
          <div className="ml-auto mb-1 flex items-center gap-1.5 text-xs text-primary font-mono">
            <span className="w-2.5 h-2.5 border border-primary/40 border-t-primary rounded-full animate-spin" />
            Running…
          </div>
        )}
      </nav>

      {/* ── Content — keep-alive tabs ──────────────────────────────── */}
      {/*
        Components mount on first visit and stay mounted behind display:none.
        This preserves WorkflowPanel job history, React Flow zoom/pan state,
        and all other local state across tab switches.
      */}
      <main className="flex-1 overflow-hidden relative">
        {/* Ingest — always mounted */}
        <div style={tabStyle('upload')}>
          <WorkflowPanel
            onSSEEvent={handleSSEEvent}
            hasData={hasData}
            onLoadExisting={loadExistingData}
            onToast={addToast}
          />
        </div>

        {/* Elements — lazy-mounted on first visit */}
        {visitedTabs.has('elements') && (
          <div style={tabStyle('elements')}>
            <ElementsTable elements={elements} />
          </div>
        )}

        {/* Graph — lazy-mounted; stays alive so React Flow keeps its state */}
        {visitedTabs.has('graph') && (
          <div style={tabStyle('graph')}>
            <KnowledgeGraph refreshKey={graphRefresh} />
          </div>
        )}

        {/* Traceability — lazy-mounted on first visit */}
        {visitedTabs.has('traceability') && (
          <div style={tabStyle('traceability')}>
            <TraceabilityView coverage={coverage} />
          </div>
        )}
      </main>

      {/* ── Floating chat ───────────────────────────────────────────── */}
      <ChatWindow disabled={!hasData} />

      {/* ── Toast notifications ─────────────────────────────────────── */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </motion.div>
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
