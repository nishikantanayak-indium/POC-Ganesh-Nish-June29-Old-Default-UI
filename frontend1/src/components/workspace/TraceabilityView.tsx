import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FileText, GitCompareArrows, Inbox } from 'lucide-react'

import { cn } from '@/lib/utils'
import { truncate } from '@/lib/formatters'
import { coverageStyle, elementStyle } from '@/lib/domain-taxonomy'
import { getChain, getCoverage } from '@/api/traceability'
import type { ChainElement, CoverageResult } from '@/types/analysis'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface TraceabilityViewProps {
  workspaceId: string
}

function CoverageScoreBar({ results }: { results: CoverageResult[] }) {
  const total = results.length
  const covered = results.filter((r) => r.status === 'Covered').length
  const partial = results.filter((r) => r.status === 'Partially Covered').length
  const notCovered = results.filter((r) => r.status === 'Not Covered').length

  if (total === 0) return null

  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-ink dark:text-ink-inverted">Coverage score</span>
        <span className="text-ink-subtle">{covered} / {total} covered</span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-muted dark:bg-surface-dark-muted">
        <div className={coverageStyle('Covered').dotClass} style={{ width: `${pct(covered)}%` }} />
        <div className={coverageStyle('Partially Covered').dotClass} style={{ width: `${pct(partial)}%` }} />
        <div className={coverageStyle('Not Covered').dotClass} style={{ width: `${pct(notCovered)}%` }} />
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-ink-subtle">
        <span className="inline-flex items-center gap-1">
          <span className={cn('h-2 w-2 rounded-full', coverageStyle('Covered').dotClass)} />
          Covered ({covered})
        </span>
        <span className="inline-flex items-center gap-1">
          <span className={cn('h-2 w-2 rounded-full', coverageStyle('Partially Covered').dotClass)} />
          Partial ({partial})
        </span>
        <span className="inline-flex items-center gap-1">
          <span className={cn('h-2 w-2 rounded-full', coverageStyle('Not Covered').dotClass)} />
          Not covered ({notCovered})
        </span>
      </div>
    </div>
  )
}

function ChainElementCard({ element }: { element: ChainElement }) {
  const style = elementStyle(element.type)
  return (
    <Card className="border-border/80">
      <CardContent className="space-y-1.5 p-3">
        <div className="flex items-center justify-between gap-1.5">
          <Badge className={cn('text-[10px]', style.badgeClass)} variant="outline">
            {style.label}
          </Badge>
          {element.is_inter_document && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-accent-600 dark:text-accent-400">
              <GitCompareArrows className="h-3 w-3" />
              Inter-doc
            </span>
          )}
        </div>
        <p className="text-xs leading-relaxed text-ink dark:text-ink-inverted">{truncate(element.text, 140)}</p>
        {element.source && (
          <p className="flex items-center gap-1 text-[11px] text-ink-subtle">
            <FileText className="h-3 w-3" />
            {element.source}
            {element.page_number !== undefined ? ` · p.${element.page_number}` : ''}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function KanbanColumn({ title, elements }: { title: string; elements: ChainElement[] }) {
  return (
    <div className="flex min-w-[220px] flex-1 flex-col rounded-md border border-border bg-surface-subtle dark:border-border-dark dark:bg-surface-dark">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 dark:border-border-dark">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted dark:text-ink-subtle">
          {title}
        </span>
        <Badge variant="secondary" className="text-[10px]">
          {elements.length}
        </Badge>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2" style={{ maxHeight: '32rem' }}>
        {elements.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-ink-subtle">None</p>
        ) : (
          elements.map((el, i) => <ChainElementCard key={`${el.id}-${i}`} element={el} />)
        )}
      </div>
    </div>
  )
}

export function TraceabilityView({ workspaceId }: TraceabilityViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const coverageQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'coverage'],
    queryFn: () => getCoverage(workspaceId),
    enabled: !!workspaceId,
  })

  const results = coverageQuery.data?.results ?? []

  useEffect(() => {
    if (!selectedId && results.length > 0) {
      setSelectedId(results[0].requirement_id)
    }
  }, [results, selectedId])

  const selected = useMemo(
    () => results.find((r) => r.requirement_id === selectedId) ?? null,
    [results, selectedId]
  )

  const chainQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'chain', selectedId],
    queryFn: () => getChain(workspaceId, selectedId!),
    enabled: !!workspaceId && !!selectedId,
  })

  const chain = chainQuery.data

  const clauses = useMemo(
    () => [...(chain?.full_coverage ?? []), ...(chain?.partial_coverage ?? [])],
    [chain]
  )

  if (coverageQuery.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center dark:border-border-dark">
        <Inbox className="h-8 w-8 text-ink-subtle" />
        <p className="text-sm font-medium text-ink dark:text-ink-inverted">No coverage data yet</p>
        <p className="max-w-sm text-sm text-ink-subtle">
          Ingest documents for this workspace to generate requirement coverage and traceability chains.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
      <div className="space-y-3">
        <Card>
          <CardContent className="p-4">
            <CoverageScoreBar results={results} />
          </CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Requirements ({results.length})</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[36rem] space-y-1 overflow-y-auto pt-0">
            {results.map((r) => {
              const style = coverageStyle(r.status)
              const active = r.requirement_id === selectedId
              return (
                <button
                  key={r.requirement_id}
                  type="button"
                  onClick={() => setSelectedId(r.requirement_id)}
                  className={cn(
                    'flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    active
                      ? 'border-navy-300 bg-navy-50 dark:border-navy-700 dark:bg-navy-900/40'
                      : 'border-transparent hover:bg-surface-muted dark:hover:bg-surface-dark-muted'
                  )}
                >
                  <span className="line-clamp-2 text-ink dark:text-ink-inverted">
                    {truncate(r.requirement_text, 110)}
                  </span>
                  <Badge className={cn('w-fit text-[10px]', style.badgeClass)} variant="outline">
                    {style.label}
                  </Badge>
                </button>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {!selected ? (
          <p className="text-sm text-ink-subtle">Select a requirement to view its traceability chain.</p>
        ) : (
          <>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-ink dark:text-ink-inverted">{selected.requirement_text}</p>
                <Badge className={cn('mt-2', coverageStyle(selected.status).badgeClass)} variant="outline">
                  {coverageStyle(selected.status).label}
                </Badge>
              </CardContent>
            </Card>

            {chainQuery.isLoading ? (
              <Skeleton className="h-96 w-full" />
            ) : (
              <>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  <KanbanColumn title="Clauses" elements={clauses} />
                  <KanbanColumn title="Risks" elements={chain?.risks ?? []} />
                  <KanbanColumn title="Mitigations" elements={chain?.mitigations ?? []} />
                  <KanbanColumn title="LDs" elements={chain?.lds ?? []} />
                </div>

                {chain && chain.gaps.length > 0 && (
                  <Card className="border-danger-200 bg-danger-50 dark:border-danger-700/40 dark:bg-danger-700/10">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm text-danger-700 dark:text-danger-400">
                        <AlertTriangle className="h-4 w-4" />
                        Gaps
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <ul className="list-disc space-y-1 pl-5 text-sm text-danger-700 dark:text-danger-400">
                        {chain.gaps.map((gap, i) => (
                          <li key={i}>{gap}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
