import { redirect } from "next/navigation";

/** Moved into the KORVA administration. */
export default function PlatformActivationRedirect() {
  redirect("/admin/commerces");
}
