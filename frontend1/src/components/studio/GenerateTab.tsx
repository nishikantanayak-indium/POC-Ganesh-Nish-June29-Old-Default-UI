import { useCallback, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  FileStack,
  FileText,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
  generateDocuments,
  getDocOverview,
  getMeta,
  uploadSeeds,
} from '@/api/studio'
import type { DocGenKnobs, DocGenTarget, GenEvent, GenStage } from '@/types/studio'

interface GenerateTabProps {
  projectId: string
}

const STAGE_LABELS: Record<GenStage, string> = {
  queued: 'Queued',
  running: 'Generating documents',
  validating: 'Validating',
  scoring: 'Quality scoring',
  done: 'Complete',
  error: 'Failed',
}

const STAGE_PROGRESS: Record<GenStage, number> = {
  queued: 5,
  running: 40,
  validating: 70,
  scoring: 90,
  done: 100,
  error: 100,
}

let targetRowId = 0
function nextRowId() {
  targetRowId += 1
  return `row-${targetRowId}`
}

interface TargetRow {
  id: string
  doc_type: string
  count: number
  brief: string
}

function SeedUploadCard({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<File[]>([])
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return
    setFiles((prev) => [...prev, ...Array.from(incoming)])
  }, [])

  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index))

  const mutation = useMutation({
    mutationFn: () => uploadSeeds(projectId, files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studio', 'project', projectId, 'overview'] })
      queryClient.invalidateQueries({ queryKey: ['studio', 'project', projectId, 'doc-overview'] })
      toast({
        title: 'Seed documents uploaded',
        description: `${files.length} file${files.length === 1 ? '' : 's'} processed successfully.`,
        variant: 'success',
      })
      setFiles([])
    },
    onError: (err) => {
      toast({
        title: 'Could not upload seed documents',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seed Documents</CardTitle>
        <CardDescription>
          Upload representative contracts to seed the gap analysis and ground synthetic generation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragActive(false)
            addFiles(e.dataTransfer.files)
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-10 text-center transition-colors dark:border-border-dark',
            dragActive
              ? 'border-accent-400 bg-accent-50 dark:bg-accent-900/20'
              : 'hover:border-accent-300 hover:bg-surface-subtle dark:hover:bg-surface-dark-subtle',
          )}
        >
          <Upload className="h-8 w-8 text-ink-subtle" />
          <p className="text-sm font-medium text-ink dark:text-ink-inverted">
            Drag and drop seed documents, or click to browse
          </p>
          <p className="text-xs text-ink-subtle">Accepts .pdf and .docx</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
        </div>

        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${i}`}
                className="flex items-center justify-between rounded-md border border-border bg-surface-subtle px-3 py-1.5 text-sm dark:border-border-dark dark:bg-surface-dark-subtle"
              >
                <span className="flex items-center gap-2 truncate">
                  <FileText className="h-4 w-4 shrink-0 text-ink-subtle" />
                  <span className="truncate">{file.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="ml-2 shrink-0 text-ink-subtle hover:text-danger-600"
                  aria-label={`Remove ${file.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button
            disabled={files.length === 0}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <Upload className="h-4 w-4" />
            Upload Seeds
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function DocOverviewCard({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['studio', 'project', projectId, 'doc-overview'],
    queryFn: () => getDocOverview(projectId),
  })

  const docTypes = data?.doc_types ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gap Analysis</CardTitle>
        <CardDescription>Seed coverage per document type versus target counts.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-9 w-full animate-pulse rounded bg-surface-muted dark:bg-surface-dark-muted" />
            ))}
          </div>
        ) : docTypes.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <FileStack className="h-8 w-8 text-ink-subtle" />
            <p className="text-sm font-medium text-ink dark:text-ink-inverted">No seed documents yet</p>
            <p className="text-xs text-ink-subtle">
              Upload seed documents above to see coverage against target counts.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Doc Type</TableHead>
                <TableHead>Seed Count</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Gap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docTypes.map((dt) => (
                <TableRow key={dt.doc_type}>
                  <TableCell className="font-medium">{dt.doc_type}</TableCell>
                  <TableCell>{dt.seed_count}</TableCell>
                  <TableCell>{dt.threshold}</TableCell>
                  <TableCell>
                    <Badge variant={dt.deficit > 0 ? 'danger' : 'success'}>
                      {dt.deficit > 0 ? `+${dt.deficit} needed` : 'On target'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function GenerationBuilder({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: meta } = useQuery({
    queryKey: ['studio', 'meta'],
    queryFn: () => getMeta(),
  })

  const [rows, setRows] = useState<TargetRow[]>([
    { id: nextRowId(), doc_type: meta?.doc_types[0] ?? '', count: 5, brief: '' },
  ])
  const [industries, setIndustries] = useState('')
  const [languages, setLanguages] = useState('')
  const [note, setNote] = useState('')

  const [event, setEvent] = useState<GenEvent | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const addRow = () => {
    setRows((prev) => [...prev, { id: nextRowId(), doc_type: meta?.doc_types[0] ?? '', count: 5, brief: '' }])
  }

  const removeRow = (id: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev))
  }

  const updateRow = (id: string, patch: Partial<TargetRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const canGenerate =
    !isGenerating && rows.some((r) => r.doc_type.trim() && r.count > 0)

  const runGeneration = async () => {
    const targets: DocGenTarget[] = rows
      .filter((r) => r.doc_type.trim() && r.count > 0)
      .map((r) => ({
        doc_type: r.doc_type,
        count: r.count,
        brief: r.brief.trim() || undefined,
      }))

    if (targets.length === 0) return

    const knobs: DocGenKnobs = {
      industries: industries
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      languages: languages
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      note: note.trim() || undefined,
    }

    const controller = new AbortController()
    abortRef.current = controller
    setIsGenerating(true)
    setEvent({ stage: 'queued', message: 'Starting generation…', progress: 0 })

    try {
      await generateDocuments(
        projectId,
        targets,
        knobs,
        (e) => {
          setEvent(e)
          if (e.stage === 'done') {
            queryClient.invalidateQueries({ queryKey: ['studio', 'project', projectId, 'versions'] })
            queryClient.invalidateQueries({ queryKey: ['studio', 'project', projectId, 'documents'] })
            toast({
              title: 'Generation complete',
              description: 'Switch to the Review tab to send documents through SME review.',
              variant: 'success',
            })
          }
        },
        controller.signal,
      )
    } catch (err) {
      setEvent({
        stage: 'error',
        error: err instanceof Error ? err.message : 'Generation failed. Please try again.',
      })
    } finally {
      setIsGenerating(false)
      abortRef.current = null
    }
  }

  const stage = event?.stage
  const progress = stage ? (event?.progress ?? STAGE_PROGRESS[stage]) : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate Documents</CardTitle>
        <CardDescription>
          Choose document types and counts to generate, with optional briefs and knobs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="grid gap-3 rounded-md border border-border p-3 dark:border-border-dark sm:grid-cols-[2fr_1fr_auto] sm:items-start">
              <div className="space-y-1.5">
                <Label>Doc Type</Label>
                <Select value={row.doc_type} onValueChange={(v) => updateRow(row.id, { doc_type: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select doc type" />
                  </SelectTrigger>
                  <SelectContent>
                    {(meta?.doc_types ?? []).map((dt) => (
                      <SelectItem key={dt} value={dt}>
                        {dt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  value={row.brief}
                  onChange={(e) => updateRow(row.id, { brief: e.target.value })}
                  placeholder="Optional brief (scenario, party names, key clauses…)"
                  className="min-h-[60px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Count</Label>
                <Input
                  type="number"
                  min={1}
                  value={row.count}
                  onChange={(e) => updateRow(row.id, { count: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="flex justify-end sm:pt-6">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={rows.length === 1}
                  onClick={() => removeRow(row.id)}
                  aria-label="Remove target"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4" />
            Add target
          </Button>
        </div>

        <Separator />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="gen-industries">Industries (comma-separated)</Label>
            <Input
              id="gen-industries"
              value={industries}
              onChange={(e) => setIndustries(e.target.value)}
              placeholder={meta?.industries.slice(0, 3).join(', ') || 'e.g. Healthcare, Finance'}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gen-languages">Languages (comma-separated)</Label>
            <Input
              id="gen-languages"
              value={languages}
              onChange={(e) => setLanguages(e.target.value)}
              placeholder={meta?.languages.slice(0, 3).join(', ') || 'e.g. English, Spanish'}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gen-note">Additional guidance (optional)</Label>
          <Textarea
            id="gen-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Any additional guidance for the generator…"
          />
        </div>

        <div className="flex justify-end">
          <Button disabled={!canGenerate} loading={isGenerating} onClick={runGeneration}>
            Generate
          </Button>
        </div>

        <AnimatePresence>
          {event && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {event.stage === 'error' ? (
                <Card className="border-danger-200 bg-danger-50 dark:border-danger-700/40 dark:bg-danger-700/10">
                  <CardContent className="flex items-start gap-3 pt-5">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-600 dark:text-danger-400" />
                    <div>
                      <p className="text-sm font-medium text-danger-700 dark:text-danger-400">Generation failed</p>
                      <p className="mt-1 text-sm text-ink-muted">{event.error ?? 'An unknown error occurred.'}</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="space-y-3 pt-5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-ink dark:text-ink-inverted">{STAGE_LABELS[event.stage]}</span>
                      <span className="text-ink-subtle">{Math.round(progress)}%</span>
                    </div>
                    <Progress value={progress} variant={event.stage === 'done' ? 'success' : 'default'} />
                    {event.message && <p className="text-xs text-ink-subtle">{event.message}</p>}

                    {event.stage === 'done' && event.summary && (
                      <div className="flex flex-wrap gap-3 pt-1">
                        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 py-1.5 text-sm dark:border-border-dark dark:bg-surface-dark-subtle">
                          <CheckCircle2 className="h-4 w-4 text-success-600 dark:text-success-400" />
                          Generated <span className="font-semibold">{event.summary.generated}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 py-1.5 text-sm dark:border-border-dark dark:bg-surface-dark-subtle">
                          Approved <span className="font-semibold text-success-700 dark:text-success-400">{event.summary.approved}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 py-1.5 text-sm dark:border-border-dark dark:bg-surface-dark-subtle">
                          Rejected <span className="font-semibold text-danger-700 dark:text-danger-400">{event.summary.rejected}</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  )
}

export function GenerateTab({ projectId }: GenerateTabProps) {
  return (
    <div className="space-y-6">
      <SeedUploadCard projectId={projectId} />
      <DocOverviewCard projectId={projectId} />
      <GenerationBuilder projectId={projectId} />
    </div>
  )
}
