// NOTE: All timers are timestamp-based and survive server restarts:
// - Break timer: uses breakStartedAt (epoch ms) in state.json
// - 48h interested timer: uses interestedAt (ISO string) in state.json
// - Daily reset: uses lastReset (YYYY-MM-DD) in state.json
// Server can restart at any time without losing timer state.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data', 'state.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

const BREAK_DURATION_MS = 60 * 60 * 1000; // 1 hour

// ─── State Management ─────────────────────────────────────────────────────────
function getTodayStr() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 10);
}

function getTomorrowStr() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  ist.setDate(ist.getDate() + 1);
  return ist.toISOString().slice(0, 10);
}

function loadState() {
  if (fs.existsSync(DATA_FILE)) {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
  }
  return createFreshState();
}

function createFreshState() {
  return {
    numbers: [],
    agents: {},
    uploadedFiles: [],
    dialedLog: [],
    lastReset: getTodayStr(),
    allowedEids: {
      '061007': 'Shweta Thakur',
      '080208': 'Suman Yadav',
      '060402': 'Isha Pandro',
      '020486': 'Meena Tirpathi'
    }
  };
}

function saveState(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function checkDailyReset(state) {
  const today = getTodayStr();
  if (state.lastReset !== today) {
    for (const id in state.agents) {
      state.agents[id].totalDialedToday = 0;
      state.agents[id].date = today;
      state.agents[id].active = false;
      state.agents[id].currentIndex = null;
      state.agents[id].onBreak = false;
      state.agents[id].breakStartedAt = null;
      state.agents[id].totalBreakMs = 0;
      state.agents[id].currentNumberId = null;
      state.agents[id].firstLoginToday = null;
      state.agents[id].firstLoginDate  = null;
    }
    // Clear retry numbers whose retryAfter date has arrived (today >= retryAfter)
    state.numbers.forEach(n => {
      if ((n.disposition === 'not_received' || n.disposition === 'switch_off') && n.retryAfter && today >= n.retryAfter) {
        n.disposition = null;
        n.retryAfter = null;
        n.dialedBy = null;
        n.dialedAt = null;
        n.assignedTo = null;
      }
    });
    state.lastReset = today;
    saveState(state);
  }
  return state;
}

let appState = loadState();
// Migrate old states that don't have allowedEids yet
if (!appState.allowedEids) {
  appState.allowedEids = {
    '061007': 'Shweta Thakur',
    '080208': 'Suman Yadav',
    '060402': 'Isha Pandro',
    '020486': 'Meena Tirpathi'
  };
}
appState = checkDailyReset(appState);

// On restart: agents that were active (dialing) get flagged for auto-resume.
// Agents on break keep their break state intact (breakStartedAt preserved).
// Agents that were stopped (active: false) stay stopped.
for (const id in appState.agents) {
  const a = appState.agents[id];
  if (a.active && !a.onBreak) {
    // Was actively dialing — mark for client auto-resume
    a.needsAutoResume = true;
  }
  // active is reset to false until the socket reconnects
  a.active = false;
}
saveState(appState);

// ─── Auto-save every second ────────────────────────────────────────────────────
setInterval(() => {
  try { saveState(appState); } catch {}
}, 1000);

// ─── Number helpers ───────────────────────────────────────────────────────────
function getNextNumber(agentId) {
  appState = checkDailyReset(appState);
  const now = new Date();
  const today = getTodayStr();
  const undialed = appState.numbers.find(n => {
    if (n.dialedBy || n.assignedTo) return false;
    // Skip dead numbers
    if (n.disposition === 'dead') return false;
    // Skip not_interested numbers still within 30-day block
    if (n.disposition === 'not_interested' && n.blockedUntil && new Date(n.blockedUntil) > now) return false;
    // Skip followup numbers locked by another agent
    if (n.disposition === 'followup' && n.followupLockedBy && n.followupLockedBy !== agentId) return false;
    // Skip interested numbers
    if (n.disposition === 'interested') return false;
    // Skip not_received/switch_off numbers whose retry date has not arrived yet
    if ((n.disposition === 'not_received' || n.disposition === 'switch_off') && n.retryAfter && today < n.retryAfter) return false;
    return true;
  });
  if (!undialed) return null;
  undialed.assignedTo = agentId;
  saveState(appState);
  return undialed;
}

function markDialed(agentId, numberId) {
  appState = checkDailyReset(appState);
  const num = appState.numbers.find(n => n.id === numberId);
  if (!num) return;
  const today = getTodayStr();
  num.dialedBy = agentId;
  num.dialedAt = new Date().toISOString();
  num.assignedTo = null;

  const agent = appState.agents[agentId];
  if (agent) {
    agent.totalDialedToday = (agent.totalDialedToday || 0) + 1;
    agent.date = today;
    agent.currentNumberId = null;
  }
  appState.dialedLog.push({
    phone: num.phone, agentId,
    agentName: agent ? agent.name : agentId,
    timestamp: new Date().toISOString()
  });
  saveState(appState);
  broadcastAdminStats();
}

function releaseNumber(agentId, numberId) {
  const num = appState.numbers.find(n => n.id === numberId && n.assignedTo === agentId);
  if (num) { num.assignedTo = null; saveState(appState); }
  const agent = appState.agents[agentId];
  if (agent) agent.currentNumberId = null;
}

// ─── Disposition System ───────────────────────────────────────────────────────
const VALID_DISPOSITIONS = ['dead', 'not_received', 'not_interested', 'followup', 'switch_off', 'interested'];
const VALID_LOAN_TYPES = ['BL_Business', 'LAP_Business', 'LAP_Salaried', 'PL_Business', 'PL_Salaried'];

function applyDisposition(agentId, numberId, disposition, extra) {
  appState = checkDailyReset(appState);
  const num = appState.numbers.find(n => n.id === numberId);
  if (!num) return;
  const agent = appState.agents[agentId];
  const now = new Date().toISOString();

  switch (disposition) {
    case 'dead':
      num.disposition = 'dead';
      num.dialedBy = agentId;
      num.dialedAt = now;
      num.assignedTo = null;
      break;
    case 'not_received':
      num.disposition = 'not_received';
      num.dialedBy = agentId;
      num.dialedAt = now;
      num.assignedTo = null;
      num.retryAfter = getTomorrowStr();
      break;
    case 'not_interested':
      num.disposition = 'not_interested';
      num.blockedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      num.dialedBy = agentId;
      num.dialedAt = now;
      num.assignedTo = null;
      break;
    case 'followup':
      num.disposition = 'followup';
      num.followupDate = extra && extra.followupDate ? extra.followupDate : null;
      num.followupTime = extra && extra.followupTime ? extra.followupTime : null;
      num.followupLockedBy = agentId;
      num.dialedBy = agentId;
      num.dialedAt = now;
      num.assignedTo = null;
      break;
    case 'switch_off':
      num.disposition = 'switch_off';
      num.dialedBy = agentId;
      num.dialedAt = now;
      num.assignedTo = null;
      num.retryAfter = getTomorrowStr();
      break;
    case 'interested':
      num.disposition = 'interested';
      num.interestedBy = agentId;
      num.interestedAt = now;
      num.leadName = extra && extra.leadName ? extra.leadName : '';
      num.loanType = extra && extra.loanType && VALID_LOAN_TYPES.includes(extra.loanType) ? extra.loanType : '';
      num.remarks = extra && extra.remarks ? extra.remarks : '';
      num.loanAmount = extra && extra.loanAmount ? extra.loanAmount : '';
      num.documentationComplete = false;
      num.documentationCompletedAt = null;
      num.dialedBy = agentId;
      num.dialedAt = now;
      num.assignedTo = null;
      break;
  }

  // Common actions for all dispositions
  if (agent) {
    agent.totalDialedToday = (agent.totalDialedToday || 0) + 1;
    agent.currentNumberId = null;
  }
  appState.dialedLog.push({
    phone: num.phone, agentId,
    agentName: agent ? agent.name : agentId,
    timestamp: now,
    disposition: disposition
  });
  saveState(appState);
  broadcastAdminStats();
}

// ─── Break helpers ────────────────────────────────────────────────────────────
function startBreak(agentId) {
  const agent = appState.agents[agentId];
  if (!agent || agent.onBreak) return { error: 'Already on break or agent not found' };
  agent.onBreak = true;
  agent.breakStartedAt = Date.now();
  if (!agent.totalBreakMs) agent.totalBreakMs = 0;
  saveState(appState);
  broadcastAdminStats();
  return { success: true, breakStartedAt: agent.breakStartedAt };
}

function endBreak(agentId) {
  const agent = appState.agents[agentId];
  if (!agent || !agent.onBreak) return { error: 'Not on break' };
  const elapsed = Date.now() - (agent.breakStartedAt || Date.now());
  agent.totalBreakMs = (agent.totalBreakMs || 0) + elapsed;
  agent.onBreak = false;
  agent.breakStartedAt = null;
  saveState(appState);
  broadcastAdminStats();
  return { success: true, totalBreakMs: agent.totalBreakMs };
}

function getBreakMsRemaining(agent) {
  if (!agent.onBreak) return BREAK_DURATION_MS - (agent.totalBreakMs || 0);
  const elapsed = Date.now() - (agent.breakStartedAt || Date.now());
  return BREAK_DURATION_MS - ((agent.totalBreakMs || 0) + elapsed);
}

// ─── Admin broadcast ──────────────────────────────────────────────────────────
function broadcastAdminStats() {
  const stats = getAdminStats();
  io.to('admin-room').emit('stats-update', stats);
}

function getAdminStats() {
  appState = checkDailyReset(appState);
  const total = appState.numbers.length;
  const dialed = appState.numbers.filter(n => n.dialedBy).length;
  const assigned = appState.numbers.filter(n => n.assignedTo && !n.dialedBy).length;
  const remaining = total - dialed - assigned;

  const agentStats = Object.entries(appState.agents).map(([id, a]) => {
    const liveBreakMs = a.onBreak ? (Date.now() - (a.breakStartedAt || Date.now())) : 0;
    const totalBreakMs = (a.totalBreakMs || 0) + liveBreakMs;
    const breakRemaining = Math.max(0, BREAK_DURATION_MS - totalBreakMs);

    // Late login: first login recorded today AND after 10:00 IST
    const firstLogin = a.firstLoginToday || null;
    const lateLogin  = firstLogin ? (firstLogin > '10:00') : false;

    return {
      id, name: a.name, active: a.active,
      totalDialedToday: a.totalDialedToday || 0,
      date: a.date,
      onBreak: a.onBreak || false,
      totalBreakMs,
      breakRemaining,
      breakAllowedMs: BREAK_DURATION_MS,
      firstLoginToday: firstLogin,
      lateLogin
    };
  });

  const fileStats = appState.uploadedFiles.map(f => {
    const fileNums = appState.numbers.filter(n => n.file === f.id);
    return {
      ...f,
      total: fileNums.length,
      dialed: fileNums.filter(n => n.dialedBy).length,
      remaining: fileNums.filter(n => !n.dialedBy).length
    };
  });

  return { total, dialed, assigned, remaining, agentStats, fileStats, today: getTodayStr(), interestedCount: appState.numbers.filter(n => n.disposition === 'interested').length, followupCount: appState.numbers.filter(n => n.disposition === 'followup').length, comingBackTomorrow: appState.numbers.filter(n => (n.disposition === 'not_received' || n.disposition === 'switch_off') && n.retryAfter && getTodayStr() < n.retryAfter).length, overdueInterestedCount: appState.numbers.filter(n => n.disposition === 'interested' && !n.documentationComplete && (Date.now() - new Date(n.interestedAt).getTime()) >= 48 * 60 * 60 * 1000).length };
}

// ─── Express Setup ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: UPLOADS_DIR });

app.post('/api/admin/upload', upload.single('file'), (req, res) => {
  try {
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const fileId = uuidv4();
    const phones = [];
    const existingPhones = new Set(appState.numbers.map(n => n.phone));
    let skipped = 0;
    rows.forEach((row, i) => {
      if (i === 0 && isNaN(row[0])) return;
      const phone = String(row[0] || '').trim().replace(/\s+/g, '');
      if (!phone || phone.length < 7) return;
      if (existingPhones.has(phone)) { skipped++; return; }
      existingPhones.add(phone);
      const name = row[1] ? String(row[1]).trim() : '';
      phones.push({ id: uuidv4(), phone, name, file: fileId, assignedTo: null, dialedBy: null, dialedAt: null });
    });
    appState.numbers.push(...phones);
    appState.uploadedFiles.push({ id: fileId, name: req.file.originalname, uploadedAt: new Date().toISOString(), total: phones.length });
    saveState(appState);
    fs.unlinkSync(req.file.path);
    broadcastAdminStats();
    res.json({ success: true, count: phones.length, skipped, fileId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stats', (req, res) => res.json(getAdminStats()));

// ─── Disposition API Endpoints ────────────────────────────────────────────────
app.post('/api/agent/disposition', (req, res) => {
  const { agentId, numberId, disposition, followupDate, followupTime, leadName, loanType, remarks, loanAmount } = req.body;
  if (!agentId || !numberId || !disposition) {
    return res.status(400).json({ error: 'agentId, numberId, and disposition are required' });
  }
  if (!VALID_DISPOSITIONS.includes(disposition)) {
    return res.status(400).json({ error: 'Invalid disposition. Must be one of: ' + VALID_DISPOSITIONS.join(', ') });
  }
  applyDisposition(agentId, numberId, disposition, { followupDate, followupTime, leadName, loanType, remarks, loanAmount });
  const nextNum = getNextNumber(agentId);
  const agent = appState.agents[agentId];
  if (nextNum && agent) {
    agent.currentNumberId = nextNum.id;
    saveState(appState);
  }
  res.json({ success: true, nextNumber: nextNum ? { numberId: nextNum.id, phone: nextNum.phone, name: nextNum.name || '' } : null });
});

app.get('/api/admin/interested', (req, res) => {
  const now = Date.now();
  const interested = appState.numbers.filter(n => n.disposition === 'interested' && !n.documentationComplete).map(n => {
    const agent = appState.agents[n.interestedBy];
    const elapsedMs = now - new Date(n.interestedAt).getTime();
    const hoursElapsed = elapsedMs / (1000 * 60 * 60);
    const hoursRemaining = Math.max(0, 48 - hoursElapsed);
    const overdue = hoursRemaining <= 0;
    return {
      id: n.id, phone: n.phone, name: n.leadName || n.name || '',
      loanType: n.loanType || '',
      remarks: n.remarks || '',
      loanAmount: n.loanAmount || '',
      interestedBy: agent ? agent.name : n.interestedBy,
      interestedByAgentId: n.interestedBy,
      interestedAt: n.interestedAt,
      documentationComplete: n.documentationComplete || false,
      documentationCompletedAt: n.documentationCompletedAt || null,
      hoursRemaining: Math.round(hoursRemaining * 100) / 100,
      overdue
    };
  });
  res.json(interested);
});

app.get('/api/admin/followups', (req, res) => {
  const followups = appState.numbers.filter(n => n.disposition === 'followup').map(n => {
    const agent = appState.agents[n.followupLockedBy];
    return {
      id: n.id, phone: n.phone, name: n.name || '',
      followupLockedBy: agent ? agent.name : n.followupLockedBy,
      followupDate: n.followupDate,
      followupTime: n.followupTime
    };
  });
  res.json(followups);
});

app.get('/api/agent/interested/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  const now = Date.now();
  const interested = appState.numbers.filter(n => n.disposition === 'interested' && n.interestedBy === agentId && !n.documentationComplete).map(n => {
    const elapsedMs = now - new Date(n.interestedAt).getTime();
    const hoursElapsed = elapsedMs / (1000 * 60 * 60);
    const hoursRemaining = Math.max(0, 48 - hoursElapsed);
    return {
      id: n.id, phone: n.phone, name: n.leadName || n.name || '',
      loanType: n.loanType || '',
      remarks: n.remarks || '',
      loanAmount: n.loanAmount || '',
      interestedAt: n.interestedAt,
      documentationComplete: n.documentationComplete || false,
      documentationCompletedAt: n.documentationCompletedAt || null,
      hoursRemaining: Math.round(hoursRemaining * 100) / 100
    };
  });
  res.json(interested);
});

app.get('/api/agent/followups/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  const followups = appState.numbers.filter(n => n.disposition === 'followup' && n.followupLockedBy === agentId).map(n => ({
    id: n.id, phone: n.phone, name: n.name || '',
    followupDate: n.followupDate,
    followupTime: n.followupTime
  }));
  res.json(followups);
});

// ─── Interested Lead Management Endpoints ─────────────────────────────────────
app.post('/api/agent/mark-documentation-complete', (req, res) => {
  const { agentId, numberId } = req.body;
  if (!agentId || !numberId) {
    return res.status(400).json({ error: 'agentId and numberId are required' });
  }
  const num = appState.numbers.find(n => n.id === numberId);
  if (!num) return res.status(404).json({ error: 'Number not found' });
  if (num.disposition !== 'interested') return res.status(400).json({ error: 'Number is not marked as interested' });
  if (num.interestedBy !== agentId) return res.status(403).json({ error: 'This lead is not assigned to you' });
  num.documentationComplete = true;
  num.documentationCompletedAt = new Date().toISOString();
  saveState(appState);
  broadcastAdminStats();
  res.json({ success: true, numberId, documentationComplete: true, documentationCompletedAt: num.documentationCompletedAt });
});

app.post('/api/admin/transfer-interested', (req, res) => {
  const { numberId, newAgentId } = req.body;
  if (!numberId || !newAgentId) {
    return res.status(400).json({ error: 'numberId and newAgentId are required' });
  }
  // Allow transfer to registered agents OR valid EID-based agents from allowedEids
  if (!appState.agents[newAgentId]) {
    // Check if it's a valid EID from allowedEids (format: emp_XXXXXX)
    const eidMatch = newAgentId.match(/^emp_(\d+)$/);
    if (!eidMatch || !appState.allowedEids[eidMatch[1]]) {
      return res.status(404).json({ error: 'Target agent not found' });
    }
    // Create a placeholder agent entry so the lead can be assigned
    const eid = eidMatch[1];
    appState.agents[newAgentId] = {
      name: appState.allowedEids[eid],
      employeeId: eid,
      active: false,
      totalDialedToday: 0,
      date: getTodayStr(),
      currentIndex: null,
      onBreak: false,
      breakStartedAt: null,
      totalBreakMs: 0,
      currentNumberId: null,
      firstLoginToday: null,
      firstLoginDate: null
    };
  }
  const num = appState.numbers.find(n => n.id === numberId);
  if (!num) return res.status(404).json({ error: 'Number not found' });
  if (num.disposition !== 'interested') return res.status(400).json({ error: 'Number is not marked as interested' });
  num.interestedBy = newAgentId;
  num.interestedAt = new Date().toISOString();
  saveState(appState);
  broadcastAdminStats();
  res.json({ success: true, numberId, newAgentId, interestedAt: num.interestedAt });
});

app.post('/api/agent/add-interested', (req, res) => {
  const { agentId, phone, leadName, loanType } = req.body;
  if (!agentId || !phone) {
    return res.status(400).json({ error: 'agentId and phone are required' });
  }
  if (!appState.agents[agentId]) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  if (loanType && !VALID_LOAN_TYPES.includes(loanType)) {
    return res.status(400).json({ error: 'Invalid loan type' });
  }
  const existingNumber = appState.numbers.find(n => n.phone === phone);
  if (existingNumber) {
    return res.status(409).json({ error: 'This phone number already exists in the system' });
  }
  const now = new Date().toISOString();
  const newEntry = {
    id: uuidv4(),
    phone,
    name: leadName || '',
    file: null,
    assignedTo: null,
    dialedBy: agentId,
    dialedAt: now,
    disposition: 'interested',
    interestedBy: agentId,
    interestedAt: now,
    leadName: leadName || '',
    loanType: loanType || '',
    documentationComplete: false,
    documentationCompletedAt: null
  };
  appState.numbers.push(newEntry);
  saveState(appState);
  broadcastAdminStats();
  res.json({ success: true, entry: newEntry });
});

app.get('/api/admin/agents-list', (req, res) => {
  // Merge registered agents with allowedEids that haven't logged in yet
  const agentMap = {};

  // First, add all registered agents
  for (const [id, a] of Object.entries(appState.agents)) {
    agentMap[id] = { id, name: a.name };
  }

  // Then, add virtual entries for EIDs not yet registered
  for (const [eid, name] of Object.entries(appState.allowedEids)) {
    const virtualId = 'emp_' + eid;
    if (!agentMap[virtualId]) {
      agentMap[virtualId] = { id: virtualId, name };
    }
  }

  res.json(Object.values(agentMap));
});

// ─── New Endpoints: Remove Interested, Update Interested, Completed Leads ────

// Agent removes an interested lead (marks as dead)
app.post('/api/agent/remove-interested', (req, res) => {
  const { agentId, numberId } = req.body;
  if (!agentId || !numberId) {
    return res.status(400).json({ error: 'agentId and numberId are required' });
  }
  const num = appState.numbers.find(n => n.id === numberId);
  if (!num) return res.status(404).json({ error: 'Number not found' });
  if (num.disposition !== 'interested') return res.status(400).json({ error: 'Number is not marked as interested' });
  if (num.interestedBy !== agentId) return res.status(403).json({ error: 'This lead is not assigned to you' });
  num.disposition = 'dead';
  saveState(appState);
  broadcastAdminStats();
  res.json({ success: true });
});

// Admin removes an interested or completed lead (marks as dead)
app.post('/api/admin/remove-interested', (req, res) => {
  const { numberId } = req.body;
  if (!numberId) {
    return res.status(400).json({ error: 'numberId is required' });
  }
  const num = appState.numbers.find(n => n.id === numberId);
  if (!num) return res.status(404).json({ error: 'Number not found' });
  num.disposition = 'dead';
  saveState(appState);
  broadcastAdminStats();
  res.json({ success: true });
});

// Admin updates interested lead fields (loanType, remarks, loanAmount, status)
app.post('/api/admin/update-interested', (req, res) => {
  const { numberId, loanType, remarks, loanAmount, status } = req.body;
  if (!numberId) {
    return res.status(400).json({ error: 'numberId is required' });
  }
  const num = appState.numbers.find(n => n.id === numberId);
  if (!num) return res.status(404).json({ error: 'Number not found' });
  if (loanType !== undefined) {
    if (loanType && !VALID_LOAN_TYPES.includes(loanType)) {
      return res.status(400).json({ error: 'Invalid loan type' });
    }
    num.loanType = loanType;
  }
  if (remarks !== undefined) num.remarks = remarks;
  if (loanAmount !== undefined) num.loanAmount = loanAmount;
  if (status !== undefined) num.adminStatus = status;
  saveState(appState);
  broadcastAdminStats();
  res.json({ success: true });
});

// Admin updates lead status (for completed leads)
app.post('/api/admin/update-lead-status', (req, res) => {
  const { numberId, adminStatus } = req.body;
  if (!numberId || !adminStatus) {
    return res.status(400).json({ error: 'numberId and adminStatus are required' });
  }
  const validStatuses = ['Completed', 'In Process', 'Rejected', 'Approved', 'On Hold'];
  if (!validStatuses.includes(adminStatus)) {
    return res.status(400).json({ error: 'Invalid status. Must be one of: ' + validStatuses.join(', ') });
  }
  const num = appState.numbers.find(n => n.id === numberId);
  if (!num) return res.status(404).json({ error: 'Number not found' });
  num.adminStatus = adminStatus;
  saveState(appState);
  broadcastAdminStats();
  res.json({ success: true });
});

// Get all documentation-completed leads (admin)
app.get('/api/admin/completed', (req, res) => {
  const completed = appState.numbers.filter(n => n.disposition === 'interested' && n.documentationComplete).map(n => {
    const agent = appState.agents[n.interestedBy];
    return {
      id: n.id, phone: n.phone, name: n.leadName || n.name || '',
      loanType: n.loanType || '',
      remarks: n.remarks || '',
      loanAmount: n.loanAmount || '',
      interestedBy: agent ? agent.name : n.interestedBy,
      interestedByAgentId: n.interestedBy,
      documentationCompletedAt: n.documentationCompletedAt || null,
      adminStatus: n.adminStatus || ''
    };
  });
  res.json(completed);
});

// Get agent's documentation-completed leads
app.get('/api/agent/completed/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  const completed = appState.numbers.filter(n => n.disposition === 'interested' && n.documentationComplete && n.interestedBy === agentId).map(n => ({
    id: n.id, phone: n.phone, name: n.leadName || n.name || '',
    loanType: n.loanType || '',
    remarks: n.remarks || '',
    loanAmount: n.loanAmount || '',
    documentationCompletedAt: n.documentationCompletedAt || null,
    adminStatus: n.adminStatus || ''
  }));
  res.json(completed);
});

