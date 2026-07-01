// ============================================================
// app.js â€” chat logic (Firebase Auth + Realtime Database)
// Import pakai bare specifier "firebase/*" â€” di browser di-resolve via
// importmap di index.html; di Vite/Webpack di-resolve dari node_modules.
// ============================================================

import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  update,
  onValue,
  off,
  query,
  orderByChild,
  serverTimestamp,
  onDisconnect,
} from "firebase/database";

import { firebaseConfig, EMAIL_DOMAIN } from "./firebase-config.js";

// ---------- Init ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// ---------- State ----------
let currentUser = null;
let currentChatId = null;
let currentPeer = null;
let messagesRef = null;
let messagesListener = null;
let usersRef = null;
let usersListener = null;
let allUsers = [];
let messageFormListener = null;
let connectedRef = null;
let connectedListener = null;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const authScreen = $("auth-screen");
const chatScreen = $("chat-screen");
const authForm = $("auth-form");
const authError = $("auth-error");
const authSubmit = $("auth-submit");
const authTitle = $("auth-title");
const authSubtitle = $("auth-subtitle");
const toggleText = $("toggle-text");
const toggleLink = $("toggle-link");
const usernameInput = $("username");
const passwordInput = $("password");

let authMode = "login";

// ---------- Helpers ----------
const usernameToEmail = (u) => `${u.toLowerCase().trim()}@${EMAIL_DOMAIN}`;

