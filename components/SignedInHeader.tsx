"use client";

import { signOut } from "next-auth/react";
import type { Session } from "next-auth";

export function SignedInHeader({ user }: { user: Session["user"] }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-dewey-mute truncate max-w-[140px] sm:max-w-[200px]">
        {user.email ?? user.name}
      </span>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        className="text-xs font-medium text-dewey-mute hover:text-dewey-ink transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
