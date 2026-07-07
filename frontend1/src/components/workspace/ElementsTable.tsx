import { Fragment, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronRight, ChevronsUpDown, ArrowUp, ArrowDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { truncate } from '@/lib/formatters'
import { elementStyle } from '@/lib/domain-taxonomy'
import type { ElementType, GraphNode } from '@/types/analysis'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface ElementsTableProps {
  elements: GraphNode[]
}

type SortKey = 'type' | 'id' | 'text' | 'source' | 'confidence'
type SortDirection = 'asc' | 'desc'

const TYPE_FILTER_OPTIONS: Array<{ value: 'All' | ElementType; label: string }> = [
  { value: 'All', label: 'All types' },
  { value: 'Requirement', label: 'Requirement' },
  { value: 'Clause', label: 'Clause' },
  { value: 'Risk', label: 'Risk' },
  { value: 'Mitigation', label: 'Mitigation' },
  { value: 'LD', label: 'LD' },
  { value: 'Document', label: 'Document' },
]

function compareValues(a: GraphNode, b: GraphNode, key: SortKey): number {
  switch (key) {
    case 'type':
      return a.type.localeCompare(b.type)
    case 'id':
      return a.id.localeCompare(b.id)
    case 'text':
      return a.text.localeCompare(b.text)
    case 'source':
      return (a.source ?? '').localeCompare(b.source ?? '')
    case 'confidence':
      return (a.confidence ?? -1) - (b.confidence ?? -1)
    default:
      return 0
  }
}

function formatConfidence(confidence?: number): string {
  if (confidence === undefined || confidence === null || Number.isNaN(confidence)) return '—'
  return `${Math.round(confidence * 100)}%`
}

export function ElementsTable({ elements }: ElementsTableProps) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'All' | ElementType>('All')
  const [sortKey, setSortKey] = useState<SortKey>('type')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const filteredSorted = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = elements.filter((el) => {
      if (typeFilter !== 'All' && el.type !== typeFilter) return false
      if (query && !el.text.toLowerCase().includes(query)) return false
      return true
    })
    const sorted = [...filtered].sort((a, b) => {
      const cmp = compareValues(a, b, sortKey)
      return sortDirection === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [elements, search, typeFilter, sortKey, sortDirection])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function SortHeader({ label, sortableKey }: { label: string; sortableKey: SortKey }) {
    const isActive = sortKey === sortableKey
    return (
      <button
        type="button"
        onClick={() => toggleSort(sortableKey)}
        className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink dark:text-ink-subtle dark:hover:text-ink-inverted"
      >
        {label}
        {isActive ? (
          sortDirection === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search element text…"
          className="max-w-xs"
        />
        <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as 'All' | ElementType)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            {TYPE_FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-ink-subtle">
          {filteredSorted.length} of {elements.length} elements
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border dark:border-border-dark">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>
                <SortHeader label="Type" sortableKey="type" />
              </TableHead>
              <TableHead>
                <SortHeader label="ID" sortableKey="id" />
              </TableHead>
              <TableHead>
                <SortHeader label="Text" sortableKey="text" />
              </TableHead>
              <TableHead>
                <SortHeader label="Source" sortableKey="source" />
              </TableHead>
              <TableHead className="text-right">
                <SortHeader label="Confidence" sortableKey="confidence" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-ink-muted dark:text-ink-subtle">
                  No elements match your filters.
                </TableCell>
              </TableRow>
            )}
            {filteredSorted.map((el) => {
              const style = elementStyle(el.type)
              const isExpanded = expandedIds.has(el.id)
              return (
                <Fragment key={el.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => toggleExpanded(el.id)}
                  >
                    <TableCell className="w-8">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-ink-subtle" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-ink-subtle" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('border', style.badgeClass)}>
                        {style.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-ink-muted dark:text-ink-subtle">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>{truncate(el.id, 18)}</span>
                        </TooltipTrigger>
                        <TooltipContent>{el.id}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="max-w-md text-sm text-ink dark:text-ink-inverted">
                      {truncate(el.text, 120)}
                    </TableCell>
                    <TableCell className="text-sm text-ink-muted dark:text-ink-subtle">
                      {el.source ?? '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm text-ink-muted dark:text-ink-subtle">
                      {formatConfidence(el.confidence)}
                    </TableCell>
                  </TableRow>
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="p-0">
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18, ease: 'easeInOut' }}
                            className="overflow-hidden"
                          >
                            <div className="border-t border-border bg-surface-subtle px-4 py-3 text-sm leading-relaxed text-ink dark:border-border-dark dark:bg-surface-dark-subtle dark:text-ink-inverted">
                              {el.text}
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
