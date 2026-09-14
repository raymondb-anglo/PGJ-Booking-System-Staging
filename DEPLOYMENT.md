# PGJ Booking System — Deployment Guide

## Prerequisites

- Node.js 18+ installed
- MySQL 8.0+ running
- PM2 installed globally: `npm install -g pm2`
- Git installed

## 1. Clone the Repository

```bash
git clone <your-repo-url> pgj-booking-system
cd pgj-booking-system
```

## 2. Install Dependencies

```bash
npm install
```

## 3. Create Environment File

Copy the example and fill in your values:

```bash
cp .env.example .env
nano .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 5040) |
| `NODE_ENV` | Set to `production` |
| `DB_HOST` | MySQL host (e.g., `localhost`) |
| `DB_PORT` | MySQL port (default: `3306`) |
| `DB_NAME` | Database name |
| `DB_USER` | Database username |
| `DB_PASSWORD` | Database password |
| `SESSION_SECRET` | Random secret string for session encryption |
| `SMTP_HOST` | SMTP server (e.g., `smtp.gmail.com`) |
| `SMTP_PORT` | SMTP port (e.g., `587`) |
| `SMTP_USER` | SMTP username/email |
| `SMTP_PASSWORD` | SMTP password or app password |

## 4. Set Up MySQL Database

Create the database and user:

```sql
CREATE DATABASE pgj_booking CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'pgj_user'@'localhost' IDENTIFIED BY 'your_password_here';
GRANT ALL PRIVILEGES ON pgj_booking.* TO 'pgj_user'@'localhost';
FLUSH PRIVILEGES;
```

Import your existing database if migrating:

```bash
mysql -u pgj_user -p pgj_booking < backup.sql
```

## 5. Test the Application

```bash
node server.js
```

Verify it starts on port 5040 and connects to the database.

## 6. Start with PM2

```bash
pm2 start ecosystem.config.cjs
```

Or manually:

```bash
pm2 start server.js --name pgj-booking-system
```

## 7. Enable PM2 Startup (Auto-start on Reboot)

```bash
pm2 startup
pm2 save
```

## 8. Common PM2 Commands

| Command | Description |
|---------|-------------|
| `pm2 status` | Check running processes |
| `pm2 logs pgj-booking-system` | View live logs |
| `pm2 logs pgj-booking-system --lines 100` | View last 100 log lines |
| `pm2 restart pgj-booking-system` | Restart the app |
| `pm2 stop pgj-booking-system` | Stop the app |
| `pm2 delete pgj-booking-system` | Remove from PM2 |
| `pm2 monit` | Real-time monitoring dashboard |

## 9. Updating the Application

```bash
cd pgj-booking-system
git pull origin main
npm install
pm2 restart pgj-booking-system
```

## 10. Log Files

PM2 logs are stored in:

- Output: `./logs/pm2-out.log`
- Errors: `./logs/pm2-error.log`

Create the logs directory if it doesn't exist:

```bash
mkdir -p logs
```

## 11. Reverse Proxy (Optional)

If using Nginx as a reverse proxy:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:5040;
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

## Architecture

- **Backend**: Node.js + Express.js (ESM modules)
- **Database**: MySQL via mysql2/promise
- **View Engine**: EJS + express-ejs-layouts
- **Frontend**: Bootstrap 5, vanilla JavaScript
- **Auth**: bcryptjs + express-session
- **PDF**: pdfkit
- **Email**: nodemailer (SMTP)
