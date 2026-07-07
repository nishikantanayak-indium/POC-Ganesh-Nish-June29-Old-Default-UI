import type { ExtractedTable } from '@/types/analysis'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface TableBlockProps {
  table: ExtractedTable
}

export function TableBlock({ table }: TableBlockProps) {
  const columnCount = table.headers.length

  return (
    <div className="overflow-hidden rounded-lg border border-border dark:border-border-dark">
      <div className="border-b border-border bg-surface-subtle px-3 py-1.5 text-xs font-medium text-ink-muted dark:border-border-dark dark:bg-surface-dark-subtle dark:text-ink-subtle">
        Page {table.page}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {table.headers.map((header, idx) => (
              <TableHead key={idx}>{header || `Column ${idx + 1}`}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={Math.max(columnCount, 1)} className="py-6 text-center text-sm text-ink-muted dark:text-ink-subtle">
                No rows in this table.
              </TableCell>
            </TableRow>
          )}
          {table.rows.map((row, rowIdx) => (
            <TableRow key={rowIdx}>
              {Array.from({ length: columnCount }).map((_, cellIdx) => (
                <TableCell key={cellIdx} className="text-sm text-ink dark:text-ink-inverted">
                  {row[cellIdx] ?? ''}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