app.delete('/api/admin/file/:fileId', (req, res) => {
  const fid = req.params.fileId;
  appState.numbers = appState.numbers.filter(n => n.file !== fid);
  appState.uploadedFiles = appState.uploadedFiles.filter(f => f.id !== fid);
  saveState(appState);
  broadcastAdminStats();
  res.json({ success: true });
});

app.post('/api/admin/reset-today', (req, res) => {
  for (const id in appState.agents) {
    appState.agents[id].totalDialedToday = 0;
    appState.agents[id].active = false;
    appState.agents[id].currentIndex = null;
    appState.agents[id].onBreak = false;
    appState.agents[id].breakStartedAt = null;
    appState.agents[id].totalBreakMs = 0;
    appState.agents[id].currentNumberId = null;
    appState.agents[id].firstLoginToday = null;
    appState.agents[id].firstLoginDate  = null;
  }
  appState.lastReset = getTodayStr();
  saveState(appState);
  broadcastAdminStats();
  io.emit('force-stop');
  res.json({ success: true });
});

app.post('/api/admin/clear-all', (req, res) => {
  appState.numbers = [];
  appState.uploadedFiles = [];
  appState.dialedLog = [];
  for (const id in appState.agents) {
    appState.agents[id].totalDialedToday = 0;
    appState.agents[id].active = false;
    appState.agents[id].onBreak = false;
    appState.agents[id].breakStartedAt = null;
    appState.agents[id].totalBreakMs = 0;
    appState.agents[id].currentNumberId = null;
  }
  saveState(appState);
  broadcastAdminStats();
  io.emit('force-stop');
  res.json({ success: true });
});

