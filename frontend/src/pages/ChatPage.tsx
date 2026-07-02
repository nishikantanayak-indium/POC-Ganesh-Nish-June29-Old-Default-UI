import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Trash2, Pencil, Check, X, Send,
  MessageSquare, Loader2,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'

import KnowledgeMapLogo from '../components/KnowledgeMapLogo'
import ThemeToggle from '../components/ThemeToggle'
import { SourcesSection } from '../components/EvidenceCards'
import {
  fetchConversations, createConversation, renameConversation,
  deleteConversation, fetchMessages, askInConversation,
} from '../api/client'
import type { Conversation, ConversationMessage, EvidenceItem } from '../types'
import { QUERY_TYPE, queryTypeTint } from '../theme/domainColors'

const SUGGESTIONS = [
  'Give me an overall summary of coverage and risks',
  'Which requirements from the RFP are not covered by the contract?',
  'Are there any unmitigated risks?',
  'Which risks have no liquidated damages clause?',
  'Compare the RFP requirements against the contract',
  'What obligations does the vendor have and what happens if they are breached?',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupByDate(convs: Conversation[]): { label: string; items: Conversation[] }[] {
  const now  = new Date()
  const today = now.toDateString()
  const yesterday = new Date(now.getTime() - 86400000).toDateString()

  const groups: Record<string, Conversation[]> = {}
  for (const c of convs) {
    const d = new Date(c.updated_at).toDateString()
    const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : 'Earlier'
    ;(groups[label] ??= []).push(c)
  }

  return ['Today', 'Yesterday', 'Earlier']
    .filter(l => groups[l]?.length)
    .map(l => ({ label: l, items: groups[l] }))
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Conversation list item ────────────────────────────────────────────────────

function ConvItem({
  conv, selected, onSelect, onRename, onDelete,
}: {
  conv: Conversation
  selected: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing]   = useState(false)
  const [draft,   setDraft]     = useState(conv.title)
  const [hovered, setHovered]   = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft(conv.title)
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const commitEdit = () => {
    const t = draft.trim()
    if (t && t !== conv.title) onRename(t)
    setEditing(false)
  }

  const cancelEdit = () => { setDraft(conv.title); setEditing(false) }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitEdit() }
    if (e.key === 'Escape') cancelEdit()
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => !editing && onSelect()}
      className={clsx(
        'group relative rounded-lg px-3 py-2.5 cursor-pointer transition-all',
        selected
          ? 'bg-primary/15 border border-primary/30'
          : 'hover:bg-card border border-transparent hover:border-border',
      )}
    >
      {editing ? (
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-xs text-foreground outline-none border-b border-primary/50 pb-0.5"
          />
          <button onClick={commitEdit} className="p-0.5 text-success hover:text-success/80">
            <Check size={11} />
          </button>
          <button onClick={cancelEdit} className="p-0.5 text-muted hover:text-foreground">
            <X size={11} />
          </button>
        </div>
      ) : (
        <>
          <p className={clsx(
            'text-xs truncate pr-12 leading-snug',
            selected ? 'text-foreground font-medium' : 'text-muted',
          )}>
            {conv.title}
          </p>
          <p className="text-[10px] text-muted mt-0.5 font-mono">{relativeTime(conv.updated_at)}</p>

          <AnimatePresence>
            {(hovered || selected) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5"
                onClick={e => e.stopPropagation()}
              >
                <button onClick={startEdit}
                  className="p-1 rounded text-muted hover:text-foreground hover:bg-border/30 transition-colors">
                  <Pencil size={10} />
                </button>
                <button onClick={onDelete}
                  className="p-1 rounded text-muted hover:text-danger hover:bg-danger/10 transition-colors">
                  <Trash2 size={10} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ConversationMessage }) {
  const isUser = msg.role === 'user'
  const qt     = msg.query_type && QUERY_TYPE[msg.query_type]
  const ev     = (msg.evidence ?? []) as EvidenceItem[]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={clsx('flex', isUser ? 'justify-end' : 'justify-start')}
    >
      {isUser ? (
        <div className="max-w-[70%] bg-primary text-white rounded-2xl rounded-br-sm px-4 py-3">
          <p className="text-sm leading-relaxed">{msg.content}</p>
        </div>
      ) : (
        <div className="max-w-[80%] bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3.5">
          {qt && (
            <div className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold px-2 py-0.5 rounded mb-2.5"
              style={{ color: qt.color, background: queryTypeTint(msg.query_type) }}>
              {qt.label}
            </div>
          )}
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{msg.content}</p>
          {ev.length > 0 && <SourcesSection evidence={ev} />}
        </div>
      )}
    </motion.div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()

  const [conversations, setConversations]   = useState<Conversation[]>([])
  const [activeConvId,  setActiveConvId]    = useState<string | null>(null)
  const [messages,      setMessages]        = useState<ConversationMessage[]>([])
  const [input,         setInput]           = useState('')
  const [sending,       setSending]         = useState(false)
  const [loadingMsgs,   setLoadingMsgs]     = useState(false)

  const scrollRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const activeConv = conversations.find(c => c.id === activeConvId) ?? null

  // ── Load conversations ──────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    try {
      const list = await fetchConversations(workspaceId)
      setConversations(list)
    } catch { /* non-fatal */ }
  }, [workspaceId])

  useEffect(() => { loadConversations() }, [loadConversations])

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, sending])

  // ── Select conversation ─────────────────────────────────────────────────────
  const selectConv = useCallback(async (convId: string) => {
    setActiveConvId(convId)
    setMessages([])
    setLoadingMsgs(true)
    try {
      const msgs = await fetchMessages(workspaceId, convId)
      setMessages(msgs)
    } finally {
      setLoadingMsgs(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [workspaceId])

  // ── New conversation ────────────────────────────────────────────────────────
  const handleNewConv = useCallback(async () => {
    const conv = await createConversation(workspaceId)
    setConversations(prev => [conv, ...prev])
    await selectConv(conv.id)
  }, [workspaceId, selectConv])

  // ── Rename ──────────────────────────────────────────────────────────────────
  const handleRename = useCallback(async (convId: string, title: string) => {
    const updated = await renameConversation(workspaceId, convId, title)
    setConversations(prev => prev.map(c => c.id === convId ? updated : c))
  }, [workspaceId])

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (convId: string) => {
    await deleteConversation(workspaceId, convId)
    setConversations(prev => prev.filter(c => c.id !== convId))
    if (activeConvId === convId) {
      setActiveConvId(null)
      setMessages([])
    }
  }, [workspaceId, activeConvId])

  // ── Send message ─────────────────────────────────────────────────────────────
  // convIdOverride lets callers pass the ID directly when state hasn't flushed yet
  const send = useCallback(async (question: string, convIdOverride?: string) => {
    const q = question.trim()
    const targetConvId = convIdOverride ?? activeConvId
    if (!q || sending || !targetConvId) return
    setInput('')
    setSending(true)

    // Optimistic user message
    const tempId = `tmp-${Date.now()}`
    const userMsg: ConversationMessage = {
      id: tempId, conversation_id: targetConvId,
      role: 'user', content: q,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])

    try {
      const result = await askInConversation(workspaceId, targetConvId, q)

      // Replace temp + add assistant reply
      const assistantMsg: ConversationMessage = {
        id: `ai-${Date.now()}`, conversation_id: targetConvId,
        role: 'assistant', content: result.answer,
        query_type: result.query_type, evidence: result.evidence,
        created_at: new Date().toISOString(),
      }
      setMessages(prev => [...prev.filter(m => m.id !== tempId), userMsg, assistantMsg])

      // Refresh sidebar so title + timestamp update
      loadConversations()
    } catch (e) {
      const errMsg: ConversationMessage = {
        id: `err-${Date.now()}`, conversation_id: targetConvId,
        role: 'assistant',
        content: `Error: ${e instanceof Error ? e.message : String(e)}`,
        created_at: new Date().toISOString(),
      }
      setMessages(prev => [...prev.filter(m => m.id !== tempId), userMsg, errMsg])
    } finally {
      setSending(false)
    }
  }, [sending, activeConvId, workspaceId, loadConversations])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const grouped = groupByDate(conversations)

  return (
    <div className="flex flex-col h-screen bg-bg overflow-hidden">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/workspace/${workspaceId}`)}
            className="flex items-center gap-1.5 text-muted hover:text-foreground transition-colors text-xs font-medium"
          >
            <ArrowLeft size={13} /> Back to workspace
          </button>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-primary flex items-center justify-center">
              <KnowledgeMapLogo size={14} className="text-foreground" />
            </div>
            <span className="font-semibold text-foreground text-sm tracking-tight">ContractIQ</span>
            <span className="text-muted text-sm">/</span>
            <span className="text-foreground text-sm font-medium">Chat</span>
          </div>
        </div>
        <ThemeToggle />
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="w-72 shrink-0 flex flex-col border-r border-border bg-surface overflow-hidden">

          {/* New chat button */}
          <div className="p-3 border-b border-border">
            <button
              onClick={handleNewConv}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={14} /> New conversation
            </button>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-4">
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                <MessageSquare size={20} className="text-muted mb-2" />
                <p className="text-xs text-muted">No conversations yet</p>
                <p className="text-[10px] text-muted/70 mt-1">Click "New conversation" to start</p>
              </div>
            ) : (
              grouped.map(group => (
                <div key={group.label}>
                  <p className="text-[10px] text-muted font-mono uppercase tracking-widest px-3 mb-1">
                    {group.label}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map(conv => (
                      <ConvItem
                        key={conv.id}
                        conv={conv}
                        selected={conv.id === activeConvId}
                        onSelect={() => selectConv(conv.id)}
                        onRename={title => handleRename(conv.id, title)}
                        onDelete={() => handleDelete(conv.id)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* ── Main chat area ───────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {activeConvId === null ? (
            /* No conversation selected */
            <div className="flex-1 flex flex-col items-center justify-center p-8">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <MessageSquare size={22} className="text-primary" />
              </div>
              <h2 className="text-foreground font-semibold text-base mb-1">Start a conversation</h2>
              <p className="text-muted text-sm mb-8 text-center max-w-sm">
                Ask questions about your procurement documents — coverage gaps, risks, comparisons, and more.
              </p>
              <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={async () => {
                      const c = await createConversation(workspaceId)
                      setConversations(p => [c, ...p])
                      // Set state directly — no messages to load for a brand-new conv
                      setActiveConvId(c.id)
                      setMessages([])
                      // Pass ID explicitly so send() doesn't rely on stale closure
                      send(s, c.id)
                    }}
                    className="text-left text-xs px-3.5 py-3 rounded-xl bg-card border border-border text-muted hover:text-foreground hover:border-primary/40 transition-all leading-snug"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Conversation title bar */}
              <div className="px-6 py-3 border-b border-border bg-surface shrink-0 flex items-center gap-3">
                <MessageSquare size={14} className="text-muted shrink-0" />
                <span className="text-sm font-medium text-foreground truncate">
                  {activeConv?.title ?? 'Conversation'}
                </span>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
                {loadingMsgs ? (
                  <div className="flex items-center justify-center h-32 gap-2 text-muted text-sm">
                    <Loader2 size={16} className="animate-spin" /> Loading messages…
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 text-center">
                    <p className="text-sm text-muted">Ask your first question below</p>
                    <div className="grid grid-cols-2 gap-2 mt-4 w-full max-w-lg">
                      {SUGGESTIONS.slice(0, 4).map(s => (
                        <button key={s} onClick={() => send(s, activeConvId ?? undefined)}
                          className="text-left text-xs px-3 py-2.5 rounded-xl bg-card border border-border text-muted hover:text-foreground hover:border-primary/40 transition-all leading-snug">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)
                )}

                {sending && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="flex justify-start"
                  >
                    <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Input */}
              <div className="shrink-0 border-t border-border bg-surface px-6 py-4">
                <div className="flex items-end gap-3 bg-card border border-border rounded-2xl px-4 py-3 focus-within:border-primary/50 transition-colors">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder="Ask about coverage, risks, comparisons…"
                    rows={1}
                    className="flex-1 bg-transparent text-sm text-foreground placeholder-muted outline-none resize-none leading-5 max-h-36"
                  />
                  <button
                    onClick={() => send(input)}
                    disabled={!input.trim() || sending}
                    className={clsx(
                      'p-2 rounded-xl transition-all shrink-0',
                      input.trim() && !sending
                        ? 'bg-primary text-white hover:bg-primary/80'
                        : 'text-border cursor-not-allowed',
                    )}
                  >
                    {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  </button>
                </div>
                <p className="text-[10px] text-muted/70 mt-2 text-center">Enter to send · Shift+Enter for newline</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
