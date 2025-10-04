// public/client.js
// Full client logic for Akshara OPD app.
// - Uses class-based screen toggles (no inline display writes) so CSS transitions work.
// - Supports receptionist login, add patient (phone required), start/end consult,
//   patient search by token/name/phone, CSV export, reset, and doctor presence/arrival.

(function () {
  const $ = (id) => document.getElementById(id);
  const API = (p) => '/api' + p;

// lightweight akFetch used only for login to ensure credentials are sent
window.akFetch = function akFetch(url, opts = {}) {
  const merged = Object.assign({}, opts || {});
  if (!merged.credentials) merged.credentials = 'same-origin';
                   return window.fetch(url, merged);
};

  let jwt = localStorage.getItem('mf_jwt') || null;
  let cachedQueue = [];

  // Local keys
  const DOCTOR_PRESENT_KEY = 'mf_doctor_present';
  const DOCTOR_ARRIVAL_KEY = 'mf_doctor_arrival';

  // ---------- Page show/hide (with fade transitions) ----------
  let currentScreen = null;
  const FADE_DURATION = 320; // ms - match your CSS transition

  function hideAllScreensImmediate() {
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.remove('active', 'fade-out');
      s.style.display = 'none';
    });
    currentScreen = null;
  }

  function showScreen(id) {
    const next = document.getElementById(id);
    if (!next) return;
    if (currentScreen === next) return; // already visible

    const stage = document.querySelector('.stage');
    if (stage) stage.classList.add('fading');

    // Helper to fade in the next screen
    function fadeInNext() {
      // Hide any other screens immediately (safety)
      document.querySelectorAll('.screen').forEach(s => {
        if (s !== next) {
          s.classList.remove('active', 'fade-out');
          s.style.display = 'none';
        }
      });

      // Make next visible and trigger CSS transition
      next.style.display = 'block';
      // Use requestAnimationFrame to ensure the browser notices the display change before adding class
      requestAnimationFrame(() => {
        next.classList.add('active');
        currentScreen = next;
        // remove stage fading after transition finishes
        setTimeout(() => { if (stage) stage.classList.remove('fading'); }, FADE_DURATION + 20);
      });
    }

    // If there is a current screen, fade it out first
    if (currentScreen) {
      currentScreen.classList.add('fade-out');
      setTimeout(() => {
        currentScreen.classList.remove('fade-out', 'active');
        currentScreen.style.display = 'none';
        fadeInNext();
      }, FADE_DURATION);
    } else {
      // no current screen — just show the next
      fadeInNext();
    }
  }

  // ---------- Clock ----------
  function tickClock() {
    const c = $('currentTime');
    if (c) c.textContent = new Date().toLocaleTimeString();
  }
  setInterval(tickClock, 1000);
  tickClock();

  // ---------- Doctor local state ----------
  function getDoctorPresent() { return localStorage.getItem(DOCTOR_PRESENT_KEY) === 'true'; }
  function setDoctorPresent(v) { localStorage.setItem(DOCTOR_PRESENT_KEY, v ? 'true' : 'false'); renderDoctorStatus(); }
  function getDoctorArrival() { return localStorage.getItem(DOCTOR_ARRIVAL_KEY) || null; }
  function setDoctorArrival(iso) { if (iso) localStorage.setItem(DOCTOR_ARRIVAL_KEY, iso); else localStorage.removeItem(DOCTOR_ARRIVAL_KEY); renderDoctorStatus(); }

/* ---------- Doctor shifts & improved ETA utilities (insert here) ---------- */
// storage key for shifts
const DOCTOR_SHIFTS_KEY = 'mf_doctor_shifts'; // stores array of { startISO, endISO }

/**
 * Get array of shifts (sorted ascending)
 * returns array of { start: Date, end: Date, startISO, endISO }
 */
