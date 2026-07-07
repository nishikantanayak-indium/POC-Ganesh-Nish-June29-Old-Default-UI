import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Download, Check } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { SyntheticDocSection } from '@/types/studio'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

interface DocumentViewerProps {
  title: string
  sections: SyntheticDocSection[]
  editable?: boolean
  onChange?: (data: { title: string; markdown: string }) => void
  exportMdUrl?: string
  exportDocxUrl?: string
}

function sectionsToMarkdown(title: string, sections: SyntheticDocSection[]): string {
  const body = sections.map((s) => `## ${s.heading}\n\n${s.body}\n`).join('\n')
  return `# ${title}\n\n${body}`
}

export function DocumentViewer({
  title,
  sections,
  editable = false,
  onChange,
  exportMdUrl,
  exportDocxUrl,
}: DocumentViewerProps) {
  const [copied, setCopied] = useState(false)
  const initialMarkdown = useMemo(() => sectionsToMarkdown(title, sections), [title, sections])
  const [markdown, setMarkdown] = useState(initialMarkdown)

  const fullMarkdown = editable ? markdown : initialMarkdown

  const handleTitleChange = (newTitle: string) => {
    // Rewrite just the first heading line to keep body edits intact.
    const rest = markdown.replace(/^#\s.*\n/, '')
    const next = `# ${newTitle}\n${rest}`
    setMarkdown(next)
    onChange?.({ title: newTitle, markdown: next })
  }

  const handleMarkdownChange = (value: string) => {
    setMarkdown(value)
    const firstLine = value.match(/^#\s(.*)$/m)
    onChange?.({ title: firstLine ? firstLine[1].trim() : title, markdown: value })
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullMarkdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — silently ignore
    }
  }

  const derivedTitle = editable ? markdown.match(/^#\s(.*)$/m)?.[1]?.trim() ?? title : title

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {editable ? (
          <Input
            value={derivedTitle}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="max-w-lg text-base font-semibold"
          />
        ) : (
          <h2 className="text-lg font-semibold tracking-tight text-ink dark:text-white">{title}</h2>
        )}
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy markdown'}
          </Button>
          {exportMdUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={exportMdUrl} download>
                <Download className="h-3.5 w-3.5" />
                .md
              </a>
            </Button>
          )}
          {exportDocxUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={exportDocxUrl} download>
                <Download className="h-3.5 w-3.5" />
                .docx
              </a>
            </Button>
          )}
        </div>
      </div>

      {editable ? (
        <Textarea
          value={markdown}
          onChange={(e) => handleMarkdownChange(e.target.value)}
          className="min-h-[420px] flex-1 font-mono text-[13px] leading-relaxed"
          spellCheck={false}
        />
      ) : (
        <div className="flex-1 space-y-6 overflow-y-auto">
          {sections.length === 0 && (
            <p className="text-sm text-ink-subtle dark:text-ink-subtle">This document has no sections.</p>
          )}
          {sections.map((section, idx) => (
            <div key={`${section.heading}-${idx}`} className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted dark:text-ink-subtle">
                {section.heading}
              </h3>
              <div
                className={cn(
                  'prose-sm max-w-none text-[14px] leading-relaxed text-ink dark:text-ink-inverted',
                  '[&_p]:mb-3 [&_p]:leading-relaxed',
                  '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold',
                  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold',
                  '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold',
                  '[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1',
                  '[&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1',
                  '[&_li]:leading-relaxed',
                  '[&_strong]:font-semibold',
                  '[&_a]:text-accent-600 [&_a]:underline dark:[&_a]:text-accent-400',
                  '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic dark:[&_blockquote]:border-border-dark',
                  '[&_code]:rounded [&_code]:bg-surface-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] dark:[&_code]:bg-surface-dark-muted',
                  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm',
                  '[&_thead]:bg-surface-muted dark:[&_thead]:bg-surface-dark-muted',
                  '[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold dark:[&_th]:border-border-dark',
                  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 dark:[&_td]:border-border-dark',
                )}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
