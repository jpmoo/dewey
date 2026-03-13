import type { NextAuthOptions } from "next-auth";
import AppleProvider from "next-auth/providers/apple";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";
import type { AuthProvider } from "@/lib/db";
import { findUserByOAuth, createUserForOAuth, getUserByUsername } from "@/lib/db";
import { getDefaultSettingsFromEnv, getSettings, setSettings } from "@/lib/settings";
import { verifyPassword } from "@/lib/password";

const providers: NextAuthOptions["providers"] = [];

if (process.env.AUTH_APPLE_ID && process.env.AUTH_APPLE_SECRET) {
  providers.push(
    AppleProvider({
      clientId: process.env.AUTH_APPLE_ID,
      clientSecret: process.env.AUTH_APPLE_SECRET,
    })
  );
}
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    })
  );
}
if (process.env.AUTH_MICROSOFT_ID && process.env.AUTH_MICROSOFT_SECRET) {
  providers.push(
    AzureADProvider({
      clientId: process.env.AUTH_MICROSOFT_ID,
      clientSecret: process.env.AUTH_MICROSOFT_SECRET,
      authorization: { params: { scope: "openid profile email" } },
    })
  );
}

providers.push(
  CredentialsProvider({
    id: "dewey",
    name: "Dewey account",
    credentials: {
      username: { label: "Username", type: "text" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.username || !credentials?.password) return null;
      const user = await getUserByUsername(credentials.username);
      if (!user || !user.password_hash) return null;
      const ok = await verifyPassword(credentials.password, user.password_hash);
      if (!ok) return null;
      const userId = String(user.id);
      const settings = await getSettings(userId);
      const is_system_admin = settings.is_system_admin === true;
      return {
        id: userId,
        name: user.username,
        email: null,
        is_system_admin,
      };
    },
  })
);

export const authOptions: NextAuthOptions = {
  providers,
  callbacks: {
    async signIn() {
      return true;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.name = (token.name as string) ?? session.user.name ?? null;
        session.user.email = (token.email as string | null) ?? session.user.email ?? null;
        (session as { user: { is_system_admin?: boolean } }).user.is_system_admin =
          token.is_system_admin === true;
      }
      return session;
    },
    async jwt({ token, user, account }) {
      if (user) {
        const provider = account?.provider as string | undefined;
        const isOAuth = provider && provider !== "dewey" && ["google", "azure-ad", "apple"].includes(provider);
        let ourUserId: string;
        if (isOAuth) {
          let ourUser = await findUserByOAuth(provider as AuthProvider, user.id);
          if (!ourUser) {
            ourUser = await createUserForOAuth({
              auth_provider: provider as AuthProvider,
              provider_id: user.id,
              email: user.email ?? null,
              name: user.name ?? null,
            });
          }
          ourUserId = String(ourUser.id);
          const existing = await getSettings(ourUserId);
          if (Object.keys(existing).length === 0) {
            await setSettings(ourUserId, { ...getDefaultSettingsFromEnv(), is_system_admin: false });
          }
        } else {
          ourUserId = user.id;
        }
        const settings = await getSettings(ourUserId);
        token.sub = ourUserId;
        token.name = user.name;
        token.email = user.email ?? null;
        token.is_system_admin = settings.is_system_admin === true;
      }
      return token;
    },
  },
  pages: {
    signIn: "/",
    error: "/",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === "development",
};
