import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Upload, FileText, X, Play, Wand2, CheckCircle2, UserCheck, RotateCcw,
  Zap, ChevronDown, ChevronUp, Plus, Check, Sparkles, Copy, BarChart3, Tag,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'

import { uploadSeeds, streamGenerate, updateProject } from '../../api/client'
import type { StudioMeta, StudioOverview, MatrixCellInfo, GenEvent, GenSelection, GenKnobs } from '../../types'

const STAGES = ['generate', 'validate', 'quality', 'relate', 'assemble', 'persist'] as const
type Intent = 'describe' | 'mirror' | 'balance'

interface Props {
  projectId: string
  meta: StudioMeta | null
  overview: StudioOverview | null
  onReloadOverview: () => Promise<void>
  onGenerationComplete: (versionId: string) => void
  onToast: (msg: string, type: 'success' | 'error') => void
}

export default function GenerateTab({
  projectId, meta, overview, onReloadOverview, onGenerationComplete, onToast,
}: Props) {
  const navigate = useNavigate()

  // seeds
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // intent + shared config
  const [intent, setIntent] = useState<Intent>('describe')
  const [brief, setBrief] = useState('')
  const [genRelationships, setGenRelationships] = useState(true)
  // 'none' = don't assemble documents at all; 'single' = fold everything into
  // one composite doc (default); 'split' = one doc per document type.
  const [docOutput, setDocOutput] = useState<'none' | 'single' | 'split'>('single')

  // describe
  const [describeTypes, setDescribeTypes] = useState<Set<string>>(new Set())
  const [describeCount, setDescribeCount] = useState(5)
  // balance
  const [selection, setSelection] = useState<Record<string, number>>({})
  // mirror
  const [mirrorId, setMirrorId] = useState('')

  // labels editor
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [labelsDraft, setLabelsDraft] = useState<string[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [savingLabels, setSavingLabels] = useState(false)

  // run
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState<GenEvent[]>([])
  const [stage, setStage] = useState<string>('')
  const [summary, setSummary] = useState<(GenEvent['summary']) | null>(null)
  const abortRef = useRef<(() => void) | null>(null)

  const threshold = overview?.min_threshold ?? meta?.min_threshold ?? 5
  const labels = useMemo(() => overview?.labels ?? meta?.labels ?? [], [overview, meta])
  const elementTypes = meta?.element_types ?? ['Requirement', 'Clause', 'Risk', 'Mitigation', 'LD']
  const cellByKey = useMemo(() => {
    const m: Record<string, MatrixCellInfo> = {}
    overview?.cells.forEach(c => { m[c.cell] = c })
    return m
  }, [overview])
  const underCells = useMemo(() => overview?.cells.filter(c => c.deficit > 0) ?? [], [overview])
  const totalCells = overview?.cells.length ?? 0
  const mirrorDocs = (overview?.seed_documents ?? []).filter(d => d.id && d.cells && Object.keys(d.cells!).length)
  const suggestions = (overview?.suggested_labels ?? []).filter(l => !labelsDraft.includes(l))

  useEffect(() => { setLabelsDraft(labels) }, [labels])

  // ── seeds ───────────────────────────────────────────────────────────────
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
      setLabelsOpen(true)   // reveal AI-suggested categories
      onToast('Seeds analyzed — review AI-suggested categories', 'success')
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Seed analysis failed', 'error')
    } finally { setAnalyzing(false) }
  }

  // ── labels ──────────────────────────────────────────────────────────────
  const addLabel = () => {
    const l = newLabel.trim()
    if (l && !labelsDraft.includes(l)) setLabelsDraft(prev => [...prev, l])
    setNewLabel('')
  }
  const addLabelValue = (l: string) => setLabelsDraft(prev => prev.includes(l) ? prev : [...prev, l])
  const saveLabels = async () => {
    setSavingLabels(true)
    try {
      await updateProject(projectId, { labels: labelsDraft })
      await onReloadOverview()
      onToast('Categories updated', 'success')
      setLabelsOpen(false)
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Could not update categories', 'error')
    } finally { setSavingLabels(false) }
  }

  // ── balance selection ─────────────────────────────────────────────────────
  const toggleCell = (c: MatrixCellInfo) => setSelection(prev => {
    const next = { ...prev }
    if (next[c.cell] !== undefined) delete next[c.cell]
    else next[c.cell] = Math.max(1, c.deficit || threshold)
    return next
  })
  const selectAllUnder = () => {
    const next: Record<string, number> = {}
    underCells.forEach(c => { next[c.cell] = c.deficit || threshold })
    setSelection(next)
  }
  const setCount = (cell: string, n: number) => setSelection(prev => ({ ...prev, [cell]: Math.max(1, n || 1) }))

  const toggleDescribeType = (et: string) => setDescribeTypes(prev => {
    const next = new Set(prev)
    next.has(et) ? next.delete(et) : next.add(et)
    return next
  })

  // ── run ───────────────────────────────────────────────────────────────────
  const buildSelections = (): { selections: GenSelection[]; mirror?: string } => {
    if (intent === 'describe') {
      return { selections: [...describeTypes].map(et => ({ element_type: et, count: describeCount })) }
    }
    if (intent === 'balance') {
      return { selections: Object.entries(selection).map(([cell, count]) => ({ cell, count })) }
    }
    // mirror: backend derives selections from the chosen document
    return { selections: [], mirror: mirrorId }
  }

  const canRun = intent === 'describe' ? describeTypes.size > 0
    : intent === 'balance' ? Object.keys(selection).length > 0
    : !!mirrorId

  const runLabel = intent === 'describe'
    ? (describeTypes.size ? `Generate ${describeTypes.size * describeCount} records` : 'Generate')
    : intent === 'balance'
      ? (Object.keys(selection).length ? `Generate ${Object.values(selection).reduce((a, b) => a + b, 0)} records` : 'Generate')
      : (mirrorId ? 'Generate from document' : 'Generate')

  const run = () => {
    const { selections, mirror } = buildSelections()
    if (!canRun) return
    setRunning(true); setEvents([]); setSummary(null); setStage('queued')
    const knobs: GenKnobs = { generate_relationships: genRelationships, assemble_documents: docOutput !== 'none' }
    if (docOutput === 'split' && intent !== 'mirror') knobs.split_by_doc_type = true
    if (brief.trim()) knobs.brief = brief.trim()
    if (mirror) knobs.mirror_document_id = mirror
    abortRef.current = streamGenerate(
      projectId, selections, knobs,
      (e) => {
        setEvents(prev => [...prev, e])
        if (e.stage) setStage(e.stage)
        if (e.summary) setSummary(e.summary)
        if (e.stage === 'error') onToast(e.message || 'Generation failed', 'error')
      },
      () => { setRunning(false); setSummary(s => { if (s?.version_id) onGenerationComplete(s.version_id); return s }) },
      (err) => { setRunning(false); onToast(err, 'error') },
    )
  }
  const cancel = () => { abortRef.current?.(); setRunning(false) }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

        {/* ── 1 · Seeds ─────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">1</span>
            <h3 className="text-sm font-semibold text-foreground">Seed documents <span className="text-muted font-normal">(optional)</span></h3>
            <span className="text-xs text-muted">— needed for Mirror and to measure coverage; skip it to just Describe</span>
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
              <p className="text-xs text-muted">PDF / DOCX — parsed & classified into your categories</p>
            </div>
            <div className="flex flex-col">
              <div className="flex-1 space-y-1.5 max-h-36 overflow-y-auto">
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
                  <p className="text-xs text-muted/50 py-3 text-center">No seeds — that's fine, use Describe below</p>
                )}
              </div>
              <button onClick={analyzeSeeds} disabled={!pendingFiles.length || analyzing}
                className={clsx('mt-2 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all',
                  pendingFiles.length && !analyzing ? 'bg-primary text-white hover:bg-primary/90' : 'bg-card text-muted border border-border cursor-not-allowed')}>
                {analyzing ? <><RotateCcw size={13} className="animate-spin" /> Analyzing…</> : <><Wand2 size={13} /> Analyze seeds</>}
              </button>
            </div>
          </div>

          {/* categories editor */}
          <div className="mt-4 pt-3 border-t border-border/50">
            <button onClick={() => setLabelsOpen(v => !v)} className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground">
              {labelsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}<Tag size={12} /> Categories ({labels.length})
            </button>
            {labelsOpen && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {labelsDraft.map(l => (
                    <span key={l} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-lg bg-card border border-border text-xs text-foreground">
                      {l}
                      <button onClick={() => setLabelsDraft(prev => prev.filter(x => x !== l))} className="text-border hover:text-danger"><X size={11} /></button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLabel() } }}
                    placeholder="Add a category (e.g. Insurance)"
                    className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder-muted/50 focus:outline-none focus:border-primary w-64" />
                  <button onClick={addLabel} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-border text-muted hover:text-foreground"><Plus size={12} /> Add</button>
                  <button onClick={saveLabels} disabled={savingLabels}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50">
                    <Check size={12} /> Save categories
                  </button>
                </div>
                {suggestions.length > 0 && (
                  <div className="pt-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Sparkles size={11} className="text-primary" />
                      <span className="text-[11px] text-muted">Suggested from your documents</span>
                      <button onClick={() => setLabelsDraft(prev => [...new Set([...prev, ...suggestions])])}
                        className="text-[11px] text-primary hover:underline">Adopt all</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestions.map(l => (
                        <button key={l} onClick={() => addLabelValue(l)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-primary/30 text-primary text-xs hover:bg-primary/10">
                          <Plus size={11} /> {l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-muted/60">
                  Element types (Requirement/Clause/Risk/Mitigation/LD) are fixed — these labels are your project's taxonomy.
                  After changing them, re-run <span className="font-medium">Analyze seeds</span> to recount coverage.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── 2 · Generate (intent-led) ─────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">2</span>
            <h3 className="text-sm font-semibold text-foreground">What do you want to generate?</h3>
          </div>

          {/* intent selector */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {([
              { id: 'describe', icon: <Sparkles size={14} />, title: 'Describe', desc: 'Tell us what you need' },
              { id: 'mirror', icon: <Copy size={14} />, title: 'Mirror a document', desc: 'Reproduce a seed doc' },
              { id: 'balance', icon: <BarChart3 size={14} />, title: 'Balance coverage', desc: 'Fill category gaps' },
            ] as const).map(o => (
              <button key={o.id} onClick={() => setIntent(o.id)}
                className={clsx('flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all',
                  intent === o.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40')}>
                <span className={clsx('flex items-center gap-1.5 text-sm font-semibold', intent === o.id ? 'text-primary' : 'text-foreground')}>
                  {o.icon}{o.title}
                </span>
                <span className="text-[11px] text-muted">{o.desc}</span>
              </button>
            ))}
          </div>

          {/* brief (describe + balance) */}
          {intent !== 'mirror' && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-muted mb-1.5">Brief — describe what you need {intent === 'balance' && '(optional)'}</label>
              <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={2}
                placeholder="e.g. SaaS MSA for a UK healthcare client — GDPR & data-residency clauses, 99.9% uptime SLA, £25k/day LDs"
                className="w-full bg-card border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder-muted/40 focus:outline-none focus:border-primary resize-none" />
            </div>
          )}

          {/* DESCRIBE */}
          {intent === 'describe' && (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted mb-1.5">Which element types? (labels are auto-assigned from your categories)</p>
                <div className="flex flex-wrap gap-1.5">
                  {elementTypes.map(et => {
                    const on = describeTypes.has(et)
                    return (
                      <button key={et} onClick={() => toggleDescribeType(et)}
                        className={clsx('px-3 py-1.5 rounded-lg text-xs border transition-all',
                          on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted hover:text-foreground hover:border-primary/40')}>
                        {et}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>How many of each type</span>
                <input type="number" min={1} max={50} value={describeCount} onChange={e => setDescribeCount(Math.max(1, Number(e.target.value) || 1))}
                  className="w-16 bg-card border border-border rounded px-2 py-1 text-foreground text-center focus:outline-none focus:border-primary" />
              </div>
            </div>
          )}

          {/* MIRROR */}
          {intent === 'mirror' && (
            <div className="space-y-2">
              {mirrorDocs.length === 0 ? (
                <p className="text-xs text-warning">Upload & analyze a seed document first (section 1) to mirror it.</p>
              ) : (
                <>
                  <select value={mirrorId} onChange={e => setMirrorId(e.target.value)}
                    className="bg-card border border-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary">
                    <option value="">Select a document to mirror…</option>
                    {mirrorDocs.map(d => <option key={d.id} value={d.id}>{d.name} ({d.elements} elements)</option>)}
                  </select>
                  <p className="text-[11px] text-muted">Reproduces the document's section layout and category composition in the same style.</p>
                </>
              )}
            </div>
          )}

          {/* BALANCE */}
          {intent === 'balance' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-muted">
                  {!overview || totalCells === 0 ? 'Analyze seeds to measure coverage.'
                    : underCells.length === 0
                      ? <span className="text-success">All {totalCells} categories meet the target ✓</span>
                      : <><span className="text-foreground font-semibold">{underCells.length}</span> of {totalCells} below target ({threshold})</>}
                </p>
                {underCells.length > 0 && (
                  <button onClick={selectAllUnder} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90">
                    <Zap size={12} /> Fill all gaps ({underCells.length})
                  </button>
                )}
              </div>
              {/* single per-category view: every cell as a chip (count + gap), grouped by element type */}
              {overview && totalCells > 0 ? (
                <div className="space-y-2">
                  {elementTypes.map(et => {
                    const rows = overview.cells.filter(c => c.element_type === et)
                    if (!rows.length) return null
                    return (
                      <div key={et} className="flex items-start gap-3">
                        <span className="text-xs font-semibold text-foreground w-24 shrink-0 pt-1.5">{et}</span>
                        <div className="flex flex-wrap gap-1.5 flex-1">
                          {rows.map(c => {
                            const on = selection[c.cell] !== undefined
                            const under = c.deficit > 0
                            return (
                              <button key={c.cell} onClick={() => toggleCell(c)}
                                title={`${c.total}/${threshold}${under ? ` — needs ${c.deficit} more` : ' — target met'}`}
                                className={clsx('px-2.5 py-1 rounded-lg text-xs border transition-all flex items-center gap-1.5',
                                  on ? 'border-primary bg-primary/10 text-primary'
                                     : under ? 'border-border text-foreground hover:border-primary/40'
                                             : 'border-border/40 text-muted/60 hover:text-foreground hover:border-primary/40')}>
                                {c.label}
                                <span className={clsx('font-mono text-[10px]', under ? 'text-danger' : 'text-success')}>
                                  {under ? `${c.total}·-${c.deficit}` : `${c.total} ✓`}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted/60">Analyze seeds (section 1) to see per-category counts — or just click categories to target them.</p>
              )}
              {/* selected chips w/ counts */}
              {Object.keys(selection).length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {Object.entries(selection).map(([cell, count]) => (
                    <div key={cell} className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-lg bg-card border border-border">
                      <span className="text-xs font-mono text-foreground">{cell}</span>
                      <input type="number" min={1} max={50} value={count} onChange={e => setCount(cell, Number(e.target.value))}
                        className="w-14 bg-surface border border-border rounded px-2 py-0.5 text-xs text-foreground text-center focus:outline-none focus:border-primary" />
                      <button onClick={() => cellByKey[cell] && toggleCell(cellByKey[cell])} className="text-border hover:text-danger p-0.5"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* knobs + run */}
          <div className="flex items-center gap-4 mt-4 mb-3">
            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
              <input type="checkbox" checked={genRelationships} onChange={e => setGenRelationships(e.target.checked)} className="accent-[var(--primary)]" />
              Relationship examples
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              Documents
              <select
                value={intent === 'mirror' && docOutput === 'split' ? 'single' : docOutput}
                onChange={e => setDocOutput(e.target.value as 'none' | 'single' | 'split')}
                className="bg-surface border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary cursor-pointer"
              >
                <option value="none">Don't assemble</option>
                <option value="single">One combined document</option>
                {intent !== 'mirror' && <option value="split">One document per doc type</option>}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-3">
            {!running ? (
              <button onClick={run} disabled={!canRun}
                className={clsx('py-2.5 px-5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all',
                  canRun ? 'bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20' : 'bg-card text-muted border border-border cursor-not-allowed')}>
                <Play size={14} fill={canRun ? 'white' : 'currentColor'} /> {runLabel}
              </button>
            ) : (
              <button onClick={cancel} className="py-2.5 px-5 rounded-xl text-sm font-semibold flex items-center gap-2 bg-danger/15 text-danger border border-danger/30">
                <X size={14} /> Cancel
              </button>
            )}
            {(running || events.length > 0) && <StageStrip stage={stage} />}
          </div>

          {events.length > 0 && (
            <div className="mt-3 rounded-lg bg-bg border border-border max-h-44 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
              {events.filter(e => e.message).map((e, i) => (
                <div key={i} className="flex gap-2.5 leading-relaxed">
                  <span className={clsx('shrink-0', e.stage === 'error' ? 'text-danger' : (e.stage === 'complete' || e.stage === 'done') ? 'text-success' : 'text-muted')}>[{e.stage}]</span>
                  <span className="text-foreground/80">{e.message}</span>
                </div>
              ))}
              {running && <div className="text-muted animate-pulse">█</div>}
            </div>
          )}
        </section>

        {/* ── 3 · Result + SME CTA ──────────────────────────────────── */}
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
                <Stat label="Rejected" value={summary.rejected ?? 0} tone="danger" />
                <Stat label="Duplicates" value={summary.duplicates ?? 0} tone="warn" />
                <Stat label="Relationships" value={summary.relationships} />
                <Stat label="Documents" value={summary.documents} />
                <Stat label="Diversity" value={summary.distribution?.diversity_score ?? 0} />
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/[0.05] p-3">
                <UserCheck size={18} className="text-primary shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">Run SME validation before publishing</p>
                  <p className="text-xs text-muted mt-0.5">A quick expert review of a representative sample markedly improves dataset quality.</p>
                </div>
                <button onClick={() => navigate(`/studio/project/${projectId}/sme`)}
                  className="shrink-0 py-2 px-4 rounded-lg text-sm font-semibold bg-primary text-white hover:bg-primary/90">Review now</button>
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
