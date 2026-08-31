/**
 * Logging Service for EKALAIVA
 * Tracks user activity, chat events, and engagement metrics
 * Stores logs locally with export capability
 */

// ============ Types ============

export type LogEventType = 
  | 'auth_login'
  | 'auth_logout'
  | 'session_start'
  | 'session_end'
  | 'activity_ping'
  | 'chat_message_sent'
  | 'chat_message_received'
  | 'chat_retry'
  | 'chat_failed'
  | 'chat_search'
  | 'agent_switch'
  | 'mode_switch'
  | 'thread_created'
  | 'thread_selected';

export interface BaseLogEvent {
  id: string;
  type: LogEventType;
  timestamp: string; // ISO string
  userId?: string;
  sessionId: string;
  userAgent: string;
}

export interface AuthLogEvent extends BaseLogEvent {
  type: 'auth_login' | 'auth_logout';
  userName?: string;
}

export interface SessionLogEvent extends BaseLogEvent {
  type: 'session_start' | 'session_end';
  duration?: number; // in milliseconds
}

export interface ActivityPingEvent extends BaseLogEvent {
  type: 'activity_ping';
  activeSeconds: number; // cumulative active time in current session
  idleSeconds: number; // cumulative idle time
  lastActivityType: 'mouse' | 'keyboard' | 'scroll' | 'focus' | 'visibility';
}

export interface ChatMessageEvent extends BaseLogEvent {
  type: 'chat_message_sent' | 'chat_message_received';
  threadId: string;
  agentId: string;
  agentName: string;
  agentKind: 'learning' | 'exam';
  content: string;
  contentLength: number;
  messageIndex: number;
}

export interface ChatRetryEvent extends BaseLogEvent {
  type: 'chat_retry';
  threadId: string;
  agentId: string;
  messageIndex: number;
  originalContent: string;
}

export interface ChatFailedEvent extends BaseLogEvent {
  type: 'chat_failed';
  threadId: string;
  agentId: string;
  errorMessage?: string;
  userMessage: string;
}

export interface ChatSearchEvent extends BaseLogEvent {
  type: 'chat_search';
  searchQuery: string;
  resultsCount: number;
  searchContext: 'sidebar' | 'chat' | 'library';
}

export interface AgentSwitchEvent extends BaseLogEvent {
  type: 'agent_switch';
  fromAgentId?: string;
  fromAgentName?: string;
  toAgentId: string;
  toAgentName: string;
}

export interface ModeSwitchEvent extends BaseLogEvent {
  type: 'mode_switch';
  fromMode: 'learning' | 'exam';
  toMode: 'learning' | 'exam';
  courseId: string;
  restoredThread: boolean;
}

export interface ThreadEvent extends BaseLogEvent {
  type: 'thread_created' | 'thread_selected';
  threadId: string;
  agentId: string;
  agentName: string;
}

export type LogEvent = 
  | AuthLogEvent 
  | SessionLogEvent 
  | ActivityPingEvent 
  | ChatMessageEvent 
  | ChatRetryEvent 
  | ChatFailedEvent 
  | ChatSearchEvent 
  | AgentSwitchEvent 
  | ModeSwitchEvent 
  | ThreadEvent;

export interface SessionSummary {
  sessionId: string;
  userId?: string;
  startTime: string;
  endTime?: string;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  messagesSent: number;
  messagesReceived: number;
  retries: number;
  failures: number;
  searches: number;
  modeSwitches: number;
  agentSwitches: number;
}

export interface DailyLogFile {
  date: string; // YYYY-MM-DD
  events: LogEvent[];
  sessions: SessionSummary[];
}

// ============ Constants ============

const STORAGE_KEY_PREFIX = 'ekalaiva_logs_';
const STORAGE_SESSION_KEY = 'ekalaiva_current_session';
const ACTIVITY_PING_INTERVAL = 60000; // 1 minute
const IDLE_THRESHOLD = 30000; // 30 seconds without activity = idle

