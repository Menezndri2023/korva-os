import { notFound } from "next/navigation";

// Any /dashboard/* path with no matching page lands here. Without this catch-all, Next.js
// would skip the dashboard/layout.tsx shell entirely for an unmatched path and fall through to
// the root not-found.tsx instead — this keeps the sidebar/header around the 404 message.
export default function DashboardCatchAll() {
  notFound();
}
