/**
 * Log Viewer Component
 * Provides UI to view, export, and manage activity logs
 */

import { useState } from "react";
import { logger, DailyLogFile, LogEvent } from "@/lib/loggingService";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Trash2, Activity, Clock, MessageSquare, RefreshCcw, AlertCircle, Search, X } from "lucide-react";

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit',
    hour12: true 
  });
}

function getEventIcon(type: string) {
  switch (type) {
    case 'chat_message_sent':
    case 'chat_message_received':
      return <MessageSquare className="w-3 h-3" />;
    case 'chat_retry':
      return <RefreshCcw className="w-3 h-3" />;
    case 'chat_failed':
      return <AlertCircle className="w-3 h-3 text-red-400" />;
    case 'chat_search':
      return <Search className="w-3 h-3" />;
    case 'activity_ping':
      return <Activity className="w-3 h-3" />;
    default:
      return <Clock className="w-3 h-3" />;
  }
}

function getEventLabel(event: LogEvent): string {
  switch (event.type) {
    case 'auth_login':
      return 'Logged in';
    case 'auth_logout':
      return 'Logged out';
    case 'session_start':
      return 'Session started';
    case 'session_end':
      return `Session ended (${formatDuration((event as any).duration || 0)})`;
    case 'activity_ping':
      return `Activity: ${formatDuration((event as any).activeSeconds * 1000)} active`;
    case 'chat_message_sent':
      return `Sent: "${(event as any).content?.substring(0, 40)}..."`;
    case 'chat_message_received':
      return `Received: ${(event as any).contentLength} chars`;
    case 'chat_retry':
      return 'Retried message';
    case 'chat_failed':
      return `Failed: ${(event as any).errorMessage || 'Unknown error'}`;
    case 'chat_search':
      return `Searched: "${(event as any).searchQuery}"`;
    case 'mode_switch':
      return `Switched: ${(event as any).fromMode} → ${(event as any).toMode}`;
    case 'agent_switch':
      return `Agent: ${(event as any).toAgentName}`;
    case 'thread_created':
      return 'New chat started';
    case 'thread_selected':
      return 'Chat selected';
    default: {
      // Handle any unknown event types
      const eventType = (event as { type?: string }).type;
      return eventType || 'Unknown event';
    }
  }
}

interface LogViewerProps {
  trigger?: React.ReactNode;
}

export function LogViewer({ trigger }: LogViewerProps) {
  const [logs, setLogs] = useState<DailyLogFile[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  
  const loadLogs = () => {
    const exportedLogs = logger.exportLogs(7);
    setLogs(exportedLogs);
    if (exportedLogs.length > 0 && !selectedDay) {
      setSelectedDay(exportedLogs[0].date);
    }
  };
  
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      loadLogs();
    }
  };
  
  const selectedDayLogs = logs.find(l => l.date === selectedDay);
  const stats = logger.getSessionStats();
  
  // Calculate summary stats
  const todayLogs = logs.find(l => l.date === new Date().toISOString().split('T')[0]);
  const todayEvents = todayLogs?.events || [];
  const messagesSent = todayEvents.filter(e => e.type === 'chat_message_sent').length;
  const messagesReceived = todayEvents.filter(e => e.type === 'chat_message_received').length;
  const retries = todayEvents.filter(e => e.type === 'chat_retry').length;
  const failures = todayEvents.filter(e => e.type === 'chat_failed').length;
  
  return (
    <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm">
            <Activity className="w-4 h-4 mr-2" />
            Activity Logs
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-2xl bg-neutral-900 border-neutral-800">
        <AlertDialogHeader>
          <div className="flex items-center justify-between">
            <AlertDialogTitle className="text-white flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Activity Logs
            </AlertDialogTitle>
            <AlertDialogCancel className="h-8 w-8 p-0 border-0 bg-transparent hover:bg-neutral-800">
              <X className="h-4 w-4 text-neutral-400" />
            </AlertDialogCancel>
          </div>
          <AlertDialogDescription className="text-neutral-400">
            View and export your activity history
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        {/* Current Session Stats */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-neutral-800/50 rounded-lg p-3">
            <div className="text-xs text-neutral-500 mb-1">Session Time</div>
            <div className="text-lg font-semibold text-white">
              {formatDuration(stats.sessionDuration)}
            </div>
          </div>
          <div className="bg-neutral-800/50 rounded-lg p-3">
            <div className="text-xs text-neutral-500 mb-1">Active Time</div>
            <div className="text-lg font-semibold text-green-400">
              {formatDuration(stats.activeSeconds * 1000)}
            </div>
          </div>
          <div className="bg-neutral-800/50 rounded-lg p-3">
            <div className="text-xs text-neutral-500 mb-1">Messages Sent</div>
            <div className="text-lg font-semibold text-blue-400">{messagesSent}</div>
          </div>
          <div className="bg-neutral-800/50 rounded-lg p-3">
            <div className="text-xs text-neutral-500 mb-1">Messages Received</div>
            <div className="text-lg font-semibold text-indigo-400">{messagesReceived}</div>
          </div>
        </div>
        
        {/* Additional Stats */}
        <div className="flex gap-4 text-xs text-neutral-500 mb-4">
          <span>Retries: <span className="text-yellow-400">{retries}</span></span>
          <span>Failures: <span className="text-red-400">{failures}</span></span>
        </div>
        
        {/* Day Selector */}
        <div className="flex gap-2 mb-3">
          {logs.map(day => (
            <Button
              key={day.date}
              variant={selectedDay === day.date ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedDay(day.date)}
              className={selectedDay === day.date 
                ? "bg-blue-600 text-white" 
                : "bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700"}
            >
              {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              <span className="ml-1 text-xs opacity-70">({day.events.length})</span>
            </Button>
          ))}
        </div>
        
        {/* Events List */}
        <ScrollArea className="h-[300px] border border-neutral-800 rounded-lg">
          <div className="p-3 space-y-1">
            {selectedDayLogs?.events.slice().reverse().map((event, i) => (
              <div 
                key={event.id || i}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-800/50 text-sm"
              >
                <span className="text-neutral-600">{getEventIcon(event.type)}</span>
                <span className="text-neutral-500 text-xs font-mono w-20">
                  {formatTimestamp(event.timestamp)}
                </span>
                <span className="text-neutral-300 flex-1 truncate">
                  {getEventLabel(event)}
                </span>
              </div>
            ))}
            {(!selectedDayLogs || selectedDayLogs.events.length === 0) && (
              <div className="text-neutral-500 text-sm text-center py-8">
                No events recorded for this day
              </div>
            )}
          </div>
        </ScrollArea>
        
        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => logger.downloadLogs(7)}
            className="bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700"
          >
            <Download className="w-4 h-4 mr-2" />
            Export Logs (7 days)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm('Are you sure you want to clear all logs? This cannot be undone.')) {
                logger.clearAllLogs();
                loadLogs();
              }
            }}
            className="bg-neutral-800 border-neutral-700 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear All
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default LogViewer;
