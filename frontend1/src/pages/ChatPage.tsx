import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import {
  ArrowLeft,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Plus,
  Send,
  Trash2,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatRelativeDay } from '@/lib/formatters'
import { QUERY_TYPE_LABELS } from '@/lib/domain-taxonomy'
import {
  askInConversation,
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  renameConversation,
} from '@/api/chat'
import type { Conversation, ConversationMessage } from '@/types/analysis'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SourcesSection } from '@/components/workspace/EvidenceCards'

const SUGGESTED_PROMPTS = [
  'Which requirements are not covered?',
  'Summarize the key risks',
  'Are there any contradictions across documents?',
  'What liquidated damages clauses exist?',
]

function makeLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function groupByDay(conversations: Conversation[]): Array<{ label: string; items: Conversation[] }> {
  const groups = new Map<string, Conversation[]>()
  for (const c of conversations) {
    const label = formatRelativeDay(c.updated_at)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(c)
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }))
}

interface ConversationRowProps {
  conversation: Conversation
  active: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}

function ConversationRow({ conversation, active, onSelect, onRename, onDelete }: ConversationRowProps) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(conversation.title)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    setEditing(false)
    const trimmed = title.trim()
    if (trimmed && trimmed !== conversation.title) {
      onRename(trimmed)
    } else {
      setTitle(conversation.title)
    }
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm',
        active
          ? 'bg-navy-50 text-navy-800 dark:bg-navy-900/40 dark:text-navy-200'
          : 'text-ink-muted hover:bg-surface-muted hover:text-ink dark:text-ink-subtle dark:hover:bg-surface-dark-muted dark:hover:text-ink-inverted'
      )}
    >
      {editing ? (
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setTitle(conversation.title)
              setEditing(false)
            }
          }}
          className="h-7 flex-1 text-sm"
        />
      ) : (
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate text-left">
          {conversation.title || 'Untitled conversation'}
        </button>
      )}
      {!editing && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
            className="rounded p-1 hover:bg-surface-dark-muted/20"
            title="Rename"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setConfirmOpen(true)
            }}
            className="rounded p-1 hover:bg-danger-100 hover:text-danger-600 dark:hover:bg-danger-700/20"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-muted dark:text-ink-subtle">
            This will permanently delete &ldquo;{conversation.title || 'Untitled conversation'}&rdquo; and all its
            messages.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false)
                onDelete()
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ChatPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const queryClient = useQueryClient()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [localMessages, setLocalMessages] = useState<ConversationMessage[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  const conversationsQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'conversations'],
    queryFn: () => listConversations(workspaceId),
    enabled: !!workspaceId,
  })

  const conversations = conversationsQuery.data?.conversations ?? []

  // Auto-select most recent conversation once loaded.
  useEffect(() => {
    if (selectedId) return
    if (conversations.length > 0) {
      const mostRecent = [...conversations].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      )[0]
      setSelectedId(mostRecent.id)
    }
  }, [conversations, selectedId])

  const messagesQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'conversation', selectedId, 'messages'],
    queryFn: () => listMessages(workspaceId, selectedId!),
    enabled: !!workspaceId && !!selectedId,
  })

  useEffect(() => {
    setLocalMessages(messagesQuery.data?.messages ?? [])
  }, [messagesQuery.data])

  useEffect(() => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }))
  }, [localMessages])

  const createMutation = useMutation({
    mutationFn: (title?: string) => createConversation(workspaceId, title),
    onSuccess: (conv) => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'conversations'] })
      setSelectedId(conv.id)
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameConversation(workspaceId, id, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'conversations'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteConversation(workspaceId, id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'conversations'] })
      if (selectedId === id) setSelectedId(null)
    },
  })

  const askMutation = useMutation({
    mutationFn: (question: string) => askInConversation(workspaceId, selectedId!, question),
    onSuccess: (data) => {
      setLocalMessages((prev) => [
        ...prev,
        {
          id: makeLocalId(),
          conversation_id: selectedId!,
          role: 'assistant',
          content: data.answer,
          query_type: data.query_type,
          evidence: data.evidence,
          created_at: new Date().toISOString(),
        },
      ])
      queryClient.invalidateQueries({
        queryKey: ['workspace', workspaceId, 'conversation', selectedId, 'messages'],
      })
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'conversations'] })
    },
  })

  const grouped = useMemo(() => groupByDay(conversations), [conversations])

  const submitQuestion = (question: string) => {
    const trimmed = question.trim()
    if (!trimmed || !selectedId || askMutation.isPending) return
    setLocalMessages((prev) => [
      ...prev,
      {
        id: makeLocalId(),
        conversation_id: selectedId,
        role: 'user',
        content: trimmed,
        created_at: new Date().toISOString(),
      },
    ])
    setInput('')
    askMutation.mutate(trimmed)
  }

  const handleNewConversation = () => {
    createMutation.mutate(undefined)
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] bg-surface-subtle dark:bg-surface-dark">
      <aside className="flex w-64 flex-col border-r border-border bg-surface dark:border-border-dark dark:bg-surface-dark-subtle">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3 dark:border-border-dark">
          <Link
            to={`/workspace/${workspaceId}`}
            className="flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink dark:text-ink-subtle dark:hover:text-ink-inverted"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Workspace
          </Link>
        </div>
        <div className="p-3">
          <Button size="sm" className="w-full" onClick={handleNewConversation} loading={createMutation.isPending}>
            <Plus className="h-4 w-4" />
            New conversation
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {conversationsQuery.isLoading && (
            <p className="px-2 text-xs text-ink-subtle">Loading conversations…</p>
          )}
          {!conversationsQuery.isLoading && conversations.length === 0 && (
            <p className="px-2 text-xs text-ink-subtle">No conversations yet. Start a new one above.</p>
          )}
          {grouped.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((c) => (
                  <ConversationRow
                    key={c.id}
                    conversation={c}
                    active={c.id === selectedId}
                    onSelect={() => setSelectedId(c.id)}
                    onRename={(title) => renameMutation.mutate({ id: c.id, title })}
                    onDelete={() => deleteMutation.mutate(c.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        {!selectedId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <MessageSquarePlus className="h-8 w-8 text-ink-subtle" />
            <p className="text-sm text-ink-muted dark:text-ink-subtle">
              {conversationsQuery.isLoading
                ? 'Loading…'
                : 'Select a conversation or start a new one to begin.'}
            </p>
            {!conversationsQuery.isLoading && (
              <Button onClick={handleNewConversation} loading={createMutation.isPending}>
                <Plus className="h-4 w-4" />
                New conversation
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="mx-auto max-w-3xl space-y-5">
                {messagesQuery.isLoading && (
                  <p className="text-sm text-ink-subtle">Loading messages…</p>
                )}
                {localMessages.map((m) => (
                  <div key={m.id} className={cn('flex flex-col gap-1.5', m.role === 'user' ? 'items-end' : 'items-start')}>
                    <div
                      className={cn(
                        'max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-7',
                        m.role === 'user'
                          ? 'bg-accent-600 text-white'
                          : 'bg-surface-muted text-ink dark:bg-surface-dark-subtle dark:text-ink-inverted'
                      )}
                    >
                      {m.role === 'assistant' ? (
                        <div className="[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                      ) : (
                        m.content
                      )}
                    </div>
                    {m.role === 'assistant' && m.query_type && (
                      <Badge variant="secondary" className="text-[10px]">
                        {QUERY_TYPE_LABELS[m.query_type]}
                      </Badge>
                    )}
                    {m.role === 'assistant' && m.evidence && m.evidence.length > 0 && (
                      <div className="w-full max-w-[95%]">
                        <SourcesSection evidence={m.evidence} />
                      </div>
                    )}
                  </div>
                ))}

                {localMessages.length === 0 && !messagesQuery.isLoading && (
                  <div className="space-y-3 pt-8 text-center">
                    <p className="text-sm text-ink-muted dark:text-ink-subtle">
                      Ask about coverage gaps, risks, mitigations, or contradictions across documents.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {SUGGESTED_PROMPTS.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => submitQuestion(prompt)}
                          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700 dark:border-border-dark dark:bg-surface-dark-subtle dark:text-ink-subtle dark:hover:border-accent-700 dark:hover:bg-accent-900/30 dark:hover:text-accent-200"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {askMutation.isPending && (
                  <div className="flex items-center gap-2 text-sm text-ink-subtle">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Thinking…
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            </div>

            <div className="border-t border-border p-4 dark:border-border-dark">
              <div className="mx-auto flex max-w-3xl items-end gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      submitQuestion(input)
                    }
                  }}
                  placeholder="Ask a question about this workspace…"
                  className="min-h-[44px] resize-none"
                  rows={1}
                />
                <Button
                  size="icon"
                  onClick={() => submitQuestion(input)}
                  disabled={!input.trim() || askMutation.isPending}
                  loading={askMutation.isPending}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
