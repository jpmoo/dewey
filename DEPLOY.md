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

## 2. Database (PostgreSQL)

Dewey stores users and per-user settings in PostgreSQL so multiple concurrent users get correct, isolated data.

1. Install Postgres (e.g. `sudo apt install postgresql` on Ubuntu).
2. Create a database and user:

   ```bash
   sudo -u postgres psql -c "CREATE USER dewey WITH PASSWORD 'your_password';"
   sudo -u postgres psql -c "CREATE DATABASE dewey OWNER dewey;"
   ```

3. Run the schema once (from the project root):

   ```bash
   psql "postgresql://dewey:your_password@localhost:5432/dewey" -f scripts/schema.sql
   ```

4. Set `DATABASE_URL` in `.env.local` (see below).

**Migrating from JSON:** If you previously used `data/users.json` and `data/settings.json`, those files are no longer read. Create the Postgres schema and set `DATABASE_URL`. Re-run first-time setup (or register) to create the first user; existing JSON user data is not auto-imported.

---

## 3. Install and build

```bash
npm ci
npm run build
```

---

## 4. Environment variables

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
| `DATABASE_URL`    | `postgresql://user:password@localhost:5432/dewey` — Postgres for users and settings |

**Optional (data and port):**

| Variable          | Default   | Notes |
|-------------------|-----------|--------|
| `DEWEY_DATA_DIR`  | `./data`  | Directory for runtime config (e.g. `dewey-runtime.json`). Use an absolute path in production (e.g. `/var/lib/dewey/data`) so it’s stable and backupable. |
| `PORT`            | `3000`    | Port for `next start`. |

**Optional (SSO):** set the `AUTH_*_ID` and `AUTH_*_SECRET` for each provider you use (Apple, Google, Microsoft). Leave unset to disable.

---

## 5. Data directory (optional)

If you set `DEWEY_DATA_DIR` for runtime config, create it and give the process write access:

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

**Stop any existing Dewey process on port 3000** (run this before starting or restarting if you’re not using PM2):

```bash
kill $(lsof -t -i :3000) 2>/dev/null; sleep 2
```

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

**Stop/restart with PM2:**

```bash
pm2 stop dewey
pm2 start dewey
pm2 restart dewey
```

**With systemd (start on boot, stop/restart with systemctl):**

1. Stop anything on port 3000, then create a user service (runs as your user, no root):

   ```bash
   kill $(lsof -t -i :3000) 2>/dev/null; sleep 2
   mkdir -p ~/.config/systemd/user
   ```

2. Create `~/.config/systemd/user/dewey.service` (adjust paths if your app is not in `~/dewey`):

   ```ini
   [Unit]
   Description=Dewey Next.js app
   After=network.target

   [Service]
   Type=simple
   WorkingDirectory=/home/YOUR_USER/dewey
   EnvironmentFile=/home/YOUR_USER/dewey/.env.local
   ExecStartPre=/bin/sh -c 'kill $$(lsof -t -i :3000) 2>/dev/null || true'
   ExecStartPre=/bin/sleep 2
   ExecStart=/usr/bin/npm start
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=default.target
   ```
   `ExecStartPre` frees port 3000 before starting so restarts don’t fail with “address in use”.

   Replace `YOUR_USER` with your username (e.g. `jpmoo`). If Node/npm is not in `/usr/bin`, use `which npm` and put that path in `ExecStart` (e.g. `ExecStart=/usr/bin/npm start` or `ExecStart=/home/jpmoo/.nvm/versions/node/v20.x.x/bin/npm start`).

3. Enable the service so it starts on login/reboot, then start it:

   ```bash
   systemctl --user daemon-reload
   systemctl --user enable dewey
   systemctl --user start dewey
   ```

4. **Stop / restart:**

   ```bash
   systemctl --user stop dewey
   systemctl --user start dewey
   systemctl --user restart dewey
   ```

   **Status and logs:**

   ```bash
   systemctl --user status dewey
   journalctl --user -u dewey -f
   ```

   **Note:** User systemd services start after you log in. To have Dewey start at machine boot without a user login, use a system-wide service under `/etc/systemd/system/dewey.service` (same content, but use `User=YOUR_USER` in `[Service]` and run `sudo systemctl enable dewey` / `sudo systemctl start dewey`).

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

**Serving Dewey under a path (e.g. `/dewey`)** when Caddy is shared with other services:

1. Add a `handle` block **before** your default/catch-all so `/dewey` is matched first:

   ```
   handle /dewey* {
     reverse_proxy 127.0.0.1:3000 {
       header_up Host {host}
       header_up X-Forwarded-Proto {scheme}
       header_up X-Forwarded-For {remote_host}
     }
   }
   ```