// ============ State ============

let currentSessionId: string | null = null;
let sessionStartTime: number = 0;
let lastActivityTime: number = 0;
let totalActiveSeconds: number = 0;
let totalIdleSeconds: number = 0;
let activityPingInterval: ReturnType<typeof setInterval> | null = null;
let lastActivityType: 'mouse' | 'keyboard' | 'scroll' | 'focus' | 'visibility' = 'focus';

// ============ Utility Functions ============

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

function getDateKey(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

function getUserAgent(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
}

function getStorageKey(date: string): string {
  return `${STORAGE_KEY_PREFIX}${date}`;
}

// ============ Storage Functions ============

function loadDailyLogs(date: string): DailyLogFile {
  try {
    const stored = localStorage.getItem(getStorageKey(date));
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load logs:', e);
  }
  return { date, events: [], sessions: [] };
}

// Maximum events per day to prevent unbounded localStorage growth
const MAX_EVENTS_PER_DAY = 500;

function saveDailyLogs(logs: DailyLogFile): void {
  // Cap events to prevent unbounded growth
  if (logs.events.length > MAX_EVENTS_PER_DAY) {
    logs.events = logs.events.slice(-MAX_EVENTS_PER_DAY);
  }
  try {
    localStorage.setItem(getStorageKey(logs.date), JSON.stringify(logs));
  } catch (e) {
    console.warn('Failed to save logs (quota exceeded), cleaning up old logs...');
    // Aggressively clean up to free space for MSAL and other critical data
    cleanupOldLogs(1); // Keep only today
    // Try once more with reduced data
    try {
      logs.events = logs.events.slice(-100); // Keep only last 100 events
      localStorage.setItem(getStorageKey(logs.date), JSON.stringify(logs));
    } catch {
      // Still failing - remove all logs to free space
      cleanupOldLogs(0);
      console.error('Cleared all logs to free localStorage space');
    }
  }
}

function cleanupOldLogs(keepDays: number = 3): void {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - keepDays);
  const cutoffKey = getDateKey(cutoffDate);
  
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_KEY_PREFIX)) {
      const dateStr = key.replace(STORAGE_KEY_PREFIX, '');
      if (dateStr < cutoffKey) {
        keysToRemove.push(key);
      }
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
  if (keysToRemove.length > 0) {
    console.log(`[Logging] Cleaned up ${keysToRemove.length} old log entries`);
  }
}

// ============ Core Logging Function ============

// Use a more permissive type for the internal logging function
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function logEvent(event: Record<string, any> & { type: LogEventType }): void {
  const fullEvent: LogEvent = {
    ...event,
    id: generateId(),
    timestamp: new Date().toISOString(),
    sessionId: currentSessionId || 'no-session',
    userAgent: getUserAgent(),
  } as LogEvent;
  
  const date = getDateKey();
  const logs = loadDailyLogs(date);
  logs.events.push(fullEvent);
  saveDailyLogs(logs);
  
  // Debug log in development
  if (import.meta.env.DEV) {
    console.log('[EKALAIVA Log]', fullEvent.type, fullEvent);
  }
}

// ============ Activity Tracking ============

function updateActivityTime(): void {
  const now = Date.now();
  const timeSinceLastActivity = now - lastActivityTime;
  
  if (lastActivityTime > 0) {
    if (timeSinceLastActivity <= IDLE_THRESHOLD) {
      // User was active
      totalActiveSeconds += timeSinceLastActivity / 1000;
    } else {
      // User was idle
      totalIdleSeconds += timeSinceLastActivity / 1000;
    }
  }
  
  lastActivityTime = now;
}

function handleActivity(type: 'mouse' | 'keyboard' | 'scroll' | 'focus' | 'visibility'): void {
  updateActivityTime();
  lastActivityType = type;
}

