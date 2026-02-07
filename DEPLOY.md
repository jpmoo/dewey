# Deploying Dewey on a Linux server

## Prerequisites

- **Node.js 18+** (LTS recommended)
- **npm** (comes with Node)

Optional, for production process management and HTTPS:

- **PM2** (keep the app running, auto-restart)
- **nginx** or **Caddy** (reverse proxy, TLS, optional)

---

## 1. Get the app on the server

Clone or copy the project (e.g. into `/opt/dewey` or your preferred path):

```bash
cd /opt
git clone <your-repo-url> dewey
cd dewey
```

Or upload a tarball and extract it.

---

## 2. Install and build

```bash
npm ci
npm run build
```

---

## 3. Environment variables

Create `.env.local` in the project root (or set env in systemd/PM2):

```bash
cp .env.example .env.local
# Edit .env.local
```

**Required:**

| Variable         | Example / notes |
|------------------|-----------------|
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL`    | `https://dewey.example.com` (must match how users reach the app) |

**Optional (data and port):**

| Variable          | Default   | Notes |
|-------------------|-----------|--------|
| `DEWEY_DATA_DIR`  | `./data`  | Directory for `users.json` and `settings.json`. Use an absolute path in production (e.g. `/var/lib/dewey/data`) so it’s stable and backupable. |
| `PORT`            | `3000`    | Port for `next start`. |

**Optional (SSO):** set the `AUTH_*_ID` and `AUTH_*_SECRET` for each provider you use (Apple, Google, Microsoft). Leave unset to disable.

---

## 4. Data directory

If you set `DEWEY_DATA_DIR`, create it and give the process write access:

```bash
sudo mkdir -p /var/lib/dewey/data
sudo chown "$(whoami)" /var/lib/dewey/data
```

Then in `.env.local`:

```
DEWEY_DATA_DIR=/var/lib/dewey/data
```

If you keep the default (`./data`), ensure the app can write to `<project>/data` (e.g. `mkdir -p data` and correct ownership).

---

## 5. Run the app

**One-off (foreground):**

```bash
npm start
```

**With PM2 (recommended):**

```bash
npm install -g pm2
pm2 start npm --name dewey -- start
pm2 save
pm2 startup   # follow the printed command to enable start on boot
```

PM2 will use your current directory and env. To set `PORT` or `DEWEY_DATA_DIR` explicitly:

```bash
PORT=3000 DEWEY_DATA_DIR=/var/lib/dewey/data pm2 start npm --name dewey -- start
```

Or use an ecosystem file (e.g. `ecosystem.config.cjs`):

```javascript
module.exports = {
  apps: [{
    name: 'dewey',
    cwd: '/opt/dewey',
    script: 'npm',
    args: 'start',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DEWEY_DATA_DIR: '/var/lib/dewey/data',
    },
    env_file: '/opt/dewey/.env.local',
  }],
};
```

Then: `pm2 start ecosystem.config.cjs`.

---

## 6. Reverse proxy and HTTPS (optional)

If the app runs on port 3000 and you want it at `https://dewey.example.com`:

**nginx** (example):

```nginx
server {
  listen 80;
  server_name dewey.example.com;
  return 301 https://$host$request_uri;
}
server {
  listen 443 ssl;
  server_name dewey.example.com;
  ssl_certificate     /path/to/fullchain.pem;
  ssl_certificate_key /path/to/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
  }
}
```

**Caddy** (auto HTTPS if DNS points to the server):

```
dewey.example.com {
  reverse_proxy localhost:3000
}
```

Ensure `NEXTAUTH_URL` is `https://dewey.example.com` and that OAuth callback URLs in your providers match (e.g. `https://dewey.example.com/api/auth/callback/google`).

---

## 7. First-time setup

1. Open `https://dewey.example.com` (or your URL).
2. You’ll see the first-time setup form (no admin exists yet).
3. Create the first account; that user is set as system admin in settings.
4. After that, other users can register or use SSO (if configured).

---

## 8. Updating the app

```bash
cd /opt/dewey
git pull   # or replace files
npm ci
npm run build
pm2 restart dewey   # if using PM2
```

`DEWEY_DATA_DIR` (and your backup of that directory) is separate from the app code; keep it across deploys.
