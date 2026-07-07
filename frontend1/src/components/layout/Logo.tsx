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
        <rect x="1" y="1" width="24" height="24" rx="6" className="fill-navy-800 dark:fill-navy-700" />
        <path
          d="M8 17.5V8.5H13.2C15 8.5 16.2 9.6 16.2 11.2C16.2 12.5 15.4 13.4 14.2 13.7L16.5 17.5H14.3L12.3 14H10V17.5H8ZM10 12.2H13C13.9 12.2 14.4 11.8 14.4 11.1C14.4 10.4 13.9 10 13 10H10V12.2Z"
          className="fill-white"
        />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-ink dark:text-white">
        Contract<span className="text-accent-600 dark:text-accent-400">IQ</span>
      </span>
    </div>
  )
}