2. Set env so the app generates correct URLs and auth callbacks:
   - `NEXT_PUBLIC_BASE_PATH=/dewey`
   - `NEXTAUTH_URL=https://your-host/dewey` (use the full URL users see, including port if needed, e.g. `https://machine:8083/dewey`)

3. Rebuild after setting `NEXT_PUBLIC_BASE_PATH`: `npm run build` then restart the app.

---

## 7. First-time setup

1. Open `https://dewey.example.com` (or your URL).
2. You’ll see the first-time setup form (no admin exists yet).
3. Create the first account; that user is set as system admin in settings.
4. After that, other users can register or use SSO (if configured).

---

## 8. Updating the app

**If using PM2:**

```bash
cd /opt/dewey
git pull   # or replace files
npm ci
npm run build
pm2 restart dewey
```

**If running with `npm start` (no PM2), stop the old process first, then rebuild and start:**

```bash
cd /opt/dewey   # or ~/dewey
kill $(lsof -t -i :3000) 2>/dev/null; sleep 2
git pull   # or replace files
npm ci
npm run build
npm start
```

`DEWEY_DATA_DIR` (and your backup of that directory) is separate from the app code; keep it across deploys.

---

## 9. Troubleshooting: "Application error" and 400 on static chunks

If the app shows "Application error" and the browser console reports **400 (Bad Request)** on `_next/static/chunks/...` or `_next/static/media/...`, plus **ChunkLoadError** and React error #423, the server (or something in front of it) is rejecting requests for static assets.

**Checks:**

1. **Reverse proxy (nginx / Caddy)**  
   If you use a proxy in front of Next.js, it must pass **all** paths to the app, including `/_next/static/...`. A single `location /` that proxies to the Node app is correct. Do not add a separate `location /_next/` that serves files from disk unless you know what you’re doing—let the Next.js process serve `_next` and the rest of the app.

2. **Confirm who returns 400**  
   On the server that runs Dewey, run:
   ```bash
   curl -I http://127.0.0.1:3000/
   ```
   Then open the app in the browser, copy a failing chunk URL from the Network tab (e.g. `http://jpmoo.tplinkdns.com:3000/_next/static/chunks/app/page-....js`), and run the **same path** against localhost:
   ```bash
   curl -I "http://127.0.0.1:3000/_next/static/chunks/app/page-a4edc00a813e6795.js"
   ```
   - If **127.0.0.1:3000** returns 400, the Next.js process (or something on that port) is rejecting the request—see step 2b.
   - If **127.0.0.1** returns 200 but the browser URL returns 400, the problem is between the client and the server (e.g. proxy, router, or firewall rewriting or blocking the request).

2b. **When Next.js itself returns 400 for a chunk**  
   That usually means the chunk file the HTML asks for is not in the current build (stale or mismatched build). On the server, in the app directory:

   ```bash
   # Does this exact chunk exist?
   ls -la .next/static/chunks/app/page-a4edc00a813e6795.js

   # What page chunks do exist?
   ls .next/static/chunks/app/page-*.js
   ```

   If the file is missing, do a **clean rebuild** and restart (stop anything on 3000 first if not using PM2):

   ```bash
   cd /opt/dewey   # or ~/dewey
   kill $(lsof -t -i :3000) 2>/dev/null; sleep 2
   rm -rf .next
   npm run build
   pm2 restart dewey   # if using PM2; otherwise: npm start
   ```

   Then hard-refresh the browser (Ctrl+Shift+R / Cmd+Shift+R) or use incognito so it doesn’t use cached HTML pointing at old chunk names.

2c. **Ensure the right process is serving**  
   If you still see the error after a clean rebuild and browser refresh, the process on port 3000 may not be the app you just built (e.g. it’s running from another directory or an old instance). On the server:

   ```bash
   lsof -i :3000
   # or:  ss -tlnp | grep 3000
   ```

   Note the PID. Check that process’s working directory:

   ```bash
   pwdx <PID>
   # or:  ls -la /proc/<PID>/cwd
   ```

   It must be your Dewey app directory (e.g. `/home/jpmoo/dewey`). If it isn’t, stop that process and start the app from the directory where you ran `npm run build`:

   ```bash
   kill $(lsof -t -i :3000) 2>/dev/null; sleep 2
   cd ~/dewey
   npm start
   ```

   (Or use PM2/systemd with `cwd` set to that directory.) Then open the site in a fresh incognito window and test again.

3. **Rebuild and restart**  
   After every `npm run build`, restart the app (`pm2 restart dewey` or equivalent). Old build artifacts plus new HTML can cause wrong chunk names; usually that’s 404, but a clean rebuild rules out mismatch.

4. **Hostname / port**  
   You’re using `http://jpmoo.tplinkdns.com:3000`. If a reverse proxy or router is in front of port 3000, ensure it forwards the full path and doesn’t strip or alter `/_next/static/...` and that it doesn’t return 400 for those paths (e.g. some security or “application control” features do).
