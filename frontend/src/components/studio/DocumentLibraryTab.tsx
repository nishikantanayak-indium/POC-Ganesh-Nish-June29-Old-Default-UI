import { useCallback, useEffect, useMemo, useState } from 'react'
import { LibraryBig, RotateCcw, FileText, Send } from 'lucide-react'
import clsx from 'clsx'
import { fetchProjectDocuments, fetchDocumentMarkdown, publishDocuments } from '../../api/client'
import type { SyntheticDocumentT } from '../../types'
import DocumentViewer, { STATUS_LABEL, statusTone } from './DocumentViewer'

// Professional document library — replaces the old Git-flavoured "Datasets"
// tab (version cards, promote/clone, staging/main badges, lineage graph).
// Every document in the project is browsable here, click one to read it in
// the same DocumentViewer the Review tab uses, and send approved documents
// to the shared document store with a plain checkbox + button.

interface Props {
  projectId: string
  onToast: (msg: string, type: 'success' | 'error') => void
}

type Filter = 'all' | 'staged' | 'sme_approved' | 'sme_rejected' | 'published'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'staged', label: 'Pending review' },
  { id: 'sme_approved', label: 'Approved' },
  { id: 'sme_rejected', label: 'Rejected' },
  { id: 'published', label: 'Published' },
]

export default function DocumentLibraryTab({ projectId, onToast }: Props) {
  const [documents, setDocuments] = useState<SyntheticDocumentT[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [publishing, setPublishing] = useState(false)

  const [markdown, setMarkdown] = useState('')
  const [loadingDoc, setLoadingDoc] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setDocuments(await fetchProjectDocuments(projectId)) }
    catch { /* ignore */ } finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { load() }, [load])

  const list = useMemo(
    () => filter === 'all' ? documents : documents.filter(d => d.status === filter),
    [documents, filter],
  )
  const selected = documents.find(d => d.id === selectedId) ?? list[0] ?? null

  useEffect(() => {
    if (!selected) { setMarkdown(''); return }
    setLoadingDoc(true)
    fetchDocumentMarkdown(selected.version_id ?? '', selected.id)
      .then(setMarkdown)
      .catch(() => setMarkdown('_Could not load document content._'))
      .finally(() => setLoadingDoc(false))
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCheck = (id: string) => setChecked(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handlePublishSelected = async () => {
    const ids = [...checked]
    if (!ids.length) return
    setPublishing(true)
    try {
      const res = await publishDocuments(ids)
      onToast(`Sent ${res.published} document${res.published === 1 ? '' : 's'} to document storage`, 'success')
      setChecked(new Set())
      await load()
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Send to storage failed', 'error')
    } finally { setPublishing(false) }
  }

  const handlePublishOne = async () => {
    if (!selected) return
    setPublishing(true)
    try {
      const res = await publishDocuments([selected.id])
      onToast(`Sent ${res.published} document to document storage`, 'success')
      await load()
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Send to storage failed', 'error')
    } finally { setPublishing(false) }
  }

  const counts: Record<Filter, number> = {
    all: documents.length,
    staged: documents.filter(d => d.status === 'staged').length,
    sme_approved: documents.filter(d => d.status === 'sme_approved').length,
    sme_rejected: documents.filter(d => d.status === 'sme_rejected').length,
    published: documents.filter(d => d.status === 'published').length,
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <LibraryBig size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Document Library</h3>
          <span className="text-xs text-muted">{documents.length} document{documents.length === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center gap-2">
          {checked.size > 0 && (
            <button onClick={handlePublishSelected} disabled={publishing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50">
              <Send size={12} /> Send {checked.size} to Document Storage
            </button>
          )}
          <button onClick={load} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-border text-muted hover:text-foreground">
            <RotateCcw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left — library list */}
        <div className="w-80 shrink-0 border-r border-border flex flex-col overflow-hidden">
          <div className="flex flex-wrap gap-1 p-2 border-b border-border">
            {FILTERS.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={clsx('flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                  filter === f.id ? 'bg-primary text-white' : 'bg-card text-muted hover:text-foreground')}>
                {f.label} <span className="opacity-70">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {list.length === 0 && !loading && (
              <p className="text-xs text-muted text-center py-8 px-3">
                {documents.length === 0 ? 'No documents yet — generate some in the Generate tab.' : 'No documents in this filter.'}
              </p>
            )}
            {list.map(doc => (
              <div key={doc.id}
                className={clsx('w-full flex items-start gap-2 px-3 py-2.5 border-b border-border/50 cursor-pointer transition-colors',
                  selected?.id === doc.id ? 'bg-card' : 'hover:bg-card/50')}
                onClick={() => setSelectedId(doc.id)}>
                {doc.status === 'sme_approved' && (
                  <input type="checkbox" checked={checked.has(doc.id)}
                    onClick={e => e.stopPropagation()}
                    onChange={() => toggleCheck(doc.id)}
                    className="mt-0.5 accent-[var(--primary)]" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <FileText size={11} className="text-muted shrink-0" />
                    <span className="text-xs font-medium text-foreground truncate flex-1">{doc.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">{doc.doc_type}</span>
                    <span className={clsx('text-[10px] font-mono px-1.5 py-0.5 rounded border', statusTone(doc.status))}>{STATUS_LABEL[doc.status] ?? doc.status}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — reader */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="h-full flex items-center justify-center"><p className="text-sm text-muted">Select a document to view.</p></div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-6">
              <DocumentViewer
                doc={selected} markdown={markdown} loading={loadingDoc} mode="library" busy={publishing}
                comment="" onCommentChange={() => {}}
                onPublish={handlePublishOne}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