function startActivityTracking(): void {
  if (typeof window === 'undefined') return;
  
  // Mouse movement
  window.addEventListener('mousemove', () => handleActivity('mouse'), { passive: true });
  window.addEventListener('click', () => handleActivity('mouse'), { passive: true });
  
  // Keyboard
  window.addEventListener('keydown', () => handleActivity('keyboard'), { passive: true });
  
  // Scroll
  window.addEventListener('scroll', () => handleActivity('scroll'), { passive: true });
  
  // Focus/blur
  window.addEventListener('focus', () => handleActivity('focus'));
  window.addEventListener('blur', () => updateActivityTime());
  
  // Visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      handleActivity('visibility');
    } else {
      updateActivityTime();
    }
  });
  
  // Periodic ping
  activityPingInterval = setInterval(() => {
    updateActivityTime();
    logEvent({
      type: 'activity_ping',
      activeSeconds: Math.round(totalActiveSeconds),
      idleSeconds: Math.round(totalIdleSeconds),
      lastActivityType,
    });
  }, ACTIVITY_PING_INTERVAL);
  
  // Before unload - save session
  window.addEventListener('beforeunload', () => {
    endSession();
  });
}

function stopActivityTracking(): void {
  if (activityPingInterval) {
    clearInterval(activityPingInterval);
    activityPingInterval = null;
  }
}

// ============ Session Management ============

function startSession(userId?: string, userName?: string): string {
  // End any existing session first
  if (currentSessionId) {
    endSession();
  }
  
  currentSessionId = generateSessionId();
  sessionStartTime = Date.now();
  lastActivityTime = Date.now();
  totalActiveSeconds = 0;
  totalIdleSeconds = 0;
  
  // Save session info
  localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify({
    sessionId: currentSessionId,
    startTime: sessionStartTime,
    userId,
    userName,
  }));
  
  logEvent({
    type: 'session_start',
    userId,
  });
  
  startActivityTracking();
  
  return currentSessionId;
}

function endSession(): void {
  if (!currentSessionId) return;
  
  updateActivityTime();
  stopActivityTracking();
  
  const duration = Date.now() - sessionStartTime;
  
  logEvent({
    type: 'session_end',
    duration,
  });
  
  // Save session summary
  const date = getDateKey();
  const logs = loadDailyLogs(date);
  
  const sessionEvents = logs.events.filter(e => e.sessionId === currentSessionId);
  const summary: SessionSummary = {
    sessionId: currentSessionId,
    startTime: new Date(sessionStartTime).toISOString(),
    endTime: new Date().toISOString(),
    totalActiveSeconds: Math.round(totalActiveSeconds),
    totalIdleSeconds: Math.round(totalIdleSeconds),
    messagesSent: sessionEvents.filter(e => e.type === 'chat_message_sent').length,
    messagesReceived: sessionEvents.filter(e => e.type === 'chat_message_received').length,
    retries: sessionEvents.filter(e => e.type === 'chat_retry').length,
    failures: sessionEvents.filter(e => e.type === 'chat_failed').length,
    searches: sessionEvents.filter(e => e.type === 'chat_search').length,
    modeSwitches: sessionEvents.filter(e => e.type === 'mode_switch').length,
    agentSwitches: sessionEvents.filter(e => e.type === 'agent_switch').length,
  };
  
  logs.sessions.push(summary);
  saveDailyLogs(logs);
  
  localStorage.removeItem(STORAGE_SESSION_KEY);
  currentSessionId = null;
}

function restoreSession(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_SESSION_KEY);
    if (stored) {
      const session = JSON.parse(stored);
      currentSessionId = session.sessionId;
      sessionStartTime = session.startTime;
      lastActivityTime = Date.now();
      startActivityTracking();
      return true;
    }
  } catch (e) {
    console.error('Failed to restore session:', e);
  }
  return false;
}

// ============ Public Logging API ============

