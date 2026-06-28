import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Network, Plus, Trash2, FolderOpen, Clock, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import { fetchWorkspaces, createWorkspace, deleteWorkspace } from '../api/client'
import type { Workspace } from '../types'

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
          <h2 className="text-base font-semibold text-white">New Analysis Workspace</h2>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors p-1 rounded-lg hover:bg-card">
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
              placeholder="e.g. RFP Analysis Q3 2024"
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-muted/50 focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Description</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Optional — describe the scope or purpose"
              rows={3}
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-muted/50 focus:outline-none focus:border-primary transition-colors resize-none"
            />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-muted border border-border hover:text-white transition-colors"
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

function WorkspaceCard({ workspace, onOpen, onDelete }: {
  workspace: Workspace
  onOpen: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="group relative bg-card border border-border rounded-2xl p-5 hover:border-primary/40 hover:shadow-[0_0_16px_rgba(99,102,241,0.07)] transition-all cursor-pointer"
      onClick={onOpen}
    >
      {/* Icon + Name */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
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
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-muted border border-border hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger/10 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <h3 className="font-semibold text-white text-sm mb-1 truncate">{workspace.name}</h3>
      {workspace.description && (
        <p className="text-xs text-muted line-clamp-2 mb-3">{workspace.description}</p>
      )}

      <div className="flex items-center gap-1 text-xs text-muted/60 font-mono mt-auto">
        <Clock size={10} />
        <span>{timeAgo(workspace.updated_at)}</span>
      </div>

      {/* Open hint */}
      <div className="absolute inset-x-0 bottom-0 rounded-b-2xl h-0.5 bg-primary scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
    </motion.div>
  )
}

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
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="border-b border-border bg-surface px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
            <Network size={15} className="text-white" />
          </div>
          <div>
            <span className="font-bold text-white text-base tracking-tight">GraphRAG</span>
            <span className="ml-2 text-muted text-xs font-mono">Procurement Intelligence</span>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
        >
          <Plus size={14} />
          New workspace
        </button>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-10">
        {/* Hero */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Analysis Workspaces</h1>
          <p className="text-muted text-sm mt-1">
            Each workspace is an isolated procurement analysis — separate graph, vectors, and coverage.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-40 rounded-2xl bg-card border border-border animate-pulse" />
            ))}
          </div>
        ) : workspaces.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-24 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <FolderOpen size={24} className="text-primary" />
            </div>
            <h2 className="text-base font-semibold text-white mb-2">No workspaces yet</h2>
            <p className="text-sm text-muted mb-6 max-w-xs">
              Create a workspace to start ingesting procurement documents and building knowledge graphs.
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
                'h-full min-h-[11rem] rounded-2xl border-2 border-dashed border-border',
                'flex flex-col items-center justify-center gap-2 text-muted',
                'hover:border-primary/40 hover:text-primary transition-all',
              )}
            >
              <Plus size={20} />
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
