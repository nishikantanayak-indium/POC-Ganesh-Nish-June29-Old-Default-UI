import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Network, Upload, GitBranch, Zap, Trash2, ArrowLeft, MessageSquare, FlaskConical } from 'lucide-react'
import { motion } from 'framer-motion'
import clsx from 'clsx'

import KnowledgeMapLogo from '../components/KnowledgeMapLogo'
import ThemeToggle from '../components/ThemeToggle'
import WorkflowPanel from '../components/WorkflowPanel'
import SyntheticLibraryModal from '../components/SyntheticLibraryModal'
import KnowledgeGraph from '../components/KnowledgeGraph'
import ElementsView from '../components/ElementsView'
import TraceabilityView from '../components/TraceabilityView'
import ChatWindow from '../components/ChatWindow'
import { ToastContainer, useToast } from '../components/Toast'
import { usePipelineStore, useWorkspaceJobs } from '../store/pipelineStore'
import {
  fetchStatus, fetchElements, fetchCoverage, resetGraph, fetchWorkspace, fetchDocuments,
} from '../api/client'
import type { AppStatus, GraphNode, CoverageResult, DocumentContent, SSEEvent } from '../types'

type Tab = 'ingest' | 'elements' | 'graph' | 'traceability'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'ingest',        label: 'Ingest',        icon: <Upload size={14} /> },
  { id: 'elements',      label: 'Explorer',      icon: <Zap size={14} /> },
  { id: 'graph',         label: 'Graph',         icon: <Network size={14} /> },
  { id: 'traceability',  label: 'Traceability',  icon: <GitBranch size={14} /> },
]

function chatPath(workspaceId: string) {
  return `/workspace/${workspaceId}/chat`
}

function tabPath(workspaceId: string, tab: Tab) {
  return `/workspace/${workspaceId}/${tab}`
}

