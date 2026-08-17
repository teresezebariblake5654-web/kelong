import type { ReactNode } from 'react';
import { cn } from '@workstation/lib/utils';

type PageContainerProps = {
  children: ReactNode;
  className?: string;
  width?: 'default' | 'wide' | 'full';
};

export function PageContainer({ children, className, width = 'default' }: PageContainerProps) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-col gap-4',
        width === 'default' && 'max-w-6xl',
        width === 'wide' && 'max-w-7xl',
        width === 'full' && 'max-w-none',
        className,
      )}
    >
      {children}
    </div>
  );
}
