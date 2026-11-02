"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/dashboard-locale";

const TABS = [
  { href: "/dashboard/communication", label: ["Conversations", "Conversations"] },
  { href: "/dashboard/communication/templates", label: ["Modèles", "Templates"] },
  { href: "/dashboard/communication/notifications", label: ["Notifications", "Notifications"] },
] satisfies { href: string; label: [string, string] }[];

export default function CommunicationLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("Communication", "Messages")}</h1>
        <nav className="mt-3 flex gap-1 overflow-x-auto border-b border-border">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium ${
                pathname === tab.href
                  ? "border-b-2 border-primary text-text"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {t(...tab.label)}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
