import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ChevronDown, ChevronUp, Link2, ShieldCheck } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatDateTime, truncate } from '@/lib/formatters'
import { VALIDATION_SCORE_STYLES, validationScoreStyle, validationVerdictStyle } from '@/lib/domain-taxonomy'
import { getVersionDocuments, listVersions } from '@/api/studio'
import type { StudioVersion, SyntheticDocumentT, ValidationDimension, ValidationEvidence, ValidationReport } from '@/types/studio'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

interface ValidationTabProps {
  projectId: string
}

type DimensionKey = keyof ValidationReport['dimensions']

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  structural_fidelity: 'Structural Fidelity',
  instruction_adherence: 'Instruction Adherence',
  deal_consistency: 'Deal Consistency',
  realism: 'Realism',
}

const NOT_APPLICABLE_REASON: Record<DimensionKey, string> = {
  structural_fidelity: 'No uploaded document was used as a structural template for this document.',
  instruction_adherence: 'No brief or note was provided for this document.',
  deal_consistency: 'Not part of a linked deal.',
  realism: 'Not scored.',
}

const DIMENSION_KEYS = Object.keys(DIMENSION_LABELS) as DimensionKey[]

function sortVersionsDesc(versions: StudioVersion[]): StudioVersion[] {
  return [...versions].sort((a, b) => {
    const ta = Date.parse(a.created_at)
    const tb = Date.parse(b.created_at)
    if (Number.isNaN(ta) || Number.isNaN(tb)) return 0
    return tb - ta
  })
}

function getValidation(doc: SyntheticDocumentT): ValidationReport | undefined {
  return doc.provenance?.validation as ValidationReport | undefined
}

function EvidenceRow({ item }: { item: ValidationEvidence }) {
  const [showFull, setShowFull] = useState(false)
  const style = validationVerdictStyle(item.verdict)
  const isLong = item.quote.length > 160

  return (
    <div className="space-y-1 rounded-md border border-border p-2.5 dark:border-border-dark">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-ink dark:text-ink-inverted">{item.aspect}</p>
        <Badge className={cn(style.badgeClass, 'shrink-0')} variant="outline">
          {style.label}
        </Badge>
      </div>
      {item.quote ? (
        <>
          <blockquote className="border-l-2 border-border pl-2 text-xs italic text-ink-muted dark:border-border-dark dark:text-ink-subtle">
            "{showFull ? item.quote : truncate(item.quote, 160)}"
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
        <p className="text-xs text-ink-subtle">No supporting text found in the document.</p>
      )}
    </div>
  )
}

