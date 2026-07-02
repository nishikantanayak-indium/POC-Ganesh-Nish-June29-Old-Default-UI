import React, { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ShieldCheck, Code2 } from 'lucide-react'
import clsx from 'clsx'
import { fetchRecords, fetchReports } from '../../api/client'
import type { StudioMeta, StudioVersion, SyntheticRecordT, RecordReports } from '../../types'

interface Props { meta: StudioMeta | null; version: StudioVersion | null }

const STATUS_TONE: Record<string, string> = {
  staged: 'text-success bg-success/10 border-success/30',
  sme_approved: 'text-success bg-success/10 border-success/30',
  published: 'text-primary bg-primary/10 border-primary/30',
  rejected: 'text-danger bg-danger/10 border-danger/30',
  duplicate: 'text-warning bg-warning/10 border-warning/30',
  sme_rejected: 'text-danger bg-danger/10 border-danger/30',
  candidate: 'text-muted bg-card border-border',
}

function Flag({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <span className={clsx('text-[10px] font-mono px-1.5 py-0.5 rounded border',
      ok === undefined ? 'text-muted/50 border-border' :
      ok ? 'text-success border-success/30 bg-success/10' : 'text-danger border-danger/30 bg-danger/10')}>
      {label}{ok === undefined ? '' : ok ? ' ✓' : ' ✗'}
    </span>
  )
}

export default function ValidateTab({ meta, version }: Props) {
  const [records, setRecords] = useState<SyntheticRecordT[]>([])
  const [reports, setReports] = useState<Record<string, RecordReports>>({})
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showSchema, setShowSchema] = useState(false)

  useEffect(() => {
    if (!version) return
    setLoading(true)
    Promise.all([fetchRecords(version.id), fetchReports(version.id)])
      .then(([recs, reps]) => { setRecords(recs); setReports(reps) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [version])

  const filtered = useMemo(
    () => statusFilter === 'all' ? records : records.filter(r => r.status === statusFilter),
    [records, statusFilter],
  )
  const statuses = useMemo(() => Array.from(new Set(records.map(r => r.status))), [records])

  if (!version) return <Empty msg="Generate a version to validate records." />

  const counts = {
    passed: records.filter(r => reports[r.id]?.validation?.reasons?.length === 0 && reports[r.id]?.validation).length,
    failed: records.filter(r => (reports[r.id]?.validation?.reasons?.length ?? 0) > 0).length,
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Validation — v{version.version_no}</h3>
            <span className="text-xs text-muted">schema · label · business rules</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-success">{counts.passed} passed</span>
            <span className="text-xs text-danger">{counts.failed} failed</span>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="bg-card border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary">
              <option value="all">all statuses</option>
              {statuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => setShowSchema(v => !v)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-border text-muted hover:text-foreground">
              <Code2 size={12} /> Schema
            </button>
          </div>
        </div>

        {showSchema && (
          <pre className="rounded-lg bg-[#0d1117] border border-white/[0.06] p-3 text-[11px] text-slate-300 overflow-x-auto max-h-64">
            {JSON.stringify(meta?.record_schema ?? {}, null, 2)}
          </pre>
        )}

        {loading ? <Empty msg="Loading records…" /> : filtered.length === 0 ? <Empty msg="No records for this filter." /> : (
          <div className="space-y-1.5">
            {filtered.map(r => {
              const rep = reports[r.id]?.validation
              const isOpen = expanded === r.id
              return (
                <div key={r.id} className="rounded-xl border border-border bg-surface overflow-hidden">
                  <button onClick={() => setExpanded(isOpen ? null : r.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-card/50">
                    {isOpen ? <ChevronDown size={14} className="text-muted shrink-0" /> : <ChevronRight size={14} className="text-muted shrink-0" />}
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">{r.element_type}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-card border border-border text-muted shrink-0">{r.label}</span>
                    <span className="text-xs text-foreground truncate flex-1">{r.text}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Flag ok={rep?.schema_ok} label="S" />
                      <Flag ok={rep?.label_ok} label="L" />
                      <Flag ok={rep?.rules_ok} label="R" />
                    </div>
                    <span className={clsx('text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0', STATUS_TONE[r.status] ?? STATUS_TONE.candidate)}>{r.status}</span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-3 pt-1 border-t border-border/50 space-y-2">
                      <p className="text-xs text-foreground leading-relaxed">{r.text}</p>
                      {r.rationale && <p className="text-[11px] text-muted italic">Rationale: {r.rationale}</p>}
                      <div className="flex flex-wrap gap-2 text-[11px] text-muted">
                        <span>industry: <span className="text-foreground">{r.industry}</span></span>
                        <span>· doc: <span className="text-foreground">{r.doc_type}</span></span>
                        <span>· lang: <span className="text-foreground">{r.language}</span></span>
                        {r.risk_category && <span>· risk_cat: <span className="text-foreground">{r.risk_category}</span></span>}
                      </div>
                      {Object.keys(r.attributes || {}).length > 0 && (
                        <pre className="text-[11px] text-slate-400 bg-card rounded p-2 overflow-x-auto">{JSON.stringify(r.attributes, null, 2)}</pre>
                      )}
                      {rep && rep.reasons.length > 0 && (
                        <div className="rounded-lg border border-danger/30 bg-danger/[0.05] p-2 space-y-0.5">
                          {rep.reasons.map((why, i) => <p key={i} className="text-[11px] text-danger font-mono">• {why}</p>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div className="h-full flex items-center justify-center"><p className="text-sm text-muted">{msg}</p></div>
}
