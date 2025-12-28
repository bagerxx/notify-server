# Notify Sunucusu

APNs ve FCM için çoklu uygulama destekli, üretime hazır bildirim geçidi.

## Kurulum

1) Ortam degiskenlerini ayarla (veya `.env.local` kullan):

```
PORT=3001
REQUIRE_HMAC=true
REQUIRE_AUTH=false
REQUIRE_HTTPS=false
```

2) Sunucuyu baslat:

```sh
npm start
```

3) Konsoldan admin path ve (varsa) olusan admin sifresini al.

## Admin Panel

Admin paneli uygulama tanimlari ve APNs/FCM anahtarlarini yonetir. Ayarlar
SQLite'da saklanir ve yeniden baslatmada korunur.

Ortam degiskenleri (opsiyonel):
- `ADMIN_BASE_PATH`: Admin URL path (bossa rastgele uretilir).
- `ADMIN_BOOTSTRAP_USER`: Ilk admin kullanicisi.
- `ADMIN_BOOTSTRAP_PASSWORD`: Ilk admin sifresi (bossa rastgele uretilir).
- `ADMIN_SESSION_SECRET`: Session imzasi (bossa otomatik uretilir).
- `CONFIG_DB_PATH`: Admin/config veritabani yolu (varsayilan: `./data/notify-config.sqlite`).
- `KEYS_DIR`: APNs/FCM anahtar dosyalari icin dizin (varsayilan: `./keys`).

## Veritabanı

SQLite iki amac icin kullanilir:
- HMAC nonce verisi: `./data/notify.sqlite` (DATABASE_PATH ile degistirilebilir)
- Admin/config verisi: `./data/notify-config.sqlite` (CONFIG_DB_PATH ile degistirilebilir)

## Kimlik Doğrulama

Varsayılan olarak HMAC imza yeterlidir. Eğer `REQUIRE_AUTH=true` ise ek olarak
API key header'ı da zorunlu olur:

- `Authorization: Bearer <apiKey>`
- ya da `x-api-key: <apiKey>`

## HMAC İmza

Backend'den gelen istekler ek bir HMAC imzası ile doğrulanır. Bu sayede
payload değiştirme ve replay saldırıları engellenir.

Gerekli header'lar:
- `x-timestamp`: Unix timestamp (ms)
- `x-nonce`: Her istek için benzersiz UUID
- `x-signature`: HMAC-SHA256 imzası (hex)

İmzalama formatı:

```
METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY
```

Örnek (Node.js):

```js
import * as crypto from 'crypto';

const method = 'POST';
const path = '/v1/notify';
const timestamp = Date.now().toString();
const nonce = crypto.randomUUID();
const body = JSON.stringify(payload);
const secret = '<apiKey>';

const canonical = [method, path, timestamp, nonce, body].join('\n');
const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
```

Sunucu `HMAC_WINDOW_MS` (varsayılan 5 dakika) dışında kalan istekleri reddeder.
Geliştirme ortamında kapatmak için `REQUIRE_HMAC=false` kullanabilirsin.
API key header'i admin panelde uretilen app secret ile ayni olmalidir.
API key header'ini da zorunlu yapmak icin `REQUIRE_AUTH=true` ayarla.
İmza hesaplanırken kullanılan `body` string'i, HTTP isteğinde gönderdiğin ham body ile birebir aynı olmalıdır.

## HTTPS Zorunlulugu

`REQUIRE_HTTPS=true` ise HTTPS olmayan istekler 403 ile reddedilir. Reverse proxy
arkasinda TLS sonlandiriyorsan `TRUST_PROXY=true` ayarlanmalidir; aksi halde
Express HTTPS'i tespit edemez.

## IP Allowlist

Sadece belirli IP'lerden gelen istekleri kabul etmek için `IP_ALLOWLIST_ENABLED=true`
ve `ALLOWED_IPS` kullanabilirsin.
Virgülle ayrılmış IP listesi gir:

```
IP_ALLOWLIST_ENABLED=true
ALLOWED_IPS=203.0.113.10,198.51.100.25
```

Eğer reverse proxy/LB arkasındaysan gerçek istemci IP'si için `TRUST_PROXY=true` yapmalısın.

## Uç Noktalar

### POST /v1/notify

Bildirim gönder (yalnızca belirli token'lara). `platform` alanı `ios` veya `android` olmalı.

```json
{
  "appId": "my-app",
  "platform": "ios",
  "tokens": ["token-1", "token-2"],
  "notification": {
    "title": "Hello",
    "body": "World"
  },
  "data": {
    "screen": "home"
  },
  "apns": {
    "sound": "default"
  }
}
```
`broadcast` desteklenmez; tüm cihazlara gönderim için backend'in kendi hedefleme
mantığını kullanıp uygun token listesini bu endpoint'e göndermelisin.
Geçersiz token'lar response içinde `invalidTokens` olarak geri döner; kendi DB'nden temizleyebilirsin.

## Backend Client Modulu

Bu depodaki `client/notify-client.js`, baska backend projelerine kopyalanip kullanilacak
standart bir gonderim moduludur. Env'den ayar okur ve HMAC imzasini otomatik uretir.

```js
import { createNotifyClient } from './client/notify-client.js';

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
  body: 'Merhaba',
});
```
