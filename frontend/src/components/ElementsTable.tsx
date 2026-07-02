import { useState, useMemo, type CSSProperties } from 'react'
import { Search, ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import type { GraphNode, ElementType } from '../types'
import { typeColor } from '../theme/domainColors'

function typePillStyle(type: string, active: boolean): CSSProperties {
  const c = typeColor(type)
  return active
    ? { color: c, background: `color-mix(in srgb, ${c} 10%, transparent)`, borderColor: c }
    : {}
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
                : 'text-muted border-border hover:text-foreground',
            )}
          >
            All ({elements.length})
          </button>
          {ELEMENT_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              style={typePillStyle(t, typeFilter === t)}
              className={clsx(
                'px-3 py-1 rounded-full text-xs font-medium transition-all border',
                typeFilter !== t && 'text-muted border-border hover:text-foreground',
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
            className="bg-transparent text-sm text-foreground placeholder-muted outline-none w-48"
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
                  <td className="font-mono text-xs text-foreground whitespace-nowrap">{e.id}</td>
                  <td>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full border" style={typePillStyle(e.type, true)}>
                      {e.type}
                    </span>
                  </td>
                  <td className="text-sm text-muted max-w-xs">
                    <span className="line-clamp-1">{e.text}</span>
                  </td>
                  <td className="text-xs text-muted font-mono">
                    <span className="block">{e.source.split(' — ')[0]}</span>
                    {e.source.split(' — ')[1] && (
                      <span className="block opacity-60 text-[10px]">{e.source.split(' — ').slice(1).join(' — ')}</span>
                    )}
                  </td>
                  <td className="font-mono text-xs text-muted text-right">
                    {((e.confidence ?? 1) * 100).toFixed(0)}%
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${e.id}-detail`} className="bg-card">
                    <td />
                    <td colSpan={5} className="py-3 px-4">
                      <p className="text-sm text-foreground leading-relaxed mb-2">{e.text}</p>
                      <div className="flex items-center gap-4 text-xs text-muted flex-wrap">
                        <span className="font-mono">doc: {e.document_id}</span>
                        <span className="font-mono">src: {e.source}</span>
                        {e.page_number != null && (
                          <span className="font-mono">page: {e.page_number}</span>
                        )}
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
      className="cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
      onClick={() => onClick(col as 'id' | 'type' | 'confidence')}
    >
      {label} {current === col ? (dir === 1 ? '↑' : '↓') : ''}
    </th>
  )
}
