import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, FlaskConical, Clock, X, ArrowRight, ArrowLeft, Database, ShieldCheck, Sparkles } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import { fetchProjects, createProject, deleteProject } from '../api/client'
import type { StudioProject } from '../types'
import ThemeToggle from '../components/ThemeToggle'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000); const h = Math.floor(m / 60); const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ago`; if (h > 0) return `${h}h ago`; if (m > 0) return `${m}m ago`
  return 'just now'
}

const CAPABILITIES = [
  { icon: <Sparkles size={12} />,    label: 'Generation'   },
  { icon: <ShieldCheck size={12} />, label: 'Validation'   },
  { icon: <FlaskConical size={12} />,label: 'Quality + SME' },
  { icon: <Database size={12} />,    label: 'Versioned Datasets' },
]

function CreateModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (name: string, desc: string, threshold: number) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [threshold, setThreshold] = useState(5)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setLoading(true)
    try { await onCreate(name.trim(), desc.trim(), threshold) }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed'); setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ duration: 0.15 }}
        className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl"
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">New Studio Project</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground p-1 rounded-lg hover:bg-card"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Name *</label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Contract Clause Augmentation"
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder-muted/50 focus:outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
              placeholder="Optional — scope / purpose"
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder-muted/50 focus:outline-none focus:border-primary resize-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Minimum examples per category (threshold)</label>
            <input type="number" min={1} max={100} value={threshold}
              onChange={e => setThreshold(Math.max(1, Number(e.target.value) || 1))}
              className="w-32 bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary" />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-muted border border-border hover:text-foreground">Cancel</button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50">
              {loading ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

function ProjectCard({ project, onOpen, onDelete }: {
  project: StudioProject; onOpen: () => void; onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const cellsCovered = project.seed_summary?.counts ? Object.keys(project.seed_summary.counts).length : 0
  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
      onClick={onOpen}
      className="group relative bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/40 hover:shadow-[0_4px_32px_rgba(99,102,241,0.10)] transition-all cursor-pointer flex flex-col">
      <div className="h-[3px] w-full bg-gradient-to-r from-primary/70 via-primary/40 to-transparent group-hover:from-primary" />
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-3 mb-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0">
            <FlaskConical size={16} className="text-primary" />
          </div>
          <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
            {confirm ? (
              <div className="flex items-center gap-1.5">
                <button onClick={onDelete} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-danger/20 text-danger border border-danger/30">Delete</button>
                <button onClick={() => setConfirm(false)} className="px-2.5 py-1 rounded-lg text-xs font-medium text-muted border border-border">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirm(true)} className="p-1.5 rounded-lg text-muted/50 hover:text-danger hover:bg-danger/10"><Trash2 size={13} /></button>
            )}
          </div>
        </div>
        <h3 className="font-semibold text-foreground text-sm leading-snug mb-1.5 truncate group-hover:text-primary">{project.name}</h3>
        {project.description
          ? <p className="text-xs text-muted/70 line-clamp-2 leading-relaxed flex-1">{project.description}</p>
          : <p className="text-xs text-muted/35 italic flex-1">No description</p>}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
          <div className="flex items-center gap-1.5 text-[11px] text-muted/50 font-mono">
            <Clock size={10} /><span>{timeAgo(project.updated_at)}</span>
          </div>
          <span className="text-[11px] text-muted/60 font-mono">
            thr {project.min_threshold}{cellsCovered ? ` · ${cellsCovered} seeded cells` : ''}
          </span>
        </div>
      </div>
    </motion.div>
  )
}

export default function StudioProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<StudioProject[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setProjects(await fetchProjects()) }
    catch { setError('Could not load projects — is the backend running?') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const handleCreate = async (name: string, desc: string, threshold: number) => {
    const p = await createProject(name, desc, threshold)
    setShowCreate(false)
    navigate(`/studio/project/${p.id}`)
  }
  const handleDelete = async (id: string) => {
    try { await deleteProject(id); setProjects(prev => prev.filter(p => p.id !== id)) }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Delete failed') }
  }

  return (
    <div className="h-screen overflow-y-auto bg-bg">
      <header className="border-b border-border bg-surface/80 backdrop-blur-sm px-8 py-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-muted hover:text-foreground text-xs font-medium">
            <ArrowLeft size={13} /> Home
          </button>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center"><FlaskConical size={15} className="text-white" /></div>
            <span className="font-bold text-foreground text-sm tracking-tight">Synthetic Data Studio</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 shadow-lg shadow-primary/20">
            <Plus size={14} /> New project
          </button>
        </div>
      </header>

      <div className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 20% 60%, rgba(99,102,241,0.10) 0%, transparent 50%)' }} />
        <div className="relative max-w-5xl mx-auto px-8 py-5 flex items-center justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-foreground tracking-tight mb-1.5">
              Generate. Validate. <span style={{ color: 'var(--primary)' }}>Review. Publish.</span>
            </h1>
            <p className="text-muted text-xs max-w-md leading-relaxed">
              Seed with real docs, close category gaps with synthetic requirements, clauses, risks & contracts,
              SME-review a representative sample, then publish a balanced dataset into Analysis.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 shrink-0">
            {CAPABILITIES.map(c => (
              <div key={c.label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-card border border-border text-[11px] font-medium text-muted whitespace-nowrap">
                <span style={{ color: 'var(--primary)' }}>{c.icon}</span>{c.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-8 py-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-[3px] h-5 rounded-full bg-primary" />
          <h2 className="text-base font-semibold text-foreground">Projects</h2>
          {!loading && projects.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-mono">{projects.length}</span>
          )}
        </div>
        {error && <div className="mb-6 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</div>}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <div key={i} className="h-40 rounded-2xl bg-card border border-border animate-pulse" />)}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <FlaskConical size={24} className="text-primary" />
            </div>
            <h2 className="text-lg font-bold text-foreground mb-2">No projects yet</h2>
            <p className="text-sm text-muted mb-6 max-w-sm leading-relaxed">
              Create a project, upload seed documents, and let the Studio surface which categories need more examples.
            </p>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90">
              <Plus size={14} /> Create your first project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {projects.map(p => (
                <ProjectCard key={p.id} project={p} onOpen={() => navigate(`/studio/project/${p.id}`)} onDelete={() => handleDelete(p.id)} />
              ))}
            </AnimatePresence>
            <motion.button layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => setShowCreate(true)}
              className={clsx('min-h-[10rem] rounded-2xl border-2 border-dashed border-border',
                'flex flex-col items-center justify-center gap-2.5 text-muted hover:border-primary/50 hover:text-primary hover:bg-primary/[0.03] transition-all')}>
              <div className="w-8 h-8 rounded-xl border border-current/30 flex items-center justify-center"><Plus size={16} /></div>
              <span className="text-xs font-medium">New project</span>
            </motion.button>
          </div>
        )}
      </main>

      <AnimatePresence>
        {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
      </AnimatePresence>
    </div>
  )
}
