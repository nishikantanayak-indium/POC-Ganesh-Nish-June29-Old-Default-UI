import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquare, Send, X, Minimize2, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'

import { askQuestion } from '../api/client'
import type { ChatMessage } from '../types'

const QUERY_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  coverage_gap:     { label: 'Coverage Gap',   color: '#ef4444' },
  risk_for_partial: { label: 'Risk / Partial',  color: '#f59e0b' },
  no_mitigation:    { label: 'No Mitigation',   color: '#8b5cf6' },
  no_ld:            { label: 'No LD',           color: '#6366f1' },
  general:          { label: 'General',         color: '#10b981' },
}

const SUGGESTIONS = [
  'Which requirements are not covered?',
  'What risks have no mitigation?',
  'Show risks for partially covered requirements',
  'Which risks have no liquidated damages?',
]

interface Props {
  disabled?: boolean
}

export default function ChatWindow({ disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200)
  }, [open])

  const send = useCallback(async (q: string) => {
    const question = q.trim()
    if (!question || loading) return
    setInput('')

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: question,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const result = await askQuestion(question)
      const aiMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: result.answer,
        queryType: result.query_type,
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, aiMsg])
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-16 right-0 w-[380px] h-[520px] bg-surface border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-sm font-semibold text-white">Graph Q&A</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMessages([])}
                  className="p-1.5 rounded-lg text-muted hover:text-white transition-colors text-xs"
                  title="Clear history"
                >
                  Clear
                </button>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-muted hover:text-white transition-colors">
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll p-4 space-y-3">
              {messages.length === 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted text-center py-2">Ask anything about your procurement documents</p>
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="w-full text-left text-xs px-3 py-2.5 rounded-lg bg-card border border-border text-muted hover:text-white hover:border-primary/40 transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {messages.map(msg => (
                <div key={msg.id} className={clsx('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={clsx(
                    'max-w-[85%] rounded-2xl px-3.5 py-2.5',
                    msg.role === 'user'
                      ? 'bg-primary text-white rounded-br-sm'
                      : 'bg-card border border-border text-white rounded-bl-sm',
                  )}>
                    {msg.role === 'assistant' && msg.queryType && (
                      <div style={{ color: QUERY_TYPE_LABELS[msg.queryType]?.color ?? '#94a3b8' }}
                        className="text-xs font-semibold mb-1.5 font-mono">
                        [{QUERY_TYPE_LABELS[msg.queryType]?.label ?? msg.queryType}]
                      </div>
                    )}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  </div>
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
                  className="flex-1 bg-transparent text-sm text-white placeholder-muted outline-none resize-none leading-5 max-h-28"
                />
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim() || loading}
                  className={clsx(
                    'p-1.5 rounded-lg transition-all shrink-0',
                    input.trim() && !loading
                      ? 'bg-primary text-white hover:bg-primary-dim'
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
          'w-13 h-13 rounded-2xl flex items-center justify-center shadow-2xl transition-all relative',
          'w-12 h-12',
          disabled
            ? 'bg-card border border-border text-border cursor-not-allowed'
            : open
            ? 'bg-primary-dim text-white glow-primary'
            : 'bg-primary text-white hover:bg-primary-dim glow-primary',
        )}
      >
        {open ? <ChevronDown size={20} /> : <MessageSquare size={20} />}
        {messages.length > 0 && !open && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-danger text-white text-xs flex items-center justify-center font-bold">
            {messages.filter(m => m.role === 'assistant').length}
          </span>
        )}
      </motion.button>
    </div>
  )
}
