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

const BREAK_DURATION_MS = 60 * 60 * 1000;
const NOT_INTERESTED_COOLDOWN_DAYS = 30;

function getTodayStr() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 10);
}

function getTomorrowStr() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const ist = new Date(tomorrow.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 10);
}

function loadState() {
  if (fs.existsSync(DATA_FILE)) {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) {}
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
    },
    interestedLeads: []
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
    state.lastReset = today;
    saveState(state);
  }
  return state;
}

let appState = loadState();
if (!appState.allowedEids) {
  appState.allowedEids = {
    '061007': 'Shweta Thakur',
    '080208': 'Suman Yadav',
    '060402': 'Isha Pandro',
    '020486': 'Meena Tirpathi'
  };
}
if (!appState.interestedLeads) appState.interestedLeads = [];
appState = checkDailyReset(appState);

// Migration for old state files
let needsMigrationSave = false;
if (appState.numbers) {
  for (let i = 0; i < appState.numbers.length; i++) {
    const num = appState.numbers[i];
    if (!num.status) {
      num.status = num.dialedBy ? 'completed' : 'active';
      needsMigrationSave = true;
    }
  }
}
if (!appState.interestedLeads) {
  appState.interestedLeads = [];
  needsMigrationSave = true;
}
if (needsMigrationSave) saveState(appState);

for (const id in appState.agents) {
  const a = appState.agents[id];
  if (a.active && !a.onBreak) {
    a.needsAutoResume = true;
  }
  a.active = false;
}
saveState(appState);

setInterval(function() {
  try { saveState(appState); } catch(e) {}
}, 1000);

function processCooldownNumbers() {
  const now = new Date();
  let changed = false;
  for (let i = 0; i < appState.numbers.length; i++) {
    const num = appState.numbers[i];
    if (num.status === 'not_interested_cooldown' && num.cooldownUntil && new Date(num.cooldownUntil) <= now) {
      num.status = 'active';
      delete num.cooldownUntil;
      changed = true;
    }
  }
  if (changed) saveState(appState);
}

function getDueFollowupForAgent(agentId) {
  const now = new Date();
  for (let i = 0; i < appState.numbers.length; i++) {
    const n = appState.numbers[i];
    if (n.status === 'followup' && n.followupAgentId === agentId && n.followupAt && new Date(n.followupAt) <= now && !n.dialedBy) {
      n.status = 'active';
      n.assignedTo = null;
      n.followupAgentId = null;
      delete n.followupAt;
      saveState(appState);
      return n;
    }
  }
  return null;
}

function getNextNumber(agentId) {
  appState = checkDailyReset(appState);
  processCooldownNumbers();
  
  const dueFollowup = getDueFollowupForAgent(agentId);
  if (dueFollowup) {
    dueFollowup.assignedTo = agentId;
    saveState(appState);
    return dueFollowup;
  }
  
  for (let i = 0; i < appState.numbers.length; i++) {
    const n = appState.numbers[i];
    if (n.status === 'active' && !n.dialedBy && !n.assignedTo) {
      n.assignedTo = agentId;
      saveState(appState);
      return n;
    }
  }
  return null;
}

function releaseNumber(agentId, numberId) {
  for (let i = 0; i < appState.numbers.length; i++) {
    const num = appState.numbers[i];
    if (num.id === numberId && num.assignedTo === agentId) {
      num.assignedTo = null;
      saveState(appState);
      break;
    }
  }
  const agent = appState.agents[agentId];
  if (agent) agent.currentNumberId = null;
}

