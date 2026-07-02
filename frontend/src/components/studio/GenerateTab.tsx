import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Upload, FileText, X, Play, Sparkles, Wand2, CheckCircle2, AlertTriangle, UserCheck, RotateCcw,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'

import { uploadSeeds, streamGenerate } from '../../api/client'
import type { StudioMeta, StudioOverview, MatrixCellInfo, GenEvent, GenSelection, GenKnobs } from '../../types'

const STAGES = ['generate', 'validate', 'quality', 'relate', 'assemble', 'persist'] as const

interface Props {
  projectId: string
  meta: StudioMeta | null
  overview: StudioOverview | null
  onReloadOverview: () => Promise<void>
  onGenerationComplete: (versionId: string) => void
  onToast: (msg: string, type: 'success' | 'error') => void
}

function cellColor(c: MatrixCellInfo, threshold: number): string {
  if (c.deficit === 0) return 'rgba(16,185,129,0.16)'          // success tint
  const ratio = Math.min(1, c.total / threshold)
  // amber → red as it gets emptier
  return `rgba(${Math.round(239 - ratio * 60)},${Math.round(120 + ratio * 60)},60,${0.14 + (1 - ratio) * 0.12})`
}

export default function GenerateTab({
  projectId, meta, overview, onReloadOverview, onGenerationComplete, onToast,
}: Props) {
  const navigate = useNavigate()
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const [selection, setSelection] = useState<Record<string, number>>({})
  const [genRelationships, setGenRelationships] = useState(true)
  const [assembleDocs, setAssembleDocs] = useState(true)
  const [brief, setBrief] = useState('')
  const [mode, setMode] = useState<'matrix' | 'mirror'>('matrix')
  const [mirrorId, setMirrorId] = useState('')

  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState<GenEvent[]>([])
  const [stage, setStage] = useState<string>('')
  const [summary, setSummary] = useState<(GenEvent['summary']) | null>(null)
  const abortRef = useRef<(() => void) | null>(null)

  const threshold = overview?.min_threshold ?? meta?.min_threshold ?? 5
  const cellByKey = useMemo(() => {
    const m: Record<string, MatrixCellInfo> = {}
    overview?.cells.forEach(c => { m[c.cell] = c })
    return m
  }, [overview])

  // ── seed upload ───────────────────────────────────────────────────────────
  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return
    const valid = Array.from(list).filter(f => /\.(pdf|docx|doc)$/i.test(f.name))
    setPendingFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...valid.filter(f => !names.has(f.name))]
    })
  }, [])

  const analyzeSeeds = async () => {
    if (!pendingFiles.length) return
    setAnalyzing(true)
    try {
      await uploadSeeds(projectId, pendingFiles)
      await onReloadOverview()
      setPendingFiles([])
      onToast('Seeds analyzed — gap overview updated', 'success')
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Seed analysis failed', 'error')
    } finally { setAnalyzing(false) }
  }

  // ── selection ───────────────────────────────────────────────────────────
  const toggleCell = (c: MatrixCellInfo) => {
    setSelection(prev => {
      const next = { ...prev }
      if (next[c.cell] !== undefined) delete next[c.cell]
      else next[c.cell] = Math.max(1, c.deficit || threshold)
      return next
    })
  }
  const selectAllUnder = () => {
    if (!overview) return
    const next: Record<string, number> = {}
    overview.cells.filter(c => c.deficit > 0).forEach(c => { next[c.cell] = c.deficit })
    setSelection(next)
  }
  const setCount = (cell: string, n: number) =>
    setSelection(prev => ({ ...prev, [cell]: Math.max(1, n || 1) }))

  const mirrorDocs = (overview?.seed_documents ?? []).filter(d => d.id && d.cells && Object.keys(d.cells!).length)

  const pickMirror = (docId: string) => {
    setMirrorId(docId)
    const doc = mirrorDocs.find(d => d.id === docId)
    if (doc?.cells) setSelection({ ...doc.cells })   // prefill target composition; still editable
  }

  const totalRecords = Object.values(selection).reduce((a, b) => a + b, 0)

  // ── run generation ───────────────────────────────────────────────────────
  const run = () => {
    const selections: GenSelection[] = Object.entries(selection).map(([cell, count]) => ({ cell, count }))
    if (!selections.length) return
    setRunning(true); setEvents([]); setSummary(null); setStage('queued')
    const knobs: GenKnobs = { generate_relationships: genRelationships, assemble_documents: assembleDocs }
    if (brief.trim()) knobs.brief = brief.trim()
    if (mode === 'mirror' && mirrorId) knobs.mirror_document_id = mirrorId
    abortRef.current = streamGenerate(
      projectId, selections, knobs,
      (e) => {
        setEvents(prev => [...prev, e])
        if (e.stage) setStage(e.stage)
        if (e.summary) setSummary(e.summary)
        if (e.stage === 'error') onToast(e.message || 'Generation failed', 'error')
      },
      () => {
        setRunning(false)
        setSummary(s => { if (s?.version_id) onGenerationComplete(s.version_id); return s })
      },
      (err) => { setRunning(false); onToast(err, 'error') },
    )
  }
  const cancel = () => { abortRef.current?.(); setRunning(false) }

  const elementTypes = meta?.element_types ?? ['Requirement', 'Clause', 'Risk', 'Mitigation', 'LD']
  const labels = meta?.labels ?? []

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

        {/* ── 1 · Seeds ─────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">1</span>
            <h3 className="text-sm font-semibold text-foreground">Seed documents</h3>
            <span className="text-xs text-muted">— upload risk docs / RFPs / contracts to measure current coverage</span>
          </div>
          <div className="grid grid-cols-[1fr_1.4fr] gap-4">
            <div onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
              onClick={() => inputRef.current?.click()}
              className={clsx('border-2 border-dashed rounded-xl p-6 cursor-pointer flex flex-col items-center justify-center gap-2 text-center transition-all',
                dragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40 hover:bg-card')}>
              <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.doc" className="hidden" onChange={e => addFiles(e.target.files)} />
              <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', dragging ? 'bg-primary' : 'bg-card border border-border')}>
                <Upload size={16} className={dragging ? 'text-white' : 'text-muted'} />
              </div>
              <p className="text-sm font-medium text-foreground">Drop seed files</p>
              <p className="text-xs text-muted">PDF / DOCX — parsed & classified into the category matrix</p>
            </div>
            <div className="flex flex-col">
              <div className="flex-1 space-y-1.5 max-h-40 overflow-y-auto">
                <AnimatePresence>
                  {pendingFiles.map(f => (
                    <motion.div key={f.name} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-card border border-border group">
                      <FileText size={13} className="text-primary shrink-0" />
                      <span className="text-xs font-mono text-foreground truncate flex-1">{f.name}</span>
                      <button onClick={e => { e.stopPropagation(); setPendingFiles(p => p.filter(x => x.name !== f.name)) }}
                        className="opacity-0 group-hover:opacity-100 text-border hover:text-danger"><X size={11} /></button>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {overview?.seed_documents?.map((d, i) => (
                  <div key={`seed-${i}`} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-card/50 border border-border/50">
                    <CheckCircle2 size={13} className="text-success shrink-0" />
                    <span className="text-xs font-mono text-muted truncate flex-1">{d.name}</span>
                    <span className="text-[11px] text-muted/60">{d.elements} el · {d.type ?? '—'}</span>
                  </div>
                ))}
                {pendingFiles.length === 0 && !overview?.seed_documents?.length && (
                  <p className="text-xs text-muted/50 py-3 text-center">No seeds yet — the matrix starts empty</p>
                )}
              </div>
              <button onClick={analyzeSeeds} disabled={!pendingFiles.length || analyzing}
                className={clsx('mt-2 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all',
                  pendingFiles.length && !analyzing ? 'bg-primary text-white hover:bg-primary/90' : 'bg-card text-muted border border-border cursor-not-allowed')}>
                {analyzing ? <><RotateCcw size={13} className="animate-spin" /> Analyzing…</> : <><Wand2 size={13} /> Analyze seeds</>}
              </button>
            </div>
          </div>
        </section>

        {/* ── 2 · Gap matrix ────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">2</span>
              <h3 className="text-sm font-semibold text-foreground">Coverage gap matrix</h3>
              <span className="text-xs text-muted">— cells below threshold ({threshold}) are highlighted</span>
            </div>
            <button onClick={selectAllUnder} disabled={!overview}
              className="text-xs px-3 py-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-40">
              Select all under-threshold
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-separate" style={{ borderSpacing: '4px' }}>
              <thead>
                <tr>
                  <th className="text-left text-[11px] font-semibold text-muted/70 uppercase tracking-wide px-2"></th>
                  {labels.map(l => (
                    <th key={l} className="text-[10px] font-semibold text-muted px-1 pb-1 whitespace-nowrap" title={meta?.label_descriptions?.[l]}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {elementTypes.map(et => (
                  <tr key={et}>
                    <td className="text-xs font-semibold text-foreground pr-2 whitespace-nowrap">{et}</td>
                    {labels.map(l => {
                      const key = `${et}|${l}`
                      const c = cellByKey[key]
                      const selected = selection[key] !== undefined
                      if (!c) return <td key={key} />
                      return (
                        <td key={key}>
                          <button onClick={() => toggleCell(c)}
                            title={`${key} — ${c.total}/${threshold}${c.deficit ? ` (need ${c.deficit})` : ' ✓'}`}
                            style={{ background: cellColor(c, threshold) }}
                            className={clsx('w-full h-11 rounded-lg text-xs font-mono flex flex-col items-center justify-center transition-all border',
                              selected ? 'border-primary ring-2 ring-primary/40' : 'border-transparent hover:border-border')}>
                            <span className={clsx('font-semibold', c.deficit === 0 ? 'text-success' : 'text-foreground')}>{c.total}</span>
                            {c.deficit > 0 && <span className="text-[9px] text-danger">-{c.deficit}</span>}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 3 · Selection + run ───────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">3</span>
            <h3 className="text-sm font-semibold text-foreground">Generate</h3>
            <span className="text-xs text-muted">— describe your needs, pick targets, then run generate → validate → quality</span>
          </div>

          {/* Brief + mode */}
          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Brief — describe what you need (optional)</label>
              <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={2}
                placeholder="e.g. SaaS MSA for a UK healthcare client — include GDPR & data-residency clauses, 99.9% uptime SLA, £25k/day LDs"
                className="w-full bg-card border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder-muted/40 focus:outline-none focus:border-primary resize-none" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted">Mode</span>
              <div className="flex rounded-lg border border-border overflow-hidden">
                {(['matrix', 'mirror'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)} disabled={m === 'mirror' && mirrorDocs.length === 0}
                    className={clsx('px-3 py-1 text-xs font-medium transition-colors',
                      mode === m ? 'bg-primary text-white' : 'bg-card text-muted hover:text-foreground',
                      m === 'mirror' && mirrorDocs.length === 0 && 'opacity-40 cursor-not-allowed')}>
                    {m === 'matrix' ? 'By category' : 'Mirror a document'}
                  </button>
                ))}
              </div>
              {mode === 'mirror' && (
                <select value={mirrorId} onChange={e => pickMirror(e.target.value)}
                  className="bg-card border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary">
                  <option value="">Select seed document…</option>
                  {mirrorDocs.map(d => <option key={d.id} value={d.id}>{d.name} ({d.elements} el)</option>)}
                </select>
              )}
            </div>
            {mode === 'mirror' && mirrorId && (
              <p className="text-[11px] text-muted">
                Reproducing the selected document’s structure & category composition. Counts are prefilled — edit below if needed.
              </p>
            )}
            {mode === 'mirror' && mirrorDocs.length === 0 && (
              <p className="text-[11px] text-warning">Upload & analyze a seed document first to enable mirror mode.</p>
            )}
          </div>

          {Object.keys(selection).length === 0 ? (
            <p className="text-xs text-muted/60 py-3">Select one or more cells above to target for generation.</p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.entries(selection).map(([cell, count]) => (
                <div key={cell} className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-lg bg-card border border-border">
                  <span className="text-xs font-mono text-foreground">{cell}</span>
                  <input type="number" min={1} max={50} value={count} onChange={e => setCount(cell, Number(e.target.value))}
                    className="w-14 bg-surface border border-border rounded px-2 py-0.5 text-xs text-foreground text-center focus:outline-none focus:border-primary" />
                  <button onClick={() => toggleCell(cellByKey[cell])} className="text-border hover:text-danger p-0.5"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 mb-4">
            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
              <input type="checkbox" checked={genRelationships} onChange={e => setGenRelationships(e.target.checked)} className="accent-[var(--primary)]" />
              Generate relationship / mapping examples
            </label>
            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
              <input type="checkbox" checked={assembleDocs} onChange={e => setAssembleDocs(e.target.checked)} className="accent-[var(--primary)]" />
              Assemble composite documents
            </label>
          </div>

          <div className="flex items-center gap-3">
            {!running ? (
              <button onClick={run} disabled={totalRecords === 0}
                className={clsx('py-2.5 px-5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all',
                  totalRecords ? 'bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20' : 'bg-card text-muted border border-border cursor-not-allowed')}>
                <Play size={14} fill={totalRecords ? 'white' : 'currentColor'} />
                Generate {totalRecords ? `${totalRecords} record${totalRecords !== 1 ? 's' : ''}` : ''}
              </button>
            ) : (
              <button onClick={cancel} className="py-2.5 px-5 rounded-xl text-sm font-semibold flex items-center gap-2 bg-danger/15 text-danger border border-danger/30">
                <X size={14} /> Cancel
              </button>
            )}
            {(running || events.length > 0) && <StageStrip stage={stage} />}
          </div>

          {/* live log */}
          {events.length > 0 && (
            <div className="mt-3 rounded-lg bg-[#0d1117] border border-white/[0.06] max-h-44 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
              {events.filter(e => e.message).map((e, i) => (
                <div key={i} className="flex gap-2.5 leading-relaxed">
                  <span className={clsx('shrink-0', e.stage === 'error' ? 'text-red-400' : e.stage === 'complete' || e.stage === 'done' ? 'text-emerald-400' : 'text-slate-500')}>
                    [{e.stage}]
                  </span>
                  <span className="text-slate-300">{e.message}</span>
                </div>
              ))}
              {running && <div className="text-slate-500 animate-pulse">█</div>}
            </div>
          )}
        </section>

        {/* ── 4 · Result + SME CTA ──────────────────────────────────── */}
        <AnimatePresence>
          {summary && !running && (
            <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-success/30 bg-success/[0.04] p-5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 size={16} className="text-success" />
                <h3 className="text-sm font-semibold text-foreground">Version {summary.version_no} staged</h3>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
                <Stat label="Staged" value={summary.staged} tone="success" />
                <Stat label="Rejected" value={summary.rejected} tone="danger" />
                <Stat label="Duplicates" value={summary.duplicates} tone="warn" />
                <Stat label="Relationships" value={summary.relationships} />
                <Stat label="Documents" value={summary.documents} />
                <Stat label="Diversity" value={summary.distribution?.diversity_score ?? 0} />
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/[0.05] p-3">
                <UserCheck size={18} className="text-primary shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">Run SME validation before publishing</p>
                  <p className="text-xs text-muted mt-0.5">
                    Datasets improve markedly when a domain expert reviews a representative sample. Recommended before promoting to main.
                  </p>
                </div>
                <button onClick={() => navigate(`/studio/project/${projectId}/sme`)}
                  className="shrink-0 py-2 px-4 rounded-lg text-sm font-semibold bg-primary text-white hover:bg-primary/90">
                  Review now
                </button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function StageStrip({ stage }: { stage: string }) {
  const idx = STAGES.indexOf(stage as typeof STAGES[number])
  const done = stage === 'complete' || stage === 'done'
  return (
    <div className="flex items-center gap-1">
      {STAGES.map((s, i) => {
        const active = s === stage
        const passed = done || (idx >= 0 && i < idx)
        return (
          <div key={s} className={clsx('px-2 py-0.5 rounded-full text-[10px] font-mono border transition-all',
            active ? 'bg-primary/15 border-primary/40 text-primary' :
            passed ? 'bg-success/10 border-success/30 text-success' :
            'bg-card border-border text-muted/50')}>
            {s}{active && <span className="ml-1 animate-pulse">•</span>}
          </div>
        )
      })}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'danger' | 'warn' }) {
  const color = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warning' : 'text-foreground'
  return (
    <div className="rounded-lg bg-card border border-border px-3 py-2 text-center">
      <div className={clsx('text-lg font-mono font-semibold', color)}>{value}</div>
      <div className="text-[10px] text-muted uppercase tracking-wide">{label}</div>
    </div>
  )
}
