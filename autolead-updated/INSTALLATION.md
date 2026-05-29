# 🚀 AutoLead v2.0 - Installation & Upgrade Guide

## 📦 What's Included

- ✅ Complete AutoLead system with disposition tracking
- ✅ Server (Node.js)
- ✅ Agent Panel (Web Interface)
- ✅ Admin Panel (Web Interface)
- ✅ Documentation (DISPOSITION_GUIDE.md, CHANGELOG.md)
- ✅ Sample data file

## 🆕 New Installation

### Prerequisites
- Node.js 14 or higher
- NPM (comes with Node.js)
- Web browser (Chrome, Firefox, Edge, Safari)

### Steps

1. **Extract the ZIP file**
   ```bash
   unzip autolead-with-dispositions.zip
   cd autolead-updated
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   
   **Linux/Mac:**
   ```bash
   ./START-LINUX-MAC.sh
   ```
   
   **Windows:**
   ```bash
   START-WINDOWS.bat
   ```
   
   **Or manually:**
   ```bash
   node server.js
   ```

4. **Access the system**
   - Find your computer's LAN IP address
   - Admin Panel: `http://YOUR-LAN-IP:3000/admin`
   - Agent Panel: `http://YOUR-LAN-IP:3000/agent`

5. **First-time setup**
   - Upload your first Excel file with phone numbers (Column A = phones, Column B = names)
   - Agents can login with their Employee IDs (default EIDs: 061007, 080208, 060402, 020486)
   - Add/remove allowed EIDs from admin panel

## 🔄 Upgrading from Previous Version

### Option A: Clean Upgrade (Recommended for testing)

1. **Backup your current data**
   ```bash
   cp -r autolead-updated/data autolead-data-backup
   ```

