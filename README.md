# 🚀 Notify Server

APNs (iOS) ve FCM (Android) için çoklu uygulama destekli **bildirim geçidi**.  
Üretim ortamına uygun, admin paneli ve güvenlik özellikleri ile birlikte gelir.

## 📦 Kurulum

### 1) Ortam değişkenlerini ayarla (`.env.local` da kullanılabilir)

```env
PORT=3001
DATABASE_URL=postgresql://user:pass@host:5432/notify?schema=public
REQUIRE_HMAC=true
REQUIRE_AUTH=false
REQUIRE_HTTPS=false
```

### 2) Sunucuyu başlat

```bash
npm start
```

Başladıktan sonra konsolda **admin panel path** ve **ilk admin şifresi** görüntülenir.

---

## 🐳 Docker Kullanımı

Docker imajı:

```
DOCKER_IMAGE=bagerxx/notify-server:latest
```
Docker 

### Çalıştırma (env ile)

```bash
docker run -d --name notify-server \
  -p 3000:3000 \
  --env-file /path/to/.env \
  your-dockerhub-user/notify-server:latest
```

---

## 🔧 Admin Panel

APNs/FCM anahtarları ve uygulamalar tek yerden yönetilir.  
Veriler PostgreSQL içinde saklanır ve yeniden başlatmada korunur.

**Ortam değişkenleri (opsiyonel):**

| Değişken | Açıklama |
|---|---|
| `ADMIN_BASE_PATH` | Admin panel path (boşsa otomatik üretilir) |
| `ADMIN_BOOTSTRAP_USER` | İlk admin kullanıcı adı |
| `ADMIN_BOOTSTRAP_PASSWORD` | İlk admin şifresi |
| `ADMIN_SESSION_SECRET` | Session imza anahtarı |

---

## 🗄 Veritabanı

PostgreSQL + Prisma kullanılır. Tek bir veritabanı yeterlidir.

```env
DATABASE_URL=postgresql://user:pass@host:5432/notify?schema=public
```

Migrations `npm start` ile otomatik uygulanır.

---

## 🔐 Güvenlik Önerileri

⚠ Veritabanında API secret ve key bilgileri bulunur. Erişimi kısıtla ve güvenli bağlantı kullan.

---

## 🛡 HMAC İmzalama

Her API isteği HMAC-SHA256 ile imzalanmalıdır.

**Gereken header’lar:**

```
x-timestamp
x-nonce
x-signature
```

**İmza formatı**

```
METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY
```

Node.js örneği:

```js
const signature = crypto.createHmac('sha256', secret)
  .update([method, path, timestamp, nonce, JSON.stringify(payload)].join('\n'))
  .digest('hex');
```

Env kontrolü:

| Değişken | Etki |
|---|---|
| `REQUIRE_HMAC=false` | Geliştirme için HMAC devre dışı |
| `REQUIRE_AUTH=true` | HMAC'e ek API Key zorunluluğu |

---

## 🌐 HTTPS Zorunluluğu

```env
REQUIRE_HTTPS=true
TRUST_PROXY=true
```

Reverse proxy kullanıyorsan `TRUST_PROXY` açılmalı.

---

## 🏷 IP Allowlist

Belirli IP’lere erişim sınırlandırma:

```env
IP_ALLOWLIST_ENABLED=true
ALLOWED_IPS=203.0.113.10,198.51.100.25
```

Proxy varsa yine `TRUST_PROXY=true`.

---

## 📡 API Uç Noktaları

### POST `/v1/notify`

Bildirim gönderme endpoint’i.

```json
{
  "appId": "my-app",
  "platform": "ios",
  "tokens": ["token-1"],
  "notification": { "title": "Hello", "body": "World" },
  "data": { "screen": "home" },
  "apns": { "sound": "default" }
}
```

📌 Notlar:

- `platform`: `ios` veya `android`
- broadcast yok → token listesini sen veriyorsun
- Geçersiz token'lar `invalidTokens` ile döner

---

## 💻 Backend Client Modülü

Projedeki `client/notify-client.js` başka backendlerde kullanılabilir.

```js
const notify = createNotifyClient({
  baseUrl: process.env.NOTIFY_SERVER_URL,
  appId: process.env.NOTIFY_APP_ID,
  appSecret: process.env.NOTIFY_APP_SECRET,
  requireAuth: process.env.NOTIFY_REQUIRE_AUTH === 'true',
});

await notify.send({
  platform: 'ios',
  tokens: ['<token>'],
  title: 'Test',
  body: 'Merhaba'
});
```

---

## 🧠 Genel Özet

- Çoklu uygulama destekli bildirim geçidi
- Admin panel + SQLite config yapısı
- HMAC güvenliği ve API Key desteği
- Docker ile dağıtıma hazır
- IP kısıtlama, HTTPS zorunluluğu seçenekleri
- iOS/Android push bildirimlerine tek endpoint
