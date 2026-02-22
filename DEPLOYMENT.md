# Deploying gads-report to DigitalOcean

This guide walks you through putting the app on a DigitalOcean droplet and keeping it running with a process manager.

---

## Quick “put it online” checklist

1. **Create a droplet** (Ubuntu 22.04) and note its IP.
2. **Point a domain** to the droplet (A record, e.g. `report.yourdomain.com` → droplet IP). HTTPS requires a domain.
3. **SSH in:** `ssh root@YOUR_DROPLET_IP`
4. **Install Node 20:** `apt update && apt upgrade -y && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs`
5. **Clone your repo:** `cd ~ && git clone https://github.com/YOUR_USERNAME/gads-report.git && cd gads-report`
6. **Install dependencies (incl. Puppeteer):** `npm install`
7. **Create credentials on server:** `nano credentials.json` and add your login users (see §3.1 below).
8. **Run with PM2:** `npm install -g pm2 && pm2 start server.js --name gads-report && pm2 save && pm2 startup` (run the `sudo env PATH=...` command it prints).
9. **Nginx + HTTPS:** Follow **§7 and §8** so the site is on **https://yourdomain.com** (no port). Firewall: `sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable` (do **not** open port 3000 to the internet.)
10. **Visit:** `https://yourdomain.com/Login.html`

---

## 1. Prerequisites

- A DigitalOcean droplet (Ubuntu 22.04 LTS recommended)
- SSH access (root or a user with sudo)
- Your app code (this repo) on your machine

---

## 2. Prepare the droplet

### 2.1 SSH into the droplet

```bash
ssh root@YOUR_DROPLET_IP
```

(Or use your non-root user, e.g. `ssh deploy@YOUR_DROPLET_IP`.)

### 2.2 Update system and install Node.js (LTS)

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # should show v20.x
npm -v
```

### 2.3 (Optional) Create a dedicated user to run the app

```bash
adduser gadsapp
usermod -aG sudo gadsapp
su - gadsapp
```

Use this user for the steps below if you created it.

---

## 3. Get the app onto the server

Pick one of these.

### Option A: Deploy with Git (recommended if you use Git)

On the droplet:

```bash
cd ~
git clone https://github.com/YOUR_USERNAME/gads-report.git
cd gads-report
```

(Replace with your repo URL. If the repo is private, set up SSH keys or a deploy key.)

### Option B: Copy files with SCP from your Mac

From your **local machine** (in a new terminal):

```bash
cd "/Users/shubham/Desktop/Final Reporting/Attempt 2/gads-report"
scp -r . root@YOUR_DROPLET_IP:~/gads-report
```

Then on the droplet:

```bash
cd ~/gads-report
```

### Option C: Zip, upload, unzip

On your Mac:

```bash
cd "/Users/shubham/Desktop/Final Reporting/Attempt 2/gads-report"
zip -r gads-report.zip . -x "*.git*" -x "node_modules/*"
scp gads-report.zip root@YOUR_DROPLET_IP:~/
```

On the droplet:

```bash
cd ~
unzip -o gads-report.zip -d gads-report
cd gads-report
```

---

## 3.1 Create credentials on the server (required for login)

`credentials.json` is not in the repo. Create it on the droplet:

```bash
cd ~/gads-report
nano credentials.json
```

Paste (change username/password as you like):

```json
{
  "users": [
    { "username": "admin", "password": "your-secure-password" }
  ]
}
```

Save: `Ctrl+X`, then `Y`, then `Enter`.

---

## 4. Run the app

The app needs `npm install` (for Puppeteer and screenshot support).

```bash
cd ~/gads-report
npm install
```

**If screenshots fail** (e.g. "Failed to launch browser"), install minimal Chromium deps (Ubuntu/Debian). Run `sudo apt update` first, then:

```bash
sudo apt install -y ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libnspr4 libnss3 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 xdg-utils
```

(If that fails, try the smaller set: `sudo apt install -y ca-certificates libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libasound2 libdbus-1-3 xdg-utils`.)

Then:

```bash
PORT=3000 node server.js
```

Visit `http://YOUR_DROPLET_IP:3000/Login.html`. Log in with the user from `credentials.json` (create it if missing — see §3.1). You should see the Dashboard.

Stop the server with `Ctrl+C` when you’re done testing.

---

## 5. Run it permanently with PM2