2. **Extract new version to a new folder**
   ```bash
   unzip autolead-with-dispositions.zip -d autolead-v2
   cd autolead-v2/autolead-updated
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Start the new version**
   ```bash
   node server.js
   ```

5. **Test the disposition system**
   - Upload test numbers
   - Try all 6 dispositions
   - Verify admin panel shows stats

6. **Once satisfied, copy old data (optional)**
   ```bash
   cp ../autolead-data-backup/state.json data/
   ```
   - System will automatically migrate old data structure

### Option B: In-Place Upgrade (For production)

1. **Stop the current server**
   - Press `Ctrl+C` in the terminal running the server

2. **Backup everything**
   ```bash
   cp -r autolead-updated autolead-backup
   ```

3. **Extract new files**
   ```bash
   unzip autolead-with-dispositions.zip
   ```

4. **Copy your data back**
   ```bash
   cp -r autolead-backup/data autolead-updated/
   cp -r autolead-backup/uploads autolead-updated/
   ```

5. **Install any new dependencies**
   ```bash
   cd autolead-updated
   npm install
   ```

6. **Start the upgraded server**
   ```bash
   node server.js
   ```

### Data Migration Details

The system **automatically migrates** old data:
- Existing numbers work without dispositions
- All agent data preserved
- Break times maintained
- Uploaded files remain intact
- No manual migration scripts needed

Old numbers will appear as "fresh" numbers in the new system until agents set dispositions.

## 🧪 Testing the Disposition System

### Quick Test Checklist

1. **Admin Panel** (`/admin`)
   - [ ] See 6 disposition stat cards (all showing 0)
   - [ ] Upload a test Excel file
   - [ ] See numbers counted in "Total Numbers"
   - [ ] "Interested Leads" table shows empty
   - [ ] "Scheduled Followups" table shows empty

2. **Agent Panel** (`/agent`)
   - [ ] Login with Employee ID
   - [ ] Click "Start Dialing"
   - [ ] See a phone number
   - [ ] See 6 disposition buttons in a grid
   - [ ] Click each disposition button and verify next number appears

3. **Test Each Disposition:**
   - [ ] **Dead** - Number disappears forever
   - [ ] **Not Received** - Number reappears tomorrow
   - [ ] **Not Interested** - Number blocked for 30 days
   - [ ] **Followup** - Modal opens, schedule callback
   - [ ] **Switch OFF** - Number reappears tomorrow
   - [ ] **Interested** - Number appears in admin "Interested Leads" table

4. **Admin Panel Verification**
   - [ ] Refresh admin panel
   - [ ] See disposition counts updated
   - [ ] Interested leads appear in table
   - [ ] Scheduled followups appear in table with status

## 🔧 Configuration

### Port Number
Default: 3000

To change, edit `server.js`:
```javascript
const PORT = 3000; // Change to your desired port
```

### Break Duration
Default: 1 hour (3600000 ms)

To change, edit `server.js`:
```javascript
const BREAK_DURATION_MS = 60 * 60 * 1000; // Change as needed
```

### Allowed Employee IDs
Manage from Admin Panel → "Allowed Agent EIDs" section
- Add new agents
- Remove agents
- No server restart needed

### Daily Reset Time
Automatic at IST midnight (00:00 IST)
- Resets dial counts
- Resets break times
- Recycles "Not Received" and "Switch OFF" numbers
- Preserves all disposition data

## 📱 Network Setup

### Find Your LAN IP

**Windows:**
```bash
ipconfig
```
Look for "IPv4 Address" (usually 192.168.x.x)

**Mac/Linux:**
```bash
ifconfig
```
or
```bash
ip addr show
```

### Firewall Settings

If agents can't connect:
1. Allow port 3000 through firewall
2. Or disable firewall temporarily for testing

**Windows Firewall:**
```bash
netsh advfirewall firewall add rule name="AutoLead" dir=in action=allow protocol=TCP localport=3000
```

**Linux (ufw):**
```bash
sudo ufw allow 3000/tcp
```

## 🗂️ File Structure

```
autolead-updated/
├── server.js              # Main server file
├── package.json           # Dependencies
├── data/
│   └── state.json        # All system data (auto-created)
├── uploads/              # Uploaded Excel files (auto-created)
├── public/
│   ├── admin/
│   │   └── index.html   # Admin panel
│   ├── agent/
│   │   └── index.html   # Agent panel
│   └── index.html       # Home page
├── DISPOSITION_GUIDE.md  # User guide
├── CHANGELOG.md          # Version history
├── INSTALLATION.md       # This file
└── README.md             # Original readme
```

## 🆘 Troubleshooting

### Server won't start
**Error:** `Port 3000 already in use`
- **Solution:** Kill the old process or change the port

**Error:** `Cannot find module 'express'`
- **Solution:** Run `npm install`

### Agents can't connect
- Check firewall settings
- Verify you're using the correct LAN IP
- Make sure server is running
- Try accessing from the server machine first: `http://localhost:3000/agent`

### Numbers not appearing
- Check that numbers were uploaded successfully in admin panel
- Verify numbers aren't all marked as DEAD or INTERESTED
- Check disposition breakdown in admin panel

### Followups not showing as due
- Verify system time is correct (uses IST)
- Check followup date/time in admin "Scheduled Followups" table
- Red badge = due, yellow badge = upcoming

### Data not persisting
- Check `data/` folder exists and is writable
- Look for `state.json` file
- Check server terminal for error messages

### Disposition buttons not working
- Open browser console (F12) and check for errors
- Verify you clicked "Start Dialing" first
- Check that socket connection is active (look for disconnect warnings)

## 📞 Support

For issues or questions:
1. Check `DISPOSITION_GUIDE.md` for usage help
2. Review `CHANGELOG.md` for what's new
3. Check browser console for JavaScript errors
4. Check server terminal for backend errors

## 🔒 Security Notes

- System runs on LAN only (not accessible from internet)
- No external database required
- All data stored locally in `data/state.json`
- Employee ID whitelist prevents unauthorized access
- Regular backups recommended

## 📊 Performance Notes

- Handles 10,000+ numbers efficiently
- Auto-saves every second
- Socket.io for real-time updates
- Works on any modern browser
- Low bandwidth usage (LAN only)

## ✅ Next Steps

1. ✅ Install/upgrade the system
2. ✅ Read `DISPOSITION_GUIDE.md`
3. ✅ Test all dispositions
4. ✅ Train your agents
5. ✅ Start calling!

---

**Version:** 2.0  
**Last Updated:** May 29, 2026  
**Support:** Check documentation files included in package
