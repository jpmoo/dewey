# Running Dewey persistently on Ubuntu (headless)

Use **production** mode (`npm run build` + `npm start`), not `npm run dev`. Then run it under systemd so it restarts on failure and on reboot.

## 1. Build the app (once, and after each deploy)

```bash
cd /path/to/Dewey
npm ci
npm run build
```

## 2. Option A: systemd (recommended)

Create a systemd user service (runs as your user, no root needed):

```bash
mkdir -p ~/.config/systemd/user
```

Create `~/.config/systemd/user/dewey.service`:

```ini
[Unit]
Description=Dewey Next.js app
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/Dewey
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Replace `/path/to/Dewey` with the real path (e.g. `/home/you/dewey`).

If you use `.env` or `.env.local`, systemd won’t load them by default. Either:

- Add to `[Service]`:  
  `EnvironmentFile=/path/to/Dewey/.env.local`  
  (and create the file if needed), or  
- Export env vars in the same file and use:  
  `Environment=DEWEY_DATA_DIR=/path/to/Dewey/data`  
  (and any others like `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, etc.)

Then:

```bash
# Reload systemd
systemctl --user daemon-reload

# Start Dewey
systemctl --user start dewey

# Enable start on boot (for your user)
systemctl --user enable dewey

# Check status
systemctl --user status dewey
```

Useful commands:

- Logs: `journalctl --user -u dewey -f`
- Stop: `systemctl --user stop dewey`
- Restart: `systemctl --user restart dewey`

**If you want Dewey to run at machine boot** (before any user logs in), use a **system** unit instead:

```bash
sudo nano /etc/systemd/system/dewey.service
```

Same `[Unit]` and `[Service]` as above, but:

- Set `WorkingDirectory` and paths to where you cloned Dewey (e.g. `/home/you/dewey`).
- Use the full path to `npm` or `node`:
  - `ExecStart=/usr/bin/npm start`  
  - or `ExecStart=/usr/bin/node node_modules/.bin/next start`
- Set `User=youruser` (the user that owns the app and has the right env).
- Optionally add `EnvironmentFile=/home/you/dewey/.env.local`.

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable dewey
sudo systemctl start dewey
sudo systemctl status dewey
```

Logs: `journalctl -u dewey -f`

---

## Option B: PM2

```bash
sudo npm install -g pm2
cd /path/to/Dewey
npm run build
pm2 start npm --name dewey -- start
pm2 save
pm2 startup
# Run the command it prints (e.g. sudo env PATH=... pm2 startup systemd -u you --hp /home/you)
```

Then after reboots, PM2 will restart Dewey. Use `pm2 logs dewey`, `pm2 restart dewey`, etc.

---

## Summary

1. **Don’t use `npm run dev`** on the server; use `npm run build` and `npm start`.
2. **systemd** (Option A) is the standard way to keep the app running and start it on reboot.
3. Set **NEXTAUTH_URL** to your real URL (e.g. `https://yourdomain.com`) and keep **NEXTAUTH_SECRET** and other secrets in `.env.local` or in the systemd `Environment`/`EnvironmentFile`.
