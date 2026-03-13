"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import { ReactNode } from "react";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "");
const authBasePath = basePath ? `${basePath}/api/auth` : undefined;

export function SessionProvider({ children }: { children: ReactNode }) {
  return (
    <NextAuthSessionProvider basePath={authBasePath}>
      {children}
    </NextAuthSessionProvider>
  );
}
