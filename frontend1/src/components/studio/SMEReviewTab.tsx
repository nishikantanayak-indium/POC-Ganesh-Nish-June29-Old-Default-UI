import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, X, Pencil, ShieldCheck, Undo2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { PUBLISHED_STYLE, SME_VERDICT_STYLES } from '@/lib/domain-taxonomy'
import { formatDateTime } from '@/lib/formatters'
import type { RecordStatus, SMEVerdict, StudioVersion, SyntheticDocumentT } from '@/types/studio'
import {
  exportDocDocxUrl,
  exportDocMarkdownUrl,
  getSmeDocumentsQueue,
  listVersions,
  publishDocuments,
  recallDocument,
  submitSmeDocumentVerdict,
} from '@/api/studio'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { DocumentViewer } from './DocumentViewer'

interface SMEReviewTabProps {
  projectId: string
}

type FilterKey = 'all' | 'unreviewed' | 'approved' | 'rejected' | 'edited' | 'published'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unreviewed', label: 'Unreviewed' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'edited', label: 'Edited' },
  { key: 'published', label: 'Published' },
]

// Keeps a mutation's `isPending` (and its button spinner) visible for at least
// `ms` so quick local responses still read as a deliberate action, not a flash.
function withMinDelay<T>(promise: Promise<T>, ms = 350): Promise<T> {
  return Promise.all([promise, new Promise((r) => setTimeout(r, ms))]).then(([result]) => result)
}

function sortVersionsDesc(versions: StudioVersion[]): StudioVersion[] {
  return [...versions].sort((a, b) => {
    const ta = Date.parse(a.created_at)
    const tb = Date.parse(b.created_at)
    if (Number.isNaN(ta) || Number.isNaN(tb)) return 0
    return tb - ta
  })
}

/** Best-effort mapping from a document's backend RecordStatus to a review-facing verdict. */
function statusToVerdict(status: RecordStatus): SMEVerdict | null {
  if (status === 'sme_approved' || status === 'published') return 'approve'
  if (status === 'sme_rejected' || status === 'rejected') return 'reject'
  return null
}