function getDoctorShifts() {
  try {
    const raw = localStorage.getItem(DOCTOR_SHIFTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return arr.map(s => ({
      start: new Date(s.startISO),
      end: new Date(s.endISO),
      startISO: s.startISO,
      endISO: s.endISO
    })).sort((a,b) => a.start - b.start);
  } catch (e) {
    console.warn('failed to parse shifts', e);
    return [];
  }
}

function setDoctorShifts(shifts) {
  // expect array of { startISO, endISO } ; store as-is
  localStorage.setItem(DOCTOR_SHIFTS_KEY, JSON.stringify(shifts || []));
}

/**
 * Add a shift (startISO, endISO)
 */
function addDoctorShift(startISO, endISO) {
  const cur = getDoctorShifts().map(s => ({ startISO: s.startISO, endISO: s.endISO }));
  cur.push({ startISO, endISO });
  setDoctorShifts(cur);
}

/**
 * Find the shift that contains `dt` (Date) or null
 */
function findShiftContaining(dt) {
  const shifts = getDoctorShifts();
  for (const s of shifts) {
    if (dt >= s.start && dt <= s.end) return s;
  }
  return null;
}

/**
 * Find first shift that starts on or after dt
 */
function findNextShiftAfter(dt) {
  const shifts = getDoctorShifts();
  for (const s of shifts) {
    if (s.start.getTime() >= dt.getTime()) return s;
  }
  return null;
}

/**
 * Returns the shift which the appointment logically belongs to:
 * - If appointment has a booked time and it falls inside a shift, return that shift.
 * - Otherwise, return the next shift after the booked time (or next shift after now).
 */
function shiftForAppointmentOrNext(bookedDate) {
  if (bookedDate) {
    const inShift = findShiftContaining(bookedDate);
    if (inShift) return inShift;
    const next = findNextShiftAfter(bookedDate);
    if (next) return next;
  }
  return findNextShiftAfter(new Date());
}

/* ---------- UI for managing doctor shifts ---------- */
function renderShiftList() {
  const container = document.getElementById('shiftList');
  if (!container) return;
  const shifts = getDoctorShifts();
  if (!shifts.length) {
    container.innerHTML = '<div class="muted small">No shifts added yet.</div>';
    return;
  }
  container.innerHTML = shifts.map((s, i) => {
    const start = new Date(s.start).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    const end = new Date(s.end).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    const dateStr = new Date(s.start).toLocaleDateString();
    return `
      <div class="shift-item">
        <span>${dateStr}: ${start} → ${end}</span>
        <button data-index="${i}">×</button>
      </div>`;
  }).join('');

  // delete button listeners
  container.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', e => {
      const i = parseInt(e.currentTarget.dataset.index);
      const arr = getDoctorShifts().map(s => ({ startISO: s.startISO, endISO: s.endISO }));
      arr.splice(i, 1);
      setDoctorShifts(arr);
      renderShiftList();
      alert('Shift removed.');
    });
  });
}

