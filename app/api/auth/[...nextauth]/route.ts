import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "");
const authBasePath = basePath ? `${basePath}/api/auth` : undefined;

const handler = NextAuth({
  ...authOptions,
  ...(authBasePath && { basePath: authBasePath }),
});

export { handler as GET, handler as POST };
