import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Trash2, FolderOpen, Clock, X,
  GitBranch, Network, ShieldCheck, MessageSquare, ArrowRight,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import { fetchWorkspaces, createWorkspace, deleteWorkspace } from '../api/client'
import type { Workspace } from '../types'
import KnowledgeMapLogo from '../components/KnowledgeMapLogo'
import ThemeToggle from '../components/ThemeToggle'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ago`
  if (h > 0) return `${h}h ago`
  if (m > 0) return `${m}m ago`
  return 'just now'
}

// ── Capability pills shown in hero ────────────────────────────────────────────
const CAPABILITIES = [
  { icon: <Network size={12} />,     label: 'Knowledge Graphs'     },
  { icon: <GitBranch size={12} />,   label: 'Risk Traceability'    },
  { icon: <ShieldCheck size={12} />, label: 'Coverage Assessment'  },
  { icon: <MessageSquare size={12}/>,label: 'Semantic Q&A'         },
]

// ── Create modal ──────────────────────────────────────────────────────────────
function CreateModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (name: string, desc: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setLoading(true)
    try {
      await onCreate(name.trim(), desc.trim())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.15 }}
        className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl"
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">New Workspace</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors p-1 rounded-lg hover:bg-card">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Name *</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. RFP Analysis Q3 2025"
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder-muted/50 focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Description</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Optional — describe the scope or purpose"
              rows={3}
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder-muted/50 focus:outline-none focus:border-primary transition-colors resize-none"
            />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-muted border border-border hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Creating…' : 'Create workspace'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

// ── Workspace card ────────────────────────────────────────────────────────────
function WorkspaceCard({ workspace, onOpen, onDelete }: {
  workspace: Workspace
  onOpen: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="group relative bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/40 hover:shadow-[0_4px_32px_rgba(99,102,241,0.10)] transition-all duration-200 cursor-pointer flex flex-col"
      onClick={onOpen}
    >
      {/* Accent gradient top strip — thicker on hover */}
      <div className="h-[3px] w-full bg-gradient-to-r from-primary/70 via-primary/40 to-transparent group-hover:from-primary group-hover:via-primary/60 transition-all duration-200" />

      <div className="p-5 flex flex-col flex-1">
        {/* Top row: icon + delete */}
        <div className="flex items-start justify-between gap-3 mb-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0 group-hover:border-primary/35 transition-colors">
            <FolderOpen size={16} className="text-primary" />
          </div>
          <div
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={e => e.stopPropagation()}
          >
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onDelete}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-danger/20 text-danger border border-danger/30 hover:bg-danger/30 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium text-muted border border-border hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="p-1.5 rounded-lg text-muted/50 hover:text-danger hover:bg-danger/10 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Name + description */}
        <h3 className="font-semibold text-foreground text-sm leading-snug mb-1.5 truncate group-hover:text-primary transition-colors duration-150">
          {workspace.name}
        </h3>
        {workspace.description ? (
          <p className="text-xs text-muted/70 line-clamp-2 leading-relaxed flex-1">
            {workspace.description}
          </p>
        ) : (
          <p className="text-xs text-muted/35 italic flex-1">No description</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
          <div className="flex items-center gap-1.5 text-[11px] text-muted/50 font-mono">
            <Clock size={10} />
            <span>{timeAgo(workspace.updated_at)}</span>
          </div>
          <span className="flex items-center gap-1 text-[11px] text-primary font-semibold opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-primary/10 px-2 py-0.5 rounded-full">
            Open <ArrowRight size={10} />
          </span>
        </div>
      </div>
    </motion.div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function WorkspacesPage() {
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setWorkspaces(await fetchWorkspaces())
    } catch {
      setError('Could not load workspaces — is the backend running?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (name: string, desc: string) => {
    const ws = await createWorkspace(name, desc)
    setShowCreate(false)
    navigate(`/workspace/${ws.id}`)
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteWorkspace(id)
      setWorkspaces(prev => prev.filter(w => w.id !== id))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div className="h-screen overflow-y-auto bg-bg">

      {/* ── Header ── */}
      <header className="border-b border-border bg-surface/80 backdrop-blur-sm px-8 py-4 flex items-center justify-between sticky top-0 z-40">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
        >
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <KnowledgeMapLogo size={15} className="text-white" />
          </div>
          <span className="font-bold text-foreground text-sm tracking-tight">KnowledgeMap</span>
        </button>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
          >
            <Plus size={14} />
            New workspace
          </button>
        </div>
      </header>

      {/* ── Hero ── */}
      <div className="relative overflow-hidden border-b border-border">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 20% 60%, rgba(99,102,241,0.10) 0%, transparent 50%), radial-gradient(ellipse at 80% 10%, rgba(16,185,129,0.06) 0%, transparent 50%)',
          }}
        />
        <div className="relative max-w-5xl mx-auto px-8 py-5">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="flex items-center justify-between gap-6 flex-wrap"
          >
            {/* Left: heading + subtitle */}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-foreground tracking-tight leading-tight mb-1.5">
                Map every requirement.{' '}
                <span style={{ color: 'var(--primary)' }}>Trace every risk.</span>
              </h1>
              <p className="text-muted text-xs max-w-md leading-relaxed">
                Upload RFPs, risk sheets, and contracts — extract atomic semantic elements and build a knowledge graph with full requirement traceability.
              </p>
            </div>

            {/* Right: capability pills */}
            <div className="flex flex-wrap gap-1.5 shrink-0">
              {CAPABILITIES.map(c => (
                <div
                  key={c.label}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-card border border-border text-[11px] font-medium text-muted whitespace-nowrap"
                >
                  <span style={{ color: 'var(--primary)' }}>{c.icon}</span>
                  {c.label}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── Workspace grid ── */}
      <main className="max-w-5xl mx-auto px-8 py-6">

        {/* Section heading */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-[3px] h-5 rounded-full bg-primary" />
            <h2 className="text-base font-semibold text-foreground">Workspaces</h2>
            {!loading && workspaces.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-mono font-medium">
                {workspaces.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {['Graph isolation', 'Semantic search', 'Coverage tracking'].map((tag, i) => (
              <span
                key={i}
                className="px-2.5 py-1 rounded-lg bg-card border border-border text-[11px] text-muted/60 font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-44 rounded-2xl bg-card border border-border animate-pulse" />
            ))}
          </div>
        ) : workspaces.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <FolderOpen size={24} className="text-primary" />
            </div>
            <h2 className="text-lg font-bold text-foreground mb-2">No workspaces yet</h2>
            <p className="text-sm text-muted mb-6 max-w-sm leading-relaxed">
              Create your first workspace to start ingesting procurement documents and building a knowledge graph with full requirement traceability.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <Plus size={14} />
              Create your first workspace
            </button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {workspaces.map(ws => (
                <WorkspaceCard
                  key={ws.id}
                  workspace={ws}
                  onOpen={() => navigate(`/workspace/${ws.id}`)}
                  onDelete={() => handleDelete(ws.id)}
                />
              ))}
            </AnimatePresence>

            {/* Add new card */}
            <motion.button
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={() => setShowCreate(true)}
              className={clsx(
                'min-h-[11rem] rounded-2xl border-2 border-dashed border-border',
                'flex flex-col items-center justify-center gap-2.5 text-muted',
                'hover:border-primary/50 hover:text-primary hover:bg-primary/[0.03] transition-all',
              )}
            >
              <div className="w-8 h-8 rounded-xl border border-current/30 flex items-center justify-center">
                <Plus size={16} />
              </div>
              <span className="text-xs font-medium">New workspace</span>
            </motion.button>
          </div>
        )}
      </main>

      <AnimatePresence>
        {showCreate && (
          <CreateModal
            onClose={() => setShowCreate(false)}
            onCreate={handleCreate}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