app.post('/api/agent/register', (req, res) => {
  const { name, employeeId } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!employeeId || !/^\d+$/.test(employeeId)) return res.status(400).json({ error: 'Valid numeric Employee ID required' });

  // ── EID Whitelist check ──────────────────────────────────────────────────
  if (!appState.allowedEids[employeeId]) {
    return res.status(403).json({ error: 'Employee ID not recognised. Please contact your admin.' });
  }
  appState = checkDailyReset(appState);
  const agentId = 'emp_' + employeeId;
  const today   = getTodayStr();

  // ── Get current IST time string for login timestamp ──────────────────────
  function getISTTimeStr() {
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    return ist.toISOString().slice(11, 16); // "HH:MM"
  }

  if (!appState.agents[agentId]) {
    appState.agents[agentId] = {
      name, employeeId, active: false,
      totalDialedToday: 0, date: today,
      currentIndex: null, onBreak: false,
      breakStartedAt: null, totalBreakMs: 0,
      currentNumberId: null,
      firstLoginToday: getISTTimeStr(),
      firstLoginDate:  today
    };
  } else {
    appState.agents[agentId].name   = name;
    appState.agents[agentId].active = false;
    // Only stamp first login if it hasn't been recorded for today yet
    if (appState.agents[agentId].firstLoginDate !== today) {
      appState.agents[agentId].firstLoginToday = getISTTimeStr();
      appState.agents[agentId].firstLoginDate  = today;
    }
  }
  saveState(appState);
  broadcastAdminStats();

  // Return resume data if agent has a current number still assigned
  const agent = appState.agents[agentId];
  let resumeNumber = null;
  if (agent.currentNumberId) {
    const num = appState.numbers.find(n => n.id === agent.currentNumberId);
    if (num && num.assignedTo === agentId && !num.dialedBy) {
      resumeNumber = { numberId: num.id, phone: num.phone, name: num.name || '' };
    }
  }

  const needsAutoResume = agent.needsAutoResume || false;
  if (agent.needsAutoResume) { delete agent.needsAutoResume; saveState(appState); }

  res.json({
    agentId, name, employeeId,
    resumeNumber,
    needsAutoResume,
    totalDialedToday: agent.totalDialedToday || 0,
    onBreak: agent.onBreak || false,
    breakStartedAt: agent.breakStartedAt || null,
    totalBreakMs: agent.totalBreakMs || 0,
    breakAllowedMs: BREAK_DURATION_MS
  });
});