function colorFromString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 60%, 50%)`;
}
const initials = (n) => (n || "?").trim().slice(0, 2).toUpperCase();

function renderAvatar(el, name) {
  el.textContent = initials(name);
  el.style.background = colorFromString(name || "?");
}
const chatIdFor = (a, b) => [a, b].sort().join("_");

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusText(user) {
  if (!user) return "Offline";
  if (user.online) return "Online";
  if (user.lastSeen) return `Last Seen: ${formatDateTime(user.lastSeen)}`;
  return "Offline";
}

const showError = (msg) => (authError.textContent = msg || "");

// ---------- Auth screen ----------
function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  authTitle.textContent = isLogin ? "Log In" : "Sign Up";
  authSubtitle.textContent = isLogin ? "Welcome back!" : "Create a new account, start chatting!";
  authSubmit.textContent = isLogin ? "Log In" : "Sign Up";
  toggleText.textContent = isLogin ? "Don't have an account?" : "Already have an account?";
  toggleLink.textContent = isLogin ? "Sign Up" : "Log In";
  showError("");
}

toggleLink.addEventListener("click", (e) => {
  e.preventDefault();
  setAuthMode(authMode === "login" ? "register" : "login");
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  authSubmit.disabled = true;

  const username = usernameInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  const email = usernameToEmail(username);

  try {
    if (authMode === "register") {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await set(ref(db, `users/${cred.user.uid}`), {
        username,
        displayName: username,
        createdAt: serverTimestamp(),
      });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    const code = err.code || "";
    let msg = err.message || "Error";
    if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
      msg = "Username atau password salah";
    else if (code.includes("email-already-in-use")) msg = "Username already used";
    else if (code.includes("weak-password")) msg = "The minimum password length is 6";
    else if (code.includes("invalid-email")) msg = "Username is not valid (just letters and numbers)";
    showError(msg);
  } finally {
    authSubmit.disabled = false;
  }
});

// ---------- Auth state ----------
onAuthStateChanged(auth, async (user) => {
if (user) {
    const snap = await get(ref(db, `users/${user.uid}`));
    const data = snap.exists() ? snap.val() : { username: user.email.split("@")[0] };
    currentUser = { uid: user.uid, username: data.username };

    // ==========================================
    // LOGIKA TOMBOL ADMIN (Hanya untuk 'noti')
    // ==========================================
    const adminBtn = document.getElementById("admin-btn");
    console.log("YANG LOGIN SEKARANG:", currentUser.username);
    console.log("TOMBOL KETEMU GA:", adminBtn);
    if (adminBtn) {
      if (currentUser.username === "Noti") {
        adminBtn.classList.remove("hidden"); // Munculkan tombol jika admin
      } else {
        adminBtn.classList.add("hidden");    // Sembunyikan jika bukan admin
      }
    }
    // ==========================================

    // presence: update lastSeen now and ensure onDisconnect updates it
    const meLastSeenRef = ref(db, `users/${user.uid}/lastSeen`);
    set(meLastSeenRef, serverTimestamp()).catch(() => {});
    onDisconnect(meLastSeenRef).set(serverTimestamp());

    // cleanup previous connected listener if any
    if (connectedRef && connectedListener) {
      off(connectedRef, "value", connectedListener);
      connectedRef = null;
      connectedListener = null;
    }

    // watch .info/connected to mark online/offline and register onDisconnect for online flag
    connectedRef = ref(db, ".info/connected");
    connectedListener = onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        set(ref(db, `users/${user.uid}/online`), true).catch(() => {});
        onDisconnect(ref(db, `users/${user.uid}/online`)).set(false);
        onDisconnect(meLastSeenRef).set(serverTimestamp());
      }
    });
    showChatScreen();
  }
    else {
    // user signed out — mark previous user offline and update lastSeen
    if (currentUser && currentUser.uid) {
      set(ref(db, `users/${currentUser.uid}/online`), false).catch(() => {});
      set(ref(db, `users/${currentUser.uid}/lastSeen`), serverTimestamp()).catch(() => {});
    }

    if (connectedRef && connectedListener) {
      off(connectedRef, "value", connectedListener);
      connectedRef = null;
      connectedListener = null;
    }

    showAuthScreen();
  }
});

function showAuthScreen() {
  cleanup();
  chatScreen.classList.remove("active");
  authScreen.classList.add("active");
  authForm.reset();
}

function showChatScreen() {
  authScreen.classList.remove("active");
  chatScreen.classList.add("active");
  $("me-name").textContent = currentUser.username;
  renderAvatar($("me-avatar"), currentUser.username);
  subscribeUsers();
}

// ---------- Logout ----------
$("logout-btn").addEventListener("click", () => signOut(auth));

// ---------- Users ----------
function subscribeUsers() {
  if (usersRef && usersListener) off(usersRef, "value", usersListener);
  usersRef = ref(db, "users");
  usersListener = onValue(usersRef, (snap) => {
    allUsers = [];
    const val = snap.val() || {};
    for (const uid of Object.keys(val)) {
        if (uid !== currentUser?.uid) {
          allUsers.push({
            uid,
            username: val[uid].username || "unknown",
            online: !!val[uid].online,
            lastSeen: val[uid].lastSeen || null,
          });
        }
    }
    allUsers.sort((a, b) => a.username.localeCompare(b.username));
    renderUsers();
  });
}

function syncCurrentPeerStatus() {
  if (!currentPeer) return;
  const latestPeer = allUsers.find((u) => u.uid === currentPeer.uid);
  if (latestPeer) currentPeer = latestPeer;
}

function updateChatHeader() {
  const statusEl = document.getElementById("peer-status"); // Cari elemen status di header
  if (statusEl) statusEl.textContent = getStatusText(currentPeer); 
}

function renderUsers() {
  syncCurrentPeerStatus();
  const q = $("search-input").value.trim().toLowerCase();
  const list = $("user-list");
  const filtered = allUsers.filter((u) => u.username.toLowerCase().includes(q));

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-list">${
      allUsers.length === 0
        ? "No other users yet.<br>Invite your friends to join!"
        : "Not found."
    }</div>`;
    return;
  }

  list.innerHTML = "";
  filtered.forEach((u) => {
    if (currentPeer?.uid === u.uid) {
      currentPeer = u;
    }

    const item = document.createElement("div");
    item.className = "user-item" + (currentPeer?.uid === u.uid ? " active" : "");
    item.innerHTML = `
      <div class="avatar"></div>
      <div class="user-info">
        <div class="user-name"></div>
        <div class="user-sub"></div>
      </div>
    `;
    renderAvatar(item.querySelector(".avatar"), u.username);
    item.querySelector(".user-name").textContent = u.username;
    const sub = item.querySelector(".user-sub");
    const statusAsli = getStatusText(u);
          sub.textContent = statusAsli === "Online" ? "Online" : "Offline";

    item.addEventListener("click", () => openChat(u));
    list.appendChild(item);
  });

  updateChatHeader();
}

$("search-input").addEventListener("input", renderUsers);

