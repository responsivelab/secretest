const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 20e6,
  pingTimeout: 60000,       // aspetta 60s prima di dichiarare la connessione morta
  pingInterval: 25000,      // manda un ping ogni 25s per tenere viva la sessione
});

const PORT = process.env.PORT || 3000;

// ─── Utenti ───────────────────────────────────────────────────────────────────
const USERS = {
  marco:  { name: 'VM', password: 'server1',  decoyPassword: 'Valentina87'  },
  andrea: { name: 'AL', password: 'orlando',  decoyPassword: 'Andrealeti83' }
};

// ─── Stato in memoria ─────────────────────────────────────────────────────────
let connectedSockets = {};
let connectedIPs     = {};
let sessionTokens    = {};
let messages         = [];
let deleteTimers     = {};

// ─── live.txt ─────────────────────────────────────────────────────────────────
function checkLive() {
  try {
    return fs.readFileSync(path.join(__dirname, 'live.txt'), 'utf8').trim() === 'abracadabra';
  } catch { return false; }
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Controllo 3 IP distinti ──────────────────────────────────────────────────
function checkTripleIP() {
  const unique = new Set(Object.values(connectedIPs));
  if (unique.size >= 3) {
    messages = [];
    Object.values(deleteTimers).forEach(t => clearTimeout(t));
    deleteTimers = {};
    io.emit('triple_ip_warning');
    return true;
  }
  return false;
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  if (!checkLive()) {
    if (req.path === '/' || req.path === '/index.html')
      return res.sendFile(path.join(__dirname, 'public', 'locked.html'));
    if (req.path.startsWith('/api/'))
      return res.status(403).json({ error: 'SITE_LOCKED' });
  }
  next();
});

// ─── Login ────────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  if (!checkLive()) return res.status(403).json({ error: 'SITE_LOCKED' });

  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'MISSING_FIELDS' });

  const pw = password.trim();

  // Password reale → chat
  const realUserId = Object.keys(USERS).find(k => USERS[k].password === pw);
  if (realUserId) {
    // Disconnetti sessione precedente dello stesso utente
    if (connectedSockets[realUserId]) {
      const oldToken = Object.keys(sessionTokens).find(t => sessionTokens[t] === realUserId);
      if (oldToken) delete sessionTokens[oldToken];
      const oldSock = io.sockets.sockets.get(connectedSockets[realUserId]);
      if (oldSock) oldSock.disconnect(true);
      delete connectedSockets[realUserId];
      delete connectedIPs[realUserId];
    }
    const token = generateToken();
    sessionTokens[token] = realUserId;
    // Token scade dopo 24h
    setTimeout(() => { delete sessionTokens[token]; }, 24 * 60 * 60 * 1000);
    return res.json({ access: 'chat', token, userName: USERS[realUserId].name, userId: realUserId });
  }

  // Password esca → decoy
  const decoyUserId = Object.keys(USERS).find(k => USERS[k].decoyPassword === pw);
  if (decoyUserId) return res.json({ access: 'decoy' });

  // Password sbagliata
  return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
});

// ─── Logout ───────────────────────────────────────────────────────────────────
app.post('/api/logout', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token && sessionTokens[token]) {
    const uid = sessionTokens[token];
    delete sessionTokens[token];
    delete connectedSockets[uid];
    delete connectedIPs[uid];
  }
  res.json({ ok: true });
});

// ─── Rinnova sessione (keepalive HTTP) ────────────────────────────────────────
app.post('/api/keepalive', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token && sessionTokens[token]) return res.json({ ok: true });
  return res.status(401).json({ error: 'EXPIRED' });
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.use((socket, next) => {
  if (!checkLive()) return next(new Error('SITE_LOCKED'));
  const token = socket.handshake.auth.token;
  if (!token || !sessionTokens[token]) return next(new Error('UNAUTHORIZED'));
  socket.userId   = sessionTokens[token];
  socket.userName = USERS[socket.userId].name;
  next();
});

io.on('connection', (socket) => {
  const userId   = socket.userId;
  const userName = socket.userName;

  connectedSockets[userId] = socket.id;
  const rawIP = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '0.0.0.0';
  connectedIPs[userId] = rawIP.split(',')[0].trim();

  checkTripleIP();
  io.emit('user_status', buildStatus());

  // ── Messaggio testo ────────────────────────────────────────────────────────
  socket.on('send_message', (data) => {
    if (!checkLive()) return;
    const text = (data.text || '').trim().substring(0, 2000);
    if (!text) return;
    const msgId = crypto.randomBytes(16).toString('hex');
    const msg = {
      id: msgId, type: 'text', from: userId, fromName: userName,
      text, replyTo: data.replyTo || null, timestamp: Date.now(), readAt: null
    };
    messages.push(msg);
    io.emit('new_message', sanitizeMsg(msg));
    const otherId = Object.keys(USERS).find(k => k !== userId);
    if (connectedSockets[otherId]) markMessageRead(msgId);
  });

  // ── Immagine ───────────────────────────────────────────────────────────────
  socket.on('send_image', (data) => {
    if (!checkLive()) return;
    if (!data.base64 || data.base64.length > 20 * 1024 * 1024) return;
    const msgId = crypto.randomBytes(16).toString('hex');
    const msg = {
      id: msgId, type: 'image', from: userId, fromName: userName,
      base64: data.base64, replyTo: data.replyTo || null, timestamp: Date.now(), readAt: null
    };
    messages.push(msg);
    io.emit('new_message', sanitizeMsg(msg));
    const otherId = Object.keys(USERS).find(k => k !== userId);
    if (connectedSockets[otherId]) markMessageRead(msgId);
  });

  // ── Segna letto ────────────────────────────────────────────────────────────
  socket.on('mark_read', (data) => {
    if (!data.msgId) return;
    const msg = messages.find(m => m.id === data.msgId && m.from !== userId);
    if (msg && !msg.readAt) markMessageRead(data.msgId);
  });

  // ── Typing ─────────────────────────────────────────────────────────────────
  socket.on('typing', (data) => {
    socket.broadcast.emit('user_typing', { userName, isTyping: data.isTyping });
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log(`[DISCONNECT] ${userName} — ${reason}`);
    if (connectedSockets[userId] === socket.id) {
      delete connectedSockets[userId];
      delete connectedIPs[userId];
    }
    io.emit('user_status', buildStatus());
  });
});

// ─── Timer 5 minuti ──────────────────────────────────────────────────────────
function markMessageRead(msgId) {
  const msg = messages.find(m => m.id === msgId);
  if (!msg || msg.readAt) return;
  msg.readAt = Date.now();
  io.emit('message_read', { msgId, readAt: msg.readAt });
  deleteTimers[msgId] = setTimeout(() => deleteMessage(msgId), 300000);
}

function deleteMessage(msgId) {
  messages = messages.filter(m => m.id !== msgId);
  if (deleteTimers[msgId]) { clearTimeout(deleteTimers[msgId]); delete deleteTimers[msgId]; }
  io.emit('delete_message', { msgId });
}

function sanitizeMsg(m) {
  return {
    id: m.id, type: m.type, from: m.from, fromName: m.fromName,
    text: m.text || null, base64: m.base64 || null,
    replyTo: m.replyTo || null, timestamp: m.timestamp, readAt: m.readAt
  };
}

function buildStatus() {
  const s = {};
  for (const uid of Object.keys(USERS)) {
    s[uid] = !!connectedSockets[uid];
    s[uid + '_name'] = USERS[uid].name;
  }
  return s;
}

server.listen(PORT, '0.0.0.0', () => console.log(`\nServer attivo su porta ${PORT}\n`));