function bindShiftManagerUI() {
  const addBtn = document.getElementById('addShiftBtn');
  if (!addBtn) return;

  addBtn.addEventListener('click', () => {
    const startEl = document.getElementById('shiftStart');
    const endEl = document.getElementById('shiftEnd');
    const start = startEl.value;
    const end = endEl.value;
    if (!start || !end) return alert('Please select both start and end time.');
    const sISO = new Date(start).toISOString();
    const eISO = new Date(end).toISOString();
    if (new Date(eISO) <= new Date(sISO)) return alert('End time must be after start time.');
    addDoctorShift(sISO, eISO);
    startEl.value = '';
    endEl.value = '';
    renderShiftList();
    alert('Shift added successfully!');
  });

  renderShiftList();
}


  function renderDoctorStatus() {
    const presence = getDoctorPresent();
    const arrival = getDoctorArrival();
    const el = $('doctorPresence');
    if (el) {
      if (presence) el.textContent = 'Present';
      else if (arrival) el.textContent = `Arrives at ${new Date(arrival).toLocaleString()}`;
      else el.textContent = 'Not available';
    }
    const toggle = $('doctorToggle');
    if (toggle) toggle.textContent = presence ? 'Mark doctor absent' : 'Mark doctor present';
    const arrivalInput = $('doctorArrival');
    if (arrivalInput) {
      if (arrival) {
        const iso = new Date(arrival);
        const tz = iso.getTimezoneOffset() * 60000;
        arrivalInput.value = new Date(iso.getTime() - tz).toISOString().slice(0, 16);
      } else arrivalInput.value = '';
    }
  }

  // ---------- small binder ----------
  function bind(id, ev, fn) {
    const el = $(id);
    if (!el) return;
    el.addEventListener(ev, fn);
  }

  // ---------- Navigation bindings ----------
  bind('openLogin', 'click', () => showScreen('loginScreen'));
  bind('openPatient', 'click', () => showScreen('patientScreen'));
  bind('backHomeFromLogin', 'click', () => showScreen('homeScreen'));
  bind('backHomeFromPatient', 'click', () => showScreen('homeScreen'));

  // ensure header buttons (if any) also work
  bind('btnLogin', 'click', () => showScreen('loginScreen'));
  bind('btnPatient', 'click', () => showScreen('patientScreen'));

  // ---------- Authentication ----------
  bind('loginForm', 'submit', async (e) => {
    e.preventDefault();
    const user = $('username') ? $('username').value.trim() : '';
    const pass = $('password') ? $('password').value.trim() : '';
    if (!user || !pass) { if ($('loginError')) $('loginError').textContent = 'Enter credentials'; return; }
    try {
      const res = await fetch(API('/login'), {{ credentials: 'same-origin', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass ) });
      if (!res.ok) {
        const j = await res.json().catch(()=>({ error:'Login failed' }));
        if ($('loginError')) $('loginError').textContent = j.error || 'Login failed';
        return;
      }
      const data = await res.json();
      jwt = data.token;
      localStorage.setItem('mf_jwt', jwt);
      if (data.user && data.user.username) $('currentUser').textContent = data.user.username;
      if ($('loginError')) $('loginError').textContent = '';
      showScreen('receptionScreen');
      requestQueue();
      renderDoctorStatus();
    } catch (err) {
      console.error(err);
      if ($('loginError')) $('loginError').textContent = 'Login error';
    }
  });

  bind('logoutBtn', 'click', () => {
    jwt = null;
    localStorage.removeItem('mf_jwt');
    if ($('currentUser')) $('currentUser').textContent = '-';
    showScreen('homeScreen');
  });

  // ---------- Doctor controls ----------
  bind('doctorToggle', 'click', () => setDoctorPresent(!getDoctorPresent()));
  bind('setArrival', 'click', () => {
    const v = $('doctorArrival') ? $('doctorArrival').value : null;
    if (!v) { setDoctorArrival(null); alert('Doctor arrival cleared'); return; }
    setDoctorArrival(new Date(v).toISOString()); alert('Doctor arrival set');
  });

  // ---------- Socket / queue fetch ----------
  function requestQueue() {
    try { if (window.io && io) io().emit('request_queue'); else fetchQueueOnce(); } catch(e){ fetchQueueOnce(); }
  }

  function fetchQueueOnce() {
    fetch(API('/queue')).then(r => r.json()).then(q => { cachedQueue = q || []; applyFiltersAndRender(); }).catch(err => { console.warn('queue fetch failed', err); cachedQueue = []; applyFiltersAndRender(); });
  }

  // initialize socket
  try {
    if (window.io && io) {
      const s = io();
      s.on && s.on('connect', ()=> s.emit('request_queue'));
      s.on && s.on('queue_state', (q)=> { cachedQueue = q || []; applyFiltersAndRender(); });
    } else {
      fetchQueueOnce();
    }
  } catch(e){ console.warn('socket init failed', e); fetchQueueOnce(); }

  // ---------- Add patient (with phone validation) ----------
  bind('patientForm', 'submit', async (e) => {
    e.preventDefault();
    if (!jwt) { alert('Receptionist login required'); return; }
    const name = $('p_name') ? $('p_name').value.trim() : '';
    if (!name) { alert('Enter patient name'); return; }
    const age = $('p_age') ? parseInt($('p_age').value) || null : null;
    const sex = $('p_sex') ? $('p_sex').value : null;
    const phoneEl = $('p_phone');
    const phone = phoneEl ? phoneEl.value.trim() : '';
    const phonePattern = /^\+?[0-9\s\-]{7,15}$/;
    if (!phone || !phonePattern.test(phone)) { alert('Please enter a valid phone number (include country code, e.g. +919876543210).'); if (phoneEl) phoneEl.focus(); return; }
    const arrivalVal = $('p_arrival') ? $('p_arrival').value : null;
    const arrival = arrivalVal ? new Date(arrivalVal).toISOString() : null;
    const est = $('p_est') ? parseInt($('p_est').value) || null : null;

    try {
      const res = await fetch(API('/appointments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
        body: JSON.stringify({ name, age, sex, phone, arrivalTime: arrival, estConsultMin: est })
      });
      if (!res.ok) {
        const j = await res.json().catch(()=>({error:'failed'}));
        alert('Add failed: ' + (j.error || 'unknown'));
        return;
      }
      if ($('patientForm')) $('patientForm').reset();
      // ask server update via socket (or refetch)
      if (window.io && io) io().emit('request_queue');
      else fetchQueueOnce();
    } catch (err) {
      console.error(err); alert('Failed to add patient');
    }
  });

  // ---------- Start / finish consult (delegated) ----------
  const queueContainer = $('queueContainer');
  if (queueContainer) {
    queueContainer.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const tok = btn.dataset && btn.dataset.token;
      if (!tok) return;
      if (!jwt) { alert('Login required'); return; }
      try {
        if (btn.classList.contains('start')) {
          await fetch(API('/consult/start'), { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+jwt}, body: JSON.stringify({ token: tok }) });
        } else if (btn.classList.contains('finish')) {
          await fetch(API('/consult/end'), { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+jwt}, body: JSON.stringify({ token: tok }) });
        }
        if (window.io && io) io().emit('request_queue'); else fetchQueueOnce();
      } catch (err) { console.error(err); }
    });
  }

  // ---------- Patient search (public) ----------
  bind('checkTokenBtn', 'click', async () => {
    const q = $('tokenInput') ? $('tokenInput').value.trim() : '';
    if (!q) return;
    try {
      const res = await fetch(API('/queue?query=' + encodeURIComponent(q)));
      if (!res.ok) { if ($('tokenResult')) $('tokenResult').textContent = 'Search failed'; return; }
      const matches = await res.json();
      const out = $('tokenResult');
      if (!out) return;
      if (!matches || !matches.length) { out.innerText = 'No matches found. Please check token, name or phone.'; return; }
      if (matches.length === 1 && matches[0].name) {
        const appt = matches[0];
        // fetch full queue to compute accurate ETA
        const allRes = await fetch(API('/queue')); const all = await allRes.json();
        const idx = all.findIndex(a => a.token === appt.token);
        const est = computeEstimatedStart(all, idx);
        const estText = (typeof est === 'string') ? est : est.toLocaleTimeString();
        out.innerHTML = `<div style="font-weight:700">${appt.token} — ${appt.name}</div>
                         <div>Phone: ${appt.phone||'—'}</div>
                         <div>Booked: ${appt.arrivalTime? new Date(appt.arrivalTime).toLocaleTimeString() : '—'}</div>
                         <div>Estimated start: ${estText}</div>
                         <div>Status: ${appt.status}</div>`;
        return;
      }
      // multiple matches: list with view buttons
      let html = '<div style="display:flex;flex-direction:column;gap:8px">';
      matches.forEach(appt => {
        const nm = appt.name || appt.nameMasked || '—';
        const booked = appt.arrivalTime ? new Date(appt.arrivalTime).toLocaleTimeString() : '—';
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.04)">
                  <div><div style="font-weight:700">${nm}</div><div style="font-size:13px;color:#d8dfe8">${appt.token} • ${booked}</div></div>
                  <div><button class="btn small viewMatch" data-token="${appt.token}">View</button></div>
                </div>`;
      });
      html += '</div>';
      out.innerHTML = html;
      out.querySelectorAll('.viewMatch').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
          const tokenVal = ev.currentTarget.dataset.token;
          const allRes = await fetch(API('/queue')); const all = await allRes.json();
          const appt = all.find(a => a.token === tokenVal);
          if (!appt) { out.innerText = 'Could not load appointment details.'; return; }
          const idx = all.findIndex(a => a.token === tokenVal);
          const est = computeEstimatedStart(all, idx);
          const estText = (typeof est === 'string') ? est : est.toLocaleTimeString();
          out.innerHTML = `<div style="font-weight:700">${appt.token} — ${appt.name}</div><div>Phone: ${appt.phone||'—'}</div><div>Booked: ${appt.arrivalTime? new Date(appt.arrivalTime).toLocaleTimeString() : '—'}</div><div>Estimated start: ${estText}</div><div>Status: ${appt.status}</div>`;
        });
      });
    } catch (err) { console.error(err); if ($('tokenResult')) $('tokenResult').textContent = 'Search error'; }
  });

  // ---------- Reset / CSV ----------
  bind('resetPatients', 'click', async () => {
    if (!confirm('This will delete all appointments. Proceed?')) return;
    if (!jwt) { alert('Receptionist login required'); return; }
    try {
      const res = await fetch(API('/appointments'), { method:'DELETE', headers:{'Authorization':'Bearer '+jwt} });
      if (!res.ok) { const j = await res.json().catch(()=>({error:'failed'})); alert('Failed: ' + (j.error || 'unknown')); return; }
      alert('Patient list reset.'); if (window.io && io) io().emit('request_queue'); else fetchQueueOnce();
    } catch (err) { console.error(err); alert('Reset failed'); }
  });

  bind('downloadCSV', 'click', async () => {
    try {
      const res = await fetch(API('/queue')); const data = await res.json();
      if (!data || !data.length) { alert('No patients to download'); return; }
      const header = ['token','name','age','sex','phone','arrivalTime','estConsultMin','status','startTime','endTime'];
      const rows = data.map(r => [ r.token||'', (r.name||'').replace(/"/g,'""'), r.age||'', r.sex||'', r.phone||'', r.arrivalTime?new Date(r.arrivalTime).toISOString():'', r.estConsultMin||'', r.status||'', r.startTime?new Date(r.startTime).toISOString():'', r.endTime?new Date(r.endTime).toISOString():'']);
      const csv = [header.join(','), ...rows.map(r=>r.map(c=>`"${c}"`).join(','))].join('\n');
      const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `appointments-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (err) { console.error(err); alert('Failed to download CSV'); }
  });

  // ---------- Scheduling / rendering ----------
  function earliestPendingBooked(list) {
    const pending = (list || []).filter(a => (a.status === 'waiting' || a.status === 'inconsult') && a.arrivalTime);
    if (!pending.length) return null;
    let earliest = new Date(pending[0].arrivalTime);
    pending.forEach(p => { const t = new Date(p.arrivalTime); if (t < earliest) earliest = t; });
    return earliest;
  }

/* ---------- improved computeEstimatedStart(list,index) ---------- */
/**
 * Compute an estimated start time (Date) for a target appointment at list[index].
 * Returns either:
 *  - a Date object for the estimated start
 *  - the string 'In consult'
 *  - a string like 'Booked time unknown'
 */
function computeEstimatedStart(list, index) {
  const appt = list && list[index];
  if (!appt) return 'Booked time unknown';
  if (appt.status === 'inconsult') return 'In consult';

  const booked = appt.arrivalTime ? new Date(appt.arrivalTime) : null;
  const now = new Date();

  // shifts
  const assignedShift = shiftForAppointmentOrNext(booked); // may be null

  // doctor presence / arrival
  const doctorIsPresent = getDoctorPresent();
  const doctorArrivalISO = getDoctorArrival();
  const doctorArrivalDate = doctorArrivalISO ? new Date(doctorArrivalISO) : null;

  function nextShiftAfterDate(dt) {
    return findNextShiftAfter(dt || new Date());
  }

  // clamp cursor to shifts: if cursor > currentShift.end => move to next shift.start
  function clampCursorToShifts(cursor, currentShift) {
    if (!currentShift) return cursor;
    if (cursor <= currentShift.end) return cursor;
    const nxt = nextShiftAfterDate(currentShift.end);
    if (!nxt) return cursor;
    return new Date(nxt.start.getTime());
  }

  // If doctor is not present and arrival specified: apply arrival logic
  if (!doctorIsPresent) {
    if (doctorArrivalDate) {
      const arrivalShift = findShiftContaining(doctorArrivalDate) || findNextShiftAfter(doctorArrivalDate);
      if (assignedShift && arrivalShift && assignedShift.start.getTime() === arrivalShift.start.getTime()) {
        // shift relative to assigned shift start
        const offsetMs = doctorArrivalDate.getTime() - assignedShift.start.getTime();
        if (!booked) return 'Booked time unknown';
        return new Date(booked.getTime() + offsetMs);
      }
      // fallback legacy behaviour: shift relative to earliest pending booked
      const earliest = earliestPendingBooked(list);
      if (!earliest) return booked ? booked : 'Booked time unknown';
      const shiftMs = doctorArrivalDate.getTime() - earliest.getTime();
      if (!booked) return 'Booked time unknown';
      return new Date(booked.getTime() + shiftMs);
    } else {
      // not present and no arrival: show booked or unknown
      if (booked) return booked;
      return 'Booked time unknown';
    }
  }

  // doctor present -> compute cursor by iterating earlier patients
  let cursor = null;
  let currentShift = assignedShift || null;

  for (let i = 0; i < index; i++) {
    const p = list[i];

    if (p.startTime) {
      const pStart = new Date(p.startTime);
      if (p.endTime) {
        const pEnd = new Date(p.endTime);
        if (!cursor) cursor = new Date(pEnd.getTime());
        else {
          if (cursor < pStart) cursor = new Date(pStart.getTime());
          const durMin = Math.max(0, Math.round((pEnd.getTime() - pStart.getTime()) / 60000));
          cursor = new Date(cursor.getTime() + durMin * 60000);
        }
      } else {
        const est = p.estConsultMin || 8;
        if (!cursor) cursor = new Date(Math.max(pStart.getTime(), now.getTime()));
        else { if (cursor < pStart) cursor = new Date(pStart.getTime()); }
        cursor = new Date(cursor.getTime() + est * 60000);
      }
    } else {
      const pBooked = p.arrivalTime ? new Date(p.arrivalTime) : null;
      const est = p.estConsultMin || 8;
      if (!cursor) {
        if (pBooked) cursor = new Date(Math.max(pBooked.getTime(), now.getTime()));
        else cursor = new Date(now.getTime());
      } else {
        if (pBooked && cursor < pBooked) cursor = new Date(pBooked.getTime());
      }
      cursor = new Date(cursor.getTime() + est * 60000);
    }

    // update shift for this prior patient
    const pBookedTime = p.arrivalTime ? new Date(p.arrivalTime) : null;
    const pShift = pBookedTime ? findShiftContaining(pBookedTime) || shiftForAppointmentOrNext(pBookedTime) : currentShift;
    if (pShift) currentShift = pShift;

    // if cursor exceeds current shift end, move to next shift start
    if (currentShift && cursor && cursor.getTime() > currentShift.end.getTime()) {
      const nxt = nextShiftAfterDate(currentShift.end);
      if (nxt) {
        cursor = new Date(nxt.start.getTime());
        currentShift = nxt;
      }
    }
  }

  // If no cursor, start from booked or now
  if (!cursor) {
    if (booked) cursor = new Date(Math.max(booked.getTime(), now.getTime()));
    else cursor = new Date(now.getTime());
  }

  // ensure cursor respects assignedShift
  if (assignedShift && cursor.getTime() < assignedShift.start.getTime()) {
    cursor = new Date(Math.max(cursor.getTime(), assignedShift.start.getTime()));
  }
  if (assignedShift && cursor.getTime() > assignedShift.end.getTime()) {
    const nxt = nextShiftAfterDate(assignedShift.end);
    if (nxt) cursor = new Date(nxt.start.getTime());
  }

  return cursor;
}


  function renderQueueList(list) {
    const container = $('queueContainer'); if (!container) return; container.innerHTML = '';
    (list || []).forEach((a, idx) => {
      const bookedStr = a.arrivalTime ? new Date(a.arrivalTime).toLocaleTimeString() : 'Booked time unknown';
      const est = computeEstimatedStart(list, idx);
      const expectedHtml = (typeof est === 'string') ? ((est === 'In consult') ? `<div class="meta"><strong>In consult</strong></div>` : `<div class="meta">Booked: ${bookedStr}</div>`) : `<div class="meta">Booked: ${bookedStr}</div><div class="meta" style="font-weight:700;color:var(--navy)">Expected: ${est.toLocaleTimeString()}</div>`;
      const div = document.createElement('div');
      div.className = 'queue-item';
      div.innerHTML = `
        <div style="display:flex;gap:12px;align-items:center">
          <div class="token-badge">${a.token}</div>
          <div>
            <div style="font-weight:700">${a.name || a.nameMasked || '—'}</div>
            <div class="meta">Age: ${a.age||'—'} • ${a.sex||'—'}</div>
            <div class="meta">Phone: ${a.phone||'—'}</div>
            <div class="meta">Est: ${a.estConsultMin||8} min</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
          ${expectedHtml}
          <div class="q-actions">${a.status==='waiting' ? `<button class="start" data-token="${a.token}">Start</button>` : a.status==='inconsult' ? `<button class="finish" data-token="${a.token}">Finish</button>` : `<span class="meta">${a.status}</span>`}</div>
        </div>
      `;
      container.appendChild(div);
    });
  }

  function renderStats(list) {
    try {
      const waiting = (list || []).filter(a => a.status === 'waiting').length;
      // update possible quick stats elements if present
      const statEls = document.querySelectorAll('.quick-stats .big');
      if (statEls && statEls.length >= 3) {
        statEls[0].textContent = waiting;
        const ests = (list || []).map(a => a.estConsultMin || 8);
        statEls[1].textContent = ests.length ? Math.round(ests.reduce((s, n) => s + n, 0) / ests.length) : 8;
        const now = new Date();
        const nextPending = (list || []).find(a => a.status === 'inconsult' || a.status === 'waiting');
        let delay = 0;
        if (nextPending && nextPending.arrivalTime) { const nextBooked = new Date(nextPending.arrivalTime); delay = Math.max(0, Math.round((now - nextBooked) / 60000)); }
        statEls[2].textContent = (delay ? (delay + 'm') : '0m');
      }
    } catch (e) { console.error('renderStats', e); }
  }

  function applyFiltersAndRender() {
    let list = cachedQueue.slice ? cachedQueue.slice() : (cachedQueue || []);
    const qraw = $('searchToken') ? $('searchToken').value.trim().toLowerCase() : '';
    if (qraw) list = list.filter(a => (a.token && a.token.toLowerCase().includes(qraw)) || (a.name && a.name.toLowerCase().includes(qraw)) || (a.phone && a.phone.toLowerCase().includes(qraw)));
    renderQueueList(list);
    renderStats(list);
  }

  // wire simple search input Enter key
  bind('searchToken', 'keyup', (e) => { if (e.key === 'Enter') applyFiltersAndRender(); });

  // initial UI setup
  document.addEventListener('DOMContentLoaded', () => {
    // restore login display if jwt present
    if (jwt && $('currentUser')) {
      $('currentUser').textContent = 'receptionist';
    }
    // show home by default
    showScreen('homeScreen');
    // initial queue load
    requestQueue();
    // doctor status render
    renderDoctorStatus();
  bindShiftManagerUI();

  });

  // expose for debugging
  window._akshara = {
    computeEstimatedStart,
    renderQueueList,
    getDoctorPresent,
    getDoctorArrival,
    requestQueue
  };
})();


// Reception display button handler (opens a clean TV-friendly page)
document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (t && t.id === 'receptionDisplayBtn') {
    // open in new window; preferred for TV setups
    window.open('/reception_display.html', '_blank', 'noopener');
  }
});
