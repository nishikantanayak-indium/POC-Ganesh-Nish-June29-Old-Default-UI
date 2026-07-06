import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Upload, FileText, FileSignature, ShieldAlert, Files, X, Play, Wand2,
  CheckCircle2, UserCheck, RotateCcw, Loader2, Circle, Minus, Plus, Sparkles,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'

import { uploadSeeds, streamGenerateDocuments, fetchDocTypeOverview } from '../../api/client'
import type { StudioOverview, GenEvent, DocGenTarget, DocTypeOverview } from '../../types'

// Document-first generation — no atomic elements, no LLM validation stage.
// Element-level Describe/Mirror/Balance generation is parked (see
// StudioProjectPage.tsx); this tab now only ever produces whole documents.
const STAGES = [
  { id: 'generate', label: 'Generate' },
  { id: 'persist', label: 'Save' },
] as const

function docTypeIcon(docType: string) {
  const t = docType.toLowerCase()
  if (t.includes('rfp')) return FileText
  if (t.includes('contract')) return FileSignature
  if (t.includes('risk')) return ShieldAlert
  return Files
}

interface Props {
  projectId: string
  overview: StudioOverview | null
  onReloadOverview: () => Promise<void>
  onGenerationComplete: () => void
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

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
  const fillGap = (docType: string, deficit: number) => {
    setCount(docType, Math.max(1, deficit))
    setExpanded(prev => ({ ...prev, [docType]: true }))
  }