export default function WorkspacePage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const location = useLocation()

  // Derive active tab from URL path segment
  const pathTab = location.pathname.split('/').pop() as Tab
  const tab: Tab = TABS.some(t => t.id === pathTab) ? pathTab : 'ingest'

  // Keep-alive: once a tab has been visited, its component stays mounted
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(new Set<Tab>(['ingest']))

  const handleTabChange = useCallback((next: Tab) => {
    navigate(tabPath(workspaceId, next))
    setVisitedTabs(prev => prev.has(next) ? prev : new Set([...prev, next]))
  }, [navigate, workspaceId])

  const [status, setStatus]         = useState<AppStatus | null>(null)
  const [workspaceName, setWorkspaceName] = useState('')
  const [elements, setElements]     = useState<GraphNode[]>([])
  const [coverage, setCoverage]     = useState<CoverageResult[]>([])
  const [documents, setDocuments]   = useState<DocumentContent[]>([])
  const [graphRefresh, setGraphRefresh] = useState(0)
  const [preloading, setPreloading] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [showSyntheticLibrary, setShowSyntheticLibrary] = useState(false)

  const wsJobs = useWorkspaceJobs(workspaceId)
  const pipelineRunning = wsJobs.some(j => j.status === 'running')
  const { toasts, addToast, removeToast } = useToast()
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadData = useCallback(async () => {
    setPreloading(true)
    try {
      const [elems, cov, st, docs] = await Promise.allSettled([
        fetchElements(workspaceId),
        fetchCoverage(workspaceId),
        fetchStatus(workspaceId),
        fetchDocuments(workspaceId),
      ])
      if (elems.status === 'fulfilled') setElements(elems.value)
      if (cov.status   === 'fulfilled') setCoverage(cov.value)
      if (st.status    === 'fulfilled') setStatus(st.value)
      if (docs.status  === 'fulfilled') setDocuments(docs.value)
      if (elems.status === 'fulfilled' && elems.value.length > 0) setGraphRefresh(n => n + 1)
    } finally {
      setPreloading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    // Load workspace name for display + cross-workspace toast labels
    fetchWorkspace(workspaceId)
      .then(ws => setWorkspaceName(ws.name))
      .catch(() => {})
    loadData()
  }, [workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSSEEvent = useCallback((evt: SSEEvent) => {
    if (evt.type === 'pipeline_complete') {
      // Update header stats immediately from the event summary — no need to wait for loadData
      setStatus({
        has_data: evt.summary.nodes > 0,
        nodes: evt.summary.nodes,
        edges: evt.summary.edges,
        type_counts: {},
      })
      setGraphRefresh(n => n + 1)
      // Full data refresh (elements + coverage) after the DB write settles
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null
        loadData()
      }, 2000)
    }
  }, [loadData])

  const handleReset = async () => {
    if (!resetConfirm) { setResetConfirm(true); return }
    await resetGraph(workspaceId)
    setResetConfirm(false)
    setElements([])
    setCoverage([])
    setDocuments([])
    setStatus({ has_data: false, nodes: 0, edges: 0, type_counts: {} })
    setGraphRefresh(n => n + 1)
    usePipelineStore.getState().clearJobs(workspaceId)
    handleTabChange('ingest')
    addToast('Workspace graph wiped', 'success')
  }

  const hasData = status?.has_data || elements.length > 0

  // CSS keep-alive: absolute fill, display:none when inactive
  const tabStyle = (t: Tab): React.CSSProperties => ({
    position: 'absolute', inset: 0,
    display: tab === t ? 'block' : 'none',
    overflow: 'hidden',
  })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col h-screen bg-bg overflow-hidden"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/workspaces')}
            className="flex items-center gap-1.5 text-muted hover:text-foreground transition-colors text-xs font-medium"
          >
            <ArrowLeft size={13} />
            Workspaces
          </button>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-primary flex items-center justify-center">
              <KnowledgeMapLogo size={14} className="text-foreground" />
            </div>
            <span className="font-semibold text-foreground text-sm tracking-tight">ContractIQ</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {preloading && (
            <span className="text-xs text-muted font-mono flex items-center gap-1.5">
              <span className="w-3 h-3 border border-muted/30 border-t-muted rounded-full animate-spin inline-block" />
              Loading…
            </span>
          )}
          <ThemeToggle />
          {status && (
            <div className="flex items-center gap-3">
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
                  : 'bg-card text-muted hover:text-foreground border border-border',
              )}
            >
              <Trash2 size={12} />
              {resetConfirm ? 'Confirm wipe?' : 'Wipe'}
            </button>
          )}
          {resetConfirm && (
            <button
              onClick={() => setResetConfirm(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-card text-muted border border-border hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <nav className="flex items-center gap-1 px-6 pt-3 pb-0 border-b border-border bg-surface shrink-0">
        {TABS.map(t => {
          const disabled = t.id !== 'ingest' && !hasData
          return (
            <button
              key={t.id}
              onClick={() => !disabled && handleTabChange(t.id)}
              disabled={disabled}
              style={{
                borderBottomColor: t.id === tab ? 'var(--primary)' : 'transparent',
                color: t.id === tab ? 'var(--foreground)' : disabled ? 'var(--border)' : 'var(--muted)',
              }}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg transition-all border-b-2 -mb-px',
                disabled ? 'cursor-not-allowed' : 'hover:brightness-125',
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
          )
        })}

        {/* Chat — navigates to standalone chat page */}
        <button
          onClick={() => hasData && navigate(chatPath(workspaceId))}
          disabled={!hasData}
          style={{ color: !hasData ? 'var(--border)' : 'var(--muted)', borderBottomColor: 'transparent' }}
          className={clsx(
            'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg transition-all border-b-2 -mb-px',
            !hasData ? 'cursor-not-allowed' : 'hover:brightness-125',
          )}
        >
          <MessageSquare size={14} />
          Chat
        </button>

        {pipelineRunning && (
          <div className="ml-auto mb-1 flex items-center gap-1.5 text-xs text-primary font-mono">
            <span className="w-2.5 h-2.5 border border-primary/40 border-t-primary rounded-full animate-spin" />
            Running…
          </div>
        )}
      </nav>

      {/* Keep-alive tab content */}
      <main className="flex-1 overflow-hidden relative">
        <div style={tabStyle('ingest')}>
          <button onClick={() => setShowSyntheticLibrary(true)}
            className="absolute top-3 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-primary/30 bg-surface text-primary hover:bg-primary/10">
            <FlaskConical size={13} /> Add from Synthetic Library
          </button>
          <WorkflowPanel
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            onSSEEvent={handleSSEEvent}
            hasData={hasData}
            onLoadExisting={loadData}
            onToast={addToast}
          />
        </div>

        {visitedTabs.has('elements') && (
          <div style={tabStyle('elements')}>
            <ElementsView elements={elements} documents={documents} loading={preloading} />
          </div>
        )}

        {visitedTabs.has('graph') && (
          <div style={tabStyle('graph')}>
            <KnowledgeGraph workspaceId={workspaceId} refreshKey={graphRefresh} />
          </div>
        )}

        {visitedTabs.has('traceability') && (
          <div style={tabStyle('traceability')}>
            <TraceabilityView workspaceId={workspaceId} coverage={coverage} />
          </div>
        )}
      </main>

      <ChatWindow workspaceId={workspaceId} disabled={!hasData} />
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
      {showSyntheticLibrary && (
        <SyntheticLibraryModal
          workspaceId={workspaceId}
          onClose={() => setShowSyntheticLibrary(false)}
          onImported={loadData}
        />
      )}
    </motion.div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-foreground font-mono text-sm font-semibold">{value.toLocaleString()}</div>
      <div className="text-muted text-xs">{label}</div>
    </div>
  )
}
