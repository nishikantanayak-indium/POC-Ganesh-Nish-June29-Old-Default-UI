import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Loader2,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { formatDateTime, truncate } from '@/lib/formatters'
import { validationVerdictStyle } from '@/lib/domain-taxonomy'
import {
  exportDraftDocxUrl,
  exportDraftMarkdownUrl,
  generateDraft,
  getDraft,
  getDraftTemplates,
  listDrafts,
  reviseSection,
  updateDraft,
} from '@/api/contractDraft'
import type {
  ContractDraft,
  DraftCitation,
  DraftEvent,
  DraftSection,
  DraftStage,
  DraftTemplate,
  DraftTemplateInfo,
} from '@/types/analysis'

interface DraftTabProps {
  workspaceId: string
}

// A real structure preview instead of a text-described button — shows the
// actual section headings the template would produce (for 'rfp_mirror',
// detected out of the real ingested RFP), like a mini table of contents.
function TemplateThumbnail({
  info,
  selected,
  onSelect,
  disabled,
}: {
  info: DraftTemplateInfo
  selected: boolean
  onSelect: () => void
  disabled: boolean
}) {
  const preview = info.sections.slice(0, 7)
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'flex flex-col gap-2 rounded-md border p-3 text-left transition-colors',
        selected
          ? 'border-accent-400 bg-accent-50 dark:border-accent-700 dark:bg-accent-900/20'
          : 'border-border hover:border-accent-300 dark:border-border-dark',
      )}
    >
      <p className="text-sm font-medium text-ink dark:text-ink-inverted">{info.label}</p>
      <div className="rounded-sm border border-border bg-surface p-2.5 dark:border-border-dark dark:bg-surface-dark">
        {preview.length > 0 ? (
          <ul className="space-y-1">
            {preview.map((h, i) => (
              <li key={i} className="flex items-center gap-1.5 text-[10px] leading-tight text-ink-muted dark:text-ink-subtle">
                <span className="h-1 w-1 shrink-0 rounded-full bg-ink-subtle/60" />
                <span className="truncate">{h}</span>
              </li>
            ))}
            {info.sections.length > preview.length && (
              <li className="pl-2.5 text-[10px] text-ink-subtle">+{info.sections.length - preview.length} more</li>
            )}
          </ul>
        ) : (
          <p className="text-[10px] text-ink-subtle">Structure detected from your RFP at generation time.</p>
        )}
      </div>
    </button>
  )
}

const STAGE_TRACKER: { id: DraftStage; label: string }[] = [
  { id: 'queued', label: 'Queued' },
  { id: 'grounding', label: 'Grounding' },
  { id: 'drafting', label: 'Drafting' },
  { id: 'citing', label: 'Citing' },
  { id: 'persisting', label: 'Persisting' },
  { id: 'done', label: 'Done' },
]

function stageRank(stage: DraftStage | undefined): number {
  const idx = STAGE_TRACKER.findIndex((s) => s.id === stage)
  return idx === -1 ? 0 : idx
}

