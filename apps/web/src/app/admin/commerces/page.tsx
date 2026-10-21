import { redirect } from "next/navigation";

/** Renamed: the administration covers every trade, not only shops. */
export default function OldShopsRedirect() {
  redirect("/admin/entreprises");
}
