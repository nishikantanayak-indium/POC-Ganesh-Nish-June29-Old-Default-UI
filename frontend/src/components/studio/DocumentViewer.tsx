import { useEffect, useState, type ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import { Check, X, Pencil, Send, Download } from 'lucide-react'
import clsx from 'clsx'
import { exportUrls } from '../../api/client'
import type { SyntheticDocumentT } from '../../types'

// One reusable document reader/editor — powers both the Review tab
// (approve/reject/edit) and the Document Library tab (read-only + publish).
// No version/Git language anywhere; documents move through a plain
// Draft → In Review → Approved/Rejected → Published lifecycle.

export const STATUS_LABEL: Record<string, string> = {
  staged: 'Pending review',
  sme_approved: 'Approved',
  sme_rejected: 'Rejected',
  published: 'Published',
  candidate: 'Draft',
}

export function statusTone(status: string): string {
  if (status === 'sme_rejected') return 'text-danger bg-danger/10 border-danger/30'
  if (status === 'sme_approved') return 'text-success bg-success/10 border-success/30'
  if (status === 'published') return 'text-primary bg-primary/10 border-primary/30'
  return 'text-warning bg-warning/10 border-warning/30'
}

const mdComponents = {
  h1: (p: ComponentProps<'h1'>) => <h1 className="text-xl font-bold text-foreground mt-4 mb-2 first:mt-0" {...p} />,
  h2: (p: ComponentProps<'h2'>) => <h2 className="text-lg font-semibold text-foreground mt-5 mb-2 first:mt-0" {...p} />,
  h3: (p: ComponentProps<'h3'>) => <h3 className="text-base font-semibold text-foreground mt-4 mb-1.5" {...p} />,
  p: (p: ComponentProps<'p'>) => <p className="text-sm text-foreground/90 leading-relaxed mb-3" {...p} />,
  ul: (p: ComponentProps<'ul'>) => <ul className="list-disc pl-5 space-y-1 mb-3 text-sm text-foreground/90" {...p} />,
  ol: (p: ComponentProps<'ol'>) => <ol className="list-decimal pl-5 space-y-1 mb-3 text-sm text-foreground/90" {...p} />,
  li: (p: ComponentProps<'li'>) => <li className="leading-relaxed" {...p} />,
  strong: (p: ComponentProps<'strong'>) => <strong className="font-semibold text-foreground" {...p} />,
  blockquote: (p: ComponentProps<'blockquote'>) => (
    <blockquote className="border-l-2 border-primary/40 pl-3 italic text-muted my-3" {...p} />
  ),
}

interface Props {
  doc: SyntheticDocumentT
  markdown: string
  loading: boolean
  mode: 'review' | 'library'
  busy: boolean
  onApprove?: () => void
  onReject?: () => void
  onSaveEdit?: (markdown: string, title: string) => void
  onPublish?: () => void
  comment: string
  onCommentChange: (v: string) => void
}

export default function DocumentViewer({
  doc, markdown, loading, mode, busy, onApprove, onReject, onSaveEdit, onPublish, comment, onCommentChange,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draftMarkdown, setDraftMarkdown] = useState(markdown)
  const [draftTitle, setDraftTitle] = useState(doc.title)

  useEffect(() => {
    setEditing(false)
    setDraftMarkdown(markdown)
    setDraftTitle(doc.title)
  }, [doc.id, markdown]) // eslint-disable-line react-hooks/exhaustive-deps

  const industry = typeof doc.provenance?.industry === 'string' ? doc.provenance.industry : null
  const language = typeof doc.provenance?.language === 'string' ? doc.provenance.language : null

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {editing ? (
            <input value={draftTitle} onChange={e => setDraftTitle(e.target.value)}
              className="text-lg font-semibold text-foreground bg-card border border-border rounded-lg px-2 py-1 w-full focus:outline-none focus:border-primary" />
          ) : (
            <h2 className="text-lg font-semibold text-foreground truncate">{doc.title}</h2>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">{doc.doc_type}</span>
            {industry && <span className="text-[11px] text-muted">· {industry}</span>}
            {language && <span className="text-[11px] text-muted">· {language}</span>}
            <span className={clsx('text-[11px] font-mono px-1.5 py-0.5 rounded border', statusTone(doc.status))}>
              {STATUS_LABEL[doc.status] ?? doc.status}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <a href={exportUrls.docMd(doc.version_id ?? '', doc.id)} download
            title="Download as Markdown"
            className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-card border border-border">
            <Download size={13} />
          </a>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : editing ? (
        <textarea value={draftMarkdown} onChange={e => setDraftMarkdown(e.target.value)} rows={22}
          className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono leading-relaxed focus:outline-none focus:border-primary resize-y" />
      ) : (
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <ReactMarkdown components={mdComponents}>{markdown}</ReactMarkdown>
        </div>
      )}

      {mode === 'review' && (
        <>
          <input value={comment} onChange={e => onCommentChange(e.target.value)} placeholder="Optional feedback comment…"
            className="w-full bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder-muted/50 focus:outline-none focus:border-primary" />
          <div className="flex items-center gap-2">
            <button onClick={onApprove} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-success/15 text-success border border-success/30 hover:bg-success/25 disabled:opacity-50">
              <Check size={12} /> Approve
            </button>
            <button onClick={onReject} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 disabled:opacity-50">
              <X size={12} /> Reject
            </button>
            {editing ? (
              <button onClick={() => onSaveEdit?.(draftMarkdown, draftTitle)} disabled={busy}
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

      {mode === 'library' && (
        <div className="flex items-center gap-2">
          {doc.status === 'sme_approved' && onPublish && (
            <button onClick={onPublish} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50">
              <Send size={12} /> Send to Document Storage
            </button>
          )}
          {doc.status === 'published' && (
            <span className="text-xs text-primary flex items-center gap-1.5"><Check size={13} /> Sent to document storage</span>
          )}
        </div>
      )}
    </div>
  )
}
