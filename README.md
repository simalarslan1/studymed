# StudyMed - Birlikte Ders Çalış

Tıp öğrencileri için gerçek zamanlı görüntülü ders çalışma platformu.

## Kurulum

### 1. Bağımlılıkları yükle
```bash
npm install
```

### 2. VAPID anahtarlarını oluştur
```bash
npm run generate-vapid
```

Çıktıyı kopyala ve `.env.local` dosyası oluştur:
```
VAPID_PUBLIC_KEY=buraya_yapistir
VAPID_PRIVATE_KEY=buraya_yapistir
```

### 3. Uygulamayı başlat
```bash
npm run dev
```

### 4. Tarayıcıda aç
http://localhost:3000

## Nasıl Kullanılır?

1. İki kişi de uygulamayı açar, adlarını girer ve bildirimlere izin verir
2. Birinci kişi arkadaşının adının yanındaki **"Davet Et"** butonuna tıklar
3. Arkadaşı push bildirimi alır: "Şimal ders çalışıyor - Katıl!"
4. Arkadaşı "Katıl" derse oda açılır ve video görüşme başlar
5. WhatsApp butonu ile oda linkini de paylaşabilirsin

## Özellikler

- Gerçek zamanlı video görüşme (WebRTC P2P)
- Tarayıcı push bildirimleri
- Oda linki oluşturma ve WhatsApp paylaşımı
- Mikrofon ve kamera kontrolü
- Ders süresi sayacı
- Türkçe arayüz

## Teknoloji

- Next.js 14 (App Router)
- Express + Socket.io (sinyal + gerçek zamanlı davetler)
- WebRTC (P2P video)
- web-push (tarayıcı bildirimleri)
- Tailwind CSS
