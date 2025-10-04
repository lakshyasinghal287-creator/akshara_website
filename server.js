// server.js
// Simple file-based DB (data/db.json), Express API + Socket.IO, basic JWT auth.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs').promises;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// Ensure data directory exists
const ensureDataDir = async () => {
  const dir = path.join(__dirname, 'data');
  try { await fs.access(dir); } catch { await fs.mkdir(dir); }
};

async function loadDb() {
  try {
    await ensureDataDir();
    const raw = await fs.readFile(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    const defaultUserPassword = 'Akshara@123';
    const passwordHash = bcrypt.hashSync(defaultUserPassword, 10);
    const db = {
      users: [{ id:1, username:'akshara_reception', passwordHash, role:'reception' }],
      appointments: [],
      consults: []
    };
    await saveDb(db);
    console.log('Created new DB with default receptionist: akshara_reception / Akshara@123');
    return db;
  }
}

async function saveDb(db) {
  await ensureDataDir();
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

const makeToken = (n) => `T-${n}`;

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing auth' });
  const parts = auth.split(' ');
  if (parts.length !== 2) return res.status(401).json({ error: 'Invalid auth' });
  try {
    const payload = jwt.verify(parts[1], JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const queueLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

async function broadcastQueue() {
  const db = await loadDb();
  io.emit('queue_state', db.appointments);
}

// login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  const db = await loadDb();
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  return res.json({ token, user: { username: user.username, role: user.role }});
});

// public queue (search)
app.get('/api/queue', queueLimiter, async (req, res) => {
  const q = (req.query.query || '').trim();
  const db = await loadDb();
  const list = db.appointments || [];
  if (!q) return res.json(list);
  const ql = q.toLowerCase();
  const matches = list.filter(a => {
    if (!a) return false;
    return (a.token && a.token.toLowerCase().includes(ql)) ||
           (a.name && a.name.toLowerCase().includes(ql)) ||
           (a.phone && a.phone.toLowerCase().includes(ql));
  }).slice(0, 10);
  const masked = matches.map(a => {
    const copy = Object.assign({}, a);
    const matchPhone = copy.phone && copy.phone.toLowerCase().includes(ql);
    const matchToken = copy.token && copy.token.toLowerCase().includes(ql);
    if (!matchPhone && !matchToken && copy.name) {
      const n = copy.name.trim().split(' ')[0] || copy.name;
      const mask = n.length > 3 ? (n[0] + '***' + n.slice(-2)) : n;
      copy.nameMasked = mask;
      delete copy.name;
    } else {
      copy.nameMasked = copy.name;
    }
    delete copy.createdAt; delete copy.updatedAt;
    return copy;
  });
  res.json(masked);
});

// create appointment (receptionist)
app.post('/api/appointments', authMiddleware, async (req, res) => {
  if (!['reception','admin'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
  const { name, age, sex, phone, email, arrivalTime, estConsultMin } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });
  if (!phone) return res.status(400).json({ error: 'Missing phone' });
  const phonePattern = /^\+?[0-9\s\-]{7,15}$/;
  if (!phonePattern.test(phone)) return res.status(400).json({ error: 'Invalid phone' });

  const db = await loadDb();
  const next = (db.appointments.length || 0) + 1;
  const token = makeToken(next);
  const appt = {
    id: Date.now(),
    token,
    name,
    age: age || null,
    sex: sex || null,
    phone: phone || null,
    email: email || null,
    arrivalTime: arrivalTime ? new Date(arrivalTime).toISOString() : new Date().toISOString(),
    estConsultMin: estConsultMin || 8,
    status: 'waiting',
    startTime: null,
    endTime: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.appointments.push(appt);
  await saveDb(db);
  await broadcastQueue();
  res.json(appt);
});

// start consult
app.post('/api/consult/start', authMiddleware, async (req, res) => {
  if (!['reception','doctor','admin'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'missing token' });
  const db = await loadDb();
  const appt = db.appointments.find(a => a.token === token);
  if (!appt) return res.status(404).json({ error: 'not found' });
  appt.status = 'inconsult';
  appt.startTime = new Date().toISOString();
  appt.updatedAt = new Date().toISOString();
  await saveDb(db);
  await broadcastQueue();
  res.json(appt);
});

// end consult
app.post('/api/consult/end', authMiddleware, async (req, res) => {
  if (!['reception','doctor','admin'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'missing token' });
  const db = await loadDb();
  const appt = db.appointments.find(a => a.token === token);
  if (!appt) return res.status(404).json({ error: 'not found' });
  if (!appt.startTime) return res.status(400).json({ error: 'consult not started' });
  appt.status = 'done';
  appt.endTime = new Date().toISOString();
  appt.updatedAt = new Date().toISOString();
  const durationMin = Math.round((new Date(appt.endTime) - new Date(appt.startTime)) / 60000);
  db.consults.push({ id: Date.now(), appointmentId: appt.id, token: appt.token, doctor: req.user.username, startTime: appt.startTime, endTime: appt.endTime, durationMin });
  await saveDb(db);
  await broadcastQueue();
  res.json({ appointment: appt, durationMin });
});

// delete all appointments (reset)
app.delete('/api/appointments', authMiddleware, async (req, res) => {
  if (!['reception','admin'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
  const db = await loadDb();
  db.appointments = [];
  await saveDb(db);
  await broadcastQueue();
  res.json({ ok: true });
});

// serve UI
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

io.on('connection', async (socket) => {
  const db = await loadDb();
  socket.emit('queue_state', db.appointments);
  socket.on('request_queue', async () => {
    const fresh = await loadDb();
    socket.emit('queue_state', fresh.appointments);
  });
});

server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