// Break endpoints
app.post('/api/agent/break/start', (req, res) => {
  const { agentId } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  res.json(startBreak(agentId));
});

app.post('/api/agent/break/end', (req, res) => {
  const { agentId } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  res.json(endBreak(agentId));
});

app.get('/api/agent/state/:agentId', (req, res) => {
  const agent = appState.agents[req.params.agentId];
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  let resumeNumber = null;
  if (agent.currentNumberId) {
    const num = appState.numbers.find(n => n.id === agent.currentNumberId);
    if (num && num.assignedTo === req.params.agentId && !num.dialedBy) {
      resumeNumber = { numberId: num.id, phone: num.phone, name: num.name || '' };
    }
  }
  const needsAutoResume = agent.needsAutoResume || false;
  if (agent.needsAutoResume) { delete agent.needsAutoResume; saveState(appState); }
  res.json({
    resumeNumber,
    needsAutoResume,
    totalDialedToday: agent.totalDialedToday || 0,
    onBreak: agent.onBreak || false,
    breakStartedAt: agent.breakStartedAt || null,
    totalBreakMs: agent.totalBreakMs || 0,
    breakAllowedMs: BREAK_DURATION_MS
  });
});

// ─── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  let socketAgentId = null;
  let socketCurrentNumber = null;

  socket.on('join-admin', () => {
    socket.join('admin-room');
    socket.emit('stats-update', getAdminStats());
  });

  socket.on('disconnect', () => {
    if (socketAgentId) {
      const agent = appState.agents[socketAgentId];
      if (agent) { agent.active = false; saveState(appState); }
      // Do NOT release the number on disconnect — for power-cut resume!
      broadcastAdminStats();
    }
  });

  socket.on('agent-start', ({ agentId }) => {
    socketAgentId = agentId;
    appState = checkDailyReset(appState);
    const agent = appState.agents[agentId];
    if (!agent) return socket.emit('error', 'Agent not found');
    agent.active = true;
    saveState(appState);
    broadcastAdminStats();

    // Resume: check if agent had a number already assigned (power-cut recovery)
    if (agent.currentNumberId) {
      const num = appState.numbers.find(n => n.id === agent.currentNumberId);
      if (num && num.assignedTo === agentId && !num.dialedBy) {
        socketCurrentNumber = num.id;
        return socket.emit('show-number', {
          numberId: num.id, phone: num.phone, name: num.name || '',
          totalDialedToday: agent.totalDialedToday || 0,
          resumed: true
        });
      }
    }

    const num = getNextNumber(agentId);
    if (!num) {
      socket.emit('no-numbers');
    } else {
      socketCurrentNumber = num.id;
      agent.currentNumberId = num.id;
      saveState(appState);
      socket.emit('show-number', {
        numberId: num.id, phone: num.phone, name: num.name || '',
        totalDialedToday: agent.totalDialedToday || 0
      });
    }
  });

  socket.on('agent-next', ({ agentId, prevNumberId }) => {
    appState = checkDailyReset(appState);
    const agent = appState.agents[agentId];
    if (!agent) return socket.emit('error', 'Agent not found');

    if (prevNumberId) markDialed(agentId, prevNumberId);

    const num = getNextNumber(agentId);
    if (!num) {
      socketCurrentNumber = null;
      if (agent) agent.currentNumberId = null;
      saveState(appState);
      socket.emit('no-numbers', { totalDialedToday: agent.totalDialedToday || 0 });
    } else {
      socketCurrentNumber = num.id;
      agent.currentNumberId = num.id;
      saveState(appState);
      socket.emit('show-number', {
        numberId: num.id, phone: num.phone, name: num.name || '',
        totalDialedToday: agent.totalDialedToday || 0
      });
    }
    broadcastAdminStats();
  });

  socket.on('agent-stop', ({ agentId, currentNumberId }) => {
    const agent = appState.agents[agentId];
    if (agent) {
      agent.active = false;
      agent.currentNumberId = null;
    }
    if (currentNumberId) releaseNumber(agentId, currentNumberId);
    saveState(appState);
    broadcastAdminStats();
  });

  socket.on('agent-disposition', ({ agentId, numberId, disposition, followupDate, followupTime, leadName, loanType, remarks, loanAmount }) => {
    appState = checkDailyReset(appState);
    const agent = appState.agents[agentId];
    if (!agent) return socket.emit('error', 'Agent not found');
    if (!VALID_DISPOSITIONS.includes(disposition)) return socket.emit('error', 'Invalid disposition');

    applyDisposition(agentId, numberId, disposition, { followupDate, followupTime, leadName, loanType, remarks, loanAmount });

    const num = getNextNumber(agentId);
    if (!num) {
      socketCurrentNumber = null;
      if (agent) agent.currentNumberId = null;
      saveState(appState);
      socket.emit('no-numbers', { totalDialedToday: agent.totalDialedToday || 0 });
    } else {
      socketCurrentNumber = num.id;
      agent.currentNumberId = num.id;
      saveState(appState);
      socket.emit('show-number', {
        numberId: num.id, phone: num.phone, name: num.name || '',
        totalDialedToday: agent.totalDialedToday || 0
      });
    }
    broadcastAdminStats();
  });

  socket.on('agent-break-start', ({ agentId }) => {
    const result = startBreak(agentId);
    socket.emit('break-started', result);
    broadcastAdminStats();
  });

  socket.on('agent-break-end', ({ agentId }) => {
    const result = endBreak(agentId);
    socket.emit('break-ended', result);
    broadcastAdminStats();
  });

  socket.on('ping-alive', ({ agentId }) => {
    const agent = appState.agents[agentId];
    if (agent) appState = checkDailyReset(appState);
  });
});

