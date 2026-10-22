import { cva } from 'class-variance-authority'

export const buttonVariants = cva(
  'rw:inline-flex rw:items-center rw:justify-center rw:gap-2 rw:whitespace-nowrap rw:rounded-md rw:text-sm rw:font-medium rw:transition-all rw:disabled:pointer-events-none rw:disabled:opacity-50 rw:[&_svg]:pointer-events-none rw:[&_svg:not([class*="size-"])]:size-4 rw:shrink-0 rw:[&_svg]:shrink-0 rw:outline-none rw:focus-visible:border-ring rw:focus-visible:ring-ring/50 rw:focus-visible:ring-3 rw:aria-invalid:ring-destructive/20 rw:dark:aria-invalid:ring-destructive/40 rw:aria-invalid:border-destructive',
  {
    variants: {
      variant: {
        default: 'rw:bg-primary rw:text-primary-foreground rw:hover:bg-primary/90',
        destructive:
          'rw:bg-destructive rw:text-white rw:hover:bg-destructive/90 rw:focus-visible:ring-destructive/20 rw:dark:focus-visible:ring-destructive/40 rw:dark:bg-destructive/60',
        outline:
          'rw:border rw:bg-background rw:shadow-xs rw:hover:bg-accent rw:hover:text-accent-foreground rw:dark:bg-input/30 rw:dark:border-input rw:dark:hover:bg-input/50',
        secondary:
          'rw:bg-secondary rw:text-secondary-foreground rw:hover:bg-secondary/80',
        ghost:
          'rw:hover:bg-accent rw:hover:text-accent-foreground rw:dark:hover:bg-accent/50',
        link: 'rw:text-primary rw:underline-offset-4 rw:hover:underline',
      },
      size: {
        default: 'rw:h-9 rw:px-4 rw:py-2 rw:has-[>svg]:px-3',
        xs: 'rw:h-6 rw:gap-1 rw:rounded-md rw:px-2 rw:text-xs rw:has-[>svg]:px-1.5 rw:[&_svg:not([class*="size-"])]:size-3',
        sm: 'rw:h-8 rw:rounded-md rw:gap-1.5 rw:px-3 rw:has-[>svg]:px-2.5',
        lg: 'rw:h-10 rw:px-6 rw:has-[>svg]:px-4',
        icon: 'rw:size-9',
        'icon-xs': 'rw:size-6 rw:rounded-md rw:[&_svg:not([class*="size-"])]:size-3',
        'icon-sm': 'rw:size-8',
        'icon-lg': 'rw:size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)
