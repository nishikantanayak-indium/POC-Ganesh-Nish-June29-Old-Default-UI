import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileWarning, ShieldCheck } from 'lucide-react'

import { truncate } from '@/lib/formatters'
import type { StudioVersion } from '@/types/studio'
import { getVersionRecords, getVersionReports, listVersions } from '@/api/studio'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface ValidateTabProps {
  projectId: string
}

type StatusFilter = 'all' | 'valid' | 'failed'

function sortVersionsDesc(versions: StudioVersion[]): StudioVersion[] {
  return [...versions].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

export function ValidateTab({ projectId }: ValidateTabProps) {
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
        const validation = reports[record.id]?.validation
        const passed = validation?.passed ?? true
        return { record, validation, passed }
      })
      .filter((row) => {
        if (statusFilter === 'valid') return row.passed
        if (statusFilter === 'failed') return !row.passed
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
            <SelectItem value="valid">Valid only</SelectItem>
            <SelectItem value="failed">Failed only</SelectItem>
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
                <TableHead>Label</TableHead>
                <TableHead>Text</TableHead>
                <TableHead>Doc type</TableHead>
                <TableHead>Validation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ record, validation, passed }) => (
                <TableRow key={record.id}>
                  <TableCell>
                    <Badge variant="outline">{record.element_type}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{record.label}</TableCell>
                  <TableCell className="max-w-md text-sm text-ink-muted dark:text-ink-subtle">
                    {truncate(record.text, 120)}
                  </TableCell>
                  <TableCell className="text-sm">{record.doc_type}</TableCell>
                  <TableCell>
                    {passed ? (
                      <Badge variant="success">Valid</Badge>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="danger" className="inline-flex cursor-default items-center gap-1">
                            <FileWarning className="h-3 w-3" />
                            Failed
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          {validation?.reasons && validation.reasons.length > 0 ? (
                            <ul className="list-disc space-y-0.5 pl-3">
                              {validation.reasons.map((reason, idx) => (
                                <li key={idx}>{reason}</li>
                              ))}
                            </ul>
                          ) : (
                            'No reasons provided'
                          )}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
