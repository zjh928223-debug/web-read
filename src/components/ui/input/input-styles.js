import { cva } from 'class-variance-authority'

export const inputVariants = cva(
  'rw:file:text-foreground rw:placeholder:text-muted-foreground rw:selection:bg-primary rw:selection:text-primary-foreground rw:dark:bg-input/30 rw:border-border rw:w-full rw:min-w-0 rw:rounded-md rw:border rw:bg-transparent rw:shadow-xs rw:transition-[color,box-shadow] rw:outline-none rw:file:inline-flex rw:file:h-7 rw:file:border-0 rw:file:bg-transparent rw:file:text-sm rw:file:font-medium rw:disabled:pointer-events-none rw:disabled:cursor-not-allowed rw:disabled:opacity-50 rw:focus-visible:border-ring rw:focus-visible:ring-ring/50 rw:focus-visible:ring-3 rw:aria-invalid:ring-destructive/20 rw:dark:aria-invalid:ring-destructive/40 rw:aria-invalid:border-destructive',
  {
    variants: {
      size: {
        default: 'rw:h-9 rw:px-3 rw:py-1 rw:text-base rw:md:text-sm',
        sm: 'rw:h-8 rw:px-2.5 rw:py-1 rw:text-sm',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)
