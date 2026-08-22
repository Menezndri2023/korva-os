"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { useAuthBootstrap } from "@/lib/use-auth-bootstrap";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }));

  useAuthBootstrap();

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
