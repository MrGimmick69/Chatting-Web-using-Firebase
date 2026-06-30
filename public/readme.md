# Chat App â€” Firebase (HTML + CSS + JS, npm-style)

Chat 1-on-1 realtime pakai **Firebase Auth + Realtime Database**.

## File
- `index.html` Â· `styles.css` Â· `app.js` Â· `firebase-config.js`
- `package.json` (untuk npm install firebase + Vite)

## Setup di VSCode

```bash
# di dalam folder ini
npm install
npm run dev
```

Lalu buka `http://localhost:5173`.

Vite akan auto-resolve `import "firebase/app"` dll dari `node_modules`. Importmap di `index.html` cuma fallback supaya file ini juga bisa dibuka langsung tanpa bundler (Live Server).

## Firebase Console

1. **Authentication** â†’ Sign-in method â†’ enable **Email/Password**
2. **Realtime Database** â†’ udah ada (region asia-southeast1), pastikan rules-nya bisa di-read/write user yang login:

```json
{
  "rules": {
    "users": {
      ".read": "auth != null",
      "$uid": {
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "chats": {
      "$chatId": {
        ".read": "auth != null && data.child('meta/participants').child(auth.uid).exists()",
        ".write": "auth != null && (data.child('meta/participants').child(auth.uid).exists() || newData.child('meta/participants').child(auth.uid).exists())"
      }
    }
  }
}
```

(Buat awal-awal test, boleh pakai test mode: `{ "rules": { ".read": "auth != null", ".write": "auth != null" } }`.)

## Cara pakai
1. Daftar dengan username + password
2. Suruh temenmu daftar juga
3. Klik nama temen di sidebar â†’ mulai chat
4. Pesan tersimpan permanen di Realtime Database

## Struktur data RTDB
```
users/{uid}: { username, displayName, createdAt, lastSeen }
chats/{chatId}/meta: { participants: {uid: true}, lastMessage, lastMessageAt }
chats/{chatId}/messages/{pushKey}: { senderId, text, createdAt }
```
`chatId = sorted([uidA, uidB]).join("_")`