export function SMEReviewTab({ projectId }: SMEReviewTabProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>(undefined)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedDocId, setSelectedDocId] = useState<string | undefined>(undefined)
  const [isEditing, setIsEditing] = useState(false)
  const [comment, setComment] = useState('')
  const [editedTitle, setEditedTitle] = useState<string | undefined>(undefined)
  const [editedMarkdown, setEditedMarkdown] = useState<string | undefined>(undefined)
  // Tracks verdicts submitted this session, keyed by document id — refines the "Edited"
  // filter, since the backend RecordStatus alone can't distinguish "approved as-is" from
  // "approved after edit".
  const [localVerdicts, setLocalVerdicts] = useState<Record<string, SMEVerdict>>({})

  const versionsQuery = useQuery({
    queryKey: ['studio', 'project', projectId, 'versions'],
    queryFn: () => listVersions(projectId),
  })

  const versions = useMemo(() => sortVersionsDesc(versionsQuery.data?.versions ?? []), [versionsQuery.data])

  useEffect(() => {
    if (!selectedVersionId && versions.length > 0) {
      setSelectedVersionId(versions[0].id)
    }
  }, [versions, selectedVersionId])

  const versionId = selectedVersionId
  const queueQuery = useQuery({
    queryKey: ['studio', 'version', versionId, 'sme-documents-queue'],
    queryFn: () => getSmeDocumentsQueue(versionId as string),
    enabled: !!versionId,
  })

  const documents = queueQuery.data?.documents ?? []
  const summary = queueQuery.data?.summary

  const effectiveVerdict = (doc: SyntheticDocumentT): SMEVerdict | null =>
    localVerdicts[doc.id] ?? statusToVerdict(doc.status)

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      const verdict = effectiveVerdict(doc)
      switch (filter) {
        case 'unreviewed':
          return verdict === null
        case 'approved':
          return verdict === 'approve' && doc.status !== 'published'
        case 'rejected':
          return verdict === 'reject'
        case 'edited':
          return verdict === 'edit'
        case 'published':
          return doc.status === 'published'
        default:
          return true
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })
  }, [documents, filter, localVerdicts])

  useEffect(() => {
    if (filteredDocuments.length === 0) {
      setSelectedDocId(undefined)
      return
    }
    if (!selectedDocId || !filteredDocuments.some((d) => d.id === selectedDocId)) {
      setSelectedDocId(filteredDocuments[0].id)
    }
  }, [filteredDocuments, selectedDocId])

  const selectedDoc = documents.find((d) => d.id === selectedDocId)

  // Reset local edit buffer whenever the selected document changes.
  useEffect(() => {
    setIsEditing(false)
    setComment('')
    setEditedTitle(undefined)
    setEditedMarkdown(undefined)
  }, [selectedDocId])

  const invalidateQueue = () => {
    if (!versionId) return
    queryClient.invalidateQueries({ queryKey: ['studio', 'version', versionId, 'sme-documents-queue'] })
    queryClient.invalidateQueries({ queryKey: ['studio', 'version', versionId, 'sme-documents-summary'] })
  }

  const advanceToNextUnreviewed = (fromDocId: string) => {
    const idx = filteredDocuments.findIndex((d) => d.id === fromDocId)
    const rest = filteredDocuments.slice(idx + 1)
    const next = rest.find((d) => effectiveVerdict(d) === null) ?? rest[0]
    setSelectedDocId(next?.id)
  }

  const verdictMutation = useMutation({
    mutationFn: (data: { document_id: string; verdict: SMEVerdict; corrected_markdown?: string; corrected_title?: string; comment?: string }) =>
      withMinDelay(submitSmeDocumentVerdict(versionId as string, data)),
    onSuccess: (_res, variables) => {
      setLocalVerdicts((prev) => ({ ...prev, [variables.document_id]: variables.verdict }))
      invalidateQueue()
      toast({ title: 'Verdict submitted', description: `Document marked as ${variables.verdict}.` })
      advanceToNextUnreviewed(variables.document_id)
      setIsEditing(false)
      setComment('')
    },
    onError: () => {
      toast({ title: 'Failed to submit verdict', variant: 'destructive' })
    },
  })

  const publishMutation = useMutation({
    mutationFn: (ids: string[]) => publishDocuments(ids),
    onSuccess: (res) => {
      invalidateQueue()
      setSelectedIds(new Set())
      toast({ title: 'Published', description: `${res.published} document(s) published to the shared store.` })
    },
    onError: () => {
      toast({ title: 'Failed to publish documents', variant: 'destructive' })
    },
  })

  const recallMutation = useMutation({
    mutationFn: (documentId: string) => recallDocument(documentId),
    onSuccess: (_res, documentId) => {
      setLocalVerdicts((prev) => {
        const next = { ...prev }
        delete next[documentId]
        return next
      })
      invalidateQueue()
      toast({ title: 'Recalled', description: 'Document pulled back into review — it can be edited and re-submitted.' })
    },
    onError: () => {
      toast({ title: 'Failed to recall document', variant: 'destructive' })
    },
  })

  const toggleSelected = (docId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }

  const submitVerdict = (verdict: SMEVerdict) => {
    if (!selectedDoc) return
    verdictMutation.mutate({
      document_id: selectedDoc.id,
      verdict,
      corrected_title: verdict === 'edit' ? editedTitle ?? selectedDoc.title : undefined,
      corrected_markdown: verdict === 'edit' ? editedMarkdown : undefined,
      comment: comment.trim() || undefined,
    })
  }

  if (versionsQuery.isLoading) {
    return (
      <div className="space-y-3 py-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center dark:border-border-dark">
        <ShieldCheck className="h-8 w-8 text-ink-subtle" />
        <p className="text-sm font-medium text-ink dark:text-ink-inverted">No generation runs yet</p>
        <p className="max-w-sm text-sm text-ink-muted dark:text-ink-subtle">
          Run a generation from the Generate tab to produce documents for SME review.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {versions.length > 1 ? (
            <Select value={selectedVersionId} onValueChange={setSelectedVersionId}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select version" />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {formatDateTime(v.created_at)} · {v.stats.documents} docs
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-sm text-ink-muted dark:text-ink-subtle">
              Version generated {formatDateTime(versions[0].created_at)}
            </span>
          )}
        </div>

        {summary && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{summary.total} total</Badge>
            <Badge variant="outline" className={cn('border', SME_VERDICT_STYLES.approve.badgeClass)}>
              {summary.approved} approved
            </Badge>
            <Badge variant="outline" className={cn('border', SME_VERDICT_STYLES.reject.badgeClass)}>
              {summary.rejected} rejected
            </Badge>
            <Badge variant="outline" className={cn('border', SME_VERDICT_STYLES.edit.badgeClass)}>
              {summary.edited} edited
            </Badge>
            <Badge variant="outline">{summary.pending} pending</Badge>
          </div>
        )}
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
        <TabsList>
          {FILTERS.map((f) => (
            <TabsTrigger key={f.key} value={f.key}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-md border border-accent-200 bg-accent-50 px-4 py-2.5 dark:border-accent-800 dark:bg-accent-900/20">
          <span className="text-sm font-medium text-accent-800 dark:text-accent-200">
            {selectedIds.size} document{selectedIds.size === 1 ? '' : 's'} selected
          </span>
          <Button
            size="sm"
            loading={publishMutation.isPending}
            onClick={() => publishMutation.mutate([...selectedIds])}
          >
            Publish {selectedIds.size} selected
          </Button>
        </div>
      )}

      {queueQuery.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center dark:border-border-dark">
          <p className="text-sm font-medium text-ink dark:text-ink-inverted">No documents in this version</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
          <div className="rounded-lg border border-border dark:border-border-dark">
            <ScrollArea className="h-[600px]">
              <div className="divide-y divide-border dark:divide-border-dark">
                {filteredDocuments.length === 0 && (
                  <p className="p-4 text-sm text-ink-muted dark:text-ink-subtle">No documents match this filter.</p>
                )}
                <AnimatePresence initial={false}>
                  {filteredDocuments.map((doc) => {
                    const verdict = effectiveVerdict(doc)
                    const isActive = doc.id === selectedDocId
                    const isPublished = doc.status === 'published'
                    return (
                      <motion.div
                        key={doc.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        onClick={() => setSelectedDocId(doc.id)}
                        className={cn(
                          'flex cursor-pointer items-start gap-2.5 px-3 py-3 transition-colors hover:bg-surface-subtle dark:hover:bg-surface-dark-subtle',
                          isActive && 'bg-accent-50 dark:bg-accent-900/20',
                        )}
                      >
                        {isPublished ? (
                          <div className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                          <Checkbox
                            checked={selectedIds.has(doc.id)}
                            onCheckedChange={() => toggleSelected(doc.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5"
                          />
                        )}
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="truncate text-sm font-medium text-ink dark:text-ink-inverted">{doc.title}</p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px]">
                              {doc.doc_type}
                            </Badge>
                            <AnimatePresence mode="wait" initial={false}>
                              {isPublished ? (
                                <motion.span
                                  key="published"
                                  initial={{ opacity: 0, scale: 0.9 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ duration: 0.2 }}
                                >
                                  <Badge variant="outline" className={cn('border text-[10px]', PUBLISHED_STYLE.badgeClass)}>
                                    {PUBLISHED_STYLE.label}
                                  </Badge>
                                </motion.span>
                              ) : verdict ? (
                                <motion.span
                                  key={verdict}
                                  initial={{ opacity: 0, scale: 0.9 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ duration: 0.2 }}
                                >
                                  <Badge
                                    variant="outline"
                                    className={cn('border text-[10px]', SME_VERDICT_STYLES[verdict].badgeClass)}
                                  >
                                    {SME_VERDICT_STYLES[verdict].label}
                                  </Badge>
                                </motion.span>
                              ) : (
                                <motion.span
                                  key="pending"
                                  initial={{ opacity: 0, scale: 0.9 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ duration: 0.2 }}
                                >
                                  <Badge variant="secondary" className="text-[10px]">
                                    Pending
                                  </Badge>
                                </motion.span>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            </ScrollArea>
          </div>

          <div className="rounded-lg border border-border p-5 dark:border-border-dark">
            <AnimatePresence mode="wait" initial={false}>
            {!selectedDoc ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex h-full items-center justify-center text-sm text-ink-muted dark:text-ink-subtle"
              >
                Select a document to review.
              </motion.div>
            ) : (
              <motion.div
                key={selectedDoc.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="flex h-full flex-col gap-4"
              >
                {selectedDoc.status === 'published' && (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-navy-200 bg-navy-50 px-3 py-2 dark:border-navy-700 dark:bg-navy-900/30">
                    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', PUBLISHED_STYLE.textClass)}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', PUBLISHED_STYLE.dotClass)} />
                      Published to the shared store — read-only until recalled.
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      loading={recallMutation.isPending}
                      onClick={() => recallMutation.mutate(selectedDoc.id)}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Recall to edit
                    </Button>
                  </div>
                )}

                <DocumentViewer
                  title={isEditing ? editedTitle ?? selectedDoc.title : selectedDoc.title}
                  sections={selectedDoc.sections}
                  editable={isEditing}
                  onChange={({ title, markdown }) => {
                    setEditedTitle(title)
                    setEditedMarkdown(markdown)
                  }}
                  exportMdUrl={versionId ? exportDocMarkdownUrl(versionId, selectedDoc.id) : undefined}
                  exportDocxUrl={versionId ? exportDocDocxUrl(versionId, selectedDoc.id) : undefined}
                />

                {selectedDoc.status !== 'published' && (
                  <div className="space-y-2 border-t border-border pt-4 dark:border-border-dark">
                    <Textarea
                      placeholder="Optional review comment…"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      className="min-h-[64px]"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {!isEditing ? (
                        <>
                          <Button
                            className="bg-success-600 text-white transition-transform active:scale-95 hover:bg-success-700"
                            loading={verdictMutation.isPending && verdictMutation.variables?.verdict === 'approve'}
                            disabled={verdictMutation.isPending}
                            onClick={() => submitVerdict('approve')}
                          >
                            <Check className="h-4 w-4" />
                            Approve
                          </Button>
                          <Button
                            variant="destructive"
                            className="transition-transform active:scale-95"
                            loading={verdictMutation.isPending && verdictMutation.variables?.verdict === 'reject'}
                            disabled={verdictMutation.isPending}
                            onClick={() => submitVerdict('reject')}
                          >
                            <X className="h-4 w-4" />
                            Reject
                          </Button>
                          <Button
                            variant="secondary"
                            className="transition-transform active:scale-95"
                            disabled={verdictMutation.isPending}
                            onClick={() => setIsEditing(true)}
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="secondary"
                            loading={verdictMutation.isPending}
                            onClick={() => submitVerdict('edit')}
                          >
                            <Check className="h-4 w-4" />
                            Save edit &amp; submit
                          </Button>
                          <Button variant="outline" onClick={() => setIsEditing(false)}>
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  )
}
