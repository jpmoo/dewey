"use client";

import { useState } from "react";

export function StartCTA() {
  const [started, setStarted] = useState(false);

  if (started) {
    return (
      <div className="rounded-xl border border-dewey-border bg-white/60 p-6 text-left">
        <p className="text-sm text-dewey-mute mt-4">
          The chat experience will go here.
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setStarted(true)}
      className="dewey-btn-primary"
    >
      Let&apos;s start.
    </button>
  );
}
