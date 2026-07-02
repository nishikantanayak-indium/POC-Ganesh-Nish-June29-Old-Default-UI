import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { UserCheck, Check, X, Pencil, RotateCcw, Lock, Star } from 'lucide-react'
import clsx from 'clsx'
import { fetchSmeQueue, submitSmeVerdict, fetchSmeSummary } from '../../api/client'
import type { StudioMeta, StudioVersion, SyntheticRecordT, RecordReports, SMESummary } from '../../types'

interface Props {
  meta: StudioMeta | null
  version: StudioVersion | null
  onToast: (msg: string, type: 'success' | 'error') => void
}

type Filter = 'unreviewed' | 'approved' | 'rejected' | 'all'

const REVIEWABLE = ['staged', 'sme_approved', 'sme_rejected']

interface VerdictBody { record_id: string; verdict: string; corrected_label?: string; corrected_text?: string; comment: string }

function ReviewCard({ rec, report, labels, inSample, readOnly, onSubmit }: {
  rec: SyntheticRecordT
  report?: RecordReports
  labels: string[]
  inSample: boolean
  readOnly: boolean
  onSubmit: (body: VerdictBody) => Promise<void>
}) {
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
    } finally { setBusy(false) }
  }

  const q = report?.quality
  const reviewed = rec.status === 'sme_approved' || rec.status === 'sme_rejected'
  const statusTone = rec.status === 'sme_rejected'
    ? 'text-danger bg-danger/10 border-danger/30'
    : rec.status === 'sme_approved' ? 'text-success bg-success/10 border-success/30'
    : 'text-warning bg-warning/10 border-warning/30'

  return (
    <div className={clsx('rounded-xl border bg-surface p-4 space-y-3',
      rec.status === 'sme_rejected' ? 'border-danger/20' : rec.status === 'sme_approved' ? 'border-success/20' : 'border-border')}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">{rec.element_type}</span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-card border border-border text-muted">{rec.label}</span>
        {inSample && <span title="in representative sample" className="text-[10px] text-primary flex items-center gap-0.5"><Star size={10} /></span>}
        <span className="text-[10px] font-mono text-muted">· {rec.industry} · {rec.doc_type}</span>
        <span className={clsx('text-[10px] font-mono px-1.5 py-0.5 rounded border', statusTone)}>{rec.status}</span>
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

      {readOnly || reviewed ? (
        <p className="text-[11px] text-muted flex items-center gap-1.5">
          {readOnly && <Lock size={11} />}
          {readOnly ? 'Read-only — version promoted to main.' : `Reviewed — ${rec.status.replace('sme_', '')}.`}
        </p>
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
  )
}

export default function SMEReviewTab({ meta, version, onToast }: Props) {
  const [records, setRecords] = useState<SyntheticRecordT[]>([])
  const [reports, setReports] = useState<Record<string, RecordReports>>({})
  const [sampleIds, setSampleIds] = useState<Set<string>>(new Set())
  const [summary, setSummary] = useState<SMESummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('unreviewed')
  const [sampleOnly, setSampleOnly] = useState(false)

  const load = useCallback(async () => {
    if (!version) return
    setLoading(true)
    try {
      const q = await fetchSmeQueue(version.id)
      setRecords(q.records); setReports(q.reports)
      setSampleIds(new Set(q.sample_ids)); setSummary(q.summary)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [version])

  useEffect(() => { load() }, [load])

  const handleVerdict = async (body: VerdictBody) => {
    if (!version) return
    try {
      await submitSmeVerdict(version.id, body)
      // Keep the record visible — just move it to its reviewed bucket.
      setRecords(prev => prev.map(r => r.id === body.record_id ? {
        ...r,
        status: body.verdict === 'reject' ? 'sme_rejected' : 'sme_approved',
        text: body.corrected_text ?? r.text,
        label: body.corrected_label ?? r.label,
      } : r))
      setSummary(await fetchSmeSummary(version.id))
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Verdict failed', 'error')
      throw err
    }
  }

  const buckets = useMemo(() => {
    const reviewable = records.filter(r => REVIEWABLE.includes(r.status))
    return {
      unreviewed: reviewable.filter(r => r.status === 'staged'),
      approved: reviewable.filter(r => r.status === 'sme_approved'),
      rejected: reviewable.filter(r => r.status === 'sme_rejected'),
      all: reviewable,
    }
  }, [records])

  if (!version) return <div className="h-full flex items-center justify-center"><p className="text-sm text-muted">Generate a version to review.</p></div>

  const frozen = version.status === 'main'
  const pct = summary && summary.reviewable ? Math.round((summary.reviewed / summary.reviewable) * 100) : 0

  let list = buckets[filter]
  if (sampleOnly) list = list.filter(r => sampleIds.has(r.id))

  const TABS: { id: Filter; label: string; n: number }[] = [
    { id: 'unreviewed', label: 'Unreviewed', n: buckets.unreviewed.length },
    { id: 'approved',   label: 'Approved',   n: buckets.approved.length },
    { id: 'rejected',   label: 'Rejected',   n: buckets.rejected.length },
    { id: 'all',        label: 'All',        n: buckets.all.length },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCheck size={16} className="text-primary" />
            <h3 className="text-sm font-semibold text-foreground">SME Review — v{version.version_no}</h3>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-border text-muted hover:text-foreground">
            <RotateCcw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {frozen && (
          <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-3 flex items-center gap-2.5">
            <Lock size={15} className="text-primary shrink-0" />
            <p className="text-xs text-foreground">
              This version is <span className="font-semibold">promoted to main and immutable</span>. Reviews are read-only —
              use <span className="font-medium">Clone to edit</span> in the Datasets tab to make changes.
            </p>
          </div>
        )}

        {summary && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-muted">Reviewed {summary.reviewed}/{summary.reviewable}</span>
              <span className="text-muted">Approval rate <span className="text-success font-mono">{Math.round(summary.approval_rate * 100)}%</span></span>
            </div>
            <div className="h-2 rounded-full bg-card overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            {summary.complete && <p className="text-[11px] text-success mt-2">✓ All reviewable records have a verdict — you can promote this version in Datasets.</p>}
          </div>
        )}

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setFilter(t.id)}
                className={clsx('px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5',
                  filter === t.id ? 'bg-primary text-white' : 'bg-card text-muted hover:text-foreground')}>
                {t.label}
                <span className={clsx('px-1.5 rounded-full text-[10px] font-mono',
                  filter === t.id ? 'bg-white/20' : 'bg-border/50')}>{t.n}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
            <input type="checkbox" checked={sampleOnly} onChange={e => setSampleOnly(e.target.checked)} className="accent-[var(--primary)]" />
            <Star size={11} className="text-primary" /> Representative sample only
          </label>
        </div>

        <div className="space-y-2">
          {list.length === 0 && !loading && (
            <p className="text-sm text-muted text-center py-6">
              {filter === 'unreviewed' ? 'No unreviewed records — all caught up.' : `No ${filter} records.`}
            </p>
          )}
          {list.map(rec => (
            <ReviewCard key={rec.id} rec={rec} report={reports[rec.id]} labels={meta?.labels ?? []}
              inSample={sampleIds.has(rec.id)} readOnly={frozen} onSubmit={handleVerdict} />
          ))}
        </div>
      </div>
    </div>
  )
}