function DimensionCard({ dimKey, dim }: { dimKey: DimensionKey; dim: ValidationDimension }) {
  if (!dim.applicable) {
    return (
      <div className="rounded-md border border-border bg-surface-subtle p-3 text-xs text-ink-subtle dark:border-border-dark dark:bg-surface-dark-subtle">
        <span className="font-medium text-ink-muted dark:text-ink-subtle">{DIMENSION_LABELS[dimKey]}</span>
        {' — not applicable. '}
        {NOT_APPLICABLE_REASON[dimKey]}
      </div>
    )
  }
  const score = dim.score ?? 0
  const style = validationScoreStyle(score)
  const pct = Math.round(score * 100)

  return (
    <Card className="border-border/80">
      <CardContent className="space-y-2.5 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink dark:text-ink-inverted">{DIMENSION_LABELS[dimKey]}</span>
          <Badge className={style.badgeClass} variant="outline">
            {pct}%
          </Badge>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted dark:bg-surface-dark-muted">
          <div className={cn('h-full rounded-full', style.dotClass)} style={{ width: `${pct}%` }} />
        </div>
        {dim.summary && <p className="text-xs text-ink-muted dark:text-ink-subtle">{dim.summary}</p>}
        {dim.evidence && dim.evidence.length > 0 && (
          <div className="space-y-2 pt-1">
            {dim.evidence.map((e, i) => (
              <EvidenceRow key={i} item={e} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DocumentValidationRow({ doc }: { doc: SyntheticDocumentT }) {
  const [open, setOpen] = useState(false)
  const report = getValidation(doc)
  const overallStyle = validationScoreStyle(report?.overall_score ?? null)
  const dealId = typeof doc.provenance?.deal_id === 'string' ? (doc.provenance.deal_id as string) : undefined

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink dark:text-ink-inverted">{doc.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{doc.doc_type}</Badge>
            {dealId && (
              <Badge variant="outline">
                <Link2 className="mr-1 h-3 w-3" />
                Deal {dealId.slice(-4)}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {report?.error ? (
            <Badge variant="danger">Validation failed</Badge>
          ) : report ? (
            <Badge className={overallStyle.badgeClass} variant="outline">
              {report.overall_score !== null ? `${Math.round(report.overall_score * 100)}%` : 'N/A'}
            </Badge>
          ) : (
            <Badge variant="outline">Not validated</Badge>
          )}
          {open ? (
            <ChevronUp className="h-4 w-4 text-ink-subtle" />
          ) : (
            <ChevronDown className="h-4 w-4 text-ink-subtle" />
          )}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <CardContent className="space-y-3 border-t border-border pt-4 dark:border-border-dark">
              {report?.error ? (
                <div className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-700/40 dark:bg-danger-700/10 dark:text-danger-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Validation failed: {report.error}</span>
                </div>
              ) : report ? (
                DIMENSION_KEYS.map((key) => <DimensionCard key={key} dimKey={key} dim={report.dimensions[key]} />)
              ) : (
                <p className="text-sm text-ink-subtle">This document hasn't been validated yet.</p>
              )}
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

function useValidationSummary(documents: SyntheticDocumentT[]) {
  return useMemo(() => {
    const reports = documents.map(getValidation).filter((r): r is ValidationReport => !!r && !r.error)
    const scored = reports.filter((r) => r.overall_score !== null)
    const avg =
      scored.length > 0 ? scored.reduce((s, r) => s + (r.overall_score ?? 0), 0) / scored.length : null
    const tiers = { high: 0, medium: 0, low: 0 }
    for (const r of scored) {
      const s = r.overall_score ?? 0
      const tier = s >= 0.75 ? 'high' : s >= 0.5 ? 'medium' : 'low'
      tiers[tier]++
    }
    const dimCounts: Partial<Record<DimensionKey, number>> = {}
    for (const r of reports) {
      for (const key of DIMENSION_KEYS) {
        if (r.dimensions[key]?.applicable) dimCounts[key] = (dimCounts[key] ?? 0) + 1
      }
    }
    return { avg, tiers, dimCounts, total: documents.length, validated: reports.length }
  }, [documents])
}

export function ValidationTab({ projectId }: ValidationTabProps) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>(undefined)

  const versionsQuery = useQuery({
    queryKey: ['studio', 'project', projectId, 'versions'],
    queryFn: () => listVersions(projectId),
  })
  const versions = useMemo(() => sortVersionsDesc(versionsQuery.data?.versions ?? []), [versionsQuery.data])

  useEffect(() => {
    if (!selectedVersionId && versions.length > 0) setSelectedVersionId(versions[0].id)
  }, [versions, selectedVersionId])

  const versionId = selectedVersionId
  const docsQuery = useQuery({
    queryKey: ['studio', 'version', versionId, 'documents'],
    queryFn: () => getVersionDocuments(versionId as string),
    enabled: !!versionId,
  })
  const documents = docsQuery.data?.documents ?? []
  const summary = useValidationSummary(documents)

  if (versionsQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />
  }

  if (versions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <ShieldCheck className="h-8 w-8 text-ink-subtle" />
          <p className="text-sm font-medium text-ink dark:text-ink-inverted">No versions yet</p>
          <p className="text-xs text-ink-subtle">
            Generate documents first — validation runs automatically as part of generation.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Select value={versionId} onValueChange={setSelectedVersionId}>
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Validation Summary</CardTitle>
          <CardDescription>
            {summary.validated} of {summary.total} document(s) validated
            {summary.avg !== null && ` — average overall score ${Math.round(summary.avg * 100)}%`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-0">
          <Badge className={VALIDATION_SCORE_STYLES.high.badgeClass} variant="outline">
            {summary.tiers.high} high
          </Badge>
          <Badge className={VALIDATION_SCORE_STYLES.medium.badgeClass} variant="outline">
            {summary.tiers.medium} medium
          </Badge>
          <Badge className={VALIDATION_SCORE_STYLES.low.badgeClass} variant="outline">
            {summary.tiers.low} low
          </Badge>
          {DIMENSION_KEYS.map((key) => (
            <Badge key={key} variant="secondary">
              {summary.dimCounts[key] ?? 0} of {summary.total} checked for {DIMENSION_LABELS[key]}
            </Badge>
          ))}
        </CardContent>
      </Card>

      {docsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <p className="text-sm text-ink-subtle">No documents in this version.</p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <DocumentValidationRow key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  )
}
