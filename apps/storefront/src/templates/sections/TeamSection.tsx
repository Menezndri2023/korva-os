"use client";

import { useState } from "react";
import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";
import { SectionHeading } from "./SectionHeading";
import { useT } from "@/lib/storefront-locale";

export function TeamSection({ organization }: { organization: PublicOrganization }) {
  const t = useT();
  const team = organization.teamMembers;
  if (!team || team.length === 0) return null;

  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <SectionHeading eyebrow={t("L'équipe", "The team")} title={t("Les personnes derrière ce projet", "The people behind this")} />
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-3">
          {team.map((member) => (
            <div key={member.id} className="text-center">
              <MemberPhoto photo={member.photo} name={member.name} />
              <p className={`mt-4 font-medium ${KT.headingFont}`}>{member.name}</p>
              <p className={`text-xs font-semibold uppercase tracking-wide ${KT.accentText}`}>
                {member.role}
              </p>
              {member.bio && <p className={`mt-2 text-sm ${KT.textMuted}`}>{member.bio}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MemberPhoto({ photo, name }: { photo?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (photo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`mx-auto h-28 w-28 rounded-full border object-cover shadow-md ${KT.border}`}
      />
    );
  }
  return (
    <div
      className={`mx-auto flex h-28 w-28 items-center justify-center rounded-full text-xl font-semibold shadow-md ${KT.accentBg} ${KT.accentContrastText}`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
