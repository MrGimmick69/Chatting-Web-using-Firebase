import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signOut } from 'firebase/auth';
import { getDatabase, ref, get, onValue, off, query, orderByChild } from 'firebase/database';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const authError = document.getElementById('authError');
const adminPanel = document.getElementById('adminPanel');
const chatRoomList = document.getElementById('chatRoomList');
const messagesContainer = document.getElementById('messagesContainer');
const headerTitle = document.getElementById('headerTitle');
const headerInfo = document.getElementById('headerInfo');
const backToChatBtn = document.getElementById('backToChatBtn');

let currentUser = null;
let activeRoom = null;
let roomsListener = null;
let usersListener = null;
let messagesListener = null;
let messagesRef = null;
let roomListCache = [];
let chatsSnapshot = null;
let usersByUid = {};

function showError(message) {
  authError.style.display = 'flex';
  authError.innerHTML = `⛔ ${message}`;
  adminPanel.style.display = 'none';
}

function showPanel() {
  authError.style.display = 'none';
  adminPanel.style.display = 'flex';
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateHeading(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatSidebarDate(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function getDisplayName(uid) {
  if (!uid) return 'Unknown';
  if (uid === currentUser?.uid) return currentUser.username || 'You';
  return usersByUid[uid]?.username || uid;
}

function formatParticipants(participants) {
  const names = Object.keys(participants || {})
    .filter((uid) => uid !== currentUser?.uid)
    .map((uid) => getDisplayName(uid));

  return names.length ? names.join(' & ') : 'Chat Room';
}

function renderRooms(rooms) {
  chatRoomList.innerHTML = '';

  if (!rooms.length) {
    chatRoomList.innerHTML = '<li class="admin-empty">Belum ada percakapan.</li>';
    return;
  }

  rooms.forEach((room) => {
    const item = document.createElement('li');
    item.className = `admin-room${activeRoom && activeRoom.id === room.id ? ' active' : ''}`;
    item.innerHTML = `
      <div class="admin-room-title">${room.name}</div>
      <div class="admin-room-preview">${room.preview || 'Belum ada pesan'}</div>
      <div class="admin-room-preview" style="margin-top: 4px; font-size: 11px; opacity: 0.75;">${room.lastMessageAt ? formatSidebarDate(room.lastMessageAt) : ''}</div>
    `;
    item.addEventListener('click', () => selectRoom(room));
    chatRoomList.appendChild(item);
  });
}

function renderMessages(messages) {
  messagesContainer.innerHTML = '';

  if (!messages.length) {
    messagesContainer.innerHTML = '<div class="admin-empty">Belum ada pesan di percakapan ini.</div>';
    return;
  }

  let lastDate = '';
  let lastRecipient = '';
  const recipientName = activeRoom?.name || 'Conversation';

  messages.forEach((msg) => {
    const currentDate = formatDateHeading(msg.createdAt);

    if (currentDate !== lastDate) {
      const dateDivider = document.createElement('div');
      dateDivider.className = 'timeline-date';
      dateDivider.textContent = currentDate;
      messagesContainer.appendChild(dateDivider);
      lastDate = currentDate;
    }

    if (recipientName !== lastRecipient) {
      const recipientLabel = document.createElement('div');
      recipientLabel.className = 'timeline-recipient';
      recipientLabel.textContent = `To: ${recipientName}`;
      messagesContainer.appendChild(recipientLabel);
      lastRecipient = recipientName;
    }

    const row = document.createElement('div');
    row.className = `admin-msg${msg.senderId === currentUser?.uid ? ' mine' : ''}`;
    row.innerHTML = `
      <div>${msg.text}</div>
      <div class="admin-msg-meta">${formatTime(msg.createdAt)}</div>
    `;
    messagesContainer.appendChild(row);
  });
}

function selectRoom(room) {
  activeRoom = room;
  headerTitle.textContent = room.name;
  headerInfo.textContent = room.preview || 'Percakapan';
  renderRooms(roomListCache);

  if (messagesRef && messagesListener) {
    off(messagesRef, 'value', messagesListener);
  }

  messagesRef = ref(db, `chats/${room.id}/messages`);
  messagesListener = onValue(query(messagesRef, orderByChild('createdAt')), (snap) => {
    const arr = [];
    snap.forEach((child) => arr.push({ id: child.key, ...child.val() }));
    renderMessages(arr);
  });
}

function getRoomListFromSnapshot() {
  return roomListCache;
}

function buildRoomsFromChats() {
  if (!chatsSnapshot) return;

  const rooms = [];
  chatsSnapshot.forEach((child) => {
    const data = child.val() || {};
    const messagesSnap = child.child('messages');

    if (!messagesSnap.exists()) return;

    const messages = [];
    messagesSnap.forEach((msgChild) => {
      const msg = msgChild.val() || {};
      messages.push({ id: msgChild.key, ...msg });
    });

    if (!messages.length) return;

    messages.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const newestMessage = messages[0];

    rooms.push({
      id: child.key,
      name: formatParticipants(data.meta?.participants || {}),
      preview: newestMessage?.text || 'Belum ada pesan',
      lastMessageAt: newestMessage?.createdAt || null,
    });
  });

  roomListCache = rooms;
  renderRooms(rooms);

  if (!activeRoom && rooms.length) {
    selectRoom(rooms[0]);
  }
}

function subscribeUsers() {
  if (usersListener) {
    off(ref(db, 'users'), 'value', usersListener);
  }

  const usersRef = ref(db, 'users');
  usersListener = onValue(usersRef, (snap) => {
    usersByUid = {};
    snap.forEach((child) => {
      usersByUid[child.key] = child.val() || {};
    });
    buildRoomsFromChats();
  });
}

function subscribeRooms() {
  if (roomsListener) {
    off(ref(db, 'chats'), 'value', roomsListener);
  }

  const chatsRef = ref(db, 'chats');
  roomsListener = onValue(chatsRef, (snap) => {
    chatsSnapshot = snap;
    buildRoomsFromChats();
  });
}

backToChatBtn.addEventListener('click', () => {
  window.location.href = 'index.html';
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showError('Anda harus login terlebih dahulu.');
    return;
  }

  const userSnap = await get(ref(db, `users/${user.uid}`));
  const data = userSnap.exists() ? userSnap.val() : {};
  currentUser = { uid: user.uid, username: data.username || user.email?.split('@')[0] || 'user' };

  if (currentUser.username !== 'Noti') {
    showError('Anda tidak memiliki akses admin.');
    return;
  }

  showPanel();
  subscribeUsers();
  subscribeRooms();
});