// ─── Disposition Stats Endpoint ─────────────────────────────────────────────────
app.get('/api/stats/dispositions', (req, res) => {
  const period = req.query.period || 'daily';
  const agentId = req.query.agentId || null;

  // Calculate IST "now" for date filtering
  const now = new Date();
  const istNow = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const istTodayStr = istNow.toISOString().slice(0, 10); // YYYY-MM-DD in IST

  let daysBack = 0;
  switch (period) {
    case 'daily': daysBack = 0; break;
    case 'weekly': daysBack = 7; break;
    case 'monthly': daysBack = 30; break;
    case 'yearly': daysBack = 365; break;
    default: daysBack = 0;
  }

  // Calculate the cutoff date in IST
  let cutoffDate;
  if (daysBack === 0) {
    // Daily: only today in IST
    cutoffDate = new Date(istTodayStr + 'T00:00:00.000+05:30');
  } else {
    const cutoffIST = new Date(istNow);
    cutoffIST.setDate(cutoffIST.getDate() - daysBack);
    const cutoffStr = cutoffIST.toISOString().slice(0, 10);
    cutoffDate = new Date(cutoffStr + 'T00:00:00.000+05:30');
  }

  // Filter dialedLog entries
  const filteredLogs = appState.dialedLog.filter(entry => {
    if (!entry.timestamp) return false;
    const entryDate = new Date(entry.timestamp);
    if (entryDate < cutoffDate) return false;
    if (agentId && entry.agentId !== agentId) return false;
    return true;
  });

  // Count dispositions
  const stats = {
    period: period,
    totalCalls: filteredLogs.length,
    dead: 0,
    not_received: 0,
    not_interested: 0,
    followup: 0,
    switch_off: 0,
    interested: 0
  };

  filteredLogs.forEach(entry => {
    const d = entry.disposition;
    if (d && stats.hasOwnProperty(d)) {
      stats[d]++;
    }
  });

  res.json(stats);
});

