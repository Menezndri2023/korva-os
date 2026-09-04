import type { HTMLAttributes } from "react";
import { cn } from "../cn.ts";

export type CardProps = HTMLAttributes<HTMLDivElement>;

// Encapsulates only what's actually invariant across the 27 "card-like" containers found in
// apps/web (F2-B.3 audit): rounded-lg + border-zinc-200 + bg-white, now via tokens. Padding is
// deliberately NOT included here — it varies by usage (p-3 / p-4 / p-6 / none for table
// wrappers that use overflow-hidden instead) with no dominant default, so it stays the
// caller's responsibility via className, exactly as it is today. No CardHeader/CardContent/
// CardFooter either: no single, repeated, cross-file structural sub-pattern was found strong
// enough to justify them (see F2-B.3 report §2).
export function Card({ className, children, ...props }: CardProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface shadow-sm", className)} {...props}>
      {children}
    </div>
  );
}
