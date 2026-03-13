/**
 * Base path when app is served under a path (e.g. /dewey). Used for API fetch URLs
 * and auth callback URLs so they work when NEXT_PUBLIC_BASE_PATH is set.
 */
const BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BASE_PATH) || "";

export const basePath = BASE.replace(/\/$/, "");

/** Prepend base path to an absolute path (e.g. "/api/foo" -> "/dewey/api/foo"). */
export function pathWithBase(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return basePath ? `${basePath}${p}` : p;
}

/** Root path for redirects and callbackUrl (e.g. "/dewey" or "/"). */
export const rootPath = basePath ? `${basePath}/` : "/";