function nowStamp() {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// Unwraps a highlight <mark> back into a plain text node carrying whatever
// text it currently holds — used both to cancel a pending AI edit (restore
// the original selection) and, after a successful edit, to drop the wrapper
// once its fade-out transition finishes.
function unwrapMark(markEl: HTMLElement) {
  markEl.replaceWith(document.createTextNode(markEl.textContent ?? ''))
}

interface TimedEvent {
  time: string
  event: DraftEvent
}

const PROSE_CLASSES = cn(
  'prose-sm max-w-none text-[14px] leading-relaxed text-ink dark:text-ink-inverted',
  '[&_p]:mb-3 [&_p]:leading-relaxed',
  '[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1',
  '[&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1',
  '[&_li]:leading-relaxed',
  '[&_strong]:font-semibold',
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm',
  '[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold dark:[&_th]:border-border-dark',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 dark:[&_td]:border-border-dark',
)

function CitationRow({ citation }: { citation: DraftCitation }) {
  const [showFull, setShowFull] = useState(false)
  const style = validationVerdictStyle(citation.verdict)
  const isLong = citation.quote.length > 160

  return (
    <div className="space-y-1 rounded-md border border-border p-2.5 dark:border-border-dark">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-ink dark:text-ink-inverted">{citation.aspect || citation.requirement_id}</p>
        <Badge className={cn(style.badgeClass, 'shrink-0')} variant="outline">
          {style.label}
        </Badge>
      </div>
      {citation.quote ? (
        <>
          <blockquote className="border-l-2 border-border pl-2 text-xs italic text-ink-muted dark:border-border-dark dark:text-ink-subtle">
            "{showFull ? citation.quote : truncate(citation.quote, 160)}"
          </blockquote>
          {isLong && (
            <button
              type="button"
              onClick={() => setShowFull((v) => !v)}
              className="text-xs font-medium text-accent-600 hover:underline dark:text-accent-400"
            >
              {showFull ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      ) : (
        <p className="text-xs text-ink-subtle">No supporting text cited.</p>
      )}
    </div>
  )
}

const STATUS_DOT: Record<DraftSection['status'], string> = {
  pending: 'bg-ink-subtle/50',
  approved: 'bg-success-500',
  edited: 'bg-info-500',
}

const STATUS_LABEL: Record<DraftSection['status'], string> = {
  pending: 'Pending review',
  approved: 'Approved',
  edited: 'Edited',
}

interface AiPopup {
  markEl: HTMLElement
  top: number
  left: number
  text: string
}

// One section of a continuous, directly-editable document — no separate
// "click Edit to reveal a textarea" mode. The rendered prose IS the editor
// (a contentEditable surface seeded once from the markdown, never
// re-rendered out from under an active edit). Selecting any span of text
// pops a small "Ask AI" box right next to that selection — Notion/Google-
// Docs style — and the AI's reply is spliced into that exact spot with a
// brief highlight-fade transition, not replaced instantly.
function DocSection({
  section,
  active,
  onSelect,
  onApprove,
  onSaveEdit,
  onAskAi,
  busy,
}: {
  section: DraftSection
  active: boolean
  onSelect: () => void
  onApprove: () => void
  onSaveEdit: (body: string) => void
  onAskAi: (selectedText: string, instruction: string) => Promise<string>
  busy: boolean
}) {
  const containerRef = useRef<HTMLElement | null>(null)
  const editableRef = useRef<HTMLDivElement | null>(null)
  const lastSyncedBody = useRef(section.body)
  const [popup, setPopup] = useState<AiPopup | null>(null)
  const [instruction, setInstruction] = useState('')
  const [asking, setAsking] = useState(false)

  // Rendered once per external body change, not on every keystroke — this is
  // what lets the contentEditable div stay a live, uncontrolled editing
  // surface instead of React fighting the DOM on each character typed.
  const html = useMemo(
    () => renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown>),
    [section.body],
  )

  useLayoutEffect(() => {
    const el = editableRef.current
    if (!el) return
    // Only push an external update into the live DOM when the user isn't
    // actively editing it right now — never clobber an in-progress edit.
    if (document.activeElement !== el && section.body !== lastSyncedBody.current) {
      el.innerHTML = html
      lastSyncedBody.current = section.body
    } else if (!el.innerHTML) {
      el.innerHTML = html
      lastSyncedBody.current = section.body
    }
  }, [html, section.body])

  const closePopup = (restoreText?: string) => {
    if (popup) {
      if (restoreText !== undefined) popup.markEl.textContent = restoreText
      unwrapMark(popup.markEl)
    }
    setPopup(null)
    setInstruction('')
  }

  useEffect(() => {
    if (!active) closePopup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const saveIfChanged = () => {
    const el = editableRef.current
    if (!el) return
    const current = el.innerText.replace(/\n{3,}/g, '\n\n').trim()
    if (current && current !== lastSyncedBody.current.trim()) {
      lastSyncedBody.current = current
      onSaveEdit(current)
    }
  }

  const handleMouseUp = () => {
    const sel = window.getSelection()
    const el = editableRef.current
    const container = containerRef.current
    if (!sel || sel.isCollapsed || !el || !container || !el.contains(sel.anchorNode)) {
      return
    }
    const text = sel.toString().trim()
    if (!text) return
    const range = sel.getRangeAt(0)

    // Wrap the selection in a persistent highlight BEFORE the popup steals
    // focus — the browser's native selection highlight fades to a dull gray
    // the instant the contentEditable loses focus, which is exactly what
    // happens when the user clicks into the popup's input. This explicit
    // mark stays vivid regardless of focus, so it's always clear what's
    // being edited until the AI edit actually lands (or is cancelled).
    const mark = document.createElement('mark')
    mark.className = 'rounded bg-accent-200 text-inherit dark:bg-accent-800/60'
    try {
      range.surroundContents(mark)
    } catch {
      return // selection spans element boundaries in a way that can't be simply wrapped — skip
    }
    window.getSelection()?.removeAllRanges()

    const rect = mark.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    setInstruction('')
    setPopup({
      markEl: mark,
      top: Math.max(0, rect.top - containerRect.top - 46),
      left: Math.max(0, Math.min(rect.left - containerRect.left, containerRect.width - 280)),
      text,
    })
  }

  const submitAskAi = async () => {
    if (!popup || !instruction.trim()) return
    setAsking(true)
    try {
      const revised = await onAskAi(popup.text, instruction.trim())
      const { markEl } = popup
      markEl.textContent = revised
      // Smoothly fade the highlight out right after paint, so the edit
      // reads as a transition landing in place, not an instant text swap —
      // only removed now that the update has actually been applied.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          markEl.className = 'rounded bg-transparent transition-colors duration-700'
          setTimeout(() => unwrapMark(markEl), 750)
        })
      })
      setPopup(null)
      setInstruction('')
      saveIfChanged()
    } finally {
      setAsking(false)
    }
  }

  return (
    <section
      ref={containerRef}
      onClick={onSelect}
      className={cn(
        'group relative -mx-4 rounded-md px-4 py-2 transition-colors',
        active && 'bg-accent-50/60 dark:bg-accent-900/10',
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[section.status])}
          title={STATUS_LABEL[section.status]}
        />
        <h2 className="text-base font-semibold text-ink dark:text-ink-inverted">{section.heading}</h2>
        <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {section.citations.length > 0 && (
            <span className="text-xs text-ink-subtle">
              {section.citations.length} citation{section.citations.length === 1 ? '' : 's'}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onApprove()
            }}
            disabled={busy || section.status === 'approved'}
            className="rounded p-1.5 text-success-600 hover:bg-success-50 disabled:opacity-40 dark:text-success-400 dark:hover:bg-success-700/10"
            aria-label="Approve section"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={editableRef}
        contentEditable
        suppressContentEditableWarning
        onClick={(e) => e.stopPropagation()}
        onMouseUp={handleMouseUp}
        onBlur={() => {
          if (!popup) saveIfChanged()
        }}
        className={cn(
          PROSE_CLASSES,
          '-mx-1 rounded-sm px-1 outline-none focus:bg-surface-subtle/40 dark:focus:bg-surface-dark-subtle/40',
        )}
      />

      {popup && (
        <div
          className="absolute z-10 flex items-center gap-1.5 rounded-md border border-accent-200 bg-surface p-1.5 shadow-lg dark:border-accent-800 dark:bg-surface-dark"
          style={{ top: popup.top, left: popup.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent-600 dark:text-accent-300" />
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitAskAi()
              }
              if (e.key === 'Escape') closePopup(popup.text)
            }}
            placeholder="Tell AI how to revise this…"
            className="w-56 bg-transparent text-xs text-ink outline-none placeholder:text-ink-subtle dark:text-ink-inverted"
            autoFocus
          />
          <Button size="sm" loading={asking} disabled={!instruction.trim()} onClick={submitAskAi}>
            Revise
          </Button>
          <Button variant="ghost" size="sm" onClick={() => closePopup(popup.text)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </section>
  )
}

// The whole draft rendered as one continuous document (a single "page"),
// with a sticky evidence sidebar alongside it instead of citations breaking
// up the document flow — closer to a real document editor + review pane.
function DraftDocument({
  draft,
  activeIndex,
  onSelectSection,
  onApprove,
  onSaveEdit,
  onAskAi,
  busy,
}: {
  draft: ContractDraft
  activeIndex: number
  onSelectSection: (i: number) => void
  onApprove: (i: number) => void
  onSaveEdit: (i: number, body: string) => void
  onAskAi: (i: number, selectedText: string, instruction: string) => Promise<string>
  busy: boolean
}) {
  const activeSection = draft.sections[activeIndex]

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <Card className="overflow-hidden">
        <CardContent className="p-6 sm:p-10">
          <h1 className="mb-8 text-2xl font-semibold tracking-tight text-ink dark:text-ink-inverted">
            {draft.title}
          </h1>
          <div className="divide-y divide-border dark:divide-border-dark">
            {draft.sections.map((section, i) => (
              <DocSection
                key={i}
                section={section}
                active={activeIndex === i}
                onSelect={() => onSelectSection(i)}
                onApprove={() => onApprove(i)}
                onSaveEdit={(body) => onSaveEdit(i, body)}
                onAskAi={(selectedText, instruction) => onAskAi(i, selectedText, instruction)}
                busy={busy}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Evidence</CardTitle>
            <CardDescription>{activeSection?.heading ?? 'Select a section'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {activeSection && activeSection.citations.length > 0 ? (
              activeSection.citations.map((c, i) => <CitationRow key={i} citation={c} />)
            ) : (
              <p className="text-xs text-ink-subtle">No citations for this section.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

const STAGE_TRACKER_ICONS: Record<DraftStage, LucideIcon> = {
  queued: Loader2,
  grounding: FileText,
  drafting: Sparkles,
  citing: CheckCircle2,
  persisting: FileText,
  done: Check,
  error: AlertTriangle,
}

function StageTracker({ current }: { current: DraftStage | undefined }) {
  const rank = stageRank(current)
  return (
    <div className="flex items-stretch">
      {STAGE_TRACKER.map((s, i) => {
        const Icon = STAGE_TRACKER_ICONS[s.id]
        const isDone = i < rank || current === 'done'
        const isActive = i === rank && current !== 'done'
        const isLast = i === STAGE_TRACKER.length - 1
        return (
          <div key={s.id} className="flex flex-1 items-center">
            <div
              className={cn(
                'flex min-w-[76px] flex-1 flex-col items-center gap-1 rounded-md border px-2 py-1.5 text-center transition-colors',
                isDone
                  ? 'border-success-100 bg-success-50 text-success-700 dark:border-success-700/40 dark:bg-success-700/20 dark:text-success-400'
                  : isActive
                    ? 'border-accent-200 bg-accent-50 text-accent-700 dark:border-accent-800 dark:bg-accent-900/30 dark:text-accent-200'
                    : 'border-border bg-surface text-ink-subtle dark:border-border-dark dark:bg-surface-dark-subtle',
              )}
            >
              {isDone ? (
                <Check className="h-3.5 w-3.5" />
              ) : isActive ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
              <span className="text-[11px] font-medium leading-tight">{s.label}</span>
            </div>
            {!isLast && <div className="mx-1 h-px w-3 flex-none bg-border dark:bg-border-dark sm:w-6" />}
          </div>
        )
      })}
    </div>
  )
}

export function DraftTab({ workspaceId }: DraftTabProps) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [template, setTemplate] = useState<DraftTemplate>('rfp_mirror')
  const [events, setEvents] = useState<TimedEvent[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [logOpen, setLogOpen] = useState(true)
  const [selectedDraftId, setSelectedDraftId] = useState<string | undefined>(undefined)
  const [activeSectionIndex, setActiveSectionIndex] = useState(0)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  const draftsQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'drafts'],
    queryFn: () => listDrafts(workspaceId),
  })
  const drafts = draftsQuery.data?.drafts ?? []

  const templatesQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'draft-templates'],
    queryFn: () => getDraftTemplates(workspaceId),
  })
  const templates = templatesQuery.data?.templates ?? []

  const draftQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'draft', selectedDraftId],
    queryFn: () => getDraft(workspaceId, selectedDraftId as string),
    enabled: !!selectedDraftId,
  })
  const draft = draftQuery.data

  useEffect(() => {
    if (logOpen) logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [events, logOpen])

  const lastEvent = events.length > 0 ? events[events.length - 1].event : null
  const stage = lastEvent?.stage

  const runGeneration = async () => {
    setIsGenerating(true)
    setLogOpen(true)
    setEvents([{ time: nowStamp(), event: { stage: 'queued', message: 'Starting draft generation…' } }])
    try {
      await generateDraft(workspaceId, template, (e) => {
        setEvents((prev) => [...prev, { time: nowStamp(), event: e }])
        if (e.stage === 'done' && e.summary) {
          queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'drafts'] })
          setSelectedDraftId(e.summary.draft_id)
          toast({
            title: 'Draft ready for review',
            description: `"${e.summary.title}" — ${e.summary.sections} section(s), ${e.summary.gaps} gap(s) flagged.`,
            variant: 'success',
          })
        }
        if (e.stage === 'error') {
          toast({ title: 'Draft generation failed', description: e.message, variant: 'destructive' })
        }
      })
    } catch (err) {
      setEvents((prev) => [
        ...prev,
        { time: nowStamp(), event: { stage: 'error', message: err instanceof Error ? err.message : 'Generation failed.' } },
      ])
      toast({
        title: 'Draft generation failed',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const updateSectionMutation = useMutation({
    mutationFn: (sections: DraftSection[]) => updateDraft(workspaceId, draft!.id, { sections }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['workspace', workspaceId, 'draft', updated.id], updated)
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'drafts'] })
    },
    onError: (err) => {
      toast({
        title: 'Could not update section',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    },
  })

  const finalizeMutation = useMutation({
    mutationFn: () => updateDraft(workspaceId, draft!.id, { status: 'finalized' }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['workspace', workspaceId, 'draft', updated.id], updated)
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'drafts'] })
      toast({ title: 'Draft finalized', variant: 'success' })
    },
  })

  const allApproved = useMemo(
    () => !!draft && draft.sections.length > 0 && draft.sections.every((s) => s.status !== 'pending'),
    [draft],
  )

  const patchSection = (index: number, patch: Partial<DraftSection>) => {
    if (!draft) return
    const next = draft.sections.map((s, i) => (i === index ? { ...s, ...patch } : s))
    updateSectionMutation.mutate(next)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Draft a Response Contract</CardTitle>
          <CardDescription>
            Generates a complete, evidence-backed draft grounded in this workspace's real coverage and
            traceability data — every claim cites a real requirement, clause, or risk, never invented.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {templatesQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {templates.map((info: DraftTemplateInfo) => (
                <TemplateThumbnail
                  key={info.value}
                  info={info}
                  selected={template === info.value}
                  onSelect={() => setTemplate(info.value)}
                  disabled={isGenerating}
                />
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={runGeneration} loading={isGenerating} disabled={isGenerating}>
              <Sparkles className="h-4 w-4" />
              Generate Draft
            </Button>
          </div>

          <AnimatePresence>
            {events.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <Card>
                  <CardContent className="space-y-3 pt-5">
                    <StageTracker current={stage} />
                    <p className="text-sm text-ink-muted dark:text-ink-subtle">{lastEvent?.message ?? 'Working…'}</p>
                    <div>
                      <button
                        type="button"
                        onClick={() => setLogOpen((o) => !o)}
                        className="flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink dark:text-ink-subtle dark:hover:text-ink-inverted"
                      >
                        {logOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {logOpen ? 'Hide log' : `Show log (${events.length})`}
                      </button>
                      <AnimatePresence initial={false}>
                        {logOpen && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-2 overflow-hidden"
                          >
                            <ScrollArea className="h-40 rounded-md border border-border bg-slate-950 dark:border-border-dark">
                              <div className="p-3 font-mono text-xs leading-relaxed text-slate-300">
                                {events.map((e, i) => (
                                  <div key={i} className={cn(e.event.stage === 'error' && 'text-danger-400')}>
                                    <span className="text-slate-500">[{e.time}]</span> {e.event.message ?? e.event.stage}
                                  </div>
                                ))}
                                <div ref={logEndRef} />
                              </div>
                            </ScrollArea>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {draftsQuery.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : drafts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Past Drafts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            {drafts.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelectedDraftId(d.id)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-left text-xs transition-colors',
                  selectedDraftId === d.id
                    ? 'border-accent-400 bg-accent-50 dark:border-accent-700 dark:bg-accent-900/20'
                    : 'border-border hover:border-accent-300 dark:border-border-dark',
                )}
              >
                <p className="font-medium text-ink dark:text-ink-inverted">{d.title}</p>
                <p className="mt-0.5 text-ink-subtle">
                  {d.status} · {formatDateTime(d.created_at)}
                </p>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {selectedDraftId && (
        <div className="space-y-4">
          {draftQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : draft ? (
            <>
              {draft.gaps.length > 0 && (
                <Card className="border-warning-200 bg-warning-50 dark:border-warning-700/40 dark:bg-warning-700/10">
                  <CardContent className="space-y-2 pt-5">
                    <div className="flex items-center gap-2 text-sm font-medium text-warning-700 dark:text-warning-400">
                      <AlertTriangle className="h-4 w-4" />
                      {draft.gaps.length} gap{draft.gaps.length === 1 ? '' : 's'} flagged — not silently resolved
                    </div>
                    <ul className="space-y-1 text-xs text-ink-muted dark:text-ink-subtle">
                      {draft.gaps.map((g, i) => (
                        <li key={i}>
                          <span className="font-medium text-ink dark:text-ink-inverted">{g.requirement_text}</span>
                          {' — '}
                          {g.reason}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-ink dark:text-ink-inverted">{draft.title}</h2>
                  <p className="text-xs text-ink-subtle">
                    {draft.status} · {draft.sections.length} section(s)
                    {draft.summary && ` · ${draft.summary.requirements_needing_attention} requirement(s) addressed`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a href={exportDraftMarkdownUrl(workspaceId, draft.id)} download>
                      <Download className="h-3.5 w-3.5" />
                      .md
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={exportDraftDocxUrl(workspaceId, draft.id)} download>
                      <Download className="h-3.5 w-3.5" />
                      .docx
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    disabled={!allApproved || draft.status === 'finalized' || finalizeMutation.isPending}
                    loading={finalizeMutation.isPending}
                    onClick={() => finalizeMutation.mutate()}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {draft.status === 'finalized' ? 'Finalized' : 'Finalize'}
                  </Button>
                </div>
              </div>

              <DraftDocument
                draft={draft}
                activeIndex={Math.min(activeSectionIndex, Math.max(draft.sections.length - 1, 0))}
                onSelectSection={setActiveSectionIndex}
                onApprove={(i) => patchSection(i, { status: 'approved' })}
                onSaveEdit={(i, body) => patchSection(i, { body, status: 'edited' })}
                onAskAi={(i, selectedText, instruction) => reviseSection(workspaceId, draft.id, i, selectedText, instruction).then((r) => r.revised_text)}
                busy={updateSectionMutation.isPending}
              />
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