  const targets: DocGenTarget[] = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([doc_type, count]) => ({ doc_type, count, brief: briefs[doc_type]?.trim() || undefined }))

  const canRun = targets.length > 0
  const totalRequested = targets.reduce((a, t) => a + t.count, 0)
  const runLabel = totalRequested ? `Generate ${totalRequested} document${totalRequested > 1 ? 's' : ''}` : 'Generate documents'

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
        onGenerationComplete()
      },
      (err) => { setRunning(false); onToast(err, 'error') },
    )
  }
  const cancel = () => { abortRef.current?.(); setRunning(false) }

  const lastMessage = [...events].reverse().find(e => e.message)?.message
  const errored = events.some(e => e.stage === 'error')

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">

        {/* ── Seeds ─────────────────────────────────────────────────── */}
        <section className="relative bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="h-[3px] w-full bg-gradient-to-r from-primary/70 via-primary/40 to-transparent" />
          <div className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0">
                <Upload size={16} className="text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Seed documents</h3>
                <p className="text-xs text-muted">Optional — conditions tone &amp; structure for documents of the same type</p>
              </div>
            </div>
            <div className="grid grid-cols-[1fr_1.4fr] gap-4">
              <div onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
                onClick={() => inputRef.current?.click()}
                className={clsx('border-2 border-dashed rounded-xl p-6 cursor-pointer flex flex-col items-center justify-center gap-2 text-center transition-all',
                  dragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40 hover:bg-card/60')}>
                <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.doc" className="hidden" onChange={e => addFiles(e.target.files)} />
                <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', dragging ? 'bg-primary' : 'bg-card border border-border')}>
                  <Upload size={16} className={dragging ? 'text-white' : 'text-muted'} />
                </div>
                <p className="text-sm font-medium text-foreground">Drop seed files</p>
                <p className="text-xs text-muted">PDF / DOCX — classified by document type automatically</p>
              </div>
              <div className="flex flex-col">
                <div className="space-y-1.5 max-h-36 min-h-[2.5rem] overflow-y-auto">
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
                    <div key={`seed-${i}`} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-card/60 border border-border/60">
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
                  className={clsx('mt-3 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all',
                    pendingFiles.length && !analyzing ? 'bg-primary text-white hover:bg-primary/90' : 'bg-card text-muted border border-border cursor-not-allowed opacity-70')}>
                  {analyzing ? <><RotateCcw size={13} className="animate-spin" /> Analyzing…</> : <><Wand2 size={13} /> Analyze seeds</>}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Document targets ──────────────────────────────────────── */}
        <section className="relative bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="h-[3px] w-full bg-gradient-to-r from-primary/70 via-primary/40 to-transparent" />
          <div className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0">
                <Sparkles size={16} className="text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">How many more documents do you need?</h3>
                <p className="text-xs text-muted">Pick a count per type — describe what they should contain if it matters</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(docOverview?.doc_types ?? []).map(dt => {
                const Icon = docTypeIcon(dt.doc_type)
                const pct = dt.threshold > 0 ? Math.min(100, Math.round((dt.total / dt.threshold) * 100)) : 100
                const met = dt.deficit <= 0
                const count = counts[dt.doc_type] ?? 0
                const isOpen = expanded[dt.doc_type] ?? count > 0
                return (
                  <div key={dt.doc_type}
                    className={clsx('relative rounded-xl border overflow-hidden transition-colors',
                      count > 0 ? 'border-primary/50 bg-primary/[0.07]' : 'border-border bg-card')}>
                    <div className={clsx('h-[2px] w-full', met ? 'bg-success/50' : 'bg-warning/60')} />
                    <div className="p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                            met ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
                            <Icon size={13} />
                          </div>
                          <span className="text-sm font-semibold text-foreground truncate">{dt.doc_type}</span>
                        </div>
                        <span className="text-[11px] font-mono text-muted shrink-0">{dt.total}/{dt.threshold}</span>
                      </div>

                      <div className="h-1.5 rounded-full bg-border/40 overflow-hidden">
                        <motion.div className={clsx('h-full rounded-full', met ? 'bg-success' : 'bg-warning')}
                          initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.4 }} />
                      </div>

                      {dt.deficit > 0 && (
                        <button onClick={() => fillGap(dt.doc_type, dt.deficit)}
                          className="text-[11px] text-warning hover:underline">needs {dt.deficit} more — fill gap</button>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] font-medium text-muted">Generate</span>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setCount(dt.doc_type, count - 1)} disabled={count <= 0}
                            className="w-6 h-6 rounded-md border border-border flex items-center justify-center text-muted hover:text-foreground disabled:opacity-30">
                            <Minus size={11} />
                          </button>
                          <input type="number" min={0} max={50} value={count}
                            onChange={e => setCount(dt.doc_type, Number(e.target.value))}
                            className="w-10 bg-transparent text-center text-sm font-mono font-semibold text-foreground focus:outline-none" />
                          <button onClick={() => setCount(dt.doc_type, count + 1)}
                            className="w-6 h-6 rounded-md border border-border flex items-center justify-center text-muted hover:text-foreground">
                            <Plus size={11} />
                          </button>
                        </div>
                      </div>

                      {count > 0 && (
                        <button onClick={() => setExpanded(prev => ({ ...prev, [dt.doc_type]: !isOpen }))}
                          className="text-[11px] text-primary hover:underline">
                          {isOpen ? 'Hide brief' : 'Describe what these should contain (optional)'}
                        </button>
                      )}
                      <AnimatePresence>
                        {count > 0 && isOpen && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                            <textarea value={briefs[dt.doc_type] ?? ''} onChange={e => setBrief(dt.doc_type, e.target.value)}
                              rows={3} placeholder={`e.g. a ${dt.doc_type.toLowerCase()} with a 99.9% uptime SLA and a $5k/day LD clause`}
                              className="w-full bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder-muted/40 focus:outline-none focus:border-primary resize-none" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-3 mt-5 pt-4 border-t border-border/60">
              {!running ? (
                <button onClick={run} disabled={!canRun}
                  className={clsx('py-2.5 px-5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all',
                    canRun ? 'bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20' : 'bg-card text-muted border border-border cursor-not-allowed opacity-70')}>
                  <Play size={14} fill={canRun ? 'white' : 'currentColor'} /> {runLabel}
                </button>
              ) : (
                <button onClick={cancel} className="py-2.5 px-5 rounded-xl text-sm font-semibold flex items-center gap-2 bg-danger/15 text-danger border border-danger/30">
                  <X size={14} /> Cancel
                </button>
              )}
              {!running && !canRun && <span className="text-xs text-muted">Pick at least one document type above to enable generation</span>}
            </div>

            <AnimatePresence>
              {(running || events.length > 0) && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="mt-4 rounded-xl border border-border bg-card p-3.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {STAGES.map(s => {
                      const idx = STAGES.findIndex(x => x.id === stage)
                      const sIdx = STAGES.findIndex(x => x.id === s.id)
                      const done = stage === 'complete' || stage === 'done' || (idx >= 0 && sIdx < idx)
                      const active = s.id === stage
                      return (
                        <div key={s.id} className="flex items-center gap-2">
                          <div className={clsx('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all',
                            errored ? 'border-danger/30 text-danger bg-danger/10' :
                            active ? 'border-primary/40 text-primary bg-primary/10' :
                            done ? 'border-success/30 text-success bg-success/10' :
                            'border-border text-muted/50 bg-bg')}>
                            {active && !errored ? <Loader2 size={11} className="animate-spin" /> : done ? <CheckCircle2 size={11} /> : <Circle size={11} />}
                            {s.label}
                          </div>
                          {s.id !== STAGES[STAGES.length - 1].id && <div className="w-3 h-px bg-border" />}
                        </div>
                      )
                    })}
                  </div>
                  {lastMessage && (
                    <p className={clsx('text-xs mt-2.5 truncate', errored ? 'text-danger' : 'text-muted')}>{lastMessage}</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* ── Result + Review CTA ──────────────────────────────────── */}
        <AnimatePresence>
          {summary && !running && (
            <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-success/30 bg-success/[0.04] p-5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 size={16} className="text-success" />
                <h3 className="text-sm font-semibold text-foreground">{summary.documents} document{summary.documents === 1 ? '' : 's'} generated</h3>
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
                  <p className="text-xs text-muted mt-0.5">Review is the only quality gate in this flow — study each document before it's sent to storage.</p>
                </div>
                <button onClick={() => navigate(`/studio/project/${projectId}/review`)}
                  className="shrink-0 py-2 px-4 rounded-lg text-sm font-semibold bg-primary text-white hover:bg-primary/90">Review now</button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
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
