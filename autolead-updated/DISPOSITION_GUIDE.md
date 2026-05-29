# 📋 Disposition System Guide

## Overview
The AutoLead system now includes a comprehensive disposition tracking system that allows agents to categorize each call and automatically manages follow-up scheduling and lead prioritization.

## 6 Disposition Types

### 1. ❌ Call Not Connected (DEAD)
- **Use when:** Number is invalid, disconnected, or permanently unreachable
- **System behavior:** Number is marked as DEAD and will **NEVER** be dialed again
- **Admin view:** Counted in "Dead Numbers" stat

### 2. 📵 Call Not Received
- **Use when:** Call rings but customer doesn't answer
- **System behavior:** Number returns to the pool and will be available for dialing the next day
- **Admin view:** Counted in "Not Received" stat
- **Note:** These numbers get recycled daily for retry attempts

### 3. 🚫 Not Interested
- **Use when:** Customer explicitly states they are not interested
- **System behavior:** Number is blocked for **30 days** from the disposition date
- **Admin view:** Counted in "Not Interested" stat
- **Note:** After 30 days, the number automatically becomes available again

### 4. 📅 Followup
- **Use when:** Customer requests a callback at a specific date/time
- **System behavior:** 
  - Opens a modal to schedule date and time
  - Number is removed from regular pool
  - When followup time arrives, number gets **PRIORITY** in dialing queue
  - After followup is dialed, agent can set a new disposition
- **Admin view:** 
  - Counted in "Followups" stat
  - Listed in "Scheduled Followups" table with status:
    - 🔴 **DUE NOW** (red) - followup time has passed
    - 🟡 **Upcoming** (yellow) - followup scheduled for future
- **Agent experience:** Followup leads appear first when available

### 5. 📴 Switch OFF
- **Use when:** Customer's phone is switched off or unreachable temporarily
- **System behavior:** Number returns to the pool and will be available for dialing the next day
- **Admin view:** Counted in "Switch OFF" stat
- **Note:** Similar to "Not Received" but tracks temporarily unavailable phones

### 6. ⭐ Interested (PINNED)
- **Use when:** Customer shows genuine interest and wants to proceed
- **System behavior:** 
  - Number is marked as INTERESTED and removed from dialing pool
  - Lead is **PINNED** and visible to admin permanently
  - Will never be auto-dialed again
- **Admin view:** 
  - Counted in "Interested" stat
  - Listed in "Interested Leads (Pinned)" table showing:
    - Phone number
    - Customer name
    - Agent who marked it
    - Timestamp
- **Note:** This is your hot leads list!

## Agent Interface

### How to Use Dispositions
1. **Start Dialing** - Click "Start Dialing" button
2. **View Lead** - System shows phone number and name (if available)
3. **Make the Call** - Dial the number on your phone
4. **Select Disposition** - After call, click the appropriate disposition button
5. **Next Lead** - System automatically shows the next number

### Followup Scheduling
When you click **📅 Followup**:
1. Modal opens with date and time pickers
2. Select the date (minimum: today)
3. Select the time (default: 10:00 AM)
4. Click "Schedule Followup"
5. Lead is scheduled and next number appears

## Admin Panel Features

### Disposition Breakdown
6-card grid showing real-time counts:
- Dead Numbers
- Not Received
- Not Interested
- Followups (pending)
- Switch OFF
- Interested

### Interested Leads Table
Shows all leads marked as interested:
- Phone number
- Customer name
- Agent who marked it
- Timestamp when marked

### Scheduled Followups Table
Shows all pending followups:
- Phone number
- Customer name
- Agent who scheduled it
- Followup date/time
- Status (DUE NOW or Upcoming)

## Dialing Priority Logic

The system follows this priority order:

1. **Due Followups** - Any followup whose date/time has passed
2. **Fresh Numbers** - Numbers never contacted
3. **Retry Numbers** - Numbers marked as "Not Received" or "Switch OFF" from previous day

## Automatic Daily Reset

At midnight IST:
- Agent dial counts reset to 0
- "Not Received" and "Switch OFF" numbers become available again
- Agents marked as inactive until they log in
- Break times reset
- All other disposition states persist (Dead, Not Interested, Followups, Interested)

## Data Persistence

All disposition data is stored in `data/state.json`:
- Number disposition status
- Followup schedules
- Interested lead list
- Complete disposition history
- Agent actions log

## Best Practices

### For Agents:
- ✅ Be accurate with dispositions - they affect future dialing
- ✅ Use "Not Interested" only when customer explicitly refuses
- ✅ Schedule followups at times customer prefers
- ✅ Mark "Interested" only for genuine hot leads
- ✅ Use "Switch OFF" vs "Not Received" appropriately

### For Admins:
- ✅ Monitor "Interested Leads" table daily
- ✅ Review "Scheduled Followups" for due callbacks
- ✅ Check disposition breakdown for team performance
- ✅ Follow up on hot leads promptly
- ✅ Backup `data/state.json` regularly

## Technical Notes

### Disposition States Stored Per Number:
```javascript
{
  disposition: 'INTERESTED',
  dispositionDate: '2026-05-29T10:30:00.000Z',
  dispositionBy: 'emp_061007',
  followupDateTime: '2026-06-01T10:00:00',  // For FOLLOWUP only
  followupDialed: false,                      // For FOLLOWUP tracking
  interested: true,                           // For INTERESTED flag
  interestedAt: '2026-05-29T10:30:00.000Z'   // For INTERESTED timestamp
}
```

### Socket Events:
- `agent-disposition` - Sent when agent selects disposition
  - Parameters: agentId, numberId, disposition, followupDateTime (optional)

### API Endpoints:
All existing endpoints work with disposition system transparently.

## Troubleshooting

**Q: Followup not appearing when due?**
- A: Check that followupDialed is false and followup time has passed

**Q: Number not available after 30 days?**
- A: Check dispositionDate - 30 days calculated from that timestamp

**Q: Interested lead still appearing in dial queue?**
- A: This shouldn't happen - check disposition field is set to 'INTERESTED'

**Q: Agent can't see any numbers?**
- A: All available numbers may be blocked by dispositions - check admin panel

## Summary

The disposition system provides:
- ✅ Smart lead categorization
- ✅ Automatic followup scheduling
- ✅ Hot lead tracking (Interested)
- ✅ 30-day not-interested blocks
- ✅ Dead number filtering
- ✅ Priority-based dialing
- ✅ Complete admin visibility

This ensures no leads fall through the cracks and your team focuses on the right leads at the right time!
