# Savollar banki — To'liq qo'llanma

## Yangi xususiyatlar

### 🔐 Kirish usullari (Foydalanuvchilar uchun)
- `/app` sahifasiga Telegram bot orqali kirilganda avtomatik tanilib kiritiladi
- Brauzerdan (Chrome, Safari va h.k.) to'g'ridan-to'g'ri kirilganda: Telegram botni ochish tugmasi va login/parol bilan kirish (yoki ro'yxatdan o'tish) formasi ko'rsatiladi
- Google orqali kirish endi qo'llab-quvvatlanmaydi (faqat Developer panelda Google bilan kirish qoladi)

### ⚙️ Developer Panel (`/developer`)
- Google akkaunt bilan kirish (faqat ruxsat etilgan emaillar)
- Dashboard: jami foydalanuvchilar, bugungi testlar, faollik statistikasi
- **Broadcast**: barcha Telegram foydalanuvchilarga xabar yuborish
- **Maintenance mode**: saytni texnik ish rejimiga o'tkazish (bot + sayt)
- **Botga statistika yuborish**: har qanday vaqtda kunlik statistikani Telegram ga yuborish
- Developerlar boshqaruvi (qo'shish/o'chirish)

### 🤖 Bot yangiliklari
- `/stats` buyrug'i: admin statistikani botga yuborishini so'rashi mumkin
- Maintenance mode yoqilganda bot `/start` da xabar ko'rsatadi
- Test yakunlangach `bot_stats` jadvaliga yoziladi

---

## O'rnatish va sozlash

### 1. .env fayl

```
BOT_TOKEN=your_telegram_bot_token
APP_URL=https://your-app.up.railway.app

DATABASE_URL=postgresql://...

JWT_SECRET=random_secret_string

ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
ADMIN_CHAT_ID=your_telegram_chat_id

# Google OAuth (faqat Developer panel uchun)
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxx

# Developer panel uchun birinchi email
DEVELOPER_EMAIL=you@gmail.com

# Ixtiyoriy: Telegram bot username (taklif tugmasi uchun, avtomatik aniqlanadi)
BOT_USERNAME=your_bot_username

PORT=3000
```

### 2. Google Cloud Console sozlash (faqat Developer panel uchun)
1. https://console.cloud.google.com/ ga kiring
2. **APIs & Services → Credentials → Create OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Authorized redirect URIs:
   ```
   https://your-app.up.railway.app/api/auth/developer/google/callback
   ```
5. Client ID va Secret ni `.env` ga joylashtiring

### 3. Developer qo'shish
- `.env` da `DEVELOPER_EMAIL=you@gmail.com` qo'ying (birinchi developer)
- Server ishga tushganda u avtomatik qo'shiladi
- Keyin developer panel orqali boshqalarni qo'shish mumkin

---

## Sahifalar

| Manzil | Tavsif |
|--------|--------|
| `/app` | Foydalanuvchi ilovasi (Telegram + Google) |
| `/admin` | Admin panel (username/parol) |
| `/developer` | Developer panel (Google OAuth) |

## API Endpointlar

### Auth
- `POST /api/auth/telegram` — Telegram WebApp orqali kirish
- `POST /api/auth/register` — Login/parol bilan ro'yxatdan o'tish (brauzerdan)
- `POST /api/auth/login` — Login/parol bilan kirish (brauzerdan)
- `GET /api/bot-info` — Telegram bot username/havolasi (kirish ekrani uchun)
- `GET /api/auth/developer/google/url` — Developer login URL
- `GET /api/auth/developer/google/callback` — Developer redirect

### Developer API (token kerak)
- `GET /api/developer/stats` — Dashboard statistika
- `POST /api/developer/broadcasts` — Broadcast yuborish
- `GET/PUT /api/developer/maintenance` — Maintenance mode
- `POST /api/developer/send-stats` — Botga statistika yuborish
- `GET /api/developer/students` — Foydalanuvchilar ro'yxati
- `GET/POST/DELETE /api/developer/developers` — Developerlar boshqaruvi
"# qbankf" 
