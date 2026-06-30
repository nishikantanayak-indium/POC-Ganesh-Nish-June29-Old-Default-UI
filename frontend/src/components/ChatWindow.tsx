import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquare, Send, ChevronDown, ChevronUp, BookOpen, GitBranch, ArrowRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'

import { askQuestion } from '../api/client'
import type { ChatMessage, EvidenceItem, EvidenceConnection, CoverageSummary } from '../types'

// ── Query type config ─────────────────────────────────────────────────────────
const QUERY_TYPE: Record<string, { label: string; color: string; bg: string }> = {
  coverage_gap:     { label: 'Coverage Gap',    color: '#ef4444', bg: '#ef444415' },
  risk_for_partial: { label: 'Risk / Partial',  color: '#f59e0b', bg: '#f59e0b15' },
  no_mitigation:    { label: 'No Mitigation',   color: '#8b5cf6', bg: '#8b5cf615' },
  no_ld:            { label: 'No LD',           color: '#6366f1', bg: '#6366f115' },
  summary:          { label: 'Summary',         color: '#10b981', bg: '#10b98115' },
  comparison:       { label: 'Comparison',      color: '#06b6d4', bg: '#06b6d415' },
  general:          { label: 'Semantic Search', color: '#10b981', bg: '#10b98115' },
}

const TYPE_COLOR: Record<string, string> = {
  Requirement: '#6366f1',
  Clause:      '#10b981',
  Risk:        '#ef4444',
  Mitigation:  '#f59e0b',
  LD:          '#8b5cf6',
  Document:    '#64748b',
}

const REL_LABEL: Record<string, string> = {
  COVERS:           'covers',
  PARTIALLY_COVERS: 'partially covers',
  INTRODUCES_RISK:  'introduces risk',
  MITIGATED_BY:     'mitigated by',
  LINKED_TO_LD:     'linked to LD',
  CONTRADICTS:      'contradicts',
  CONTAINS:         'contains',
}

const SUGGESTIONS = [
  'Give me an overall summary',
  'Which requirements are not covered?',
  'What risks have no mitigation?',
  'Compare the RFP requirements against the contract',
]

// ── Stat cell (used in summary card) ─────────────────────────────────────────
function StatCell({ label, value, color = 'text-foreground' }: {
  label: string; value: number; color?: string
}) {
  return (
    <div className="flex flex-col items-center bg-bg rounded-lg px-2 py-1.5 min-w-0">
      <span className={clsx('text-base font-bold font-mono tabular-nums', color)}>{value}</span>
      <span className="text-[9px] text-muted text-center leading-tight mt-0.5">{label}</span>
    </div>
  )
}

// ── Connection row ────────────────────────────────────────────────────────────
function ConnectionRow({ conn, depth = 0 }: { conn: EvidenceConnection; depth?: number }) {
  const accent = conn.type ? (TYPE_COLOR[conn.type] ?? '#64748b') : '#64748b'
  const relLabel = REL_LABEL[conn.rel] ?? conn.rel.toLowerCase().replace(/_/g, ' ')
  const arrow = conn.direction === 'outgoing' ? '→' : '←'
  const shortText = (conn.text ?? '').length > 90
    ? (conn.text ?? '').slice(0, 90) + '…'
    : (conn.text ?? '')

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <div className="flex items-start gap-1.5 py-0.5">
        <span className="shrink-0 text-[10px] text-muted font-mono w-3 text-center mt-0.5">{arrow}</span>
        <span
          className="shrink-0 text-[9px] font-mono px-1 py-0.5 rounded"
          style={{ color: accent, background: `${accent}18` }}
        >
          {relLabel}
        </span>
        {conn.type && (
          <span className="shrink-0 text-[9px] text-slate-500 font-mono">
            [{conn.type}]
          </span>
        )}
        <span className="text-[10px] text-slate-400 leading-tight min-w-0">{shortText}</span>
        {conn.page_number != null && (
          <span className="shrink-0 text-[9px] font-mono text-slate-600">p.{conn.page_number}</span>
        )}
      </div>
      {conn.connections?.map((sub, i) => (
        <ConnectionRow key={i} conn={sub} depth={depth + 1} />
      ))}
    </div>
  )
}

