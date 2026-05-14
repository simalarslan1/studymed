// Load .env.local before anything else
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) process.env[key] = value;
      }
    }
  });
}

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const next = require('next');
const webpush = require('web-push');
const { v4: uuidv4 } = require('uuid');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

// In-memory storage
const users = new Map(); // name -> { name, subscription, socketId, online }
const rooms = new Map(); // roomId -> Set of { socketId, name }
const invites = new Map(); // roomId -> { fromName, toName }
const availabilityMessages = new Map(); // name -> [{ from, time, createdAt }]

// VAPID key setup
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (!vapidPublicKey || !vapidPrivateKey) {
  console.log('\n⚠️  No VAPID keys found. Generating temporary keys for this session...');
  const keys = webpush.generateVAPIDKeys();
  vapidPublicKey = keys.publicKey;
  vapidPrivateKey = keys.privateKey;
  console.log('\n📋 Add these to .env.local for persistent keys:');
  console.log(`VAPID_PUBLIC_KEY=${vapidPublicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${vapidPrivateKey}`);
  console.log('\n');
}

webpush.setVapidDetails(
  'mailto:study@studymed.app',
  vapidPublicKey,
  vapidPrivateKey
);

app.prepare().then(() => {
  const server = express();
  const httpServer = createServer(server);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  server.use(express.json());

  // REST API routes
  server.get('/api/vapid-key', (req, res) => {
    res.json({ publicKey: vapidPublicKey });
  });

  server.post('/api/register', (req, res) => {
    const { name, subscription } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const existing = users.get(name) || {};
    users.set(name, {
      name,
      subscription: subscription || existing.subscription || null,
      socketId: existing.socketId || null,
      online: existing.socketId ? true : false
    });

    console.log(`✅ Registered user: ${name}`);
    res.json({ success: true, name });
  });

  server.get('/api/users', (req, res) => {
    const userList = Array.from(users.values()).map(u => ({
      name: u.name,
      online: u.socketId ? true : false
    }));
    res.json(userList);
  });

  server.post('/api/invite', async (req, res) => {
    const { fromName, toName, roomId } = req.body;
    if (!fromName || !toName || !roomId) {
      return res.status(400).json({ error: 'fromName, toName, and roomId are required' });
    }

    const targetUser = users.get(toName);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Kaydet — reddetme bildirimi için lazım
    invites.set(roomId, { fromName, toName });

    // Emit socket event if user is online
    if (targetUser.socketId) {
      io.to(targetUser.socketId).emit('invite', { fromName, roomId });
    }

    // Send push notification if subscription exists
    if (targetUser.subscription) {
      const payload = JSON.stringify({
        title: `📚 ${fromName} ders çalışıyor!`,
        body: `${fromName} seni ders çalışmaya davet ediyor - Katıl!`,
        roomId, fromName, icon: '/icon-192.png'
      });
      try {
        await webpush.sendNotification(targetUser.subscription, payload);
      } catch (err) {
        console.error(`❌ Push failed for ${toName}:`, err.message);
      }
    }

    res.json({ success: true });
  });

  // Arkadaş "Müsait Değilim" tıkladığında
  server.post('/api/decline', (req, res) => {
    const { roomId, fromName } = req.body; // fromName = reddeden kişi (Süeda)
    const invite = invites.get(roomId);
    if (!invite) return res.json({ success: true }); // davet expire olmuş

    const inviter = users.get(invite.fromName); // daveti gönderen (Şimal)
    if (inviter?.socketId) {
      io.to(inviter.socketId).emit('invite-declined', { byName: fromName });
    }
    invites.delete(roomId);
    res.json({ success: true });
  });

  // ── Availability endpoints ───────────────────────────────────────────────────

  // POST /api/availability
  server.post('/api/availability', (req, res) => {
    const { notifyName, from, time } = req.body;
    if (!notifyName || !from || !time) {
      return res.status(400).json({ error: 'notifyName, from, and time are required' });
    }
    if (!availabilityMessages.has(notifyName)) availabilityMessages.set(notifyName, []);
    availabilityMessages.get(notifyName).push({ from, time, createdAt: Date.now() });

    // Also notify via socket if online
    const user = users.get(notifyName);
    if (user?.socketId) {
      io.to(user.socketId).emit('availability-update', { from, time });
    }
    console.log(`💌 Availability from ${from} for ${notifyName}: ${time}`);
    res.json({ success: true });
  });

  // GET /api/messages?name=Şimal
  server.get('/api/messages', (req, res) => {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const messages = availabilityMessages.get(name) || [];
    res.json(messages);
  });

  // DELETE /api/messages?name=Şimal
  server.delete('/api/messages', (req, res) => {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'name is required' });
    availabilityMessages.delete(name);
    res.json({ success: true });
  });

  // ── Socket.io ────────────────────────────────────────────────────────────────

  // Socket.io
  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);
    let currentUserName = null;
    let currentRoomId = null;

    const broadcastUsers = () => {
      const userList = Array.from(users.values()).map(u => ({ name: u.name, online: u.online }));
      io.emit('users-update', userList);
    };

    socket.on('register', (name) => {
      currentUserName = name;
      const user = users.get(name);
      if (user) {
        user.socketId = socket.id;
        user.online = true;
        users.set(name, user);
      } else {
        users.set(name, {
          name,
          subscription: null,
          socketId: socket.id,
          online: true
        });
      }
      console.log(`👤 Socket registered: ${name} (${socket.id})`);
      broadcastUsers();
    });

    socket.on('join-room', ({ roomId, name }) => {
      currentRoomId = roomId;
      currentUserName = name;

      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Map());
      }

      const room = rooms.get(roomId);
      const existingMembers = Array.from(room.values());

      // Send existing members to the joiner
      socket.emit('room-info', { members: existingMembers });

      // Tell existing members about the new joiner
      existingMembers.forEach(member => {
        io.to(member.socketId).emit('peer-joined', {
          socketId: socket.id,
          name: name
        });
      });

      // Add joiner to room
      room.set(socket.id, { socketId: socket.id, name });
      socket.join(roomId);

      console.log(`🚪 ${name} joined room ${roomId}. Members: ${room.size}`);
    });

    socket.on('signal', ({ to, data }) => {
      io.to(to).emit('signal', { from: socket.id, data });
    });

    socket.on('leave-room', () => {
      if (currentRoomId && rooms.has(currentRoomId)) {
        const room = rooms.get(currentRoomId);
        room.delete(socket.id);
        socket.to(currentRoomId).emit('peer-left', { socketId: socket.id, name: currentUserName });
        socket.leave(currentRoomId);

        if (room.size === 0) {
          rooms.delete(currentRoomId);
        }
        console.log(`🚪 ${currentUserName} left room ${currentRoomId}`);
        currentRoomId = null;
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socket.id} (${currentUserName})`);

      if (currentUserName) {
        const user = users.get(currentUserName);
        if (user && user.socketId === socket.id) {
          user.socketId = null;
          user.online = false;
          users.set(currentUserName, user);
          broadcastUsers();
        }
      }

      if (currentRoomId && rooms.has(currentRoomId)) {
        const room = rooms.get(currentRoomId);
        room.delete(socket.id);
        socket.to(currentRoomId).emit('peer-left', { socketId: socket.id, name: currentUserName });

        if (room.size === 0) {
          rooms.delete(currentRoomId);
        }
      }
    });
  });

  // Let Next.js handle all other routes
  server.all('*', (req, res) => {
    return handle(req, res);
  });

  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`\n🚀 StudyMed server running at http://localhost:${PORT}`);
    console.log(`   Environment: ${dev ? 'development' : 'production'}\n`);
  });
});
