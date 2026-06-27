import { motion } from 'framer-motion'
import { Network, GitBranch, MessageSquare, Zap, ArrowRight, Database } from 'lucide-react'
import type { AppStatus } from '../types'

interface Props {
  status: AppStatus | null
  onEnter: (hasData: boolean) => void
}

const FEATURES = [
  {
    icon: <Zap size={18} className="text-indigo-400" />,
    title: 'Automated Pipeline',
    desc: 'Upload any PDF or DOCX — GPT-4o extracts typed elements and infers relationships in one click.',
  },
  {
    icon: <Network size={18} className="text-emerald-400" />,
    title: 'Knowledge Graph',
    desc: 'Force-directed Neo4j-style graph. Drag nodes, expand neighborhoods, highlight edge paths.',
  },
  {
    icon: <GitBranch size={18} className="text-amber-400" />,
    title: 'Traceability',
    desc: 'Per-requirement lineage — Clauses, Risks, Mitigations, LDs — with inter-document badges.',
  },
  {
    icon: <MessageSquare size={18} className="text-purple-400" />,
    title: 'Natural Language Q&A',
    desc: 'Ask about gaps, uncovered requirements, or risks. Answered via graph traversal + semantic search.',
  },
]

export default function LandingPage({ status, onEnter }: Props) {
  const hasData = status?.has_data ?? false

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-6 relative overflow-hidden">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(to right, #6366f1 1px, transparent 1px),
            linear-gradient(to bottom, #6366f1 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
        }}
      />

      {/* Glow blobs */}
      <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-purple-600/8 rounded-full blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 flex flex-col items-center text-center max-w-3xl w-full"
      >
        {/* Logo */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="w-16 h-16 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center mb-6 shadow-lg shadow-primary/10"
        >
          <Network size={28} className="text-primary" />
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-5xl font-bold text-white tracking-tight mb-2"
        >
          GraphRAG
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="text-lg text-muted font-mono mb-2"
        >
          Procurement Intelligence
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-slate-400 text-sm max-w-xl mb-10"
        >
          Convert RFPs, risk sheets, and contracts into a queryable knowledge graph.
          Trace coverage, surface gaps, and ask questions in plain English.
        </motion.p>

        {/* Feature grid */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4 }}
          className="grid grid-cols-2 gap-3 w-full mb-10"
        >
          {FEATURES.map(f => (
            <div
              key={f.title}
              className="flex items-start gap-3 p-4 rounded-xl bg-surface border border-border text-left"
            >
              <div className="mt-0.5 shrink-0">{f.icon}</div>
              <div>
                <p className="text-white text-sm font-semibold mb-0.5">{f.title}</p>
                <p className="text-muted text-xs leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </motion.div>

        {/* CTA buttons */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="flex flex-col items-center gap-3"
        >
          {hasData ? (
            <>
              <button
                onClick={() => onEnter(true)}
                className="flex items-center gap-2.5 px-8 py-3.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.02] active:scale-[0.99]"
              >
                <Database size={16} />
                Resume Session
                <ArrowRight size={15} />
              </button>
              <div className="flex items-center gap-3 text-xs text-muted font-mono">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  {status!.nodes} nodes
                </span>
                <span className="text-border">·</span>
                <span>{status!.edges} edges</span>
                {Object.entries(status!.type_counts ?? {})
                  .filter(([k]) => k !== 'Document')
                  .map(([k, v]) => (
                    <span key={k} className="text-border">
                      · {v} {k}
                    </span>
                  ))}
              </div>
              <button
                onClick={() => onEnter(false)}
                className="text-xs text-slate-600 hover:text-muted transition-colors"
              >
                Start fresh instead →
              </button>
            </>
          ) : (
            <button
              onClick={() => onEnter(false)}
              className="flex items-center gap-2.5 px-8 py-3.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.02] active:scale-[0.99]"
            >
              Launch App
              <ArrowRight size={15} />
            </button>
          )}
        </motion.div>

        {/* Footer hint */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-10 text-xs text-slate-700 font-mono"
        >
          Neo4j · Qdrant · GPT-4o · React Flow
        </motion.p>
      </motion.div>
    </div>
  )
}