// ── Summary card ──────────────────────────────────────────────────────────────
function SummaryCard({ summary, index }: { summary: CoverageSummary; index: number }) {
  const { requirements: r, risks: k } = summary
  return (
    <div className="rounded-lg bg-bg border border-border overflow-hidden"
      style={{ borderLeft: '3px solid #10b981' }}>
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-2.5">
          <span className="shrink-0 w-5 h-5 rounded-full bg-border/30 text-muted text-xs font-mono flex items-center justify-center">
            {index + 1}
          </span>
          <span className="text-xs font-semibold text-emerald-400 font-mono">Coverage Summary</span>
        </div>

        {r && (
          <div className="mb-2">
            <p className="text-[9px] text-muted font-mono uppercase tracking-wide mb-1">Requirements</p>
            <div className="grid grid-cols-4 gap-1">
              <StatCell label="Total"       value={r.total} />
              <StatCell label="Covered"     value={r.covered}           color="text-emerald-400" />
              <StatCell label="Partial"     value={r.partially_covered} color="text-amber-400" />
              <StatCell label="Not Covered" value={r.not_covered}       color="text-red-400" />
            </div>
          </div>
        )}

        {k && (
          <div>
            <p className="text-[9px] text-muted font-mono uppercase tracking-wide mb-1">Risks</p>
            <div className="grid grid-cols-4 gap-1">
              <StatCell label="Total"      value={k.total} />
              <StatCell label="Mitigated"  value={k.mitigated}   color="text-emerald-400" />
              <StatCell label="Unmitgated" value={k.unmitigated} color="text-red-400" />
              <StatCell label="With LD"    value={k.with_ld}     color="text-purple-400" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Cross-doc relationship card ───────────────────────────────────────────────
function CrossDocCard({ item, index }: { item: EvidenceItem; index: number }) {
  const relLabel = item.cross_doc_relationship
    ? (REL_LABEL[item.cross_doc_relationship] ?? item.cross_doc_relationship.toLowerCase().replace(/_/g, ' '))
    : ''

  return (
    <div className="rounded-lg bg-bg border border-border overflow-hidden"
      style={{ borderLeft: '3px solid #06b6d4' }}>
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="shrink-0 w-5 h-5 rounded-full bg-border/30 text-muted text-xs font-mono flex items-center justify-center">
            {index + 1}
          </span>
          <GitBranch size={10} className="text-cyan-400 shrink-0" />
          <span className="text-[10px] font-mono text-cyan-400">{relLabel}</span>
        </div>

        <div className="space-y-1.5 text-[10px]">
          <div className="rounded bg-surface/60 px-2 py-1.5">
            <p className="text-[9px] text-muted font-mono mb-0.5">FROM</p>
            <p className="text-slate-300 leading-tight">{item.from?.text}</p>
            <p className="text-slate-600 font-mono text-[9px] mt-0.5">{item.from?.source}</p>
          </div>
          <div className="flex justify-center">
            <ArrowRight size={10} className="text-cyan-400/50" />
          </div>
          <div className="rounded bg-surface/60 px-2 py-1.5">
            <p className="text-[9px] text-muted font-mono mb-0.5">TO</p>
            <p className="text-slate-300 leading-tight">{item.to?.text}</p>
            <p className="text-slate-600 font-mono text-[9px] mt-0.5">{item.to?.source}</p>
          </div>
          {item.evidence && (
            <p className="text-slate-600 italic text-[9px] pt-0.5">{item.evidence}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Standard evidence card ────────────────────────────────────────────────────
function EvidenceCard({ item, index }: { item: EvidenceItem; index: number }) {
  const [expanded, setExpanded] = useState(false)

  const id      = item.id ?? item.risk_id ?? undefined
  const type    = item.type ?? (item.risk_text ? 'Risk' : undefined)
  const text    = item.text ?? item.risk_text ?? item.graphiti_fact ?? ''
  const source  = item.source ?? undefined
  const reqRef  = item.requirement ?? undefined
  const status  = item.status ?? undefined

  const accent     = type ? (TYPE_COLOR[type] ?? '#64748b') : '#64748b'
  const isGraphiti = !id && !!item.graphiti_fact
  const hasConns   = (item.connections?.length ?? 0) > 0
  const shortText  = text.length > 100 ? text.slice(0, 100) + '…' : text
  const isExpandable = text.length > 100 || hasConns

  return (
    <div
      className="rounded-lg bg-bg border border-border overflow-hidden"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <button
        className={clsx(
          'w-full text-left px-3 py-2.5 flex items-start gap-2 transition-colors',
          isExpandable && 'hover:bg-white/[0.02]',
        )}
        onClick={() => isExpandable && setExpanded(v => !v)}
      >
        <span className="shrink-0 w-5 h-5 rounded-full bg-border/30 text-muted text-xs font-mono flex items-center justify-center mt-0.5">
          {index + 1}
        </span>

        <div className="flex-1 min-w-0">
          {/* Top row */}
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            {type && (
              <span
                className="text-xs font-semibold px-1.5 py-0.5 rounded font-mono"
                style={{ color: accent, background: `${accent}18` }}
              >
                {type}
              </span>
            )}
            {id && <span className="text-xs font-mono text-slate-400">{id}</span>}
            {status && (
              <span className="text-xs font-mono text-danger bg-danger/10 px-1.5 py-0.5 rounded">{status}</span>
            )}
            {reqRef && <span className="text-xs text-muted font-mono">← {reqRef}</span>}
            {isGraphiti && <span className="text-xs text-purple-400 font-mono">graphiti</span>}
            {hasConns && !expanded && (
              <span className="text-[9px] font-mono text-slate-600 flex items-center gap-0.5">
                <GitBranch size={8} />
                {item.connections!.length} link{item.connections!.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Text */}
          <p className="text-xs text-slate-300 leading-relaxed">
            {expanded ? text : shortText}
          </p>

          {/* Source + page */}
          {(source || item.page_number != null) && (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {source && <p className="text-xs text-slate-600 font-mono">{source}</p>}
              {item.page_number != null && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-border/20 text-slate-500">
                  p.{item.page_number}
                </span>
              )}
            </div>
          )}

          {/* Graph connections — shown when expanded */}
          {expanded && hasConns && (
            <div className="mt-2 pt-2 border-t border-border/30">
              <p className="text-[9px] text-muted font-mono uppercase tracking-wide mb-1.5 flex items-center gap-1">
                <GitBranch size={8} /> Graph connections
              </p>
              <div className="space-y-0.5">
                {item.connections!.map((conn, i) => (
                  <ConnectionRow key={i} conn={conn} />
                ))}
              </div>
            </div>
          )}
        </div>

        {isExpandable && (
          <span className="shrink-0 text-slate-600 mt-1">
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </span>
        )}
      </button>
    </div>
  )
}

// ── Sources section ───────────────────────────────────────────────────────────
function SourcesSection({ evidence }: { evidence: EvidenceItem[] }) {
  const [open, setOpen] = useState(false)
  if (evidence.length === 0) return null

  return (
    <div className="mt-2 pt-2 border-t border-border/50">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-slate-300 transition-colors w-full"
      >
        <BookOpen size={11} />
        <span className="font-mono">{evidence.length} source{evidence.length !== 1 ? 's' : ''}</span>
        {open ? <ChevronUp size={11} className="ml-auto" /> : <ChevronDown size={11} className="ml-auto" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-1.5">
              {evidence.map((item, i) => {
                if (item.summary)               return <SummaryCard    key={i} summary={item.summary} index={i} />
                if (item.cross_doc_relationship) return <CrossDocCard   key={i} item={item} index={i} />
                return                                  <EvidenceCard   key={i} item={item} index={i} />
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props { workspaceId: string; disabled?: boolean }

export default function ChatWindow({ workspaceId, disabled }: Props) {
  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200)
  }, [open])

  const send = useCallback(async (q: string) => {
    const question = q.trim()
    if (!question || loading) return
    setInput('')

    setMessages(prev => [...prev, {
      id: `u-${Date.now()}`,
      role: 'user',
      content: question,
      timestamp: Date.now(),
    }])
    setLoading(true)

    try {
      const result = await askQuestion(workspaceId, question)
      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: result.answer,
        queryType: result.query_type,
        evidence: result.evidence,
        timestamp: Date.now(),
      }])
    } catch (e) {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: Date.now(),
      }])
    } finally {
      setLoading(false)
    }
  }, [loading])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const aiMsgCount = messages.filter(m => m.role === 'assistant').length

  return (
    <div className="fixed bottom-5 right-5 z-50">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-16 right-0 w-[440px] h-[580px] bg-surface border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-sm font-semibold text-foreground">Graph Q&A</span>
                {aiMsgCount > 0 && (
                  <span className="text-xs text-muted font-mono">· {aiMsgCount} answer{aiMsgCount !== 1 ? 's' : ''}</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMessages([])}
                  className="px-2 py-1 rounded text-xs text-muted hover:text-foreground transition-colors"
                >
                  Clear
                </button>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-muted hover:text-foreground transition-colors">
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll p-4 space-y-4">
              {messages.length === 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted text-center py-2">Ask anything about your procurement documents</p>
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="w-full text-left text-xs px-3 py-2.5 rounded-lg bg-card border border-border text-muted hover:text-foreground hover:border-primary/40 transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {messages.map(msg => (
                <div key={msg.id} className={clsx('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {msg.role === 'user' ? (
                    <div className="max-w-[80%] bg-primary text-white rounded-2xl rounded-br-sm px-3.5 py-2.5">
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                    </div>
                  ) : (
                    <div className="max-w-[95%] bg-card border border-border rounded-2xl rounded-bl-sm px-3.5 py-3">
                      {msg.queryType && QUERY_TYPE[msg.queryType] && (
                        <div
                          className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold px-2 py-0.5 rounded mb-2"
                          style={{
                            color: QUERY_TYPE[msg.queryType].color,
                            background: QUERY_TYPE[msg.queryType].bg,
                          }}
                        >
                          {QUERY_TYPE[msg.queryType].label}
                        </div>
                      )}
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      {msg.evidence && msg.evidence.length > 0 && (
                        <SourcesSection evidence={msg.evidence} />
                      )}
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="px-3 py-3 border-t border-border bg-card shrink-0">
              <div className="flex items-end gap-2 bg-surface border border-border rounded-xl px-3 py-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Ask about coverage, risks, gaps…"
                  rows={1}
                  className="flex-1 bg-transparent text-sm text-foreground placeholder-muted outline-none resize-none leading-5 max-h-28"
                />
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim() || loading}
                  className={clsx(
                    'p-1.5 rounded-lg transition-all shrink-0',
                    input.trim() && !loading
                      ? 'bg-primary text-white hover:bg-primary/80'
                      : 'text-border cursor-not-allowed',
                  )}
                >
                  <Send size={14} />
                </button>
              </div>
              <p className="text-xs text-border mt-1.5 text-center">Enter to send · Shift+Enter for newline</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
        className={clsx(
          'w-12 h-12 rounded-2xl flex items-center justify-center shadow-2xl transition-all relative',
          disabled
            ? 'bg-card border border-border text-border cursor-not-allowed'
            : open
            ? 'bg-primary/80 text-white'
            : 'bg-primary text-white hover:bg-primary/90',
        )}
      >
        {open ? <ChevronDown size={20} /> : <MessageSquare size={20} />}
        {aiMsgCount > 0 && !open && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-danger text-white text-xs flex items-center justify-center font-bold">
            {aiMsgCount}
          </span>
        )}
      </motion.button>
    </div>
  )
}
