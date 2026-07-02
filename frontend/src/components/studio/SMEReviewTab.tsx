import React, { useCallback, useEffect, useState } from 'react'
import { UserCheck, Check, X, Pencil, RotateCcw } from 'lucide-react'
import clsx from 'clsx'
import { fetchSmeSample, submitSmeVerdict, fetchSmeSummary } from '../../api/client'
import type { StudioMeta, StudioVersion, SyntheticRecordT, RecordReports, SMESummary } from '../../types'

interface Props {
  meta: StudioMeta | null
  version: StudioVersion | null
  onToast: (msg: string, type: 'success' | 'error') => void
}

function ReviewCard({ rec, report, labels, onSubmit }: {
  rec: SyntheticRecordT
  report?: RecordReports
  labels: string[]
  onSubmit: (body: { record_id: string; verdict: string; corrected_label?: string; corrected_text?: string; comment: string }) => Promise<void>
}) {
  const [verdict, setVerdict] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(rec.text)
  const [label, setLabel] = useState(rec.label)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (v: string) => {
    setBusy(true)
    try {
      await onSubmit({
        record_id: rec.id, verdict: v, comment,
        corrected_text: v === 'edit' ? text : undefined,
        corrected_label: v === 'edit' ? label : undefined,
      })
      setVerdict(v)
    } finally { setBusy(false) }
  }

  const q = report?.quality
  if (verdict) {
    return (
      <div className={clsx('rounded-xl border px-4 py-2.5 flex items-center gap-3',
        verdict === 'reject' ? 'border-danger/30 bg-danger/[0.04]' : 'border-success/30 bg-success/[0.04]')}>
        <span className={clsx('text-[10px] font-mono px-1.5 py-0.5 rounded', verdict === 'reject' ? 'text-danger bg-danger/10' : 'text-success bg-success/10')}>
          {verdict === 'edit' ? 'edited & approved' : verdict === 'reject' ? 'rejected' : 'approved'}
        </span>
        <span className="text-xs text-muted truncate flex-1">{rec.text}</span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">{rec.element_type}</span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-card border border-border text-muted">{rec.label}</span>
        <span className="text-[10px] font-mono text-muted">· {rec.industry} · {rec.doc_type}</span>
        <div className="ml-auto flex items-center gap-2 text-[10px] font-mono">
          {q && <span className="text-muted">realism <span className={q.realism >= 0.75 ? 'text-success' : 'text-warning'}>{q.realism.toFixed(2)}</span></span>}
          {q?.is_duplicate && <span className="text-warning">dup</span>}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary resize-none" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Label</span>
            <select value={label} onChange={e => setLabel(e.target.value)}
              className="bg-card border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary">
              {labels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
      ) : (
        <p className="text-sm text-foreground leading-relaxed">{rec.text}</p>
      )}
      {rec.rationale && !editing && <p className="text-[11px] text-muted italic">Rationale: {rec.rationale}</p>}

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
    </div>
  )
}

export default function SMEReviewTab({ meta, version, onToast }: Props) {
  const [sample, setSample] = useState<SyntheticRecordT[]>([])
  const [reports, setReports] = useState<Record<string, RecordReports>>({})
  const [summary, setSummary] = useState<SMESummary | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!version) return
    setLoading(true)
    try {
      const [s, sum] = await Promise.all([fetchSmeSample(version.id), fetchSmeSummary(version.id)])
      setSample(s.sample); setReports(s.reports); setSummary(sum)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [version])

  useEffect(() => { load() }, [load])

  const handleVerdict = async (body: { record_id: string; verdict: string; corrected_label?: string; corrected_text?: string; comment: string }) => {
    if (!version) return
    try {
      await submitSmeVerdict(version.id, body)
      setSummary(await fetchSmeSummary(version.id))
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Verdict failed', 'error')
      throw err
    }
  }

  if (!version) return <div className="h-full flex items-center justify-center"><p className="text-sm text-muted">Generate a version to review.</p></div>

  const pct = summary && summary.reviewable ? Math.round((summary.reviewed / summary.reviewable) * 100) : 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCheck size={16} className="text-primary" />
            <h3 className="text-sm font-semibold text-foreground">SME Review — v{version.version_no}</h3>
            <span className="text-xs text-muted">representative sample</span>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-border text-muted hover:text-foreground">
            <RotateCcw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {summary && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-muted">Reviewed {summary.reviewed}/{summary.reviewable}</span>
              <span className="text-muted">Approval rate <span className="text-success font-mono">{Math.round(summary.approval_rate * 100)}%</span></span>
            </div>
            <div className="h-2 rounded-full bg-card overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            {summary.complete && <p className="text-[11px] text-success mt-2">✓ Sample fully reviewed — you can promote this version in Datasets.</p>}
          </div>
        )}

        <div className="space-y-2">
          {sample.length === 0 && !loading && <p className="text-sm text-muted text-center py-6">No staged records to review in this version.</p>}
          {sample.map(rec => (
            <ReviewCard key={rec.id} rec={rec} report={reports[rec.id]} labels={meta?.labels ?? []} onSubmit={handleVerdict} />
          ))}
        </div>
      </div>
    </div>
  )
}
