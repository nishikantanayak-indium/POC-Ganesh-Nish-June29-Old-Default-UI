import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileStack,
  FileText,
  Link2,
  Loader2,
  Plus,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  validateGeneration,
} from '@/api/studio'
import type { DocGenKnobs, DocGenTarget, GenEvent, GenStage } from '@/types/studio'

interface GenerateTabProps {
  projectId: string
}

// Coarse stage tracker — mirrors the visual convention already established in
// workspace/PipelineProgress.tsx (chip row, colored by status), with Studio's
// own stage set instead of the Analysis pipeline's parse/extract/graph/vector.
const STAGE_TRACKER: { id: GenStage; label: string }[] = [
  { id: 'queued', label: 'Queued' },
  { id: 'generate', label: 'Generate' },
  { id: 'validate', label: 'Validate' },
  { id: 'persist', label: 'Persist' },
  { id: 'done', label: 'Done' },
]

function stageRank(stage: GenStage | undefined): number {
  const idx = STAGE_TRACKER.findIndex((s) => s.id === (stage === 'complete' ? 'done' : stage))
  return idx === -1 ? 0 : idx
}

interface TimedEvent {
  time: string
  event: GenEvent
}

function nowStamp() {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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

function DocumentUploadCard({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<File[]>([])
  const [fileTypes, setFileTypes] = useState<string[]>([])
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: meta } = useQuery({
    queryKey: ['studio', 'meta'],
    queryFn: () => getMeta(),
  })
  const docTypeOptions = meta?.doc_types ?? []

  const addFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming) return
      const added = Array.from(incoming)
      setFiles((prev) => [...prev, ...added])
      setFileTypes((prev) => [...prev, ...added.map(() => docTypeOptions[0] ?? '')])
    },
    [docTypeOptions],
  )

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
    setFileTypes((prev) => prev.filter((_, i) => i !== index))
  }

  const updateFileType = (index: number, docType: string) => {
    setFileTypes((prev) => prev.map((t, i) => (i === index ? docType : t)))
  }

  const mutation = useMutation({
    mutationFn: () => uploadSeeds(projectId, files, fileTypes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studio', 'project', projectId, 'overview'] })
      queryClient.invalidateQueries({ queryKey: ['studio', 'project', projectId, 'doc-overview'] })
      toast({
        title: 'Documents uploaded',
        description: `${files.length} file${files.length === 1 ? '' : 's'} processed successfully.`,
        variant: 'success',
      })
      setFiles([])
      setFileTypes([])
    },
    onError: (err) => {
      toast({
        title: 'Could not upload documents',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <CardDescription>
          Upload representative contracts to ground the gap analysis and synthetic generation.
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
            Drag and drop documents, or click to browse
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
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle px-3 py-1.5 text-sm dark:border-border-dark dark:bg-surface-dark-subtle"
              >
                <span className="flex min-w-0 items-center gap-2 truncate">
                  <FileText className="h-4 w-4 shrink-0 text-ink-subtle" />
                  <span className="truncate">{file.name}</span>
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <Select value={fileTypes[i] ?? ''} onValueChange={(v) => updateFileType(i, v)}>
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue placeholder="Doc type" />
                    </SelectTrigger>
                    <SelectContent>
                      {docTypeOptions.map((dt) => (
                        <SelectItem key={dt} value={dt}>
                          {dt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="text-ink-subtle hover:text-danger-600"
                    aria-label={`Remove ${file.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
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
            Upload Documents
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
        <CardDescription>Document coverage per type versus target counts.</CardDescription>
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
            <p className="text-sm font-medium text-ink dark:text-ink-inverted">No documents yet</p>
            <p className="text-xs text-ink-subtle">
              Upload documents above to see coverage against target counts.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Doc Type</TableHead>
                <TableHead>Document Count</TableHead>
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

  const [mode, setMode] = useState<'independent' | 'linked'>('independent')
  const [dealCount, setDealCount] = useState(1)
  const [rows, setRows] = useState<TargetRow[]>([
    { id: nextRowId(), doc_type: meta?.doc_types[0] ?? '', count: 5, brief: '' },
  ])
  const [industries, setIndustries] = useState('')
  const [languages, setLanguages] = useState('')
  const [note, setNote] = useState('')
  const [lengthMode, setLengthMode] = useState<'compact' | 'extended'>('extended')
  const [geography, setGeography] = useState('')
  const [compliances, setCompliances] = useState('')

  const [events, setEvents] = useState<TimedEvent[]>([])
  const [logOpen, setLogOpen] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [conflict, setConflict] = useState<{
    status: 'ui_conflict' | 'system_conflict' | 'domain_conflict' | 'security_conflict'
    conflict_field: string
    message: string
  } | null>(null)
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [isCheckingConflict, setIsCheckingConflict] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (logOpen) logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [events, logOpen])

  const lastEvent = events.length > 0 ? events[events.length - 1].event : null

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
    !isGenerating &&
    (mode === 'linked' ? dealCount > 0 : rows.some((r) => r.doc_type.trim() && r.count > 0))

  const runGeneration = async (targets: DocGenTarget[], knobs: DocGenKnobs, validationOverride = false) => {
    const controller = new AbortController()
    abortRef.current = controller
    setIsGenerating(true)
    setLogOpen(true)
    setEvents([{ time: nowStamp(), event: { stage: 'queued', message: 'Starting generation…' } }])

    try {
      await generateDocuments(
        projectId,
        targets,
        knobs,
        (e) => {
          setEvents((prev) => [...prev, { time: nowStamp(), event: e }])
          if (e.stage === 'done') {
            queryClient.invalidateQueries({ queryKey: ['studio', 'project', projectId, 'versions'] })
            queryClient.invalidateQueries({ queryKey: ['studio', 'project', projectId, 'documents'] })
            toast({
              title: 'Generation complete',
              description: 'See how each document scored in Validation, then approve in Review.',
              variant: 'success',
            })
          }
        },
        controller.signal,
        validationOverride,
      )
    } catch (err) {
      setEvents((prev) => [
        ...prev,
        {
          time: nowStamp(),
          event: {
            stage: 'error',
            error: err instanceof Error ? err.message : 'Generation failed. Please try again.',
          },
        },
      ])
    } finally {
      setIsGenerating(false)
      abortRef.current = null
    }
  }

  const getPayload = useCallback((): { targets: DocGenTarget[]; knobs: DocGenKnobs } | null => {
    const targets: DocGenTarget[] =
      mode === 'linked'
        ? []
        : rows
            .filter((r) => r.doc_type.trim() && r.count > 0)
            .map((r) => ({
              doc_type: r.doc_type,
              count: r.count,
              brief: r.brief.trim() || undefined,
            }))

    if (mode === 'independent' && targets.length === 0) return null
    if (mode === 'linked' && dealCount <= 0) return null

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
      mode,
      ...(mode === 'linked' ? { deal_count: dealCount } : {}),
      length_mode: lengthMode,
      geography: geography.trim() || undefined,
      compliances: compliances
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }

    return { targets, knobs }
  }, [mode, rows, dealCount, industries, languages, note, lengthMode, geography, compliances])

  const handleGenerateClick = async () => {
    const payload = getPayload()
    if (!payload) return

    const { targets, knobs } = payload

    setIsCheckingConflict(true)
    try {
      const res = await validateGeneration(projectId, targets, knobs)
      if (res.status === 'ok') {
        runGeneration(targets, knobs)
      } else {
        setConflict({
          status: res.status,
          conflict_field: res.conflict_field,
          message: res.message,
        })
        setShowConflictModal(true)
      }
    } catch (err) {
      console.error("Conflict pre-check failed:", err)
      setConflict({
        status: 'system_conflict',
        conflict_field: 'compliance',
        message: 'Safety and compliance checks could not be completed. Generating documents directly might bypass safety or privacy controls. Would you like to proceed anyway?'
      })
      setShowConflictModal(true)
    } finally {
      setIsCheckingConflict(false)
    }
  }

  const stage = lastEvent?.stage
  const progress =
    lastEvent?.current !== undefined && lastEvent?.total
      ? Math.round((lastEvent.current / lastEvent.total) * 100)
      : stage === 'done' || stage === 'complete'
        ? 100
        : stage === 'queued'
          ? 5
          : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate Documents</CardTitle>
        <CardDescription>
          Choose document types and counts to generate, with optional briefs and knobs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'independent' | 'linked')}>
          <TabsList>
            <TabsTrigger value="independent">Independent documents</TabsTrigger>
            <TabsTrigger value="linked">
              <Link2 className="mr-1.5 h-3.5 w-3.5" />
              Linked deal set
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === 'linked' ? (
          <div className="space-y-3 rounded-md border border-border p-4 dark:border-border-dark">
            <p className="text-sm text-ink-muted dark:text-ink-subtle">
              Each deal generates one RFP, one Contract that responds to it, and one Risk Sheet analyzing
              the Contract — sharing concrete facts across the three so they genuinely link together when
              imported into a workspace (with a deliberate minority of requirements/risks left uncovered,
              for realistic gaps).
            </p>
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="deal-count">Number of deals to generate</Label>
              <Input
                id="deal-count"
                type="number"
                min={1}
                value={dealCount}
                onChange={(e) => setDealCount(Number(e.target.value) || 0)}
              />
            </div>
          </div>
        ) : (
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
        )}

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
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="gen-length-mode">Document length</Label>
            <select
              id="gen-length-mode"
              value={lengthMode}
              onChange={(e) => setLengthMode(e.target.value as 'compact' | 'extended')}
              className="flex h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-950 dark:border-zinc-800"
            >
              <option value="extended" className="dark:bg-zinc-950">Extended (9–15 pages)</option>
              <option value="compact" className="dark:bg-zinc-950">Compact (3–5 pages)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gen-geography">Target geography / Country (optional)</Label>
            <Input
              id="gen-geography"
              value={geography}
              onChange={(e) => setGeography(e.target.value)}
              placeholder="e.g. US, EU, Global"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gen-compliances">Target compliances (comma-separated)</Label>
            <Input
              id="gen-compliances"
              value={compliances}
              onChange={(e) => setCompliances(e.target.value)}
              placeholder="e.g. HIPAA, GDPR, SOC2"
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
          <Button disabled={!canGenerate || isCheckingConflict} loading={isGenerating || isCheckingConflict} onClick={handleGenerateClick}>
            Generate
          </Button>
        </div>

        <AnimatePresence>
          {events.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {stage === 'error' ? (
                <Card className="border-danger-200 bg-danger-50 dark:border-danger-700/40 dark:bg-danger-700/10">
                  <CardContent className="flex items-start gap-3 pt-5">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-600 dark:text-danger-400" />
                    <div>
                      <p className="text-sm font-medium text-danger-700 dark:text-danger-400">Generation failed</p>
                      <p className="mt-1 text-sm text-ink-muted">{lastEvent?.error ?? 'An unknown error occurred.'}</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="space-y-4 pt-5">
                    <StageTracker current={stage} />

                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="font-medium text-ink dark:text-ink-inverted">
                          {lastEvent?.message ?? 'Working…'}
                        </span>
                        <span className="text-ink-subtle">{progress}%</span>
                      </div>
                      <Progress value={progress} variant={stage === 'done' ? 'success' : 'default'} />
                    </div>

                    {lastEvent?.stage === 'done' && lastEvent.summary && (
                      <div className="flex flex-wrap gap-3 pt-1">
                        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 py-1.5 text-sm dark:border-border-dark dark:bg-surface-dark-subtle">
                          <CheckCircle2 className="h-4 w-4 text-success-600 dark:text-success-400" />
                          Requested <span className="font-semibold">{lastEvent.summary.requested}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 py-1.5 text-sm dark:border-border-dark dark:bg-surface-dark-subtle">
                          Generated <span className="font-semibold text-success-700 dark:text-success-400">{lastEvent.summary.generated}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 py-1.5 text-sm dark:border-border-dark dark:bg-surface-dark-subtle">
                          Staged <span className="font-semibold">{lastEvent.summary.staged}</span>
                        </div>
                      </div>
                    )}

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
                            transition={{ duration: 0.15 }}
                            className="mt-2 overflow-hidden"
                          >
                            <ScrollArea className="h-48 rounded-md border border-border bg-slate-950 dark:border-border-dark">
                              <div className="p-3 font-mono text-xs leading-relaxed text-slate-300">
                                {events.map((e, i) => (
                                  <div
                                    key={i}
                                    className={cn(e.event.stage === 'error' && 'text-danger-400')}
                                  >
                                    <span className="text-slate-500">[{e.time}]</span>{' '}
                                    {e.event.message ?? e.event.error ?? e.event.stage}
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
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>

      <Dialog open={showConflictModal} onOpenChange={setShowConflictModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className={cn("h-5 w-5", conflict?.status === 'security_conflict' ? "text-danger-600 dark:text-danger-400" : "text-amber-500")} />
              {conflict?.status === 'ui_conflict'
                ? 'Configuration Clash'
                : conflict?.status === 'domain_conflict'
                  ? 'Invalid Domain Content'
                  : conflict?.status === 'security_conflict'
                    ? 'Security Exception'
                    : 'Compliance Warning'}
            </DialogTitle>
            <DialogDescription className="pt-2 text-ink dark:text-ink-inverted">
              {conflict?.message}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4">
            {conflict?.status === 'ui_conflict' || conflict?.status === 'domain_conflict' || conflict?.status === 'security_conflict' ? (
              <Button onClick={() => setShowConflictModal(false)}>
                Go Back & Edit
              </Button>
            ) : (
              <div className="flex w-full justify-end gap-2">
                <Button variant="outline" onClick={() => setShowConflictModal(false)}>
                  Cancel
                </Button>
                <Button
                  variant="default"
                  className="bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-700 dark:hover:bg-amber-800"
                  onClick={() => {
                    setShowConflictModal(false)
                    const payload = getPayload()
                    if (payload) {
                      runGeneration(payload.targets, payload.knobs, true)
                    }
                  }}
                >
                  Proceed Anyway
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

const STAGE_TRACKER_ICONS: Record<GenStage, LucideIcon> = {
  queued: Loader2,
  generate: FileText,
  validate: CheckCircle2,
  persist: FileStack,
  complete: Check,
  done: Check,
  error: AlertTriangle,
}

function StageTracker({ current }: { current: GenStage | undefined }) {
  const rank = stageRank(current)
  return (
    <div className="flex items-stretch">
      {STAGE_TRACKER.map((s, i) => {
        const Icon = STAGE_TRACKER_ICONS[s.id]
        const isDone = i < rank || current === 'done' || current === 'complete'
        const isActive = i === rank && current !== 'done' && current !== 'complete'
        const isLast = i === STAGE_TRACKER.length - 1
        return (
          <div key={s.id} className="flex flex-1 items-center">
            <div
              className={cn(
                'flex min-w-[80px] flex-1 flex-col items-center gap-1 rounded-md border px-2 py-1.5 text-center transition-colors',
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

export function GenerateTab({ projectId }: GenerateTabProps) {
  return (
    <div className="space-y-6">
      <DocumentUploadCard projectId={projectId} />
      <DocOverviewCard projectId={projectId} />
      <GenerationBuilder projectId={projectId} />
    </div>
  )
}
