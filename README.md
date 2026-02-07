# Dewey

AI coach for educational leadership. Web app with single sign-on (Apple, Google, Microsoft) and a minimal, clean UI.

## Stack

- **Next.js 14** (App Router)
- **NextAuth.js** — SSO with Apple, Google, Microsoft (enable any subset via env)
- **Tailwind CSS** — styling
- **TypeScript**

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Environment**

   Copy `.env.example` to `.env.local` and set:

   - `NEXTAUTH_SECRET` — e.g. `openssl rand -base64 32`
   - `NEXTAUTH_URL` — in dev: `http://localhost:3000`; in prod: your public URL (e.g. `https://dewey.example.com`)
   - For each provider you want: the corresponding `AUTH_*_ID` and `AUTH_*_SECRET`. Leave a provider’s vars unset to disable it.

3. **Run locally**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Making it accessible from the outside

- **Production build**: `npm run build && npm start` (serves on port 3000 by default; set `PORT` if needed).
- **Hosting**: Deploy to Vercel, Railway, Fly.io, or any Node host. Set `NEXTAUTH_URL` to your public URL and configure your OAuth apps with the same callback URL (e.g. `https://your-domain.com/api/auth/callback/google`).
- **HTTPS**: Use a reverse proxy (e.g. Caddy, nginx) or your host’s TLS so the site is served over HTTPS in production.

- **Linux server**: See **[DEPLOY.md](./DEPLOY.md)** for step-by-step deployment (build, env, `DEWEY_DATA_DIR`, PM2, nginx/Caddy).

## Logo

The app uses `assets/image.png` as the Dewey logo. Replace that file to change the logo.
