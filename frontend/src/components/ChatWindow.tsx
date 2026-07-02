import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquare, Send, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'

import { askQuestion } from '../api/client'
import { SourcesSection } from './EvidenceCards'
import type { ChatMessage } from '../types'
import { QUERY_TYPE, queryTypeTint } from '../theme/domainColors'

const SUGGESTIONS = [
  'Give me an overall summary',
  'Which requirements are not covered?',
  'What risks have no mitigation?',
  'Compare the RFP against the contract',
]

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
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content: question, timestamp: Date.now() }])
    setLoading(true)
    try {
      const result = await askQuestion(workspaceId, question)
      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`, role: 'assistant',
        content: result.answer, queryType: result.query_type,
        evidence: result.evidence, timestamp: Date.now(),
      }])
    } catch (e) {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`, role: 'assistant',
        content: `Error: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: Date.now(),
      }])
    } finally {
      setLoading(false)
    }
  }, [loading, workspaceId])

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
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-sm font-semibold text-foreground">Quick Q&A</span>
                {aiMsgCount > 0 && (
                  <span className="text-xs text-muted font-mono">· {aiMsgCount} answer{aiMsgCount !== 1 ? 's' : ''}</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setMessages([])} className="px-2 py-1 rounded text-xs text-muted hover:text-foreground transition-colors">
                  Clear
                </button>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-muted hover:text-foreground transition-colors">
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll p-4 space-y-4">
              {messages.length === 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted text-center py-2">Ask anything about your procurement documents</p>
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => send(s)}
                      className="w-full text-left text-xs px-3 py-2.5 rounded-lg bg-card border border-border text-muted hover:text-foreground hover:border-primary/40 transition-all">
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
                        <div className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold px-2 py-0.5 rounded mb-2"
                          style={{ color: QUERY_TYPE[msg.queryType].color, background: queryTypeTint(msg.queryType) }}>
                          {QUERY_TYPE[msg.queryType].label}
                        </div>
                      )}
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      {msg.evidence && msg.evidence.length > 0 && <SourcesSection evidence={msg.evidence} />}
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

            <div className="px-3 py-3 border-t border-border bg-card shrink-0">
              <div className="flex items-end gap-2 bg-surface border border-border rounded-xl px-3 py-2">
                <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey} placeholder="Ask about coverage, risks, gaps…"
                  rows={1} className="flex-1 bg-transparent text-sm text-foreground placeholder-muted outline-none resize-none leading-5 max-h-28" />
                <button onClick={() => send(input)} disabled={!input.trim() || loading}
                  className={clsx('p-1.5 rounded-lg transition-all shrink-0',
                    input.trim() && !loading ? 'bg-primary text-white hover:bg-primary/80' : 'text-border cursor-not-allowed')}>
                  <Send size={14} />
                </button>
              </div>
              <p className="text-xs text-muted/70 mt-1.5 text-center">Enter to send · Shift+Enter for newline</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
        className={clsx(
          'w-12 h-12 rounded-2xl flex items-center justify-center shadow-2xl transition-all relative',
          disabled ? 'bg-card border border-border text-border cursor-not-allowed'
            : open ? 'bg-primary/80 text-white' : 'bg-primary text-white hover:bg-primary/90',
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
