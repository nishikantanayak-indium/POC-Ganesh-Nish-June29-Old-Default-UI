import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Upload, FileText, X, Play, Wand2, CheckCircle2, UserCheck, RotateCcw,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'

import { uploadSeeds, streamGenerateDocuments, fetchDocTypeOverview } from '../../api/client'
import type { StudioOverview, GenEvent, DocGenTarget, DocTypeOverview } from '../../types'

// Document-first generation — no atomic elements, no LLM validation stage.
// Element-level Describe/Mirror/Balance generation is parked (see
// StudioProjectPage.tsx); this tab now only ever produces whole documents.
const STAGES = ['generate', 'persist'] as const

interface Props {
  projectId: string
  overview: StudioOverview | null
  onReloadOverview: () => Promise<void>
  onGenerationComplete: (versionId: string) => void
  onToast: (msg: string, type: 'success' | 'error') => void
}

export default function GenerateTab({
  projectId, overview, onReloadOverview, onGenerationComplete, onToast,
}: Props) {
  const navigate = useNavigate()

  // seeds
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // doc-type targets
  const [docOverview, setDocOverview] = useState<DocTypeOverview | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [briefs, setBriefs] = useState<Record<string, string>>({})

  // run
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState<GenEvent[]>([])
  const [stage, setStage] = useState<string>('')
  const [summary, setSummary] = useState<(GenEvent['summary']) | null>(null)
  const abortRef = useRef<(() => void) | null>(null)

  const reloadDocOverview = useCallback(async () => {
    try { setDocOverview(await fetchDocTypeOverview(projectId)) } catch { /* ignore */ }
  }, [projectId])

  useEffect(() => { reloadDocOverview() }, [reloadDocOverview])

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
      await Promise.all([onReloadOverview(), reloadDocOverview()])
      setPendingFiles([])
      onToast('Seeds analyzed', 'success')
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Seed analysis failed', 'error')
    } finally { setAnalyzing(false) }
  }

  // ── targets ────────────────────────────────────────────────────────────
  const setCount = (docType: string, n: number) =>
    setCounts(prev => ({ ...prev, [docType]: Math.max(0, n || 0) }))
  const setBrief = (docType: string, text: string) =>
    setBriefs(prev => ({ ...prev, [docType]: text }))
  const fillGap = (docType: string, deficit: number) =>
    setCount(docType, Math.max(1, deficit))

  const targets: DocGenTarget[] = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([doc_type, count]) => ({ doc_type, count, brief: briefs[doc_type]?.trim() || undefined }))

  const canRun = targets.length > 0
  const totalRequested = targets.reduce((a, t) => a + t.count, 0)
  const runLabel = totalRequested ? `Generate ${totalRequested} document${totalRequested > 1 ? 's' : ''}` : 'Generate'

  // ── run ───────────────────────────────────────────────────────────────────
  const run = () => {
    if (!canRun) return
    setRunning(true); setEvents([]); setSummary(null); setStage('queued')
    abortRef.current = streamGenerateDocuments(
      projectId, targets, {},
      (e) => {
        setEvents(prev => [...prev, e])
        if (e.stage) setStage(e.stage)
        if (e.summary) setSummary(e.summary)
        if (e.stage === 'error') onToast(e.message || 'Generation failed', 'error')
      },
      () => {
        setRunning(false)
        setCounts({}); setBriefs({})
        reloadDocOverview()
        setSummary(s => { if (s?.version_id) onGenerationComplete(s.version_id); return s })
      },
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
            <span className="text-xs text-muted">— conditions tone/structure for generated documents of the same type</span>
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
              <p className="text-xs text-muted">PDF / DOCX — classified by document type automatically</p>
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
                    <span className="text-[11px] text-muted/60">{d.type ?? '—'}</span>
                  </div>
                ))}
                {pendingFiles.length === 0 && !overview?.seed_documents?.length && (
                  <p className="text-xs text-muted/50 py-3 text-center">No seeds yet — that's fine, generation works from a brief alone</p>
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

        {/* ── 2 · Document targets ──────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">2</span>
            <h3 className="text-sm font-semibold text-foreground">How many more documents do you need?</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(docOverview?.doc_types ?? []).map(dt => {
              const pct = dt.threshold > 0 ? Math.min(100, Math.round((dt.total / dt.threshold) * 100)) : 100
              return (
                <div key={dt.doc_type} className="rounded-xl border border-border bg-card p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">{dt.doc_type}</span>
                    <span className="text-[11px] font-mono text-muted">{dt.total}/{dt.threshold}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg overflow-hidden">
                    <div className={clsx('h-full rounded-full', dt.deficit > 0 ? 'bg-warning' : 'bg-success')}
                      style={{ width: `${pct}%` }} />
                  </div>
                  {dt.deficit > 0 && (
                    <button onClick={() => fillGap(dt.doc_type, dt.deficit)}
                      className="text-[11px] text-warning hover:underline">needs {dt.deficit} more — fill gap</button>
                  )}

                  <label className="block text-[11px] text-muted mt-1">Generate how many more</label>
                  <input type="number" min={0} max={50} value={counts[dt.doc_type] ?? 0}
                    onChange={e => setCount(dt.doc_type, Number(e.target.value))}
                    className="w-full bg-bg border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary" />

                  <label className="block text-[11px] text-muted mt-1">
                    Describe what these documents should contain <span className="text-muted/50">(optional)</span>
                  </label>
                  <textarea value={briefs[dt.doc_type] ?? ''} onChange={e => setBrief(dt.doc_type, e.target.value)}
                    rows={3} placeholder={`e.g. a ${dt.doc_type.toLowerCase()} with a 99.9% uptime SLA and a $5k/day LD clause`}
                    className="w-full bg-bg border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder-muted/40 focus:outline-none focus:border-primary resize-none" />
                </div>
              )
            })}
          </div>

          <div className="flex items-center gap-3 mt-5">
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <Stat label="Documents" value={summary.documents} tone="success" />
                {summary.distribution && typeof summary.distribution === 'object' &&
                  Object.entries(summary.distribution as unknown as Record<string, { generated: number }>).map(([dt, d]) => (
                    <Stat key={dt} label={dt} value={d.generated} />
                  ))}
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/[0.05] p-3">
                <UserCheck size={18} className="text-primary shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">Review before publishing</p>
                  <p className="text-xs text-muted mt-0.5">SME review is the only quality gate in this flow — study each document before it's published.</p>
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
