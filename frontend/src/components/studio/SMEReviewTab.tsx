import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { UserCheck, Check, X, Pencil, RotateCcw, Lock, FileText } from 'lucide-react'
import clsx from 'clsx'
import {
  fetchSmeDocumentQueue, submitSmeDocumentVerdict, fetchSmeDocumentSummary, fetchDocumentMarkdown,
} from '../../api/client'
import type { StudioVersion, SyntheticDocumentT, DocSMESummary } from '../../types'

// Document-study dashboard — the document-first counterpart to the old
// per-record ReviewCard list. Every staged document goes up for review (no
// sub-sampling — run sizes here are whole documents, not hundreds of atomic
// records), studied full-screen with an edit-in-place markdown area.

interface Props {
  version: StudioVersion | null
  onToast: (msg: string, type: 'success' | 'error') => void
}

type Filter = 'unreviewed' | 'approved' | 'rejected' | 'all'
const REVIEWABLE = ['staged', 'sme_approved', 'sme_rejected']

interface DocVerdictBody {
  document_id: string; verdict: string; corrected_markdown?: string; corrected_title?: string; comment: string
}

export default function SMEReviewTab({ version, onToast }: Props) {
  const [documents, setDocuments] = useState<SyntheticDocumentT[]>([])
  const [summary, setSummary] = useState<DocSMESummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('unreviewed')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // study pane
  const [markdown, setMarkdown] = useState('')
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftMarkdown, setDraftMarkdown] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!version) return
    setLoading(true)
    try {
      const q = await fetchSmeDocumentQueue(version.id)
      setDocuments(q.documents); setSummary(q.summary)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [version])

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
    if (!selected || !version) { setMarkdown(''); return }
    setLoadingDoc(true)
    setEditing(false); setComment('')
    fetchDocumentMarkdown(version.id, selected.id)
      .then(md => { setMarkdown(md); setDraftMarkdown(md); setDraftTitle(selected.title) })
      .catch(() => setMarkdown('_Could not load document content._'))
      .finally(() => setLoadingDoc(false))
  }, [selected?.id, version?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!version) return <div className="h-full flex items-center justify-center"><p className="text-sm text-muted">Generate a version to review.</p></div>

  const frozen = version.status === 'main'
  const pct = summary && summary.reviewable ? Math.round((summary.reviewed / summary.reviewable) * 100) : 0

  const submit = async (verdict: string) => {
    if (!selected) return
    setBusy(true)
    const body: DocVerdictBody = {
      document_id: selected.id, verdict, comment,
      corrected_markdown: verdict === 'edit' ? draftMarkdown : undefined,
      corrected_title: verdict === 'edit' ? draftTitle : undefined,
    }
    try {
      await submitSmeDocumentVerdict(version.id, body)
      setDocuments(prev => prev.map(d => d.id === selected.id ? {
        ...d,
        status: verdict === 'reject' ? 'sme_rejected' : 'sme_approved',
        title: body.corrected_title ?? d.title,
      } : d))
      if (verdict === 'edit') setMarkdown(draftMarkdown)
      setEditing(false); setComment('')
      setSummary(await fetchSmeDocumentSummary(version.id))
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

  const statusTone = (status: string) => status === 'sme_rejected'
    ? 'text-danger bg-danger/10 border-danger/30'
    : status === 'sme_approved' ? 'text-success bg-success/10 border-success/30'
    : 'text-warning bg-warning/10 border-warning/30'

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <UserCheck size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Document Review — v{version.version_no}</h3>
        </div>
        <div className="flex items-center gap-4">
          {summary && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted">Reviewed {summary.reviewed}/{summary.reviewable}</span>
              <div className="w-24 h-1.5 rounded-full bg-card overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-success font-mono">{Math.round(summary.approval_rate * 100)}%</span>
            </div>
          )}
          <button onClick={load} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-border text-muted hover:text-foreground">
            <RotateCcw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {frozen && (
        <div className="mx-6 mt-3 rounded-xl border border-primary/30 bg-primary/[0.05] p-3 flex items-center gap-2.5 shrink-0">
          <Lock size={15} className="text-primary shrink-0" />
          <p className="text-xs text-foreground">
            This version is <span className="font-semibold">promoted to main and immutable</span>. Reviews are read-only —
            use <span className="font-medium">Clone to edit</span> in the Datasets tab to make changes.
          </p>
        </div>
      )}

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
                  <span className={clsx('text-[10px] font-mono px-1.5 py-0.5 rounded border', statusTone(doc.status))}>{doc.status.replace('sme_', '')}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right — study area */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="h-full flex items-center justify-center"><p className="text-sm text-muted">Select a document to study.</p></div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  {editing ? (
                    <input value={draftTitle} onChange={e => setDraftTitle(e.target.value)}
                      className="text-lg font-semibold text-foreground bg-card border border-border rounded-lg px-2 py-1 w-full focus:outline-none focus:border-primary" />
                  ) : (
                    <h2 className="text-lg font-semibold text-foreground">{selected.title}</h2>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">{selected.doc_type}</span>
                    {typeof selected.provenance?.industry === 'string' && (
                      <span className="text-[11px] text-muted">· {String(selected.provenance.industry)}</span>
                    )}
                    {typeof selected.provenance?.language === 'string' && (
                      <span className="text-[11px] text-muted">· {String(selected.provenance.language)}</span>
                    )}
                    <span className={clsx('text-[11px] font-mono px-1.5 py-0.5 rounded border', statusTone(selected.status))}>{selected.status.replace('sme_', '')}</span>
                  </div>
                </div>
              </div>

              {/* study / edit area */}
              {loadingDoc ? (
                <p className="text-sm text-muted">Loading…</p>
              ) : editing ? (
                <textarea value={draftMarkdown} onChange={e => setDraftMarkdown(e.target.value)} rows={22}
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono leading-relaxed focus:outline-none focus:border-primary resize-y" />
              ) : (
                <div className="rounded-xl border border-border bg-card px-4 py-3">
                  <pre className="text-sm text-foreground leading-relaxed whitespace-pre-wrap font-sans">{markdown}</pre>
                </div>
              )}

              {frozen ? (
                <p className="text-[11px] text-muted flex items-center gap-1.5"><Lock size={11} /> Read-only — version promoted to main.</p>
              ) : (
                <>
                  <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Optional feedback comment…"
                    className="w-full bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder-muted/50 focus:outline-none focus:border-primary" />
                  <div className="flex items-center gap-2">
                    <button onClick={() => submit('approve')} disabled={busy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-success/15 text-success border border-success/30 hover:bg-success/25 disabled:opacity-50">
                      <Check size={12} /> Approve
                    </button>
                    <button onClick={() => submit('reject')} disabled={busy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 disabled:opacity-50">
                      <X size={12} /> Reject
                    </button>
                    {editing ? (
                      <button onClick={() => submit('edit')} disabled={busy}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50">
                        <Check size={12} /> Save & approve
                      </button>
                    ) : (
                      <button onClick={() => setEditing(true)} disabled={busy}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-card text-muted border border-border hover:text-foreground">
                        <Pencil size={12} /> Edit
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
