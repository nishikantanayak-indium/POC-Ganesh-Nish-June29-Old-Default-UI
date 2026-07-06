import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, FlaskConical, Sparkles, UserCheck } from 'lucide-react'
import { motion } from 'framer-motion'
import clsx from 'clsx'

import ThemeToggle from '../components/ThemeToggle'
import { ToastContainer, useToast } from '../components/Toast'
import GenerateTab from '../components/studio/GenerateTab'
// Parked — element-level generation's Validate/Quality tabs. Not deleted:
// the backend services (validation_service, quality_service) and these
// components stay fully functional, just unreachable from the document-first
// UI for now. Re-add to TABS + the render block below to bring them back.
// import ValidateTab from '../components/studio/ValidateTab'
// import QualityTab from '../components/studio/QualityTab'
import ReviewTab from '../components/studio/SMEReviewTab'
import { fetchStudioMeta, fetchProject, fetchOverview, fetchVersions } from '../api/client'
import type { StudioMeta, StudioProject, StudioOverview } from '../types'

// No version/staging/main language anywhere in this page — every generated
// document just flows Draft → In Review → Approved/Rejected → Published.
// The Review tab handles the whole lifecycle including sending an approved
// document to storage, so there's no separate "Documents" tab.
type Tab = 'generate' | 'review'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'generate', label: 'Generate', icon: <Sparkles size={14} /> },
  { id: 'review',   label: 'Review',   icon: <UserCheck size={14} /> },
]

export default function StudioProjectPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const location = useLocation()

  const pathTab = location.pathname.split('/').pop() as Tab
  const tab: Tab = TABS.some(t => t.id === pathTab) ? pathTab : 'generate'
  const [visited, setVisited] = useState<Set<Tab>>(new Set<Tab>(['generate']))

  const [meta, setMeta] = useState<StudioMeta | null>(null)
  const [project, setProject] = useState<StudioProject | null>(null)
  const [overview, setOverview] = useState<StudioOverview | null>(null)
  // Only used to gate "has anything been generated yet?" — never rendered.
  const [hasGenerated, setHasGenerated] = useState(false)
  const { toasts, addToast, removeToast } = useToast()

  const reloadOverview = useCallback(async () => {
    try { setOverview(await fetchOverview(projectId)) } catch { /* ignore */ }
  }, [projectId])

  const checkHasGenerated = useCallback(async () => {
    try { setHasGenerated((await fetchVersions(projectId)).length > 0) } catch { /* ignore */ }
  }, [projectId])

  useEffect(() => {
    fetchStudioMeta().then(setMeta).catch(() => {})
    fetchProject(projectId).then(setProject).catch(() => {})
    reloadOverview()
    checkHasGenerated()
  }, [projectId, reloadOverview, checkHasGenerated])

  const changeTab = useCallback((next: Tab) => {
    navigate(`/studio/project/${projectId}/${next}`)
    setVisited(prev => prev.has(next) ? prev : new Set([...prev, next]))
  }, [navigate, projectId])

  const onGenerationComplete = useCallback(async () => {
    await Promise.all([reloadOverview(), checkHasGenerated()])
    addToast('Documents generated — ready for review', 'success')
  }, [reloadOverview, checkHasGenerated, addToast])

  const tabStyle = (t: Tab): React.CSSProperties => ({
    position: 'absolute', inset: 0, display: tab === t ? 'block' : 'none', overflow: 'hidden',
  })

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
      className="flex flex-col h-screen bg-bg overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/studio')} className="flex items-center gap-1.5 text-muted hover:text-foreground text-xs font-medium">
            <ArrowLeft size={13} /> Projects
          </button>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-primary flex items-center justify-center"><FlaskConical size={13} className="text-white" /></div>
            <span className="font-semibold text-foreground text-sm tracking-tight">{project?.name ?? 'Studio'}</span>
            {project && (
              <span className="text-xs text-muted font-mono cursor-help"
                title="Minimum documents per type. Used by the Generate tab's gap analysis.">
                · target {project.min_threshold}/type
              </span>
            )}
          </div>
        </div>
        <ThemeToggle />
      </header>

      {/* Tabs */}
      <nav className="flex items-center gap-1 px-6 pt-3 pb-0 border-b border-border bg-surface shrink-0">
        {TABS.map(t => {
          const disabled = t.id !== 'generate' && !hasGenerated
          return (
            <button key={t.id} onClick={() => !disabled && changeTab(t.id)} disabled={disabled}
              style={{
                borderBottomColor: t.id === tab ? 'var(--primary)' : 'transparent',
                color: t.id === tab ? 'var(--foreground)' : disabled ? 'var(--border)' : 'var(--muted)',
              }}
              className={clsx('flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg transition-all border-b-2 -mb-px',
                disabled ? 'cursor-not-allowed' : 'hover:brightness-125')}>
              {t.icon}{t.label}
            </button>
          )
        })}
      </nav>

      {/* Keep-alive tab content */}
      <main className="flex-1 overflow-hidden relative">
        <div style={tabStyle('generate')}>
          <GenerateTab
            projectId={projectId} overview={overview}
            onReloadOverview={reloadOverview} onGenerationComplete={onGenerationComplete}
            onToast={addToast}
          />
        </div>
        {visited.has('review') && (
          <div style={tabStyle('review')}>
            <ReviewTab projectId={projectId} onToast={addToast} />
          </div>
        )}
      </main>

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </motion.div>
  )
}
