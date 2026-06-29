import { useState, useMemo } from 'react'
import { FileText, AlignLeft, ScanText, Table2, Zap } from 'lucide-react'
import clsx from 'clsx'
import ElementsTable from './ElementsTable'
import type { DocumentContent, PageContent, ExtractedTable, GraphNode } from '../types'

type SourceMode = 'text' | 'ocr' | 'tables'
type ViewMode   = SourceMode | 'elements'

interface Props {
  elements: GraphNode[]
  documents: DocumentContent[]
  loading: boolean
}

export default function ElementsView({ elements, documents, loading }: Props) {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [mode, setMode]                   = useState<ViewMode>('elements')
  const [selectedPage, setSelectedPage]   = useState<number | null>(null)

  const selectedDoc = useMemo(
    () => (selectedDocId ? documents.find(d => d.id === selectedDocId) : null) ?? documents[0] ?? null,
    [documents, selectedDocId],
  )

  const pages = selectedDoc?.page_contents ?? []

  function switchMode(m: ViewMode) {
    setMode(m)
    if (m === 'elements') setSelectedPage(null)
  }

  function selectDoc(id: string) {
    setSelectedDocId(id)
    setSelectedPage(null)
  }

  return (
    <div className="h-full flex overflow-hidden">

      {/* ── Left rail: document selector only ─────────────────────── */}
      <aside className="w-52 shrink-0 border-r border-border flex flex-col bg-surface overflow-hidden">
        <p className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-wider border-b border-border shrink-0">
          Documents
        </p>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {loading && !documents.length && (
            <p className="text-xs text-muted text-center py-6">Loading…</p>
          )}
          {!loading && !documents.length && (
            <p className="text-xs text-muted text-center py-6 leading-relaxed">
              Ingest documents to explore content
            </p>
          )}
          {documents.map(doc => {
            const active = selectedDoc?.id === doc.id
            return (
              <button
                key={doc.id}
                onClick={() => selectDoc(doc.id)}
                className={clsx(
                  'w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-start gap-2',
                  active
                    ? 'bg-primary/15 text-foreground'
                    : 'text-muted hover:bg-card hover:text-foreground',
                )}
              >
                <FileText size={12} className="mt-0.5 shrink-0 opacity-60" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{doc.name}</div>
                  <div className="text-[10px] font-mono opacity-50 mt-0.5">
                    {doc.type} · {doc.total_pages}p
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {/* ── Right area: mode bar + content ────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* Mode bar */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-surface flex-wrap min-h-[40px]">

          {/* Source mode buttons */}
          <ModeBtn icon={<AlignLeft size={11} />} label="Text"   active={mode === 'text'}   onClick={() => switchMode('text')} />
          <ModeBtn icon={<ScanText  size={11} />} label="OCR"    active={mode === 'ocr'}    onClick={() => switchMode('ocr')} />
          <ModeBtn icon={<Table2    size={11} />} label="Tables" active={mode === 'tables'} onClick={() => switchMode('tables')} />

          <div className="w-px h-4 bg-border" />

          {/* Elements button */}
          <ModeBtn
            icon={<Zap size={11} />}
            label={elements.length ? `Elements · ${elements.length}` : 'Elements'}
            active={mode === 'elements'}
            onClick={() => switchMode('elements')}
          />

          {/* Page chips — source modes only, when a doc with content is selected */}
          {mode !== 'elements' && pages.length > 0 && (
            <>
              <div className="w-px h-4 bg-border" />
              <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
                <PageChip label="All" active={selectedPage === null} onClick={() => setSelectedPage(null)} />
                {pages.map(pc => (
                  <PageChip
                    key={pc.page_num}
                    label={`${pc.page_num}`}
                    active={selectedPage === pc.page_num}
                    hasTables={pc.tables.length > 0}
                    hasOcr={pc.ocr_text.length > 0}
                    mode={mode}
                    onClick={() => setSelectedPage(pc.page_num)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {mode === 'elements' ? (
            <ElementsTable elements={elements} />
          ) : (
            <SourceContent doc={selectedDoc} mode={mode} selectedPage={selectedPage} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Mode button ────────────────────────────────────────────────────────────

function ModeBtn({
  icon, label, active, onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all shrink-0',
        active
          ? 'bg-primary/20 text-primary'
          : 'text-muted hover:text-foreground hover:bg-card',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// ── Page chip ──────────────────────────────────────────────────────────────

function PageChip({
  label, active, hasTables, hasOcr, mode, onClick,
}: {
  label: string
  active: boolean
  hasTables?: boolean
  hasOcr?: boolean
  mode?: ViewMode
  onClick: () => void
}) {
  const dotVisible =
    (mode === 'tables' && hasTables) ||
    (mode === 'ocr'    && hasOcr)

  return (
    <button
      onClick={onClick}
      className={clsx(
        'relative shrink-0 px-2 py-0.5 rounded text-xs font-mono transition-colors',
        active
          ? 'bg-primary/20 text-primary'
          : 'text-muted hover:text-foreground hover:bg-card',
      )}
    >
      {label}
      {dotVisible && !active && (
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-amber-400 rounded-full" />
      )}
    </button>
  )
}

// ── Source content dispatcher ──────────────────────────────────────────────

function SourceContent({
  doc, mode, selectedPage,
}: {
  doc: DocumentContent | null
  mode: SourceMode
  selectedPage: number | null
}) {
  if (!doc) {
    return <EmptyState>Select a document from the left panel</EmptyState>
  }
  if (!doc.page_contents.length) {
    return (
      <EmptyState>
        No extracted content available.{'\n'}Re-ingest this document to populate.
      </EmptyState>
    )
  }

  const visiblePages = selectedPage !== null
    ? doc.page_contents.filter(p => p.page_num === selectedPage)
    : doc.page_contents

  if (mode === 'text') {
    return <TextView pages={visiblePages} />
  }
  if (mode === 'ocr') {
    return <OcrView pages={visiblePages} allOcr={doc.page_contents.some(p => p.ocr_text.length > 0)} />
  }
  return <TablesView pages={visiblePages} selectedPage={selectedPage} />
}

// ── Text view ──────────────────────────────────────────────────────────────

function TextView({ pages }: { pages: PageContent[] }) {
  const withText = pages.filter(p => p.native_text.trim().length > 0)
  if (!withText.length) {
    return <EmptyState>No native text — this may be a fully scanned document</EmptyState>
  }
  return (
    <div className="max-w-4xl mx-auto px-8 py-6 space-y-8">
      {withText.map(p => (
        <PageBlock key={p.page_num} pageNum={p.page_num}>
          <pre className="text-sm text-foreground/85 whitespace-pre-wrap break-words leading-relaxed font-sans">
            {p.native_text}
          </pre>
        </PageBlock>
      ))}
    </div>
  )
}

// ── OCR view ───────────────────────────────────────────────────────────────

function OcrView({ pages, allOcr }: { pages: PageContent[]; allOcr: boolean }) {
  if (!allOcr) {
    return <EmptyState>This document was processed natively — no OCR pages</EmptyState>
  }
  const ocrPages = pages.filter(p => p.ocr_text.trim().length > 0)
  if (!ocrPages.length) {
    return <EmptyState>No OCR text for the selected page(s)</EmptyState>
  }
  return (
    <div className="max-w-4xl mx-auto px-8 py-6 space-y-8">
      {ocrPages.map(p => (
        <PageBlock key={p.page_num} pageNum={p.page_num} badge="OCR">
          <pre className="text-sm text-foreground/85 whitespace-pre-wrap break-words leading-relaxed font-sans">
            {p.ocr_text}
          </pre>
        </PageBlock>
      ))}
    </div>
  )
}

// ── Tables view ────────────────────────────────────────────────────────────

function TablesView({
  pages, selectedPage,
}: {
  pages: PageContent[]
  selectedPage: number | null
}) {
  const pagesWithTables = pages.filter(p => p.tables.length > 0)
  if (!pagesWithTables.length) {
    return (
      <EmptyState>
        {selectedPage !== null
          ? `No tables on page ${selectedPage}`
          : 'No tables found in this document — use the amber dots to find pages with tables'}
      </EmptyState>
    )
  }
  return (
    <div className="px-8 py-6 space-y-10">
      {pagesWithTables.map(p => (
        <PageBlock
          key={p.page_num}
          pageNum={p.page_num}
          badge={`${p.tables.length} table${p.tables.length !== 1 ? 's' : ''}`}
        >
          <div className="space-y-8">
            {p.tables.map((t, ti) => (
              <TableBlock key={ti} table={t} index={ti + 1} />
            ))}
          </div>
        </PageBlock>
      ))}
    </div>
  )
}

// ── Page section header ────────────────────────────────────────────────────

function PageBlock({
  pageNum, badge, children,
}: {
  pageNum: number
  badge?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-mono font-semibold text-muted">Page {pageNum}</span>
        {badge && (
          <span className="text-[10px] text-muted opacity-60 font-mono">{badge}</span>
        )}
        <div className="flex-1 h-px bg-border" />
      </div>
      {children}
    </section>
  )
}

// ── Table renderer ─────────────────────────────────────────────────────────

function TableBlock({ table, index }: { table: ExtractedTable; index: number }) {
  const colCount = Math.max(
    table.headers.length,
    ...table.rows.map(r => r.length),
    1,
  )
  const hasHeaders = table.headers.some(h => h.trim().length > 0)

  return (
    <div>
      <p className="text-[11px] text-muted font-mono mb-2">
        Table {index}
        {table.rows.length > 0 && ` · ${table.rows.length} row${table.rows.length !== 1 ? 's' : ''}`}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm border-collapse">
          {hasHeaders && (
            <thead>
              <tr className="bg-card">
                {table.headers.map((h, i) => (
                  <th
                    key={i}
                    className="px-4 py-2.5 text-left text-xs font-semibold text-muted border-b border-border align-top whitespace-pre-wrap min-w-[120px]"
                  >
                    {h || `Col ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-border">
            {table.rows.length > 0 ? (
              table.rows.map((row, ri) => {
                const padded = [...row, ...Array(Math.max(0, colCount - row.length)).fill('')]
                return (
                  <tr key={ri} className="hover:bg-card/40 transition-colors">
                    {padded.slice(0, colCount).map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-4 py-2.5 text-sm text-foreground/80 align-top whitespace-pre-wrap"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                )
              })
            ) : (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-4 py-3 text-center text-xs text-muted italic"
                >
                  No data rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Shared empty state ─────────────────────────────────────────────────────

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <p className="text-sm text-muted text-center leading-relaxed whitespace-pre-line max-w-xs">
        {children}
      </p>
    </div>
  )
}
