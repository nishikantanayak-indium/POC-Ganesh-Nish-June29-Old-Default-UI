import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, FlaskConical, Sparkles, ShieldCheck, BarChart3, UserCheck, Database } from 'lucide-react'
import { motion } from 'framer-motion'
import clsx from 'clsx'

import ThemeToggle from '../components/ThemeToggle'
import { ToastContainer, useToast } from '../components/Toast'
import GenerateTab from '../components/studio/GenerateTab'
import ValidateTab from '../components/studio/ValidateTab'
import QualityTab from '../components/studio/QualityTab'
import SMEReviewTab from '../components/studio/SMEReviewTab'
import DatasetsTab from '../components/studio/DatasetsTab'
import { fetchStudioMeta, fetchProject, fetchOverview, fetchVersions } from '../api/client'
import type { StudioMeta, StudioProject, StudioOverview, StudioVersion } from '../types'

type Tab = 'generate' | 'validate' | 'quality' | 'sme' | 'datasets'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'generate',  label: 'Generate',    icon: <Sparkles size={14} /> },
  { id: 'validate',  label: 'Validate',    icon: <ShieldCheck size={14} /> },
  { id: 'quality',   label: 'Quality',     icon: <BarChart3 size={14} /> },
  { id: 'sme',       label: 'SME Review',  icon: <UserCheck size={14} /> },
  { id: 'datasets',  label: 'Datasets',    icon: <Database size={14} /> },
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
  const [versions, setVersions] = useState<StudioVersion[]>([])
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null)
  const { toasts, addToast, removeToast } = useToast()

  const reloadOverview = useCallback(async () => {
    try { setOverview(await fetchOverview(projectId)) } catch { /* ignore */ }
  }, [projectId])

  const reloadVersions = useCallback(async () => {
    try {
      const vs = await fetchVersions(projectId)
      setVersions(vs)
      setActiveVersionId(prev => prev && vs.some(v => v.id === prev) ? prev : (vs[0]?.id ?? null))
    } catch { /* ignore */ }
  }, [projectId])

  useEffect(() => {
    fetchStudioMeta().then(setMeta).catch(() => {})
    fetchProject(projectId).then(setProject).catch(() => {})
    reloadOverview()
    reloadVersions()
  }, [projectId, reloadOverview, reloadVersions])

  const changeTab = useCallback((next: Tab) => {
    navigate(`/studio/project/${projectId}/${next}`)
    setVisited(prev => prev.has(next) ? prev : new Set([...prev, next]))
  }, [navigate, projectId])

  // When a generation completes, refresh everything and jump the user to Validate.
  const onGenerationComplete = useCallback(async (newVersionId: string) => {
    await Promise.all([reloadOverview(), reloadVersions()])
    setActiveVersionId(newVersionId)
    addToast('Generation complete — records staged', 'success')
  }, [reloadOverview, reloadVersions, addToast])

  const activeVersion = versions.find(v => v.id === activeVersionId) ?? null
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
            {project && <span className="text-xs text-muted font-mono">· threshold {project.min_threshold}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {versions.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted">Version</span>
              <select value={activeVersionId ?? ''} onChange={e => setActiveVersionId(e.target.value)}
                className="bg-card border border-border rounded-lg px-2 py-1 text-foreground font-mono focus:outline-none focus:border-primary">
                {versions.map(v => (
                  <option key={v.id} value={v.id}>v{v.version_no} · {v.status}</option>
                ))}
              </select>
            </div>
          )}
          <ThemeToggle />
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex items-center gap-1 px-6 pt-3 pb-0 border-b border-border bg-surface shrink-0">
        {TABS.map(t => {
          const disabled = t.id !== 'generate' && versions.length === 0
          const badge = t.id === 'datasets' && versions.length > 0 ? versions.length : undefined
          return (
            <button key={t.id} onClick={() => !disabled && changeTab(t.id)} disabled={disabled}
              style={{
                borderBottomColor: t.id === tab ? 'var(--primary)' : 'transparent',
                color: t.id === tab ? 'var(--foreground)' : disabled ? 'var(--border)' : 'var(--muted)',
              }}
              className={clsx('flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg transition-all border-b-2 -mb-px',
                disabled ? 'cursor-not-allowed' : 'hover:brightness-125')}>
              {t.icon}{t.label}
              {badge !== undefined && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-mono">{badge}</span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Keep-alive tab content */}
      <main className="flex-1 overflow-hidden relative">
        <div style={tabStyle('generate')}>
          <GenerateTab
            projectId={projectId} meta={meta} overview={overview}
            onReloadOverview={reloadOverview} onGenerationComplete={onGenerationComplete}
            onToast={addToast}
          />
        </div>
        {visited.has('validate') && (
          <div style={tabStyle('validate')}>
            <ValidateTab meta={meta} version={activeVersion} />
          </div>
        )}
        {visited.has('quality') && (
          <div style={tabStyle('quality')}>
            <QualityTab version={activeVersion} />
          </div>
        )}
        {visited.has('sme') && (
          <div style={tabStyle('sme')}>
            <SMEReviewTab meta={meta} version={activeVersion} onToast={addToast} />
          </div>
        )}
        {visited.has('datasets') && (
          <div style={tabStyle('datasets')}>
            <DatasetsTab projectId={projectId} versions={versions}
              onReloadVersions={reloadVersions} onToast={addToast} />
          </div>
        )}
      </main>

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </motion.div>
  )
}
