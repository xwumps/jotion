'use client';

import type { MeDto } from '@jotion/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '../ui/tooltip';

const MeContext = createContext<MeDto | null>(null);

export function useMe(): MeDto {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe außerhalb von AppProviders');
  return me;
}

export function AppProviders({ me, children }: { me: MeDto; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (count, err) => count < 2 && (err as { status?: number }).status !== 404,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <MeContext.Provider value={me}>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster
          position="bottom-center"
          toastOptions={{ className: '!bg-bg-elevated !text-fg !border-border !text-[14px]' }}
        />
      </MeContext.Provider>
    </QueryClientProvider>
  );
}
