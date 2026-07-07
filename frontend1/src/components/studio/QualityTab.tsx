import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'

import { cn } from '@/lib/utils'
import { truncate } from '@/lib/formatters'
import type { StudioVersion } from '@/types/studio'
import { getVersionRecords, getVersionReports, listVersions } from '@/api/studio'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface QualityTabProps {
  projectId: string
}

type StatusFilter = 'all' | 'passed' | 'flagged'

function sortVersionsDesc(versions: StudioVersion[]): StudioVersion[] {
  return [...versions].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

function realismColor(score: number): string {
  if (score >= 0.75) return 'bg-success-500'
  if (score >= 0.5) return 'bg-warning-500'
  return 'bg-danger-500'
}

export function QualityTab({ projectId }: QualityTabProps) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>(undefined)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const versionsQuery = useQuery({
    queryKey: ['studio', 'project', projectId, 'versions'],
    queryFn: () => listVersions(projectId),
  })
  const versions = useMemo(() => sortVersionsDesc(versionsQuery.data?.versions ?? []), [versionsQuery.data])

  useEffect(() => {
    if (!selectedVersionId && versions.length > 0) setSelectedVersionId(versions[0].id)
  }, [versions, selectedVersionId])

  const versionId = selectedVersionId

  const recordsQuery = useQuery({
    queryKey: ['studio', 'version', versionId, 'records'],
    queryFn: () => getVersionRecords(versionId as string),
    enabled: !!versionId,
  })
  const reportsQuery = useQuery({
    queryKey: ['studio', 'version', versionId, 'reports'],
    queryFn: () => getVersionReports(versionId as string),
    enabled: !!versionId,
  })

  const records = recordsQuery.data?.records ?? []
  const reports = reportsQuery.data?.reports ?? {}

  const rows = useMemo(() => {
    return records
      .map((record) => {
        const quality = reports[record.id]?.quality
        const passed = quality?.passed ?? true
        return { record, quality, passed }
      })
      .filter((row) => {
        if (statusFilter === 'passed') return row.passed
        if (statusFilter === 'flagged') return !row.passed
        return true
      })
  }, [records, reports, statusFilter])

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
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={selectedVersionId} onValueChange={setSelectedVersionId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select version" />
          </SelectTrigger>
          <SelectContent>
            {versions.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.id} · {v.stats.records} records
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="passed">Passed only</SelectItem>
            <SelectItem value="flagged">Flagged only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {recordsQuery.isLoading || reportsQuery.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center dark:border-border-dark">
          <p className="text-sm font-medium text-ink dark:text-ink-inverted">No records match this filter</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border dark:border-border-dark">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Text</TableHead>
                <TableHead>Realism</TableHead>
                <TableHead>Duplicate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ record, quality }) => {
                const realism = quality?.realism ?? 0
                const pct = Math.round(realism * 100)
                return (
                  <TableRow key={record.id}>
                    <TableCell>
                      <Badge variant="outline">{record.element_type}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md text-sm text-ink-muted dark:text-ink-subtle">
                      {truncate(record.text, 120)}
                    </TableCell>
                    <TableCell>
                      {quality?.realism_notes ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex w-32 cursor-default items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted dark:bg-surface-dark-muted">
                                <div
                                  className={cn('h-full rounded-full', realismColor(realism))}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs text-ink-muted dark:text-ink-subtle">{pct}%</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">{quality.realism_notes}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <div className="flex w-32 items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted dark:bg-surface-dark-muted">
                            <div className={cn('h-full rounded-full', realismColor(realism))} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-ink-muted dark:text-ink-subtle">{pct}%</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {quality?.is_duplicate ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="warning" className="cursor-default">
                              Duplicate
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            {quality.near_dup_score !== undefined
                              ? `Near-duplicate score: ${quality.near_dup_score.toFixed(2)}`
                              : 'Flagged as a possible duplicate'}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-xs text-ink-subtle">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