PM2 keeps the Node app running and restarts it if it crashes.

### 5.1 Install PM2

On the droplet:

```bash
npm install -g pm2
```

### 5.2 Start the app with PM2

```bash
cd ~/gads-report
pm2 start server.js --name gads-report
pm2 save
pm2 startup
```

Follow the command `pm2 startup` prints (run the `sudo env PATH=...` line it gives you).

- **Useful PM2 commands:**
  - `pm2 status`        — list processes
  - `pm2 logs gads-report` — view logs
  - `pm2 restart gads-report` — restart after you update code
  - `pm2 stop gads-report`   — stop
  - `pm2 delete gads-report` — remove from PM2

---

## 6. Firewall

Allow SSH and, for Nginx/HTTPS, allow 80 and 443. Do **not** open port 3000 to the internet.

```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
sudo ufw status
```

---

## 7. Nginx reverse proxy (HTTPS, no port in URL)

You need a **domain** pointing to the droplet (A record). Nginx listens on 80/443 and forwards to the app on `127.0.0.1:3000`.

### 7.1 Install Nginx

```bash
sudo apt install -y nginx
```

### 7.2 Create a site config

```bash
sudo nano /etc/nginx/sites-available/gads-report
```

Paste and replace `report.yourdomain.com` with your actual domain:

```nginx
server {
    listen 80;
    server_name report.yourdomain.com;   # replace with your domain

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Save and exit (`Ctrl+X`, then `Y`, then `Enter`).

### 7.3 Enable the site and reload Nginx

```bash
sudo ln -s /etc/nginx/sites-available/gads-report /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Then open `http://report.yourdomain.com` in the browser (no port). Next, add HTTPS in §8.

---

## 8. HTTPS with Let’s Encrypt

Replace `report.yourdomain.com` with your domain:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d report.yourdomain.com
```

Choose to redirect HTTP to HTTPS when asked. Then use **https://report.yourdomain.com/Login.html** (no port). Certbot renews the certificate automatically.

---

## 9. Updating the app later

After you change code:

**If you used SCP/zip:**  
Upload the new files to the same `~/gads-report` directory, then:

```bash
cd ~/gads-report
pm2 restart gads-report
```

**If you used Git:**

```bash
cd ~/gads-report
git pull
pm2 restart gads-report
```

---

## 10. Report screenshots (where images are saved)

When you click **Open report** on the Reporting page, the server takes a full-page screenshot of the report and saves it as a PNG.

- **Folder name:** The image is saved in a folder named after the **date in `data.json`** (e.g. `campaign.date` like `"Feb 21, 2026"` → folder `Feb-21-2026`).
- **Default location:**  
  `screenshots/<date>/` inside the app directory (e.g. `~/gads-report/screenshots/Feb-21-2026/report-1234567890.png`).
- **Save to a different drive or path:**  
  Set the env var **`SCREENSHOT_SAVE_DIR`** to the full path where you want the date folders and images.

  Examples:
  - Linux/Mac: `SCREENSHOT_SAVE_DIR=/home/me/Google Drive/Reports pm2 start server.js --name gads-report`
  - Windows: `set SCREENSHOT_SAVE_DIR=D:\Reports` then start the server.
  - With PM2: create/edit `ecosystem.config.js` and set `env: { SCREENSHOT_SAVE_DIR: '/path/to/your/drive/reports' }`, then `pm2 start ecosystem.config.js`.

- **Dependency:** Screenshots require **Puppeteer** (installs Chromium). Run `npm install` in the app directory; if Puppeteer is missing, the screenshot API returns an error and the report still opens in the browser.

---

## Quick reference

| Step              | Command / action                          |
|-------------------|-------------------------------------------|
| Install Node 20   | `curl -fsSL https://deb.nodesource.com/setup_20.x \| bash -` then `apt install -y nodejs` |
| Run once          | `cd ~/gads-report && PORT=3000 node server.js` |
| Run with PM2      | `pm2 start server.js --name gads-report` then `pm2 save` and `pm2 startup` |
| Restart after update | `pm2 restart gads-report`              |
| Open firewall     | `sudo ufw allow 80 && sudo ufw allow 443` (do not open 3000; use Nginx + HTTPS) |

Your app is a **Node application** that serves `final.html`, `saver.html`, `data.json`, and the `icons/` folder. No database or env vars are required for this basic setup.