export const logger = {
  // Session management
  startSession,
  endSession,
  restoreSession,
  getSessionId: () => currentSessionId,
  
  // Auth events
  logLogin: (userName?: string, userId?: string) => {
    startSession(userId, userName);
    logEvent({
      type: 'auth_login',
      userName,
      userId,
    });
  },
  
  logLogout: () => {
    logEvent({
      type: 'auth_logout',
    });
    endSession();
  },
  
  // Chat events
  logMessageSent: (params: {
    threadId: string;
    agentId: string;
    agentName: string;
    agentKind: 'learning' | 'exam';
    content: string;
    messageIndex: number;
  }) => {
    logEvent({
      type: 'chat_message_sent',
      ...params,
      contentLength: params.content.length,
    });
  },
  
  logMessageReceived: (params: {
    threadId: string;
    agentId: string;
    agentName: string;
    agentKind: 'learning' | 'exam';
    content: string;
    messageIndex: number;
  }) => {
    logEvent({
      type: 'chat_message_received',
      ...params,
      contentLength: params.content.length,
    });
  },
  
  logRetry: (params: {
    threadId: string;
    agentId: string;
    messageIndex: number;
    originalContent: string;
  }) => {
    logEvent({
      type: 'chat_retry',
      ...params,
    });
  },
  
  logChatFailed: (params: {
    threadId: string;
    agentId: string;
    userMessage: string;
    errorMessage?: string;
  }) => {
    logEvent({
      type: 'chat_failed',
      ...params,
    });
  },
  
  // Search events
  logSearch: (params: {
    searchQuery: string;
    resultsCount: number;
    searchContext: 'sidebar' | 'chat' | 'library';
  }) => {
    logEvent({
      type: 'chat_search',
      ...params,
    });
  },
  
  // Navigation events
  logAgentSwitch: (params: {
    fromAgentId?: string;
    fromAgentName?: string;
    toAgentId: string;
    toAgentName: string;
  }) => {
    logEvent({
      type: 'agent_switch',
      ...params,
    });
  },
  
  logModeSwitch: (params: {
    fromMode: 'learning' | 'exam';
    toMode: 'learning' | 'exam';
    courseId: string;
    restoredThread: boolean;
  }) => {
    logEvent({
      type: 'mode_switch',
      ...params,
    });
  },
  
  logThreadCreated: (params: {
    threadId: string;
    agentId: string;
    agentName: string;
  }) => {
    logEvent({
      type: 'thread_created',
      ...params,
    });
  },
  
  logThreadSelected: (params: {
    threadId: string;
    agentId: string;
    agentName: string;
  }) => {
    logEvent({
      type: 'thread_selected',
      ...params,
    });
  },
  
  // Export functions
  exportLogs: (days: number = 7): DailyLogFile[] => {
    const logs: DailyLogFile[] = [];
    const today = new Date();
    
    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = getDateKey(date);
      const dayLogs = loadDailyLogs(dateKey);
      if (dayLogs.events.length > 0 || dayLogs.sessions.length > 0) {
        logs.push(dayLogs);
      }
    }
    
    return logs;
  },
  
  exportLogsAsJson: (days: number = 7): string => {
    const logs = logger.exportLogs(days);
    return JSON.stringify(logs, null, 2);
  },
  
  downloadLogs: (days: number = 7) => {
    const json = logger.exportLogsAsJson(days);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ekalaiva_logs_${getDateKey()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  
  // Get current session stats
  getSessionStats: () => ({
    sessionId: currentSessionId,
    sessionDuration: currentSessionId ? Date.now() - sessionStartTime : 0,
    activeSeconds: Math.round(totalActiveSeconds),
    idleSeconds: Math.round(totalIdleSeconds),
  }),
  
  // Clear all logs
  clearAllLogs: () => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  },

  // Clean up old logs to free localStorage space (keep last N days)
  cleanup: (keepDays: number = 3) => {
    cleanupOldLogs(keepDays);
  },
};

export default logger;
