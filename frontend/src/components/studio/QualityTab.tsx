import React, { useEffect, useMemo, useState } from 'react'
import { BarChart3, Copy, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { fetchRecords, fetchReports } from '../../api/client'
import type { StudioVersion, SyntheticRecordT, RecordReports, DistributionStats } from '../../types'

interface Props { version: StudioVersion | null }

function Gauge({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const pct = Math.round(value * 100)
  const tone = value >= 0.75 ? 'var(--success)' : value >= 0.5 ? 'var(--warning)' : 'var(--danger)'
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className="text-lg font-mono font-semibold" style={{ color: tone }}>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-card overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: tone }} />
      </div>
      {hint && <p className="text-[10px] text-muted/60 mt-1.5">{hint}</p>}
    </div>
  )
}

function BarChart({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...entries.map(e => e[1]))
  if (!entries.length) return null
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[10px] font-semibold text-muted/70 uppercase tracking-widest mb-2.5">{title}</p>
      <div className="space-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-muted w-28 truncate shrink-0" title={k}>{k}</span>
            <div className="flex-1 h-4 bg-card rounded overflow-hidden">
              <div className="h-full bg-primary/60 rounded" style={{ width: `${(v / max) * 100}%` }} />
            </div>
            <span className="text-[11px] font-mono text-foreground w-6 text-right shrink-0">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function QualityTab({ version }: Props) {
  const [records, setRecords] = useState<SyntheticRecordT[]>([])
  const [reports, setReports] = useState<Record<string, RecordReports>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!version) return
    setLoading(true)
    Promise.all([fetchRecords(version.id), fetchReports(version.id)])
      .then(([recs, reps]) => { setRecords(recs); setReports(reps) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [version])

  const recById = useMemo(() => Object.fromEntries(records.map(r => [r.id, r])), [records])
  const dist: DistributionStats | undefined = version?.stats?.distribution

  const duplicates = useMemo(
    () => Object.values(reports).filter(r => r.quality?.is_duplicate),
    [reports],
  )
  const lowRealism = useMemo(
    () => Object.values(reports).filter(r => r.quality && !r.quality.is_duplicate && r.quality.realism < 0.6),
    [reports],
  )
  const avgRealism = useMemo(() => {
    const vals = Object.values(reports).map(r => r.quality?.realism).filter((x): x is number => x !== undefined)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }, [reports])

  if (!version) return <div className="h-full flex items-center justify-center"><p className="text-sm text-muted">Generate a version to assess quality.</p></div>

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Quality — v{version.version_no}</h3>
          <span className="text-xs text-muted">realism · duplication · diversity · balance</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Gauge label="Diversity" value={dist?.diversity_score ?? 0} hint="normalised entropy over cells" />
          <Gauge label="Balance" value={dist?.balance_score ?? 0} hint="evenness across cells" />
          <Gauge label="Avg realism" value={avgRealism} hint="rule + LLM-as-judge" />
          <div className="rounded-xl border border-border bg-surface p-4 flex flex-col justify-center">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Duplicates</span>
              <span className="font-mono text-warning">{duplicates.length}</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-muted">Low realism</span>
              <span className="font-mono text-danger">{lowRealism.length}</span>
            </div>
          </div>
        </div>

        {dist && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <BarChart title="By label" data={dist.by_label} />
            <BarChart title="By element type" data={dist.by_element_type} />
            <BarChart title="By document type" data={dist.by_doc_type} />
            <BarChart title="By industry" data={dist.by_industry} />
          </div>
        )}

        {dist && (dist.under_represented.length > 0 || dist.over_represented.length > 0) && (
          <div className="rounded-xl border border-border bg-surface p-4 space-y-2">
            {dist.under_represented.length > 0 && (
              <div className="flex items-start gap-2">
                <AlertTriangle size={13} className="text-warning mt-0.5 shrink-0" />
                <div>
                  <span className="text-xs text-muted">Under-represented cells: </span>
                  {dist.under_represented.map(c => <span key={c} className="text-[11px] font-mono text-warning mr-1.5">{c}</span>)}
                </div>
              </div>
            )}
            {dist.over_represented.length > 0 && (
              <div className="flex items-start gap-2">
                <AlertTriangle size={13} className="text-primary mt-0.5 shrink-0" />
                <div>
                  <span className="text-xs text-muted">Over-represented cells: </span>
                  {dist.over_represented.map(c => <span key={c} className="text-[11px] font-mono text-primary mr-1.5">{c}</span>)}
                </div>
              </div>
            )}
          </div>
        )}

        {duplicates.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[10px] font-semibold text-muted/70 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Copy size={11} /> Duplicate clusters</p>
            <div className="space-y-1">
              {duplicates.map(d => (
                <div key={d.quality!.record_id} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-warning">{d.quality!.near_dup_score.toFixed(2)}</span>
                  <span className="text-foreground truncate flex-1">{recById[d.quality!.record_id]?.text ?? d.quality!.record_id}</span>
                  <span className="text-muted font-mono">↔ {d.quality!.duplicate_of?.slice(0, 14)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading && <p className="text-xs text-muted text-center py-2">Loading…</p>}
      </div>
    </div>
  )
}