// ---------- Chat ----------
async function openChat(peer) {
  currentPeer = peer;
  currentChatId = chatIdFor(currentUser.uid, peer.uid);

  // ensure chat meta
  const metaRef = ref(db, `chats/${currentChatId}/meta`);
  const metaSnap = await get(metaRef);
  if (!metaSnap.exists()) {
    await set(metaRef, {
      participants: { [currentUser.uid]: true, [peer.uid]: true },
      createdAt: serverTimestamp(),
    });
  }

  $("empty-chat").classList.add("hidden");
  $("active-chat").classList.remove("hidden");
  $("peer-name").textContent = peer.username;
  renderAvatar($("peer-avatar"), peer.username);
  $("messages").innerHTML = "";
  // On mobile widths, hide sidebar and activate chat area
  if (window.innerWidth <= 768) {
    $("sidebar").classList.add("hide-mobile");
    $("sidebar").classList.add("mobile-hidden");
    const chatMain = document.querySelector('.chat-main');
    if (chatMain) chatMain.classList.add('mobile-active');
  }

  renderUsers();

  // cleanup old message listener FIRST
  if (messagesRef && messagesListener) {
    off(messagesRef, "value", messagesListener);
    messagesListener = null;
  }

  // setup message form listener (cleanup old one first)
  const messageForm = $("message-form");
  if (messageFormListener) messageForm.removeEventListener("submit", messageFormListener);
  messageFormListener = async (e) => {
    e.preventDefault();
    const input = $("message-input");
    const text = input.value.trim();
    if (!text || !currentChatId) return;
    input.value = "";

    const msgRef = push(ref(db, `chats/${currentChatId}/messages`));
    await set(msgRef, {
      senderId: currentUser.uid,
      text,
      createdAt: serverTimestamp(),
    });
    await update(ref(db, `chats/${currentChatId}/meta`), {
      lastMessage: text,
      lastMessageAt: serverTimestamp(),
    });
  };
  messageForm.addEventListener("submit", messageFormListener);

  // subscribe messages AFTER cleanup
  messagesRef = query(ref(db, `chats/${currentChatId}/messages`), orderByChild("createdAt"));
messagesListener = onValue(messagesRef, (snap) => {
  const container = $("messages");
  container.innerHTML = "";

  const arr = [];

  snap.forEach((child) => {
    arr.push({
      id: child.key,
      ...child.val()
    });
  });

  container.innerHTML = "";

let lastDay = "";

for (let i = 0; i < arr.length; i++) {
  const m = arr[i];

  const dateStr = m.createdAt
    ? new Date(m.createdAt).toLocaleDateString([], {
        day: "numeric",
        month: "short",
        year: "numeric"
      })
    : "";

  if (dateStr && dateStr !== lastDay) {
    const divider = document.createElement("div");
    divider.className = "day-divider";
    divider.textContent = dateStr;
    container.appendChild(divider);

    lastDay = dateStr;
  }

const mine = m.senderId === currentUser.uid;

const row = document.createElement("div");
row.className = "msg-row" + (mine ? " mine" : "");

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const textNode = document.createTextNode(m.text || "");
bubble.appendChild(textNode);

const time = document.createElement("span");
time.className = "time";

time.textContent = new Date(m.createdAt)
  .toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

bubble.appendChild(time);

  row.appendChild(bubble);
  container.appendChild(row);
}

container.scrollTop = container.scrollHeight;
});
}


// ---------- Mobile ----------
$("open-sidebar-btn").addEventListener("click", () => $("sidebar").classList.remove("hide-mobile"));

// Back button (mobile): kembali ke daftar chat
$("back-btn").addEventListener("click", () => {
  // tunjukkan kembali sidebar/daftar dan sembunyikan chat aktif
  $("sidebar").classList.remove("hide-mobile");
  $("sidebar").classList.remove("mobile-hidden");
  const chatMain = document.querySelector('.chat-main');
  if (chatMain) chatMain.classList.remove('mobile-active');
  $("empty-chat").classList.remove("hidden");
  $("active-chat").classList.add("hidden");
  // cleanup current chat state but keep listener so reopening works
  if (messagesRef && messagesListener) { off(messagesRef, "value", messagesListener); messagesRef = null; messagesListener = null; }
  if (messageFormListener) { $("message-form").removeEventListener("submit", messageFormListener); messageFormListener = null; }
  currentPeer = null;
  currentChatId = null;
  renderUsers();
});

// Ensure mobile-only classes are cleared when resizing to desktop
window.addEventListener('resize', () => {
  if (window.innerWidth > 768) {
    const sb = document.querySelector('.sidebar');
    if (sb) {
      sb.classList.remove('hide-mobile');
      sb.classList.remove('mobile-hidden');
    }
    const chatMain = document.querySelector('.chat-main');
    if (chatMain) chatMain.classList.remove('mobile-active');
  }
});

// ---------- Cleanup ----------
function cleanup() {
  if (messagesRef && messagesListener) { off(messagesRef, "value", messagesListener); messagesRef = null; messagesListener = null; }
  if (usersRef && usersListener) { off(usersRef, "value", usersListener); usersRef = null; usersListener = null; }
  if (messageFormListener) { $("message-form").removeEventListener("submit", messageFormListener); messageFormListener = null; }
  if (connectedRef && connectedListener) { off(connectedRef, "value", connectedListener); connectedRef = null; connectedListener = null; }
  currentUser = null;
  currentPeer = null;
  currentChatId = null;
  allUsers = [];
}