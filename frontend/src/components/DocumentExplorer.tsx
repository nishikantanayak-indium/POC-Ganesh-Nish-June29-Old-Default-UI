import { useState, useMemo } from 'react'
import { FileText, ChevronRight, Table2, ScanText, AlignLeft } from 'lucide-react'
import clsx from 'clsx'
import type { DocumentContent, PageContent, ExtractedTable } from '../types'

type ViewMode = 'text' | 'ocr' | 'tables'

const VIEW_MODES: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'text',   label: 'Text',     icon: <AlignLeft size={11} /> },
  { id: 'ocr',    label: 'OCR Text', icon: <ScanText  size={11} /> },
  { id: 'tables', label: 'Tables',   icon: <Table2    size={11} /> },
]

interface Props {
  documents: DocumentContent[]
  loading: boolean
}

export default function DocumentExplorer({ documents, loading }: Props) {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('text')

  const selectedDoc = useMemo(
    () => (documents.find(d => d.id === selectedDocId) ?? documents[0]) ?? null,
    [documents, selectedDocId],
  )

  // ── Empty / loading states ────────────────────────────────────────────────

  if (loading && !documents.length) {
    return (
      <Sidebar>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-muted">Loading…</span>
        </div>
      </Sidebar>
    )
  }

  if (!documents.length) {
    return (
      <Sidebar>
        <div className="flex-1 flex items-center justify-center px-5">
          <p className="text-xs text-muted text-center leading-relaxed">
            Ingest documents to explore extracted content
          </p>
        </div>
      </Sidebar>
    )
  }

  // ── Derived stats for current document ───────────────────────────────────

  const hasOcr    = selectedDoc?.page_contents.some(p => p.ocr_text.length > 0) ?? false
  const tableCount = selectedDoc?.page_contents.reduce((n, p) => n + p.tables.length, 0) ?? 0

  return (
    <Sidebar>
      {/* Document list */}
      <div className="shrink-0 border-b border-border">
        <p className="px-4 pt-3 pb-1.5 text-[10px] font-semibold text-muted uppercase tracking-wider">
          Documents
        </p>
        <div className="px-2 pb-2 space-y-0.5">
          {documents.map(doc => {
            const active = selectedDoc?.id === doc.id
            return (
              <button
                key={doc.id}
                onClick={() => setSelectedDocId(doc.id)}
                className={clsx(
                  'w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-start gap-2',
                  active
                    ? 'bg-primary/15 text-foreground'
                    : 'text-muted hover:bg-card hover:text-foreground',
                )}
              >
                <FileText size={12} className="mt-0.5 shrink-0 opacity-70" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{doc.name}</div>
                  <div className="flex items-center gap-1 mt-0.5 opacity-60 text-[10px] font-mono">
                    <span>{doc.type}</span>
                    <span>·</span>
                    <span>{doc.total_pages}p</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* View mode toggle */}
      <div className="shrink-0 px-3 py-2 border-b border-border flex gap-1">
        {VIEW_MODES.map(m => (
          <button
            key={m.id}
            onClick={() => setViewMode(m.id)}
            title={
              m.id === 'ocr'    ? (hasOcr    ? undefined : 'No OCR pages in this document') :
              m.id === 'tables' ? (tableCount > 0 ? `${tableCount} table(s) found` : 'No tables found') :
              undefined
            }
            className={clsx(
              'flex-1 flex items-center justify-center gap-1 py-1 px-1.5 rounded text-[11px] font-medium transition-all',
              viewMode === m.id
                ? 'bg-primary/20 text-primary'
                : 'text-muted hover:text-foreground hover:bg-card',
            )}
          >
            {m.icon}
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        ))}
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-y-auto">
        {selectedDoc ? (
          <DocContent doc={selectedDoc} viewMode={viewMode} hasOcr={hasOcr} tableCount={tableCount} />
        ) : (
          <div className="flex items-center justify-center p-4">
            <p className="text-xs text-muted">Select a document above</p>
          </div>
        )}
      </div>
    </Sidebar>
  )
}

// ── Sidebar shell ──────────────────────────────────────────────────────────

function Sidebar({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-72 shrink-0 border-r border-border flex flex-col h-full bg-surface overflow-hidden">
      {children}
    </div>
  )
}

// ── Document content renderer ──────────────────────────────────────────────

function DocContent({
  doc, viewMode, hasOcr, tableCount,
}: {
  doc: DocumentContent
  viewMode: ViewMode
  hasOcr: boolean
  tableCount: number
}) {
  if (!doc.page_contents.length) {
    return (
      <EmptyNote>
        No extracted content available.{'\n'}Re-ingest this document to populate.
      </EmptyNote>
    )
  }

  if (viewMode === 'ocr' && !hasOcr) {
    return (
      <EmptyNote>
        This document was processed natively — no OCR pages
      </EmptyNote>
    )
  }

  if (viewMode === 'tables' && tableCount === 0) {
    return <EmptyNote>No tables found in this document</EmptyNote>
  }

  const pages = viewMode === 'tables'
    ? doc.page_contents.filter(p => p.tables.length > 0)
    : doc.page_contents

  return (
    <div className="divide-y divide-border">
      {pages.map(page => (
        <PageSection key={page.page_num} page={page} viewMode={viewMode} />
      ))}
    </div>
  )
}

// ── Per-page collapsible section ───────────────────────────────────────────

function PageSection({ page, viewMode }: { page: PageContent; viewMode: ViewMode }) {
  const [expanded, setExpanded] = useState(false)

  const text =
    viewMode === 'text' ? page.native_text :
    viewMode === 'ocr'  ? page.ocr_text    : null

  const hasContent =
    viewMode === 'tables'
      ? page.tables.length > 0
      : (text?.length ?? 0) > 0

  const meta =
    viewMode === 'tables' ? `${page.tables.length} table${page.tables.length !== 1 ? 's' : ''}` :
    viewMode === 'ocr'    ? (page.ocr_text ? 'OCR' : '—') :
    page.native_text      ? `${page.native_text.length} chars` : '—'

  return (
    <div>
      <button
        onClick={() => setExpanded(x => !x)}
        className={clsx(
          'w-full flex items-center gap-2 px-4 py-2 text-xs transition-colors',
          hasContent
            ? 'text-muted hover:text-foreground hover:bg-card/50 cursor-pointer'
            : 'text-border cursor-default',
        )}
        disabled={!hasContent}
      >
        <ChevronRight
          size={10}
          className={clsx(
            'transition-transform shrink-0',
            expanded && hasContent && 'rotate-90',
            !hasContent && 'opacity-30',
          )}
        />
        <span className="font-mono font-medium">Page {page.page_num}</span>
        <span className="ml-auto text-[10px] font-mono opacity-50">{meta}</span>
      </button>

      {expanded && hasContent && (
        <div className="px-4 pb-4 pt-1">
          {viewMode === 'tables' ? (
            <div className="space-y-4">
              {page.tables.map((table, ti) => (
                <TableView key={ti} table={table} index={ti + 1} />
              ))}
            </div>
          ) : (
            <TextBlock
              text={text ?? ''}
              empty={
                viewMode === 'ocr'
                  ? 'Native text page — no OCR was run'
                  : 'No native text (scanned page)'
              }
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Text block ─────────────────────────────────────────────────────────────

function TextBlock({ text, empty }: { text: string; empty: string }) {
  if (!text) {
    return <p className="text-[11px] text-muted italic">{empty}</p>
  }
  return (
    <pre className="text-[11px] text-foreground/80 whitespace-pre-wrap break-words leading-relaxed font-sans">
      {text}
    </pre>
  )
}

// ── Table renderer ─────────────────────────────────────────────────────────

function TableView({ table, index }: { table: ExtractedTable; index: number }) {
  const colCount = table.headers.length || (table.rows[0]?.length ?? 0)

  return (
    <div>
      <p className="text-[10px] text-muted font-mono mb-1.5">
        Table {index} — page {table.page} — {table.rows.length} row{table.rows.length !== 1 ? 's' : ''}
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-[11px] border-collapse">
          {table.headers.length > 0 && (
            <thead>
              <tr className="bg-card">
                {table.headers.map((h, i) => (
                  <th
                    key={i}
                    className="px-2.5 py-1.5 text-left text-muted font-semibold border-b border-border whitespace-nowrap"
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
                        className="px-2.5 py-1.5 text-foreground/80 align-top max-w-[200px] break-words"
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
                  colSpan={colCount || 1}
                  className="px-2.5 py-2 text-center text-muted italic"
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

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center p-6">
      <p className="text-xs text-muted text-center leading-relaxed whitespace-pre-line">
        {children}
      </p>
    </div>
  )
}
