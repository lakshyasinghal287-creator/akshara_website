// server.js - use this or merge the sections into your existing file
const express = require('express');
const { createServer } = require('http');
const path = require('path');
const session = require('express-session'); // npm i express-session
const bodyParser = require('body-parser');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Simple session-based auth for receptionist-only pages ---
app.use(session({
  secret: 'replace_with_a_strong_secret_in_prod',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // set true if using HTTPS in prod
}));

// Replace this with your real credential check (store hashed passwords server-side)
const RECEP_CREDENTIALS = { username: 'akshara_reception', password: 'Akshara@123' };

// login endpoint (called by receptionist login form)
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === RECEP_CREDENTIALS.username && password === RECEP_CREDENTIALS.password) {
    req.session.user = 'reception';
    return res.json({ ok: true });

// API login route (matches client.js which uses /api/login)
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === RECEP_CREDENTIALS.username && password === RECEP_CREDENTIALS.password) {
    req.session.user = 'reception';
    // generate a lightweight token string (not used for server auth but returned to client)
    const token = '';
    return res.json({ ok: true, token, user: { username: RECEP_CREDENTIALS.username } });
  }
  return res.status(401).json({ ok: false, error: 'Invalid credentials' });
});


  }
  return res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

// logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// middleware to protect receptionist-only routes
function requireReception(req, res, next) {
  if (req.session && req.session.user === 'reception') return next();
  return res.status(401).send('Unauthorized');
}

// ----------------- In-memory queue model -----------------
// You likely already have a queue structure; adapt if needed.
let patients = []; // array of patient objects
let averageConsultMins = 8; // initial default, updates after each consult
let doctorPresent = false;

// patient object example:
// {
//   token: 1, name: 'Mr X', phone: '...', bookedTime: ISO string or null,
//   estConsultMin: 8,
//   status: 'waiting' | 'in_consult' | 'done',
//   arrivalTime: ISO string,
//   startTime: ISO string | null,
//   endTime: ISO string | null
// }

// helper to emit queue change
function broadcastQueue() {
  io.emit('queue_update', computeQueueView());
}

// basic token generator
function nextToken() {
  const maxToken = patients.reduce((m, p) => Math.max(m, p.token || 0), 0);
  return maxToken + 1;
}

// compute queue view with ETAs and formatted output
function computeQueueView() {
  // copy and sort by token (or arrival/booked order logic)
  const list = [...patients].sort((a, b) => (a.token || 0) - (b.token || 0));
  const now = new Date();

  // find if someone is in consult
  const inConsult = list.find(p => p.status === 'in_consult');
  // baseline time
  let baselineTime;
  if (inConsult && inConsult.startTime) {
    baselineTime = new Date(inConsult.startTime);
  } else if (doctorPresent) {
    baselineTime = now;
  } else {
    baselineTime = null; // if doctor not present, for patients with bookedTime we use that
  }

  // we'll accumulate time offset in minutes
  let offsetMins = 0;
  // if a patient is in consult, compute remaining time for that consult: est - elapsed
  if (inConsult && inConsult.startTime) {
    const est = inConsult.estConsultMin || averageConsultMins;
    const elapsed = Math.max(0, Math.floor((now - new Date(inConsult.startTime)) / 60000));
    const remaining = Math.max(0, est - elapsed);
    offsetMins += remaining;
  }

  const view = list.map((p, idx) => {
    if (p.status === 'done') {
      return {
        ...p,
        displayType: 'done',
        startTime: p.startTime,
        endTime: p.endTime
      };
    }
    if (p.status === 'in_consult') {
      return {
        ...p,
        displayType: 'in_consult',
        startTime: p.startTime
      };
    }
    // waiting patient: compute ETA
    let eta = null;
    if (!baselineTime) {
      // Doctor not present -> use bookedTime if available, else null
      if (p.bookedTime) {
        eta = new Date(p.bookedTime);
      } else {
        // fallback: now + offset
        eta = new Date(now.getTime() + offsetMins * 60000);
      }
    } else {
      eta = new Date(baselineTime.getTime() + offsetMins * 60000);
    }
    // add this patient's estConsult to offset for next patient
    const est = (p.estConsultMin || averageConsultMins);
    offsetMins += est;
    return {
      ...p,
      displayType: 'waiting',
      eta: eta.toISOString()
    };
  });

  return { patients: view, averageConsultMins, doctorPresent };
}

// ----------------- API endpoints -----------------

// get queue (used by client display page)
app.get('/api/queue', (req, res) => {
  res.json(computeQueueView());
});

// add patient (receptionist uses this)
app.post('/api/patients', requireReception, (req, res) => {
  const { name, age, sex, phone, bookedTime, estConsultMin } = req.body;
  const newP = {
    token: nextToken(),
    name,
    age,
    sex,
    phone,
    bookedTime: bookedTime || null,
    estConsultMin: estConsultMin || averageConsultMins,
    status: 'waiting',
    arrivalTime: new Date().toISOString(),
    startTime: null,
    endTime: null
  };
  patients.push(newP);
  broadcastQueue();
  return res.json({ ok: true, patient: newP });
});

// receptionist toggles doctorPresent
app.post('/api/doctor/present', requireReception, (req, res) => {
  const { present } = req.body;
  doctorPresent = !!present;
  broadcastQueue();
  return res.json({ ok: true, doctorPresent });
});

// start consult for token
app.post('/api/patient/:token/start', requireReception, (req, res) => {
  const token = Number(req.params.token);
  const p = patients.find(x => x.token === token);
  if (!p) return res.status(404).json({ ok: false, error: 'Not found' });

  // prevent duplicate "in consult"
  if (p.status === 'in_consult') {
    return res.status(400).json({ ok: false, error: 'Patient already in consult' });
  }

  // if another patient currently in_consult, you may still start this patient (depends on your policy).
  // We'll allow it but mark this patient as in_consult and update startTime.
  p.status = 'in_consult';
  p.startTime = new Date().toISOString();
  // clear any previous endTime (if re-opened)
  p.endTime = null;
  broadcastQueue();
  return res.json({ ok: true, patient: p });
});

// end consult for token
app.post('/api/patient/:token/end', requireReception, (req, res) => {
  const token = Number(req.params.token);
  const p = patients.find(x => x.token === token);
  if (!p) return res.status(404).json({ ok: false, error: 'Not found' });

  // only end if currently in consult (or allow ending if waiting — we handle)
  if (p.status !== 'in_consult') {
    return res.status(400).json({ ok: false, error: 'Patient is not in consult' });
  }

  p.endTime = new Date().toISOString();
  // compute actual consult duration and update averageConsultMins (simple running avg)
  const started = new Date(p.startTime);
  const ended = new Date(p.endTime);
  const actualMinutes = Math.max(1, Math.round((ended - started) / 60000)); // at least 1 min
  // update average using simple exponential moving average for stability
  averageConsultMins = Math.round((averageConsultMins * 3 + actualMinutes) / 4);

  p.status = 'done';
  broadcastQueue();
  return res.json({ ok: true, patient: p, averageConsultMins });
});

// remove or reset list (reception)
app.post('/api/reset', requireReception, (req, res) => {
  patients = [];
  averageConsultMins = 8;
  doctorPresent = false;
  broadcastQueue();
  return res.json({ ok: true });
});

// simple health
app.get('/health', (req, res) => res.send('ok'));

// ---------------- socket.io connections ----------------
io.on('connection', socket => {
  // send current view on connect
  socket.emit('queue_update', computeQueueView());

  socket.on('ping', () => socket.emit('pong'));
});

// ---------------- start server ----------------
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
