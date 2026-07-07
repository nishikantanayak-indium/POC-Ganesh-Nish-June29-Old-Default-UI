import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <svg
        width="26"
        height="26"
        viewBox="0 0 26 26"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect x="1" y="1" width="24" height="24" rx="6" className="fill-slate-800 dark:fill-slate-700" />
        <path
          d="M17 9.8C16.2 8.6 14.9 8 13.3 8C10.4 8 8.2 10.2 8.2 13C8.2 15.8 10.4 18 13.3 18C14.9 18 16.2 17.4 17 16.2L15.3 15C14.8 15.7 14.1 16.1 13.3 16.1C11.7 16.1 10.4 14.8 10.4 13C10.4 11.2 11.7 9.9 13.3 9.9C14.1 9.9 14.8 10.3 15.3 11L17 9.8Z"
          className="fill-white"
        />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-ink dark:text-white">
        Contract<span className="text-accent-600 dark:text-accent-400">IQ</span>
      </span>
    </div>
  )
}
