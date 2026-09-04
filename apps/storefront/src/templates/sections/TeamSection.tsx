"use client";

import { useState } from "react";
import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";

export function TeamSection({ organization }: { organization: PublicOrganization }) {
  const team = organization.teamMembers;
  if (!team || team.length === 0) return null;

  return (
    <section className="px-6 py-14">
      <div className="mx-auto max-w-5xl">
        <h2 className={`text-xl font-semibold ${KT.headingFont}`}>Notre équipe</h2>
        <div className="mt-6 grid gap-8 sm:grid-cols-2 md:grid-cols-3">
          {team.map((member) => (
            <div key={member.id} className="text-center">
              <MemberPhoto photo={member.photo} name={member.name} />
              <p className={`mt-3 font-medium ${KT.headingFont}`}>{member.name}</p>
              <p className={`text-xs uppercase tracking-wide ${KT.textMuted}`}>{member.role}</p>
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
        className={`mx-auto h-24 w-24 rounded-full border object-cover ${KT.border}`}
      />
    );
  }
  return (
    <div
      className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full text-lg font-semibold ${KT.accentBg} ${KT.accentContrastText}`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
