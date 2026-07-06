import { useCallback, useEffect, useMemo, useState } from 'react'
import { UserCheck, RotateCcw, FileText } from 'lucide-react'
import clsx from 'clsx'
import { fetchProjectDocuments, submitDocumentVerdict, fetchDocumentMarkdown } from '../../api/client'
import type { SyntheticDocumentT } from '../../types'
import DocumentViewer, { STATUS_LABEL, statusTone } from './DocumentViewer'

// Project-wide document review — no version/staging language anywhere. Every
// document generated for this project shows up here regardless of which
// generation run produced it; the reviewer studies and approves/rejects each
// one with a real editor (DocumentViewer), not a chat-style record list.

interface Props {
  projectId: string
  onToast: (msg: string, type: 'success' | 'error') => void
}

type Filter = 'unreviewed' | 'approved' | 'rejected' | 'all'
const REVIEWABLE = ['staged', 'sme_approved', 'sme_rejected']

export default function ReviewTab({ projectId, onToast }: Props) {
  const [documents, setDocuments] = useState<SyntheticDocumentT[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('unreviewed')
  const [selectedId, setSelectedId] = useState<string | null>(null)

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

  const buckets = useMemo(() => {
    const reviewable = documents.filter(d => REVIEWABLE.includes(d.status))
    return {
      unreviewed: reviewable.filter(d => d.status === 'staged'),
      approved: reviewable.filter(d => d.status === 'sme_approved'),
      rejected: reviewable.filter(d => d.status === 'sme_rejected'),
      all: reviewable,
    }
  }, [documents])

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

  const total = buckets.unreviewed.length + buckets.approved.length + buckets.rejected.length
  const reviewedCount = buckets.approved.length + buckets.rejected.length
  const pct = total ? Math.round((reviewedCount / total) * 100) : 0

  const submit = async (verdict: string, corrected?: { markdown: string; title: string }) => {
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

  const TABS: { id: Filter; label: string; n: number }[] = [
    { id: 'unreviewed', label: 'Unreviewed', n: buckets.unreviewed.length },
    { id: 'approved',   label: 'Approved',   n: buckets.approved.length },
    { id: 'rejected',   label: 'Rejected',   n: buckets.rejected.length },
    { id: 'all',        label: 'All',        n: buckets.all.length },
  ]

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <UserCheck size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Review</h3>
        </div>
        <div className="flex items-center gap-4">
          {total > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted">Reviewed {reviewedCount}/{total}</span>
              <div className="w-24 h-1.5 rounded-full bg-card overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          <button onClick={load} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-border text-muted hover:text-foreground">
            <RotateCcw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left — queue */}
        <div className="w-72 shrink-0 border-r border-border flex flex-col overflow-hidden">
          <div className="flex flex-col gap-1 p-2 border-b border-border">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setFilter(t.id)}
                className={clsx('flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  filter === t.id ? 'bg-primary text-white' : 'text-muted hover:bg-card hover:text-foreground')}>
                {t.label}
                <span className={clsx('px-1.5 rounded-full text-[10px] font-mono', filter === t.id ? 'bg-white/20' : 'bg-border/50')}>{t.n}</span>
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {list.length === 0 && !loading && (
              <p className="text-xs text-muted text-center py-6 px-3">
                {filter === 'unreviewed' ? 'No unreviewed documents — all caught up.' : `No ${filter} documents.`}
              </p>
            )}
            {list.map(doc => (
              <button key={doc.id} onClick={() => setSelectedId(doc.id)}
                className={clsx('w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors',
                  selected?.id === doc.id ? 'bg-card' : 'hover:bg-card/50')}>
                <div className="flex items-center gap-1.5 mb-1">
                  <FileText size={11} className="text-muted shrink-0" />
                  <span className="text-xs font-medium text-foreground truncate flex-1">{doc.title}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">{doc.doc_type}</span>
                  <span className={clsx('text-[10px] font-mono px-1.5 py-0.5 rounded border', statusTone(doc.status))}>{STATUS_LABEL[doc.status] ?? doc.status}</span>
                </div>
              </button>
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
                doc={selected} markdown={markdown} loading={loadingDoc} mode="review" busy={busy}
                comment={comment} onCommentChange={setComment}
                onApprove={() => submit('approve')}
                onReject={() => submit('reject')}
                onSaveEdit={(md, title) => submit('edit', { markdown: md, title })}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