// ─── Admin EID Management ──────────────────────────────────────────────────────

// List all allowed EIDs
app.get('/api/admin/eids', (req, res) => {
  const list = Object.entries(appState.allowedEids).map(([eid, name]) => ({ eid, name }));
  res.json({ eids: list });
});

// Add a new allowed EID
app.post('/api/admin/eids', (req, res) => {
  const { eid, name } = req.body;
  if (!eid || !/^\d+$/.test(eid)) return res.status(400).json({ error: 'Valid numeric EID required' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  appState.allowedEids[eid] = name.trim();
  saveState(appState);
  res.json({ success: true, eid, name: name.trim() });
});

// Remove an allowed EID
app.delete('/api/admin/eids/:eid', (req, res) => {
  const eid = req.params.eid;
  if (!appState.allowedEids[eid]) return res.status(404).json({ error: 'EID not found' });
  delete appState.allowedEids[eid];
  saveState(appState);
  res.json({ success: true });
});

// ─── Page Routes ──────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/index.html')));
app.get('/agent', (req, res) => res.sendFile(path.join(__dirname, 'public/agent/index.html')));

// ─── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅  AutoLead Showcaser running on http://0.0.0.0:${PORT}`);
  console.log(`   Admin Panel : http://YOUR-LAN-IP:${PORT}/admin`);
  console.log(`   Agent Panel : http://YOUR-LAN-IP:${PORT}/agent\n`);
});
