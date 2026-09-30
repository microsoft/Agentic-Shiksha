# EKALAIVA Logging Service

This document describes the client-side logging system implemented in `loggingService.ts`.

## Overview

The logging service tracks user activity, chat events, and engagement metrics within the EKALAIVA educational platform. All logs are stored locally in `localStorage` with export capabilities for analysis.

---

## Storage

- **Storage Location:** Browser `localStorage`
- **Key Format:** `ekalaiva_logs_YYYY-MM-DD` (one key per day)
- **Session Key:** `ekalaiva_current_session`
- **Auto-Cleanup:** Disabled (can be enabled to keep last 30 days)

---

## Event Types

### 1. Authentication Events

| Event Type | Description | Fields |
|------------|-------------|--------|
| `auth_login` | User logged in | `userName`, `userId` |
| `auth_logout` | User logged out | — |

### 2. Session Events

| Event Type | Description | Fields |
|------------|-------------|--------|
| `session_start` | Session began | `userId` |
| `session_end` | Session ended | `duration` (ms) |

### 3. Activity Tracking

| Event Type | Description | Fields |
|------------|-------------|--------|
| `activity_ping` | Periodic activity check (every 60s) | `activeSeconds`, `idleSeconds`, `lastActivityType` |

**Activity Types Tracked:**
- `mouse` — Mouse movement and clicks
- `keyboard` — Key presses
- `scroll` — Page scrolling
- `focus` — Window focus
- `visibility` — Tab visibility changes

**Idle Threshold:** 30 seconds without activity = idle

### 4. Chat Events

| Event Type | Description | Fields |
|------------|-------------|--------|
| `chat_message_sent` | User sent a message | `threadId`, `agentId`, `agentName`, `agentKind`, `content`, `contentLength`, `messageIndex` |
| `chat_message_received` | Agent responded | `threadId`, `agentId`, `agentName`, `agentKind`, `content`, `contentLength`, `messageIndex` |
| `chat_retry` | User retried a message | `threadId`, `agentId`, `messageIndex`, `originalContent` |
| `chat_failed` | Chat request failed | `threadId`, `agentId`, `userMessage`, `errorMessage` |

### 5. Search Events

| Event Type | Description | Fields |
|------------|-------------|--------|
| `chat_search` | User performed a search | `searchQuery`, `resultsCount`, `searchContext` |

**Search Contexts:**
- `sidebar` — Chat history search in sidebar
- `chat` — Search within chat
- `library` — Course library search

### 6. Navigation Events

| Event Type | Description | Fields |
|------------|-------------|--------|
| `agent_switch` | Switched to different agent | `fromAgentId`, `fromAgentName`, `toAgentId`, `toAgentName` |
| `mode_switch` | Switched between learning/exam | `fromMode`, `toMode`, `courseId`, `restoredThread` |
| `thread_created` | New chat thread created | `threadId`, `agentId`, `agentName` |
| `thread_selected` | Existing thread selected | `threadId`, `agentId`, `agentName` |

---

## Common Fields (All Events)

Every logged event includes:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique event ID |
| `type` | string | Event type identifier |
| `timestamp` | string | ISO 8601 timestamp |
| `sessionId` | string | Current session identifier |
| `userAgent` | string | Browser user agent |
| `userId` | string? | User identifier (if available) |

---

## Session Summary

At the end of each session, a summary is generated:

| Field | Description |
|-------|-------------|
| `sessionId` | Session identifier |
| `userId` | User identifier |
| `startTime` | Session start timestamp |
| `endTime` | Session end timestamp |
| `totalActiveSeconds` | Cumulative active time |
| `totalIdleSeconds` | Cumulative idle time |
| `messagesSent` | Number of messages sent |
| `messagesReceived` | Number of agent responses |
| `retries` | Number of message retries |
| `failures` | Number of failed requests |
| `searches` | Number of search queries |
| `modeSwitches` | Number of learning/exam switches |
| `agentSwitches` | Number of agent switches |

---

## API Reference

### Session Management

```typescript
logger.startSession(userId?, userName?)  // Start a new session
logger.endSession()                       // End current session
logger.restoreSession()                   // Restore session after page reload
logger.getSessionId()                     // Get current session ID
```

### Logging Methods

```typescript
// Authentication
logger.logLogin(userName?, userId?)
logger.logLogout()

// Chat
logger.logMessageSent({ threadId, agentId, agentName, agentKind, content, messageIndex })
logger.logMessageReceived({ threadId, agentId, agentName, agentKind, content, messageIndex })
logger.logRetry({ threadId, agentId, messageIndex, originalContent })
logger.logChatFailed({ threadId, agentId, userMessage, errorMessage? })

// Search
logger.logSearch({ searchQuery, resultsCount, searchContext })

// Navigation
logger.logAgentSwitch({ fromAgentId?, fromAgentName?, toAgentId, toAgentName })
logger.logModeSwitch({ fromMode, toMode, courseId, restoredThread })
logger.logThreadCreated({ threadId, agentId, agentName })
logger.logThreadSelected({ threadId, agentId, agentName })
```

### Export & Management

```typescript
logger.exportLogs(days = 7)        // Get logs as array of DailyLogFile
logger.exportLogsAsJson(days = 7)  // Get logs as JSON string
logger.downloadLogs(days = 7)      // Download logs as JSON file
logger.getSessionStats()           // Get current session statistics
logger.clearAllLogs()              // Clear all stored logs
```

---

## Data Structure

### Daily Log File

```typescript
interface DailyLogFile {
  date: string;           // YYYY-MM-DD
  events: LogEvent[];     // All events for the day
  sessions: SessionSummary[];  // Session summaries
}
```

### Example Event

```json
{
  "id": "1735574400000-abc123def",
  "type": "chat_message_sent",
  "timestamp": "2025-12-30T12:00:00.000Z",
  "sessionId": "session-1735574400000-xyz789",
  "userAgent": "Mozilla/5.0...",
  "threadId": "thread_abc123",
  "agentId": "asst_xyz789",
  "agentName": "Introduction to Python",
  "agentKind": "learning",
  "content": "What is a variable?",
  "contentLength": 19,
  "messageIndex": 0
}
```

---

## Usage Locations

The logging service is currently integrated in:

| File | Events Logged |
|------|---------------|
| `App.tsx` | Session start/restore |
| `useAgentChat.ts` | Chat messages, retries, failures |
| `TcaLacaBuilderApp.tsx` | Mode switches, agent switches |
| `LogViewer.tsx` | Log viewing and export UI |

---

## Privacy Considerations

- **Content Logging:** Full message content is logged (can be changed to log only length)
- **Local Storage:** All data stays in the user's browser
- **No Backend:** Logs are not sent to any server
- **User Control:** Users can clear logs via `logger.clearAllLogs()`
- **Export:** Users can download their logs for personal review

---

## Configuration

Constants in `loggingService.ts`:

| Constant | Value | Description |
|----------|-------|-------------|
| `ACTIVITY_PING_INTERVAL` | 60000 ms | Activity ping frequency |
| `IDLE_THRESHOLD` | 30000 ms | Idle detection threshold |
| `STORAGE_KEY_PREFIX` | `ekalaiva_logs_` | localStorage key prefix |

---

## Future Enhancements

Planned but not yet implemented:

- [ ] Backend API integration for centralized logging
- [ ] Course creation/edit logs
- [ ] File upload tracking
- [ ] Error analytics with stack traces
- [ ] Configurable privacy levels (content vs. length only)
- [ ] CSV export format