function applyDisposition(agentId, numberId, disposition, followupDateTime) {
  appState = checkDailyReset(appState);
  let num = null;
  for (let i = 0; i < appState.numbers.length; i++) {
    if (appState.numbers[i].id === numberId) { num = appState.numbers[i]; break; }
  }
  if (!num) return { error: 'Number not found' };
  
  const agent = appState.agents[agentId];
  const agentName = agent ? agent.name : agentId;
  const now = new Date();
  
  num.assignedTo = null;
  
  switch(disposition) {
    case 'Connected':
      num.dialedBy = agentId;
      num.dialedAt = now.toISOString();
      num.status = 'completed';
      if (agent) agent.totalDialedToday = (agent.totalDialedToday || 0) + 1;
      appState.dialedLog.push({ phone: num.phone, agentId: agentId, agentName: agentName, timestamp: now.toISOString(), disposition: 'Connected' });
      break;
      
    case 'Not Connected':
      num.status = 'dead';
      num.deadAt = now.toISOString();
      num.dialedBy = agentId;
      appState.dialedLog.push({ phone: num.phone, agentId: agentId, agentName: agentName, timestamp: now.toISOString(), disposition: 'Not Connected (Dead)' });
      break;
      
    case 'Not Received':
      num.status = 'active';
      num.dialedBy = null;
      num.lastAttemptAt = now.toISOString();
      appState.dialedLog.push({ phone: num.phone, agentId: agentId, agentName: agentName, timestamp: now.toISOString(), disposition: 'Not Received - Back to Queue' });
      break;
      
    case 'Not Interested':
      num.status = 'not_interested_cooldown';
      num.cooldownUntil = new Date(now.getTime() + NOT_INTERESTED_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
      num.dialedBy = agentId;
      num.notInterestedAt = now.toISOString();
      appState.dialedLog.push({ phone: num.phone, agentId: agentId, agentName: agentName, timestamp: now.toISOString(), disposition: 'Not Interested - Cooldown ' + NOT_INTERESTED_COOLDOWN_DAYS + ' days' });
      break;
      
    case 'Followup':
      if (!followupDateTime) return { error: 'Followup date/time required' };
      num.status = 'followup';
      num.followupAt = followupDateTime;
      num.followupAgentId = agentId;
      num.assignedTo = agentId;
      num.dialedBy = null;
      appState.dialedLog.push({ phone: num.phone, agentId: agentId, agentName: agentName, timestamp: now.toISOString(), disposition: 'Followup scheduled for ' + followupDateTime });
      break;
      
    case 'Switch OFF':
      num.status = 'active';
      num.dialedBy = null;
      num.lastAttemptAt = now.toISOString();
      appState.dialedLog.push({ phone: num.phone, agentId: agentId, agentName: agentName, timestamp: now.toISOString(), disposition: 'Switch OFF - Back to Queue' });
      break;
      
    case 'Interested':
      num.status = 'interested';
      num.interestedBy = agentId;
      num.interestedAt = now.toISOString();
      num.dialedBy = agentId;
      appState.interestedLeads.push({
        numberId: num.id,
        phone: num.phone,
        name: num.name || '',
        agentId: agentId,
        agentName: agentName,
        timestamp: now.toISOString()
      });
      appState.dialedLog.push({ phone: num.phone, agentId: agentId, agentName: agentName, timestamp: now.toISOString(), disposition: 'Interested - Pinned' });
      break;
      
    default:
      return { error: 'Invalid disposition' };
  }
  
  if (agent) agent.currentNumberId = null;
  saveState(appState);
  broadcastAdminStats();
  return { success: true };
}

function startBreak(agentId) {
  const agent = appState.agents[agentId];
  if (!agent || agent.onBreak) return { error: 'Already on break or agent not found' };
  agent.onBreak = true;
  agent.breakStartedAt = Date.now();
  if (!agent.totalBreakMs) agent.totalBreakMs = 0;
  saveState(appState);
  broadcastAdminStats();
  return { success: true, breakStartedAt: agent.breakStartedAt, totalBreakMs: agent.totalBreakMs };
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

function broadcastAdminStats() {
  const stats = getAdminStats();
  io.to('admin-room').emit('stats-update', stats);
}

function getAdminStats() {
  appState = checkDailyReset(appState);
  processCooldownNumbers();
  
  let total = appState.numbers.length;
  let dialed = 0;
  let assigned = 0;
  let remaining = 0;
  let dead = 0;
  let interested = 0;
  let notInterestedCooldown = 0;
  let followups = 0;
  
  for (let i = 0; i < appState.numbers.length; i++) {
    const n = appState.numbers[i];
    if (n.dialedBy && n.status === 'completed') dialed++;
    if (n.assignedTo && !n.dialedBy && n.status === 'active') assigned++;
    if (n.status === 'active' && !n.dialedBy && !n.assignedTo) remaining++;
    if (n.status === 'dead') dead++;
    if (n.status === 'interested') interested++;
    if (n.status === 'not_interested_cooldown') notInterestedCooldown++;
    if (n.status === 'followup') followups++;
  }

  // Calculate tomorrow's available leads
  const tomorrowStr = getTomorrowStr();
  let availableTomorrow = 0;
  for (let i = 0; i < appState.numbers.length; i++) {
    const n = appState.numbers[i];
    if (n.status === 'active' && !n.dialedBy) {
      availableTomorrow++;
    }
    else if (n.status === 'not_interested_cooldown' && n.cooldownUntil) {
      const cooldownDate = new Date(n.cooldownUntil);
      const tomorrowDate = new Date(tomorrowStr);
      if (cooldownDate <= tomorrowDate) {
        availableTomorrow++;
      }
    }
    else if (n.status === 'followup' && n.followupAt) {
      const followupDate = new Date(n.followupAt);
      const tomorrowDate = new Date(tomorrowStr);
      if (followupDate <= tomorrowDate) {
        availableTomorrow++;
      }
    }
    else if (n.status === 'active' && n.assignedTo && !n.dialedBy) {
      availableTomorrow++;
    }
  }

  const agentStats = [];
  for (const id in appState.agents) {
    const a = appState.agents[id];
    const liveBreakMs = a.onBreak ? (Date.now() - (a.breakStartedAt || Date.now())) : 0;
    const totalBreakMs = (a.totalBreakMs || 0) + liveBreakMs;
    const breakRemaining = Math.max(0, BREAK_DURATION_MS - totalBreakMs);
    const firstLogin = a.firstLoginToday || null;
    const lateLogin = firstLogin ? (firstLogin > '10:00') : false;
    agentStats.push({
      id: id, name: a.name, active: a.active,
      totalDialedToday: a.totalDialedToday || 0,
      date: a.date,
      onBreak: a.onBreak || false,
      totalBreakMs: totalBreakMs,
      breakRemaining: breakRemaining,
      breakAllowedMs: BREAK_DURATION_MS,
      firstLoginToday: firstLogin,
      lateLogin: lateLogin
    });
  }

  const fileStats = appState.uploadedFiles.map(function(f) {
    const fileNums = appState.numbers.filter(function(n) { return n.file === f.id; });
    return {
      id: f.id,
      name: f.name,
      uploadedAt: f.uploadedAt,
      total: fileNums.length,
      dialed: fileNums.filter(function(n) { return n.dialedBy && n.status === 'completed'; }).length,
      remaining: fileNums.filter(function(n) { return n.status === 'active' && !n.dialedBy; }).length
    };
  });

  return { 
    total: total, dialed: dialed, assigned: assigned, remaining: remaining,
    dead: dead, interested: interested, notInterestedCooldown: notInterestedCooldown, followups: followups,
    availableTomorrow: availableTomorrow,
    agentStats: agentStats, fileStats: fileStats, today: getTodayStr(), tomorrow: tomorrowStr
  };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: UPLOADS_DIR });

app.post('/api/admin/upload', upload.single('file'), function(req, res) {
  try {
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const fileId = uuidv4();
    const phones = [];
    const existingPhones = new Set();
    for (let i = 0; i < appState.numbers.length; i++) existingPhones.add(appState.numbers[i].phone);
    let skipped = 0;
    for (let i = 0; i < rows.length; i++) {
      if (i === 0 && isNaN(rows[i][0])) continue;
      const phone = String(rows[i][0] || '').trim().replace(/\s+/g, '');
      if (!phone || phone.length < 7) continue;
      if (existingPhones.has(phone)) { skipped++; continue; }
      existingPhones.add(phone);
      const name = rows[i][1] ? String(rows[i][1]).trim() : '';
      phones.push({ 
        id: uuidv4(), phone: phone, name: name, file: fileId, 
        assignedTo: null, dialedBy: null, dialedAt: null,
        status: 'active'
      });
    }
    appState.numbers = appState.numbers.concat(phones);
    appState.uploadedFiles.push({ id: fileId, name: req.file.originalname, uploadedAt: new Date().toISOString(), total: phones.length });
    saveState(appState);
    fs.unlinkSync(req.file.path);
    broadcastAdminStats();
    res.json({ success: true, count: phones.length, skipped: skipped, fileId: fileId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stats', function(req, res) { res.json(getAdminStats()); });

app.get('/api/admin/interested', function(req, res) {
  const interestedNumbers = [];
  for (let i = 0; i < appState.numbers.length; i++) {
    const n = appState.numbers[i];
    if (n.status === 'interested') {
      let agentName = 'Unknown';
      if (n.interestedBy && appState.agents[n.interestedBy] && appState.agents[n.interestedBy].name) {
        agentName = appState.agents[n.interestedBy].name;
      }
      interestedNumbers.push({
        id: n.id,
        phone: n.phone,
        name: n.name || '',
        interestedBy: n.interestedBy,
        interestedAt: n.interestedAt,
        agentName: agentName
      });
    }
  }
  res.json(interestedNumbers);
});

app.get('/api/admin/dead', function(req, res) {
  const deadNumbers = [];
  for (let i = 0; i < appState.numbers.length; i++) {
    const n = appState.numbers[i];
    if (n.status === 'dead') {
      let agentName = 'Unknown';
      if (n.dialedBy && appState.agents[n.dialedBy] && appState.agents[n.dialedBy].name) {
        agentName = appState.agents[n.dialedBy].name;
      }
      deadNumbers.push({
        id: n.id,
        phone: n.phone,
        name: n.name || '',
        deadAt: n.deadAt,
        dialedBy: n.dialedBy,
        agentName: agentName
      });
    }
  }
  res.json(deadNumbers);
});

app.get('/api/admin/followups', function(req, res) {
  const followupNumbers = [];
  for (let i = 0; i < appState.numbers.length; i++) {
    const n = appState.numbers[i];
    if (n.status === 'followup') {
      let agentName = 'Unknown';
      if (n.followupAgentId && appState.agents[n.followupAgentId] && appState.agents[n.followupAgentId].name) {
        agentName = appState.agents[n.followupAgentId].name;
      }
      followupNumbers.push({
        id: n.id,
        phone: n.phone,
        name: n.name || '',
        followupAt: n.followupAt,
        agentId: n.followupAgentId,
        agentName: agentName
      });
    }
  }
  res.json(followupNumbers);
});

app.delete('/api/admin/file/:fileId', function(req, res) {
  const fid = req.params.fileId;
  const newNumbers = [];
  for (let i = 0; i < appState.numbers.length; i++) {
    if (appState.numbers[i].file !== fid) newNumbers.push(appState.numbers[i]);
  }
  appState.numbers = newNumbers;
  const newFiles = [];
  for (let i = 0; i < appState.uploadedFiles.length; i++) {
    if (appState.uploadedFiles[i].id !== fid) newFiles.push(appState.uploadedFiles[i]);
  }
  appState.uploadedFiles = newFiles;
  saveState(appState);
  broadcastAdminStats();
  res.json({ success: true });
});

app.post('/api/admin/reset-today', function(req, res) {
  for (const id in appState.agents) {
    appState.agents[id].totalDialedToday = 0;
    appState.agents[id].active = false;
    appState.agents[id].currentIndex = null;
    appState.agents[id].onBreak = false;
    appState.agents[id].breakStartedAt = null;
    appState.agents[id].totalBreakMs = 0;
    appState.agents[id].currentNumberId = null;
    appState.agents[id].firstLoginToday = null;
    appState.agents[id].firstLoginDate = null;
  }
  appState.lastReset = getTodayStr();
  saveState(appState);
  broadcastAdminStats();
  io.emit('force-stop');
  res.json({ success: true });
});

app.post('/api/admin/clear-all', function(req, res) {
  appState.numbers = [];
  appState.uploadedFiles = [];
  appState.dialedLog = [];
  appState.interestedLeads = [];
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

app.post('/api/agent/register', function(req, res) {
  const name = req.body.name;
  const employeeId = req.body.employeeId;
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!employeeId || !/^\d+$/.test(employeeId)) return res.status(400).json({ error: 'Valid numeric Employee ID required' });

  if (!appState.allowedEids[employeeId]) {
    return res.status(403).json({ error: 'Employee ID not recognised. Please contact your admin.' });
  }
  appState = checkDailyReset(appState);
  const agentId = 'emp_' + employeeId;
  const today = getTodayStr();

  function getISTTimeStr() {
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    return ist.toISOString().slice(11, 16);
  }

  if (!appState.agents[agentId]) {
    appState.agents[agentId] = {
      name: name, employeeId: employeeId, active: false,
      totalDialedToday: 0, date: today,
      currentIndex: null, onBreak: false,
      breakStartedAt: null, totalBreakMs: 0,
      currentNumberId: null,
      firstLoginToday: getISTTimeStr(),
      firstLoginDate: today
    };
  } else {
    appState.agents[agentId].name = name;
    appState.agents[agentId].active = false;
    if (appState.agents[agentId].firstLoginDate !== today) {
      appState.agents[agentId].firstLoginToday = getISTTimeStr();
      appState.agents[agentId].firstLoginDate = today;
    }
  }
  saveState(appState);
  broadcastAdminStats();

  const agent = appState.agents[agentId];
  let resumeNumber = null;
  if (agent.currentNumberId) {
    for (let i = 0; i < appState.numbers.length; i++) {
      const num = appState.numbers[i];
      if (num.id === agent.currentNumberId && num.assignedTo === agentId && !num.dialedBy && num.status === 'active') {
        resumeNumber = { numberId: num.id, phone: num.phone, name: num.name || '' };
        break;
      }
    }
  }

  const needsAutoResume = agent.needsAutoResume || false;
  if (agent.needsAutoResume) { delete agent.needsAutoResume; saveState(appState); }

  res.json({
    agentId: agentId, name: name, employeeId: employeeId,
    resumeNumber: resumeNumber,
    needsAutoResume: needsAutoResume,
    totalDialedToday: agent.totalDialedToday || 0,
    onBreak: agent.onBreak || false,
    breakStartedAt: agent.breakStartedAt || null,
    totalBreakMs: agent.totalBreakMs || 0,
    breakAllowedMs: BREAK_DURATION_MS
  });
});

app.post('/api/agent/disposition', function(req, res) {
  const agentId = req.body.agentId;
  const numberId = req.body.numberId;
  const disposition = req.body.disposition;
  const followupDateTime = req.body.followupDateTime;
  if (!agentId || !numberId || !disposition) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const result = applyDisposition(agentId, numberId, disposition, followupDateTime);
  if (result.error) return res.status(400).json(result);
  
  const agent = appState.agents[agentId];
  if (agent && agent.active) {
    const nextNum = getNextNumber(agentId);
    if (nextNum) {
      agent.currentNumberId = nextNum.id;
      saveState(appState);
      return res.json({ success: true, nextNumber: { numberId: nextNum.id, phone: nextNum.phone, name: nextNum.name || '' } });
    } else {
      agent.currentNumberId = null;
      saveState(appState);
      return res.json({ success: true, noNumbers: true });
    }
  }
  res.json(result);
});

app.post('/api/agent/break/start', function(req, res) {
  const agentId = req.body.agentId;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  res.json(startBreak(agentId));
});

app.post('/api/agent/break/end', function(req, res) {
  const agentId = req.body.agentId;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  res.json(endBreak(agentId));
});

app.get('/api/agent/state/:agentId', function(req, res) {
  const agent = appState.agents[req.params.agentId];
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  let resumeNumber = null;
  if (agent.currentNumberId) {
    for (let i = 0; i < appState.numbers.length; i++) {
      const num = appState.numbers[i];
      if (num.id === agent.currentNumberId && num.assignedTo === req.params.agentId && !num.dialedBy && num.status === 'active') {
        resumeNumber = { numberId: num.id, phone: num.phone, name: num.name || '' };
        break;
      }
    }
  }
  const needsAutoResume = agent.needsAutoResume || false;
  if (agent.needsAutoResume) { delete agent.needsAutoResume; saveState(appState); }
  res.json({
    resumeNumber: resumeNumber,
    needsAutoResume: needsAutoResume,
    totalDialedToday: agent.totalDialedToday || 0,
    onBreak: agent.onBreak || false,
    breakStartedAt: agent.breakStartedAt || null,
    totalBreakMs: agent.totalBreakMs || 0,
    breakAllowedMs: BREAK_DURATION_MS
  });
});

app.get('/api/agent/interested/:agentId', function(req, res) {
  const agentId = req.params.agentId;
  const interested = [];
  for (let i = 0; i < appState.numbers.length; i++) {
    const n = appState.numbers[i];
    if (n.status === 'interested' && n.interestedBy === agentId) {
      interested.push({ id: n.id, phone: n.phone, name: n.name || '', interestedAt: n.interestedAt });
    }
  }
  res.json(interested);
});

// Socket.IO
io.on('connection', function(socket) {
  let socketAgentId = null;

  socket.on('join-admin', function() {
    socket.join('admin-room');
    socket.emit('stats-update', getAdminStats());
  });

  socket.on('disconnect', function() {
    if (socketAgentId) {
      const agent = appState.agents[socketAgentId];
      if (agent) { agent.active = false; saveState(appState); }
      broadcastAdminStats();
    }
  });

  socket.on('agent-start', function(data) {
    const agentId = data.agentId;
    socketAgentId = agentId;
    appState = checkDailyReset(appState);
    const agent = appState.agents[agentId];
    if (!agent) return socket.emit('error', 'Agent not found');
    agent.active = true;
    saveState(appState);
    broadcastAdminStats();

    if (agent.currentNumberId) {
      for (let i = 0; i < appState.numbers.length; i++) {
        const num = appState.numbers[i];
        if (num.id === agent.currentNumberId && num.assignedTo === agentId && !num.dialedBy && num.status === 'active') {
          return socket.emit('show-number', {
            numberId: num.id, phone: num.phone, name: num.name || '',
            totalDialedToday: agent.totalDialedToday || 0,
            resumed: true
          });
        }
      }
    }

    const num = getNextNumber(agentId);
    if (!num) {
      socket.emit('no-numbers');
    } else {
      agent.currentNumberId = num.id;
      saveState(appState);
      socket.emit('show-number', {
        numberId: num.id, phone: num.phone, name: num.name || '',
        totalDialedToday: agent.totalDialedToday || 0
      });
    }
  });

  socket.on('agent-stop', function(data) {
    const agentId = data.agentId;
    const currentNumberId = data.currentNumberId;
    const agent = appState.agents[agentId];
    if (agent) {
      agent.active = false;
      agent.currentNumberId = null;
    }
    if (currentNumberId) releaseNumber(agentId, currentNumberId);
    saveState(appState);
    broadcastAdminStats();
  });

  socket.on('agent-break-start', function(data) {
    const result = startBreak(data.agentId);
    socket.emit('break-started', result);
    broadcastAdminStats();
  });

  socket.on('agent-break-end', function(data) {
    const result = endBreak(data.agentId);
    socket.emit('break-ended', result);
    broadcastAdminStats();
  });

  socket.on('ping-alive', function(data) {
    const agent = appState.agents[data.agentId];
    if (agent) appState = checkDailyReset(appState);
  });
});

// Admin EID Management
app.get('/api/admin/eids', function(req, res) {
  const list = [];
  for (const eid in appState.allowedEids) {
    list.push({ eid: eid, name: appState.allowedEids[eid] });
  }
  res.json({ eids: list });
});

app.post('/api/admin/eids', function(req, res) {
  const eid = req.body.eid;
  const name = req.body.name;
  if (!eid || !/^\d+$/.test(eid)) return res.status(400).json({ error: 'Valid numeric EID required' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  appState.allowedEids[eid] = name.trim();
  saveState(appState);
  res.json({ success: true, eid: eid, name: name.trim() });
});

app.delete('/api/admin/eids/:eid', function(req, res) {
  const eid = req.params.eid;
  if (!appState.allowedEids[eid]) return res.status(404).json({ error: 'EID not found' });
  delete appState.allowedEids[eid];
  saveState(appState);
  res.json({ success: true });
});

// Page Routes
app.get('/admin', function(req, res) { res.sendFile(path.join(__dirname, 'public/admin/index.html')); });
app.get('/agent', function(req, res) { res.sendFile(path.join(__dirname, 'public/agent/index.html')); });

// Start server
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

server.listen(PORT, '0.0.0.0', function() {
  console.log('\n✅  AutoLead Showcaser running on http://0.0.0.0:' + PORT);
  console.log('   Admin Panel : http://YOUR-LAN-IP:' + PORT + '/admin');
  console.log('   Agent Panel : http://YOUR-LAN-IP:' + PORT + '/agent\n');
});