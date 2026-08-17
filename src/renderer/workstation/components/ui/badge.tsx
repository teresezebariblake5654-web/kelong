import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@workstation/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-border bg-muted text-muted-foreground',
        success: 'border-transparent bg-[hsl(var(--success)/0.12)] text-success',
        warning: 'border-transparent bg-[hsl(var(--warning)/0.12)] text-warning',
        danger: 'border-transparent bg-[hsl(var(--destructive)/0.12)] text-destructive',
        outline: 'border-border text-foreground',
      },
    },
    defaultVariants: {
      variant: 'secondary',
    },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
