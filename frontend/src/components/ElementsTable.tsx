import { useState, useMemo } from 'react'
import { Search, ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import type { GraphNode, ElementType } from '../types'

const TYPE_COLORS: Record<ElementType, string> = {
  Requirement: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/30',
  Clause:      'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  Risk:        'text-red-400 bg-red-400/10 border-red-400/30',
  Mitigation:  'text-amber-400 bg-amber-400/10 border-amber-400/30',
  LD:          'text-purple-400 bg-purple-400/10 border-purple-400/30',
  Document:    'text-slate-400 bg-slate-400/10 border-slate-400/30',
}

const ELEMENT_TYPES: ElementType[] = ['Requirement', 'Clause', 'Risk', 'Mitigation', 'LD']

interface Props {
  elements: GraphNode[]
}

export default function ElementsTable({ elements }: Props) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<ElementType | 'All'>('All')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sortCol, setSortCol] = useState<'id' | 'type' | 'confidence'>('id')
  const [sortDir, setSortDir] = useState<1 | -1>(1)

  const filtered = useMemo(() => {
    let rows = elements
    if (typeFilter !== 'All') rows = rows.filter(e => e.type === typeFilter)
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(e =>
        e.id.toLowerCase().includes(q) ||
        e.text.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q),
      )
    }
    rows = [...rows].sort((a, b) => {
      const av = sortCol === 'confidence' ? (a.confidence ?? 1) : a[sortCol]
      const bv = sortCol === 'confidence' ? (b.confidence ?? 1) : b[sortCol]
      return String(av).localeCompare(String(bv)) * sortDir
    })
    return rows
  }, [elements, typeFilter, search, sortCol, sortDir])

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {}
    elements.forEach(e => { c[e.type] = (c[e.type] ?? 0) + 1 })
    return c
  }, [elements])

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => (d === 1 ? -1 : 1))
    else { setSortCol(col); setSortDir(1) }
  }

  if (elements.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted text-sm">No elements — run the pipeline first.</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface shrink-0 flex-wrap">
        {/* Type filter pills */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setTypeFilter('All')}
            className={clsx(
              'px-3 py-1 rounded-full text-xs font-medium transition-all border',
              typeFilter === 'All'
                ? 'bg-primary/20 text-primary border-primary/40'
                : 'text-muted border-border hover:text-white',
            )}
          >
            All ({elements.length})
          </button>
          {ELEMENT_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={clsx(
                'px-3 py-1 rounded-full text-xs font-medium transition-all border',
                typeFilter === t
                  ? `${TYPE_COLORS[t]} border-current`
                  : 'text-muted border-border hover:text-white',
              )}
            >
              {t.slice(0, 3)} {typeCounts[t] ? `(${typeCounts[t]})` : ''}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="ml-auto flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5">
          <Search size={13} className="text-muted" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search elements…"
            className="bg-transparent text-sm text-white placeholder-muted outline-none w-48"
          />
        </div>

        <span className="text-xs text-muted font-mono">{filtered.length} rows</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="data-table w-full">
          <thead>
            <tr>
              <th className="w-8" />
              <SortTh col="id" label="ID" current={sortCol} dir={sortDir} onClick={handleSort} />
              <th>Type</th>
              <th>Text</th>
              <th>Source</th>
              <SortTh col="confidence" label="Conf" current={sortCol} dir={sortDir} onClick={handleSort} />
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => {
              const isOpen = expanded.has(e.id)
              return [
                <tr key={e.id} onClick={() => toggleExpand(e.id)} className="cursor-pointer">
                  <td className="text-center">
                    {isOpen ? <ChevronDown size={12} className="text-muted mx-auto" /> : <ChevronRight size={12} className="text-muted mx-auto" />}
                  </td>
                  <td className="font-mono text-xs text-white whitespace-nowrap">{e.id}</td>
                  <td>
                    <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border', TYPE_COLORS[e.type])}>
                      {e.type}
                    </span>
                  </td>
                  <td className="text-sm text-muted max-w-xs">
                    <span className="line-clamp-1">{e.text}</span>
                  </td>
                  <td className="text-xs text-muted font-mono whitespace-nowrap">{e.source}</td>
                  <td className="font-mono text-xs text-muted text-right">
                    {((e.confidence ?? 1) * 100).toFixed(0)}%
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${e.id}-detail`} className="bg-card">
                    <td />
                    <td colSpan={5} className="py-3 px-4">
                      <p className="text-sm text-white leading-relaxed mb-2">{e.text}</p>
                      <div className="flex items-center gap-4 text-xs text-muted">
                        <span className="font-mono">doc: {e.document_id}</span>
                        <span className="font-mono">src: {e.source}</span>
                        <span className="font-mono">conf: {((e.confidence ?? 1) * 100).toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortTh({ col, label, current, dir, onClick }: {
  col: string; label: string; current: string; dir: 1 | -1
  onClick: (c: 'id' | 'type' | 'confidence') => void
}) {
  return (
    <th
      className="cursor-pointer select-none hover:text-white transition-colors whitespace-nowrap"
      onClick={() => onClick(col as 'id' | 'type' | 'confidence')}
    >
      {label} {current === col ? (dir === 1 ? '↑' : '↓') : ''}
    </th>
  )
}
