import { useCallback, useEffect, useMemo, useState } from 'react'
import { UserCheck, RotateCcw, FileText, Send } from 'lucide-react'
import clsx from 'clsx'
import {
  fetchProjectDocuments, submitDocumentVerdict, fetchDocumentMarkdown, publishDocuments,
} from '../../api/client'
import type { SyntheticDocumentT } from '../../types'
import DocumentViewer, { STATUS_LABEL, statusTone } from './DocumentViewer'

// The whole document lifecycle lives here — review, edit, approve/reject,
// AND send an approved document to storage — so there's no separate
// "Documents" tab duplicating the same list/viewer for one extra button.

interface Props {
  projectId: string
  onToast: (msg: string, type: 'success' | 'error') => void
}

type Filter = 'unreviewed' | 'approved' | 'rejected' | 'published' | 'all'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'unreviewed', label: 'Unreviewed' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'published', label: 'Published' },
  { id: 'all', label: 'All' },
]

export default function ReviewTab({ projectId, onToast }: Props) {
  const [documents, setDocuments] = useState<SyntheticDocumentT[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('unreviewed')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [publishing, setPublishing] = useState(false)

  const [markdown, setMarkdown] = useState('')
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setDocuments(await fetchProjectDocuments(projectId)) }
    catch { /* ignore */ } finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { load() }, [load])

  const buckets = useMemo(() => ({
    unreviewed: documents.filter(d => d.status === 'staged'),
    approved: documents.filter(d => d.status === 'sme_approved'),
    rejected: documents.filter(d => d.status === 'sme_rejected'),
    published: documents.filter(d => d.status === 'published'),
    all: documents,
  }), [documents])

  const list = buckets[filter]
  const selected = documents.find(d => d.id === selectedId) ?? list[0] ?? null

  useEffect(() => {
    if (!selected) { setMarkdown(''); return }
    setLoadingDoc(true)
    setComment('')
    fetchDocumentMarkdown(selected.version_id ?? '', selected.id)
      .then(setMarkdown)
      .catch(() => setMarkdown('_Could not load document content._'))
      .finally(() => setLoadingDoc(false))
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const reviewableTotal = buckets.unreviewed.length + buckets.approved.length + buckets.rejected.length
  const reviewedCount = buckets.approved.length + buckets.rejected.length
  const pct = reviewableTotal ? Math.round((reviewedCount / reviewableTotal) * 100) : 0

  const toggleCheck = (id: string) => setChecked(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const submitVerdict = async (verdict: string, corrected?: { markdown: string; title: string }) => {
    if (!selected) return
    setBusy(true)
    try {
      await submitDocumentVerdict(selected.id, {
        verdict, comment,
        corrected_markdown: corrected?.markdown,
        corrected_title: corrected?.title,
      })
      setDocuments(prev => prev.map(d => d.id === selected.id ? {
        ...d,
        status: verdict === 'reject' ? 'sme_rejected' : 'sme_approved',
        title: corrected?.title ?? d.title,
      } : d))
      if (corrected) setMarkdown(corrected.markdown)
      setComment('')
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Verdict failed', 'error')
    } finally { setBusy(false) }
  }

  const publishOne = async () => {
    if (!selected) return
    setPublishing(true)
    try {
      const res = await publishDocuments([selected.id])
      setDocuments(prev => prev.map(d => d.id === selected.id ? { ...d, status: 'published' } : d))
      onToast(`Sent ${res.published} document to document storage`, 'success')
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Send to storage failed', 'error')
    } finally { setPublishing(false) }
  }

  const publishSelected = async () => {
    const ids = [...checked]
    if (!ids.length) return
    setPublishing(true)
    try {
      const res = await publishDocuments(ids)
      setDocuments(prev => prev.map(d => ids.includes(d.id) ? { ...d, status: 'published' } : d))
      onToast(`Sent ${res.published} document${res.published === 1 ? '' : 's'} to document storage`, 'success')
      setChecked(new Set())
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Send to storage failed', 'error')
    } finally { setPublishing(false) }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <UserCheck size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Review</h3>
        </div>
        <div className="flex items-center gap-3">
          {reviewableTotal > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted">Reviewed {reviewedCount}/{reviewableTotal}</span>
              <div className="w-24 h-1.5 rounded-full bg-card overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          {checked.size > 0 && (
            <button onClick={publishSelected} disabled={publishing}
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
        {/* Left — queue */}
        <div className="w-80 shrink-0 border-r border-border flex flex-col overflow-hidden">
          <div className="flex flex-wrap gap-1 p-2 border-b border-border">
            {FILTERS.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={clsx('flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                  filter === f.id ? 'bg-primary text-white' : 'bg-card text-muted hover:text-foreground')}>
                {f.label} <span className="opacity-70">{buckets[f.id].length}</span>
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {list.length === 0 && !loading && (
              <p className="text-xs text-muted text-center py-6 px-3">
                {documents.length === 0 ? 'No documents yet — generate some in the Generate tab.' : `No ${filter} documents.`}
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

        {/* Right — editor */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="h-full flex items-center justify-center"><p className="text-sm text-muted">Select a document to review.</p></div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-6">
              <DocumentViewer
                doc={selected} markdown={markdown} loading={loadingDoc} busy={busy || publishing}
                comment={comment} onCommentChange={setComment}
                onApprove={() => submitVerdict('approve')}
                onReject={() => submitVerdict('reject')}
                onSaveEdit={(md, title) => submitVerdict('edit', { markdown: md, title })}
                onPublish={publishOne}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
