import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/lib/theme-provider";

/** Every page under test uses React Query — this is the one bit of setup shared by all of
 * them, kept here instead of duplicated in each Lot U test file. ThemeProvider is included
 * too: any component under dashboard/ (starting with DashboardLayout itself) can call
 * useTheme() for the header's dark/light toggle, and jsdom has no real <html> attribute state
 * of its own to fall back on the way the real app's no-flash script provides in the browser. */
export function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </ThemeProvider>,
  );
}
