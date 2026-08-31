/**
 * TeacherDashboard — teacher-scoped learning-progress analytics.
 *
 * Layout:
 *   Sidebar  — brand, course selector, section nav, sign out.
 *   Header   — section title + contextual actions.
 *   Content  — Overview, Students, Usage, Feedback, Analytics.
 *
 * All data is fetched from the teacher dashboard backend (port 8060) and is
 * already restricted to the authenticated teacher's own courses.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  UserRound,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  MessageSquare,
  Coins,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Circle,
  RefreshCw,
  TrendingUp,
  Inbox,
  CalendarDays,
  ShieldCheck,
  Diamond,
  Layers,
  Compass,
  Shapes,
  Check,
  Plus,
  X,
  History,
  SquarePen,
  Trash2,
} from "lucide-react";
import { UnifiedChatContainer } from "@/features/dashboard/components/UnifiedChatContainer";
import type { EvidenceCitation } from "@/features/dashboard/lib/types";
import Markdown from "@/features/dashboard/components/Markdown";
import QuizBlock, { type QuizQuestion } from "@/features/chat/QuizBlock";
import FlashcardBlock, { type FlashCard } from "@/features/chat/FlashcardBlock";
import ChallengeBlock from "@/features/chat/ChallengeBlock";
import { AssetCard } from "@/components/assets/AssetCard";
import type { Asset } from "@/lib/types";
import type { ChatMsg } from "@/features/dashboard/chat/ChatBubble";
import { useUserStore } from "@/lib/userStore";
import { cn, getCourseName } from "@/lib/utils";
import { DASHBOARD_API_URL, authHeaders } from "@/features/dashboard/lib/config";
import {
  listDashboardAgents,
  getTeacherSummary,
  getAgentOverview,
  getCourseCurriculum,
  getStudentDetail,
  getStudentAssets,
  getStudentAsset,
  getTokenUsageAnalytics,
  getLearningActivityAnalytics,
  listFeedback,
  type DashboardAgent,
  type TeacherSummary,
  type AgentOverview,
  type CourseCurriculum,
  type StudentSummary,
  type StudentDetail,
  type StudentAsset,
  type StudentAssetDetail,
  type TokenUsageAnalytics,
  type TokenUsagePoint,
  type LearningActivityAnalytics,
  type LearningActivityMetric,
  type LearningActivityPoint,
  type UsageGranularity,
  type FeedbackItem,
} from "@/features/dashboard/lib/dashboardApi";

type Tab = "students" | "usage" | "feedback";

const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard; hint: string }[] = [
  { id: "students", label: "My Students", icon: Users, hint: "Progress & insights agent" },
  { id: "usage", label: "Usage", icon: Coins, hint: "Learning activity" },
  { id: "feedback", label: "Feedback", icon: MessageSquare, hint: "What students say" },
];

/* ───────────────────────── helpers & atoms ───────────────────────── */

function pctColor(pct: number): string {
  if (pct >= 75) return "text-emerald-400";
  if (pct >= 50) return "text-amber-400";
  if (pct >= 25) return "text-orange-400";
  return "text-rose-400";
}
function pctBar(pct: number): string {
  if (pct >= 75) return "from-emerald-500 to-emerald-400";
  if (pct >= 50) return "from-amber-500 to-amber-400";
  if (pct >= 25) return "from-orange-500 to-orange-400";
  return "from-rose-500 to-rose-400";
}
/** Compact number formatting: 1234 -> "1,234", 12000 -> "12k", 1.2M. */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return +(n / 1_000_000).toFixed(1) + "M";
  if (abs >= 10_000) return +(n / 1_000).toFixed(1) + "k";
  return n.toLocaleString();
}
/** Relative "time ago" from an ISO timestamp. Empty string if invalid. */
function timeAgo(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
function statusIcon(status: string) {
  if (status === "learned")
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  if (status === "in_progress")
    return <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  return <Circle className="w-3.5 h-3.5 text-neutral-600 shrink-0" />;
}

function dateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The dashboard only receives asset metadata, never the user-authored body. */
function toAssetCardModel(a: StudentAsset): Asset {
  return {
    id: a.id,
    userId: "",
    threadId: a.thread_id || undefined,
    title: a.title,
    description: a.description || undefined,
    category: a.category as Asset["category"],
    type: a.type as Asset["type"],
    content: "",
    previewImageUrl: a.preview_image_url || undefined,
    tags: a.tags,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}

function relativeDateRange(days: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return { start: dateInputValue(start), end: dateInputValue(end) };
}

/** Trailing window of whole months ending today. */
function trailingMonthRange(months: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - months);
  return { start: dateInputValue(start), end: dateInputValue(end) };
}

function usagePeriodLabel(point: { periodStart: string }, granularity: UsageGranularity): string {
  const start = new Date(`${point.periodStart}T00:00:00Z`);
  return new Intl.DateTimeFormat(
    undefined,
    granularity === "month"
      ? { month: "short", year: "2-digit", timeZone: "UTC" }
      : { month: "short", day: "numeric", timeZone: "UTC" },
  ).format(start);
}

function Avatar({ name, className }: { name: string; className?: string }) {
  // Neutral avatars to match Shiksha's monochrome theme.
  const palette = [
    "bg-neutral-700 text-neutral-200",
    "bg-neutral-600 text-neutral-100",
    "bg-neutral-800 text-neutral-100",
    "bg-neutral-700 text-neutral-100",
    "bg-neutral-600 text-neutral-200",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const cls = palette[Math.abs(hash) % palette.length];
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full shrink-0",
        cls,
        className,
      )}
      aria-hidden
    >
      <UserRound className="w-1/2 h-1/2 shrink-0" strokeWidth={2} />
    </div>
  );
}

/** Icon-only stat so the roster tiles stay readable without wordy labels. */
function TileStat({
  icon: Icon,
  iconClass,
  label,
  value,
}: {
  icon: typeof Diamond;
  iconClass: string;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums" title={label}>
      {value}
      <span className="sr-only">{label}</span>
      <Icon
        className={cn("w-3 h-3 shrink-0", iconClass)}
        fill="currentColor"
        fillOpacity={0.3}
        aria-hidden
      />
    </span>
  );
}

const STAT_ICONS = {
  concepts: {
    icon: Diamond,
    class: "text-violet-400",
    short: "Thresholds",
    label: "threshold concepts crossed",
  },
  topics: {
    icon: Layers,
    class: "text-sky-400",
    short: "Topics",
    label: "syllabus topics learned",
  },
  explored: {
    icon: Compass,
    class: "text-emerald-400",
    short: "Explored",
    label: "topics explored off-syllabus",
  },
  assets: {
    icon: Shapes,
    class: "text-amber-400",
    short: "Assets",
    label: "assets created",
  },
} as const;

function StatLegend() {
  return (
    <div className="grid w-full grid-cols-4 text-[10px] text-neutral-500">
      {Object.entries(STAT_ICONS).map(([key, { icon: Icon, class: iconClass, short, label }]) => (
        <span
          key={key}
          className="inline-flex min-w-0 items-center justify-center gap-1 text-center"
          title={label}
        >
          <Icon
            className={cn("w-3 h-3 shrink-0", iconClass)}
            fill="currentColor"
            fillOpacity={0.3}
            aria-hidden
          />
          <span className="roster-legend-label truncate">{short}</span>
        </span>
      ))}
    </div>
  );
}

function ProgressRing({ pct, size = 44 }: { pct: number; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * c;
  const color =
    pct >= 75 ? "#34d399" : pct >= 50 ? "#fbbf24" : pct >= 25 ? "#fb923c" : "#fb7185";
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#27272a" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-3">
      {children}
    </h2>
  );
}

function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-neutral-400 text-sm py-16 justify-center">
      <Loader2 className="w-4 h-4 animate-spin" />
      {label || "Loading…"}
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-rose-300 text-sm bg-rose-500/10 border border-rose-500/20 rounded-xl px-3.5 py-2.5">
      <AlertCircle className="w-4 h-4 shrink-0" />
      {message}
    </div>
  );
}

function EmptyState({ icon: Icon, title, sub }: { icon: typeof Inbox; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4">
      <div className="w-12 h-12 rounded-2xl bg-neutral-800/70 flex items-center justify-center mb-3">
        <Icon className="w-6 h-6 text-neutral-500" />
      </div>
      <p className="text-sm font-medium text-neutral-300">{title}</p>
      {sub && <p className="text-xs text-neutral-500 mt-1 max-w-xs">{sub}</p>}
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-neutral-800/60", className)} />;
}

/** Placeholder shown while the dashboard's first data load is in flight. */
function OverviewSkeleton() {
  return (
    <div>
      <div className="flex flex-col gap-4 border-b border-neutral-800/80 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-2 h-4 w-48" />
        </div>
        <div className="flex gap-6">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="w-20">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-5 w-12" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]">
        <div className="border-b border-neutral-800/80 p-4 lg:border-b-0 lg:border-r lg:p-5">
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-4" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-lg" />
            ))}
          </div>
        </div>
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-56" />
              <Skeleton className="mt-2 h-3 w-36" />
            </div>
            <div className="flex gap-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-24 rounded-lg" />
              ))}
            </div>
          </div>
          <Skeleton className="mt-6 h-28 rounded-lg" />
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-48 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}

type CumulativeChartLine = {
  key: string;
  label: string;
  stroke: string;
  width: number;
  values: number[];
};

function CumulativeUsageChart({
  points,
  granularity,
  activity,
  activityLabel,
}: {
  points: TokenUsagePoint[];
  granularity: UsageGranularity;
  activity?: LearningActivityPoint[];
  activityLabel?: string;
}) {
  const periods = activity ?? points;
  const width = 880;
  const height = 280;
  const padding = { top: 18, right: 18, bottom: 42, left: 72 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const lines: CumulativeChartLine[] = activity
    ? [
        {
          key: "activity",
          label: activityLabel || "Total",
          stroke: "#34d399",
          width: 3,
          values: activity.map((point) => point.cumulativeCount),
        },
      ]
    : [
        {
          key: "input",
          label: "Input",
          stroke: "#38bdf8",
          width: 2,
          values: points.map((point) => point.cumulativeInputTokens),
        },
        {
          key: "output",
          label: "Output",
          stroke: "#fbbf24",
          width: 2,
          values: points.map((point) => point.cumulativeOutputTokens),
        },
        {
          key: "total",
          label: "Total",
          stroke: "#34d399",
          width: 3,
          values: points.map((point) => point.cumulativeTokens),
        },
      ];
  const maxValue = Math.max(1, ...lines.flatMap((line) => line.values));
  const xFor = (index: number) =>
    periods.length <= 1
      ? padding.left + plotWidth / 2
      : padding.left + (index / (periods.length - 1)) * plotWidth;
  const yFor = (value: number) => padding.top + plotHeight - (value / maxValue) * plotHeight;
  const coordinates = lines.map((line) => ({
    ...line,
    points: periods.map((point, index) => ({
      x: xFor(index),
      y: yFor(Number.isFinite(line.values[index]) ? line.values[index] : 0),
      point,
      value: line.values[index] || 0,
    })),
  }));
  const totalCoordinates = coordinates[coordinates.length - 1].points;
  const totalPolyline = totalCoordinates.map(({ x, y }) => `${x},${y}`).join(" ");
  const area = totalCoordinates.length
    ? `${totalCoordinates[0].x},${padding.top + plotHeight} ${totalPolyline} ${totalCoordinates[totalCoordinates.length - 1].x},${padding.top + plotHeight}`
    : "";
  const labelEvery = Math.max(1, Math.ceil(periods.length / 6));

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap justify-end gap-x-4 gap-y-1.5" aria-hidden="true">
        {lines.map((line) => (
          <span key={line.key} className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400">
            <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: line.stroke }} />
            {line.label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={
            activity
              ? `Cumulative ${activityLabel || "activity"} over the selected date range`
              : "Cumulative input, output, and total tracked token usage over the selected date range"
          }
          className="block w-full min-w-[34rem]"
        >
        <defs>
          <linearGradient id="usage-chart-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const value = maxValue * tick;
          const y = yFor(value);
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="#27272a"
                strokeWidth="1"
              />
              <text
                x={padding.left - 12}
                y={y + 4}
                textAnchor="end"
                fill="#71717a"
                fontSize="11"
              >
                {formatNumber(Math.round(value))}
              </text>
            </g>
          );
        })}
          {area && <polygon points={area} fill="url(#usage-chart-area)" />}
          {coordinates.map((line) => {
            const polyline = line.points.map(({ x, y }) => `${x},${y}`).join(" ");
            return polyline ? (
              <polyline
                key={line.key}
                points={polyline}
                fill="none"
                stroke={line.stroke}
                strokeWidth={line.width}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null;
          })}
        {totalCoordinates.map(({ x, y, point, value }, index) => (
          <g key={`${point.periodStart}-${point.periodEnd}`}>
            <circle cx={x} cy={y} r="4" fill="#09090b" stroke="#6ee7b7" strokeWidth="2">
              <title>
                {activity
                  ? `${usagePeriodLabel(point, granularity)}: ${formatNumber(value)} ${activityLabel || "events"}`
                  : `${usagePeriodLabel(point, granularity)}: ${formatNumber((point as TokenUsagePoint).cumulativeInputTokens)} input, ${formatNumber((point as TokenUsagePoint).cumulativeOutputTokens)} output, ${formatNumber((point as TokenUsagePoint).cumulativeTokens)} total`}
              </title>
            </circle>
            {(index % labelEvery === 0 || index === points.length - 1) && (
              <text
                x={x}
                y={height - 14}
                textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
                fill="#71717a"
                fontSize="11"
              >
                {usagePeriodLabel(point, granularity)}
              </text>
            )}
          </g>
        ))}
        </svg>
      </div>
    </div>
  );
}

function TokenConsumptionCalendar({
  points,
  startDate,
  endDate,
  title = "Token consumption calendar",
  unit = "tokens",
}: {
  points: Array<TokenUsagePoint | LearningActivityPoint>;
  startDate: string;
  endDate: string;
  title?: string;
  unit?: string;
}) {
  const cellSize = 12;
  const cellGap = 3;
  const cellStep = cellSize + cellGap;
  const leftPadding = 42;
  const topPadding = 28;
  const bottomPadding = 8;
  const rangeStart = new Date(`${startDate}T00:00:00Z`);
  const rangeEnd = new Date(`${endDate}T00:00:00Z`);
  const addDays = (value: Date, days: number) => {
    const next = new Date(value);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  };
  const gridStart = addDays(rangeStart, -rangeStart.getUTCDay());
  const gridEnd = addDays(rangeEnd, 6 - rangeEnd.getUTCDay());
  const dayCount = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86_400_000) + 1;
  const weekCount = Math.ceil(dayCount / 7);
  const width = leftPadding + weekCount * cellStep;
  const height = topPadding + 7 * cellStep + bottomPadding;
  const pointByDay = new Map(points.map((point) => [point.periodStart, point]));
  const valueFor = (point?: TokenUsagePoint | LearningActivityPoint) =>
    point && "totalTokens" in point ? point.totalTokens : point?.count ?? 0;
  const positiveValues = points.map((point) => valueFor(point)).filter((value) => value > 0);
  const maxValue = Math.max(0, ...positiveValues);
  const colors = ["#18181b", "#064e3b", "#047857", "#10b981", "#6ee7b7"];
  const levelFor = (value: number) => {
    if (value <= 0 || maxValue <= 0) return 0;
    return Math.max(1, Math.min(4, Math.ceil((value / maxValue) * 4)));
  };
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const monthFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    timeZone: "UTC",
  });
  const days = Array.from({ length: dayCount }, (_, index) => addDays(gridStart, index));
  const monthLabels: Array<{ week: number; date: Date }> = [];
  let previousMonth = -1;
  for (const day of days) {
    if (day < rangeStart || day > rangeEnd) continue;
    if (day.getUTCMonth() === previousMonth) continue;
    // Label the column where each new month first appears.
    const week = Math.floor((day.getTime() - gridStart.getTime()) / 86_400_000 / 7);
    if (monthLabels.length && week - monthLabels[monthLabels.length - 1].week < 3) continue;
    previousMonth = day.getUTCMonth();
    monthLabels.push({ week, date: day });
  }
  const activeDays = positiveValues.length;
  const totalValue = points.reduce((sum, point) => sum + valueFor(point), 0);

  return (
    <section className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-neutral-200">{title}</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            {totalValue.toLocaleString()} {unit} across {activeDays} active{" "}
            {activeDays === 1 ? "day" : "days"}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-500" aria-label={`${title} intensity legend`}>
          <span>Less</span>
          {colors.map((color, index) => (
            <span
              key={color}
              className="h-3 w-3 rounded-[2px]"
              style={{ backgroundColor: color }}
              aria-label={`Level ${index}`}
            />
          ))}
          <span>More</span>
        </div>
      </div>
      <div className="pb-1">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMinYMin meet"
          role="img"
          aria-label={`${title} from ${dateFormatter.format(rangeStart)} to ${dateFormatter.format(rangeEnd)}`}
          className="block h-auto w-full"
        >
          {monthLabels.map(({ week, date: month }) => (
            <text
              key={`${month.getUTCFullYear()}-${month.getUTCMonth()}`}
              x={leftPadding + week * cellStep}
              y="14"
              fill="#a1a1aa"
              fontSize="11"
            >
              {monthFormatter.format(month)}
            </text>
          ))}
          {[
            { row: 1, label: "Mon" },
            { row: 3, label: "Wed" },
            { row: 5, label: "Fri" },
          ].map(({ row, label }) => (
            <text
              key={label}
              x={leftPadding - 8}
              y={topPadding + row * cellStep + 10}
              textAnchor="end"
              fill="#a1a1aa"
              fontSize="11"
            >
              {label}
            </text>
          ))}
          {days.map((day) => {
            const dayKey = day.toISOString().slice(0, 10);
            const inRange = day >= rangeStart && day <= rangeEnd;
            const point = pointByDay.get(dayKey);
            const value = valueFor(point);
            const week = Math.floor((day.getTime() - gridStart.getTime()) / 86_400_000 / 7);
            return (
              <rect
                key={dayKey}
                x={leftPadding + week * cellStep}
                y={topPadding + day.getUTCDay() * cellStep}
                width={cellSize}
                height={cellSize}
                rx="2"
                fill={inRange ? colors[levelFor(value)] : colors[0]}
                stroke="#27272a"
                strokeWidth="0.5"
                opacity={inRange ? 1 : 0.45}
              >
                {inRange && (
                  <title>
                    {dateFormatter.format(day)}: {value.toLocaleString()} {unit}
                  </title>
                )}
              </rect>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

/* ─────────────────────── analytics chat hook ─────────────────────── */

type InsightChatSession = {
  id: string;
  conversationId: string | null;
  title: string;
  messages: ChatMsg[];
  studentIds: string[];
  createdAt: number;
  updatedAt: number;
};

const INSIGHT_HISTORY_PREFIX = "ekalaiva.teacher-insights.v1";
const MAX_INSIGHT_SESSIONS = 20;
const MAX_INSIGHT_MESSAGES = 100;

function insightScopeKey(studentIds: string[]): string {
  return [...studentIds].sort().join(",");
}

function readInsightSessions(storageKey: string): InsightChatSession[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && Array.isArray(item.messages))
      .map((item) => ({
        id: item.id,
        conversationId: typeof item.conversationId === "string" ? item.conversationId : null,
        title: typeof item.title === "string" && item.title.trim() ? item.title : "Insights chat",
        messages: item.messages.slice(-MAX_INSIGHT_MESSAGES),
        studentIds: Array.isArray(item.studentIds)
          ? item.studentIds.filter((id: unknown): id is string => typeof id === "string")
          : [],
        createdAt: Number(item.createdAt) || Date.now(),
        updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_INSIGHT_SESSIONS);
  } catch {
    return [];
  }
}

function latestInsightSession(
  sessions: InsightChatSession[],
  scopeKey: string,
): InsightChatSession | undefined {
  return sessions
    .filter((session) => insightScopeKey(session.studentIds) === scopeKey)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

function useLoggingChat(agentId: string, studentIds: string[] = []) {
  const userId = useUserStore((state) => state.userId) || "anonymous";
  const storageKey = `${INSIGHT_HISTORY_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(agentId)}`;
  const scopeKey = insightScopeKey(studentIds);
  const initialSessionsRef = useRef<InsightChatSession[] | null>(null);
  if (initialSessionsRef.current === null) {
    initialSessionsRef.current = readInsightSessions(storageKey);
  }
  const initialSession = latestInsightSession(initialSessionsRef.current, scopeKey);
  const [sessions, setSessions] = useState<InsightChatSession[]>(initialSessionsRef.current);
  const [sessionsStorageKey, setSessionsStorageKey] = useState(storageKey);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSession?.id ?? null);
  const [messages, setMessages] = useState<ChatMsg[]>(initialSession?.messages ?? []);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const sessionsRef = useRef<InsightChatSession[]>(initialSessionsRef.current);
  const activeSessionIdRef = useRef<string | null>(initialSession?.id ?? null);
  const messagesRef = useRef<ChatMsg[]>(initialSession?.messages ?? []);
  const conversationIdRef = useRef<string | null>(initialSession?.conversationId ?? null);
  const abortRef = useRef<AbortController | null>(null);
  const studentIdsRef = useRef<string[]>(studentIds);
  studentIdsRef.current = studentIds;
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;
  const previousScopeKeyRef = useRef(scopeKey);

  const commitSessions = useCallback((update: (current: InsightChatSession[]) => InsightChatSession[]) => {
    const next = update(sessionsRef.current)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_INSIGHT_SESSIONS);
    sessionsRef.current = next;
    setSessions(next);
  }, []);

  const restoreSession = useCallback((session?: InsightChatSession) => {
    abortRef.current?.abort();
    abortRef.current = null;
    activeSessionIdRef.current = session?.id ?? null;
    conversationIdRef.current = session?.conversationId ?? null;
    messagesRef.current = session?.messages ?? [];
    setActiveSessionId(session?.id ?? null);
    setMessages(session?.messages ?? []);
    setIsStreaming(false);
    setIsWaitingForResponse(false);
  }, []);

  useEffect(() => {
    if (sessionsStorageKey === storageKey) return;
    const loaded = readInsightSessions(storageKey);
    sessionsRef.current = loaded;
    setSessions(loaded);
    setSessionsStorageKey(storageKey);
    previousScopeKeyRef.current = scopeKey;
    restoreSession(latestInsightSession(loaded, scopeKey));
  }, [scopeKey, sessionsStorageKey, storageKey, restoreSession]);

  useEffect(() => {
    if (previousScopeKeyRef.current === scopeKey) return;
    previousScopeKeyRef.current = scopeKey;
    restoreSession(latestInsightSession(sessionsRef.current, scopeKey));
  }, [scopeKey, restoreSession]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        sessionStorage.setItem(sessionsStorageKey, JSON.stringify(sessions));
      } catch {
        // History remains available in memory if browser storage is unavailable.
      }
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [sessions, sessionsStorageKey]);

  useEffect(
    () => () => {
      try {
        sessionStorage.setItem(sessionsStorageKey, JSON.stringify(sessionsRef.current));
      } catch {
        // History remains available in memory if browser storage is unavailable.
      }
    },
    [sessionsStorageKey],
  );

  const commitMessages = useCallback(
    (sessionId: string, nextMessages: ChatMsg[]) => {
      if (activeSessionIdRef.current !== sessionId) return;
      const cappedMessages = nextMessages.slice(-MAX_INSIGHT_MESSAGES);
      messagesRef.current = cappedMessages;
      setMessages(cappedMessages);
      commitSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                conversationId: conversationIdRef.current,
                messages: cappedMessages,
                updatedAt: Date.now(),
              }
            : session,
        ),
      );
    },
    [commitSessions],
  );

  const newChat = useCallback(() => restoreSession(), [restoreSession]);

  const selectSession = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((item) => item.id === sessionId);
      if (session && insightScopeKey(session.studentIds) === insightScopeKey(studentIdsRef.current)) {
        restoreSession(session);
      }
    },
    [restoreSession],
  );

  const deleteSession = useCallback(
    (sessionId: string) => {
      const deletingActiveSession = activeSessionIdRef.current === sessionId;
      commitSessions((current) => current.filter((session) => session.id !== sessionId));
      if (deletingActiveSession) restoreSession();
    },
    [commitSessions, restoreSession],
  );

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;
      const trimmedText = text.trim();
      let sessionId = activeSessionIdRef.current;
      if (!sessionId) {
        const now = Date.now();
        sessionId = crypto.randomUUID();
        const session: InsightChatSession = {
          id: sessionId,
          conversationId: null,
          title: trimmedText.length > 56 ? `${trimmedText.slice(0, 56)}…` : trimmedText,
          messages: [],
          studentIds: [...studentIdsRef.current].sort(),
          createdAt: now,
          updatedAt: now,
        };
        activeSessionIdRef.current = sessionId;
        setActiveSessionId(sessionId);
        commitSessions((current) => [session, ...current]);
      }
      const requestSessionId = sessionId;
      const nextMessages: ChatMsg[] = [
        ...messagesRef.current,
        { role: "user", content: text.trim(), createdAt: Date.now() },
        { role: "assistant", content: "", createdAt: Date.now() },
      ];
      commitMessages(requestSessionId, nextMessages);
      setIsStreaming(true);
      setIsWaitingForResponse(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const appendAssistant = (chunk: string) => {
        if (activeSessionIdRef.current !== requestSessionId) return;
        const next = [...messagesRef.current];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = { ...last, content: last.content + chunk };
          commitMessages(requestSessionId, next);
        }
      };

      try {
        const res = await fetch(
          `${DASHBOARD_API_URL}/api/teacher-dashboard/logging-agent/chat/stream`,
          {
            method: "POST",
            credentials: "include",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              text: trimmedText,
              conversation_id: conversationIdRef.current,
              agent_id: agentIdRef.current,
              student_ids: studentIdsRef.current,
            }),
            signal: controller.signal,
          },
        );
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.type === "thread_id") {
                conversationIdRef.current = evt.thread_id || evt.conversation_id;
                commitSessions((current) =>
                  current.map((session) =>
                    session.id === requestSessionId
                      ? { ...session, conversationId: conversationIdRef.current }
                      : session,
                  ),
                );
              }
              else if (evt.type === "delta" && evt.content) {
                setIsWaitingForResponse(false);
                appendAssistant(evt.content);
              }
              else if (evt.type === "message_block_delta" && evt.delta) {
                setIsWaitingForResponse(false);
                appendAssistant(evt.delta);
              }
              else if (evt.type === "message_block" && evt.content) {
                setIsWaitingForResponse(false);
                appendAssistant(evt.content);
              }
              else if (evt.type === "evidence_citations")
                {
                  const next = [...messagesRef.current];
                  const last = next[next.length - 1];
                  if (last?.role === "assistant") {
                    next[next.length - 1] = {
                      ...last,
                      evidenceCitations: evt.citations ?? [],
                      chatSignalsReviewed: Boolean(evt.chatSignalsReviewed),
                    };
                    commitMessages(requestSessionId, next);
                  }
                }
              else if (evt.type === "error") appendAssistant(`\n\n_Error: ${evt.error}_`);
            } catch {
              /* ignore malformed chunk */
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          appendAssistant(`\n\n_Error: ${(e as Error).message}_`);
        }
      } finally {
        if (activeSessionIdRef.current === requestSessionId) {
          setIsStreaming(false);
          setIsWaitingForResponse(false);
          abortRef.current = null;
        }
      }
    },
    [commitMessages, commitSessions, isStreaming],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setIsWaitingForResponse(false);
  }, []);

  const scopedSessions = useMemo(
    () => sessions.filter((session) => insightScopeKey(session.studentIds) === scopeKey),
    [scopeKey, sessions],
  );

  return {
    messages,
    isStreaming,
    isWaitingForResponse,
    send,
    stop,
    sessions: scopedSessions,
    activeSessionId,
    newChat,
    selectSession,
    deleteSession,
  };
}

/* ───────────────────────────── shell ─────────────────────────────── */

export function TeacherDashboard() {
  const [summary, setSummary] = useState<TeacherSummary | null>(null);
  const [agents, setAgents] = useState<DashboardAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [studentsInsightsOpen, setStudentsInsightsOpen] = useState(false);
  const navigate = useNavigate();
  const { section } = useParams<{ section?: string }>();
  const activeTab = TABS.find((t) => t.id === section) ?? null;
  const activeAgent = agents.find((agent) => (agent.agentId || agent.id) === selectedAgent);
  const activeCourseName = activeAgent
    ? activeAgent.courseName || getCourseName(activeAgent.name || activeAgent.agentId || activeAgent.id)
    : "";

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [agentsRes, summaryRes] = await Promise.all([
          listDashboardAgents(),
          getTeacherSummary().catch(() => null),
        ]);
        setAgents(agentsRes.agents);
        if (summaryRes) setSummary(summaryRes);
        if (agentsRes.agents.length > 0)
          setSelectedAgent(agentsRes.agents[0].agentId || agentsRes.agents[0].id);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (activeTab?.id !== "students") setStudentsInsightsOpen(false);
  }, [activeTab?.id]);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-neutral-950 text-neutral-200">
      <header className="shrink-0 border-b border-neutral-800/80 bg-neutral-900/95 px-4 sm:px-6">
        <div className="flex h-16 min-w-0 items-center gap-3">
          {activeTab && (
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              aria-label="Back to Dashboard"
              title="Back to Dashboard"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/50 text-neutral-400 transition hover:border-neutral-700 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-neutral-100">
              {activeTab ? activeTab.label : "Dashboard"}
            </h1>
            {activeTab && activeCourseName && (
              <p className="truncate text-xs text-neutral-500" title={activeCourseName}>
                {activeCourseName}
              </p>
            )}
          </div>
          {activeTab?.id === "students" && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => navigate("/dashboard/feedback")}
                className="inline-flex h-9 items-center rounded-lg border border-neutral-700 bg-neutral-950/50 px-3 text-xs font-medium text-neutral-200 transition hover:border-neutral-600 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600"
              >
                Feedback
              </button>
              <button
                type="button"
                onClick={() => setStudentsInsightsOpen(true)}
                aria-pressed={studentsInsightsOpen}
                className="inline-flex h-9 items-center rounded-lg border border-neutral-700 bg-neutral-950/50 px-3 text-xs font-medium text-neutral-200 transition hover:border-neutral-600 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600"
              >
                Insights
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <OverviewSkeleton />
        ) : error ? (
          <div className="p-6">
            <ErrorNote message={error} />
          </div>
        ) : agents.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <EmptyState
              icon={BookOpen}
              title="No courses yet"
              sub="Once you create or co-teach a teaching assistant, your students' progress and analytics will show up here."
            />
          </div>
        ) : activeTab ? (
          /* ── Section page ── */
          activeTab.id === "students" ? (
            <StudentsTab
              agentId={selectedAgent}
              insightsOpen={studentsInsightsOpen}
              setInsightsOpen={setStudentsInsightsOpen}
            />
          ) : activeTab.id === "usage" ? (
            <UsageTab agentId={selectedAgent} />
          ) : (
            <FeedbackTab />
          )
        ) : (
          <OverviewTab
            summary={summary}
            agentId={selectedAgent}
            agents={agents}
            onAgentChange={setSelectedAgent}
          />
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Overview ──────────────────────────── */

function OverviewTab({
  summary,
  agentId,
  agents,
  onAgentChange,
}: {
  summary: TeacherSummary | null;
  agentId: string;
  agents: DashboardAgent[];
  onAgentChange: (id: string) => void;
}) {
  const [overview, setOverview] = useState<AgentOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!agentId) return;
    let ignore = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const nextOverview = await getAgentOverview(agentId);
        if (!ignore) setOverview(nextOverview);
      } catch (e) {
        if (!ignore) setError((e as Error).message);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [agentId]);

  const buckets: { key: keyof AgentOverview["distribution"]; label: string; ref: number }[] = [
    { key: "75-100%", label: "75–100%", ref: 80 },
    { key: "50-75%", label: "50–75%", ref: 60 },
    { key: "25-50%", label: "25–50%", ref: 30 },
    { key: "0-25%", label: "0–25%", ref: 10 },
  ];

  const lastActive =
    overview?.students?.reduce(
      (max, s) => (s.last_updated && s.last_updated > max ? s.last_updated : max),
      "",
    ) ?? "";

  const courses = agents.map((agent) => {
    const id = agent.agentId || agent.id;
    const courseSummary = summary?.courses.find((course) => course.agentId === id);
    return {
      id,
      name: agent.courseName || courseSummary?.name || getCourseName(agent.name || id),
      level: agent.courseLevel,
      code: agent.courseCode,
      duration: agent.courseDuration,
      studentCount: courseSummary?.studentCount ?? 0,
      activeStudentCount: courseSummary?.activeStudentCount ?? 0,
      avgPctComplete: courseSummary?.avgPctComplete ?? 0,
      totalTokens: courseSummary?.totalTokens ?? 0,
      activeThreads: courseSummary?.activeThreads ?? 0,
    };
  });
  const selectedCourse = courses.find((course) => course.id === agentId) ?? courses[0];
  const selectedStudentCount =
    overview?.usage?.total_students ?? overview?.student_count ?? selectedCourse?.studentCount ?? 0;
  const selectedActiveStudents =
    overview?.usage?.active_students ?? selectedCourse?.activeStudentCount ?? 0;
  const selectedCompletion = overview?.avg_pct_complete ?? selectedCourse?.avgPctComplete ?? 0;

  return (
    <div className="p-4 sm:p-5">
      <section className="min-w-0" aria-live="polite">
          <div className="flex flex-col gap-3 border-b border-neutral-800/80 pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                {(selectedCourse?.level || selectedCourse?.code || selectedCourse?.duration) && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                    {selectedCourse.level && (
                      <span className="font-medium text-emerald-400">{selectedCourse.level}</span>
                    )}
                    {selectedCourse.code && (
                      <span
                        className="rounded border border-neutral-800 bg-neutral-900/70 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300"
                        title="Course code"
                        aria-label={`Course code ${selectedCourse.code}`}
                      >
                        {selectedCourse.code}
                      </span>
                    )}
                    {selectedCourse.duration && (
                      <span className="inline-flex items-center gap-1 text-neutral-500">
                        <CalendarDays className="h-3 w-3" aria-hidden />
                        {selectedCourse.duration}
                      </span>
                    )}
                  </div>
                )}
                <div className="relative mt-0.5 max-w-xl">
                  <select
                    value={agentId}
                    onChange={(event) => onAgentChange(event.target.value)}
                    aria-label="Select course"
                    className="w-full appearance-none bg-transparent pr-6 text-lg font-semibold text-neutral-100 outline-none focus:text-white"
                  >
                    {courses.map((course) => (
                      <option key={course.id} value={course.id} className="bg-neutral-900">
                        {course.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-600" />
                </div>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  {overview?.total_topics ?? 0} topics · {selectedActiveStudents} active
                  {lastActive ? ` · Last activity ${timeAgo(lastActive)}` : ""}
                </p>
              </div>
            </div>
            <nav aria-label={`${selectedCourse?.name || "Course"} details`} className="flex flex-wrap gap-2">
              {TABS.filter((tab) => tab.id === "students").map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => navigate(`/dashboard/${id}`)}
                  className="inline-flex w-28 flex-col items-center justify-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-3 text-xs font-medium text-neutral-200 transition hover:border-neutral-600 hover:bg-neutral-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600"
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </nav>
          </div>

          {loading ? (
            <Spinner label="Loading course details…" />
          ) : error ? (
            <div className="mt-4"><ErrorNote message={error} /></div>
          ) : !overview ? (
            <EmptyState icon={BookOpen} title="Select a course" />
          ) : (
            <div className="mt-4 space-y-3">
              {(overview.usage?.active_students ?? 0) === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2 text-xs text-neutral-400">
                  <Clock className="h-4 w-4 shrink-0 text-neutral-500" />
                  No student activity in this course yet. Usage will appear after students begin learning.
                </div>
              ) : (overview.student_count ?? 0) === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2 text-xs text-neutral-400">
                  <Clock className="h-4 w-4 shrink-0 text-neutral-500" />
                  Conversations have started, but curriculum progress has not been recorded yet.
                </div>
              ) : null}

              <div className="grid gap-3 lg:grid-cols-2">
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800">
                <div className="bg-neutral-900 px-3.5 py-3">
                  <dt className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                    <Users className="h-3.5 w-3.5" /> Students
                  </dt>
                  <div className="mt-1 flex items-baseline gap-2">
                    <dd className="text-xl font-semibold tabular-nums text-neutral-100">
                      {selectedStudentCount}
                    </dd>
                    <span className="text-[11px] text-neutral-500">{selectedActiveStudents} active</span>
                  </div>
                </div>
                <div className="bg-neutral-900 px-3.5 py-3">
                  <dt className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                    <TrendingUp className="h-3.5 w-3.5" /> Completion
                  </dt>
                  <div className="mt-1 flex items-center gap-3">
                    <dd className={cn("text-xl font-semibold tabular-nums", pctColor(selectedCompletion))}>
                      {selectedCompletion}%
                    </dd>
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-800">
                      <div
                        className={cn("h-full rounded-full bg-gradient-to-r", pctBar(selectedCompletion))}
                        style={{ width: `${Math.min(100, Math.max(0, selectedCompletion))}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="bg-neutral-900 px-3.5 py-3">
                  <dt className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                    <Coins className="h-3.5 w-3.5" /> Tokens used
                  </dt>
                  <div className="mt-1 flex items-baseline gap-2">
                    <dd className="text-xl font-semibold tabular-nums text-neutral-100">
                      {formatNumber(selectedCourse?.totalTokens ?? 0)}
                    </dd>
                    <span className="truncate text-[11px] text-neutral-500">all conversations</span>
                  </div>
                </div>
                <div className="bg-neutral-900 px-3.5 py-3">
                  <dt className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                    <MessageSquare className="h-3.5 w-3.5" /> Active threads
                  </dt>
                  <div className="mt-1 flex items-baseline gap-2">
                    <dd className="text-xl font-semibold tabular-nums text-neutral-100">
                      {overview.usage?.active_threads ?? selectedCourse?.activeThreads ?? 0}
                    </dd>
                    <span className="text-[11px] text-neutral-500">
                      {overview.usage?.total_threads ?? 0} total
                    </span>
                  </div>
                </div>
              </dl>

              <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3.5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-medium text-neutral-200">Completion distribution</h3>
                    <span className="hidden text-[11px] text-neutral-500 sm:inline">
                      Started students
                    </span>
                  </div>
                  <span className="text-[11px] tabular-nums text-neutral-500">
                    {overview.student_count} of {overview.students?.length ?? overview.student_count}
                  </span>
                </div>
                {(() => {
                  // Scale to the tallest bucket, otherwise a small cohort renders as slivers.
                  const counts = buckets.map((b) => overview.distribution?.[b.key] ?? 0);
                  const peak = Math.max(...counts, 1);
                  const ticks = peak >= 2 ? [peak, Math.round(peak / 2), 0] : [peak, 0];
                  const ordered = [...buckets].reverse();
                  return (
                    <div className="flex gap-2">
                      <div className="flex h-28 w-5 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-neutral-600">
                        {ticks.map((t) => <span key={t}>{t}</span>)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex h-28 items-end gap-3 border-b border-l border-neutral-800 pl-1">
                          {ordered.map(({ key, ref }) => {
                            const count = overview.distribution?.[key] ?? 0;
                            return (
                              <div key={key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                                <span className="text-xs font-medium tabular-nums text-neutral-300">{count}</span>
                                <div
                                  className={cn(
                                    "w-full rounded-t",
                                    // A gradient with no colour stops paints transparent, hiding empty buckets.
                                    count === 0 ? "bg-neutral-700" : cn("bg-gradient-to-t", pctBar(ref)),
                                  )}
                                  style={{ height: count === 0 ? "3px" : `${Math.max(4, Math.round((count / peak) * 100))}%` }}
                                />
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-1.5 flex gap-3 pl-1">
                          {ordered.map(({ key, label }) => (
                            <span key={key} className="min-w-0 flex-1 text-center text-[11px] tabular-nums text-neutral-500">
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
              </div>

              <section className="border-t border-neutral-800/80 pt-4" aria-labelledby="overview-usage-title">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 id="overview-usage-title" className="text-sm font-medium text-neutral-200">
                      Learning activity
                    </h3>
                    <p className="mt-0.5 text-[11px] text-neutral-500">
                      Tokens, threshold crossings, and student-created assets
                    </p>
                  </div>
                </div>
                <UsageTab agentId={agentId} embedded />
              </section>
            </div>
          )}
      </section>
    </div>
  );
}

/* ───────────────────────────── Students ──────────────────────────── */

function StudentsTab({
  agentId,
  insightsOpen,
  setInsightsOpen,
}: {
  agentId: string;
  insightsOpen: boolean;
  setInsightsOpen: (open: boolean) => void;
}) {
  const [overview, setOverview] = useState<AgentOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [expandedConcepts, setExpandedConcepts] = useState<Set<string>>(new Set());
  const [progressView, setProgressView] = useState<"concepts" | "topics" | "explored" | "assets">(
    "concepts",
  );
  const [assets, setAssets] = useState<StudentAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [curriculum, setCurriculum] = useState<CourseCurriculum | null>(null);
  const [courseView, setCourseView] = useState<"concepts" | "topics">("concepts");
  const [openAssetId, setOpenAssetId] = useState<string>("");
  const [insightsHistoryOpen, setInsightsHistoryOpen] = useState(false);
  const [insightStudentIds, setInsightStudentIds] = useState<string[]>([]);

  const toggleConcept = (concept: string) =>
    setExpandedConcepts((prev) => {
      const next = new Set(prev);
      next.has(concept) ? next.delete(concept) : next.add(concept);
      return next;
    });

  const toggleTopic = (topic: string) =>
    setExpandedTopics((prev) => {
      const next = new Set(prev);
      next.has(topic) ? next.delete(topic) : next.add(topic);
      return next;
    });

  useEffect(() => {
    if (!agentId) return;
    (async () => {
      setLoading(true);
      setError("");
      setSelected("");
      setDetail(null);
      setInsightsOpen(false);
      setInsightsHistoryOpen(false);
      setInsightStudentIds([]);
      try {
        setOverview(await getAgentOverview(agentId));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    setCurriculum(null);
    getCourseCurriculum(agentId)
      .then((c) => !cancelled && setCurriculum(c))
      .catch(() => !cancelled && setCurriculum(null));
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    if (!insightsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (insightsHistoryOpen) setInsightsHistoryOpen(false);
      else setInsightsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [insightsHistoryOpen, insightsOpen]);

  const openStudent = async (userId: string) => {
    setSelected(userId);
    setDetailLoading(true);
    setDetail(null);
    setDetailError("");
    setExpandedTopics(new Set());
    setExpandedConcepts(new Set());
    setAssets([]);
    setOpenAssetId("");
    setAssetsLoading(true);
    getStudentAssets(agentId, userId)
      .then((r) => setAssets(r.assets))
      .catch(() => setAssets([]))
      .finally(() => setAssetsLoading(false));
    try {
      setDetail(await getStudentDetail(agentId, userId));
    } catch (e) {
      const msg = (e as Error).message;
      // A student with no tracked progress yet returns 404 — not an error.
      setDetailError(/\b404\b|no learning state/i.test(msg) ? "" : msg);
    } finally {
      setDetailLoading(false);
    }
  };

  /** Open the student behind a citation on the view that holds that evidence. */
  const openCitedEvidence = (citation: EvidenceCitation) => {
    const userId =
      citation.user_id ||
      (overview?.students ?? []).find((s) => s.display_name === citation.student)?.user_id ||
      "";
    if (!userId) return;
    setProgressView(
      citation.kind === "threshold_concept"
        ? "concepts"
        : citation.kind === "topic_progress"
          ? "topics"
          : "assets",
    );
    setInsightsOpen(false);
    void openStudent(userId);
  };

  if (loading) return <Spinner />;
  if (error)
    return (
      <div className="p-6">
        <ErrorNote message={error} />
      </div>
    );

  const courseConcepts =
    overview?.students?.find((s) => s.concepts_total)?.concepts_total ?? 0;
  const selectedSummary = overview?.students?.find((student) => student.user_id === selected);
  const detailModules = detail?.syllabus ?? [];
  const syllabusTotal = detailModules.reduce((count, module) => count + module.topics.length, 0);
  const syllabusLearned = detailModules.reduce((count, module) => count + module.learned, 0);
  const topicsLearned = syllabusTotal
    ? syllabusLearned
    : detail?.learned ?? selectedSummary?.learned ?? 0;
  const topicsTotal = syllabusTotal || detail?.total_topics || selectedSummary?.total_topics || 0;
  const conceptsLearned = detail?.concepts_learned ?? selectedSummary?.concepts_learned ?? 0;
  const conceptsTotal = detail?.total_concepts ?? selectedSummary?.concepts_total ?? courseConcepts;
  const conceptCompletion = detail?.concepts_pct_complete ?? selectedSummary?.concepts_pct_complete ?? 0;
  const exploredCount = detail?.off_plan_topics?.length ?? selectedSummary?.explored ?? 0;

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* List */}
      <div className="w-[32%] max-w-[26rem] border-r border-neutral-800 flex flex-col overflow-hidden">
        <div className="roster-header shrink-0 border-b border-neutral-800/80 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <h3 className="truncate text-sm font-medium text-neutral-200">Course roster</h3>
              <span className="roster-header-enrollment shrink-0 text-[11px] tabular-nums text-neutral-500">
                {overview?.students?.length ?? 0} enrolled
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <div
                className="roster-header-totals flex items-center gap-1.5"
                title="Course totals"
                aria-label="Course totals"
              >
                {(
                  [
                    [STAT_ICONS.concepts, courseConcepts],
                    [STAT_ICONS.topics, overview?.total_topics ?? 0],
                  ] as const
                ).map(([stat, value]) => {
                  const Icon = stat.icon;
                  return (
                    <span
                      key={stat.short}
                      title={`${value} ${stat.label}`}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900/70 px-2 text-[11px] tabular-nums text-neutral-300"
                    >
                      <Icon
                        className={cn("h-3 w-3 shrink-0", stat.class)}
                        fill="currentColor"
                        fillOpacity={0.3}
                        aria-hidden
                      />
                      {value}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <StatLegend />
            </div>
            <p className="roster-header-hint shrink-0 text-[10px] text-neutral-600">
              Click student for progress
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pt-3 pb-4">
        {overview && (overview.students?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Users}
            title="No students yet"
            sub="Students appear here once they join the course with its code."
          />
        ) : (
        <div className="grid grid-cols-2 gap-2">
        {overview?.students?.map((s) => {
          const conceptPct = s.concepts_pct_complete ?? 0;
          const isOpen = selected === s.user_id;
          const started = (s.total_topics ?? 0) > 0;
          return (
            <button
              key={s.user_id}
              onClick={() => openStudent(s.user_id)}
              aria-pressed={isOpen}
              className={cn(
                "rounded-xl border p-3.5 text-center transition cursor-pointer",
                isOpen
                  ? "border-neutral-600 bg-neutral-900"
                  : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-700 hover:bg-neutral-900/70",
              )}
            >
              <Avatar name={s.display_name || s.user_id} className="w-9 h-9 mx-auto" />

              <p className="mt-3 truncate text-sm text-neutral-200">
                {s.display_name || s.user_id}
              </p>

              <div className="mt-2 h-1 rounded-full bg-neutral-800 overflow-hidden">
                <div
                  className={cn("h-full rounded-full bg-gradient-to-r", pctBar(conceptPct))}
                  style={{ width: `${conceptPct}%` }}
                />
              </div>

              <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-neutral-400">
                <TileStat
                  icon={STAT_ICONS.concepts.icon}
                  iconClass={STAT_ICONS.concepts.class}
                  label={STAT_ICONS.concepts.label}
                  value={started ? `${s.concepts_learned ?? 0}` : "—"}
                />
                <TileStat
                  icon={STAT_ICONS.topics.icon}
                  iconClass={STAT_ICONS.topics.class}
                  label={STAT_ICONS.topics.label}
                  value={started ? `${s.learned}` : "—"}
                />
                <TileStat
                  icon={STAT_ICONS.explored.icon}
                  iconClass={STAT_ICONS.explored.class}
                  label={STAT_ICONS.explored.label}
                  value={`${s.explored ?? 0}`}
                />
                <TileStat
                  icon={STAT_ICONS.assets.icon}
                  iconClass={STAT_ICONS.assets.class}
                  label={STAT_ICONS.assets.label}
                  value={`${s.assets ?? 0}`}
                />
              </div>
            </button>
          );
        })}
        </div>
        )}
        </div>
      </div>

      {/* Progress workspace */}
      <div className="relative flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="shrink-0 border-b border-neutral-800 bg-neutral-950/95 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            {selectedSummary ? (
              <div className="flex min-w-0 items-center gap-3">
                <ProgressRing pct={conceptCompletion} size={48} />
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-neutral-100">
                    {selectedSummary.display_name || selectedSummary.user_id}
                  </h3>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    <span className={pctColor(conceptCompletion)}>
                      {conceptsLearned}/{conceptsTotal}
                    </span>{" "}
                    threshold concepts crossed · {topicsLearned}/{topicsTotal} topics learned
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <h3 className="text-sm font-medium text-neutral-200">
                  {curriculum ? "Course plan" : "Student progress"}
                </h3>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {curriculum
                    ? "Pick a student from the roster to see this plan against their progress."
                    : "Select a student from the roster to inspect their learning progress."}
                </p>
              </div>
            )}
          </div>

          {selected ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {(
                [
                  ["concepts", "Threshold concepts", `${conceptsLearned}/${conceptsTotal}`],
                  ["topics", "Topics", `${topicsLearned}/${topicsTotal}`],
                  ["explored", "Explored", `${exploredCount}`],
                  ["assets", "Assets", `${assets.length}`],
                ] as const
              ).map(([key, label, count]) => {
                const active = progressView === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setProgressView(key)}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition",
                      active
                        ? "border-white/25 bg-white/[0.1] text-white"
                        : "border-neutral-800 bg-neutral-900/50 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200",
                    )}
                  >
                    {label}
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-[11px] tabular-nums",
                        active ? "bg-white/15 text-neutral-200" : "bg-neutral-800 text-neutral-500",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : curriculum ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {(
                [
                  ["concepts", "Threshold concepts", `${curriculum.total_concepts}`],
                  ["topics", "Topics", `${curriculum.total_topics}`],
                ] as const
              ).map(([key, label, count]) => {
                const active = courseView === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCourseView(key)}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition cursor-pointer",
                      active
                        ? "border-white/25 bg-white/[0.1] text-white"
                        : "border-neutral-800 bg-neutral-900/50 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200",
                    )}
                  >
                    {label}
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-[11px] tabular-nums",
                        active ? "bg-white/15 text-neutral-200" : "bg-neutral-800 text-neutral-500",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
        {!selected ? (
          curriculum ? (
            <CourseOutline
              curriculum={curriculum}
              view={courseView}
              expandedConcepts={expandedConcepts}
              onToggleConcept={toggleConcept}
              expandedTopics={expandedTopics}
              onToggleTopic={toggleTopic}
            />
          ) : (
            <EmptyState
              icon={Users}
              title="Select a student"
              sub="Pick a student on the left to see their topic-by-topic progress."
            />
          )
        ) : detailLoading ? (
          <Spinner />
        ) : detailError ? (
          <ErrorNote message={detailError} />
        ) : detail ? (
          <div className="space-y-6">
            {/* ── Threshold concept progress ── */}
            {progressView === "concepts" && (
            <div>
              {(detail.total_concepts ?? 0) === 0 ? (
                <p className="text-sm text-neutral-600">
                  No threshold concepts defined for this course yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {(
                    [
                      ["in_progress", "In progress"],
                      ["learned", "Crossed"],
                      ["not_started", "Not started"],
                    ] as const
                  ).flatMap(([key]) =>
                    (detail.concepts_by_status?.[key] ?? []).map((c) => {
                      const isOpen = expandedConcepts.has(c.concept);
                      return (
                        <div
                          key={c.concept}
                          className="rounded-xl border border-neutral-800 bg-neutral-900/50"
                        >
                          <button
                            type="button"
                            onClick={() => toggleConcept(c.concept)}
                            aria-expanded={isOpen}
                            className="w-full flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-left transition cursor-pointer hover:bg-neutral-800/40"
                          >
                            {statusIcon(c.status)}
                            <p className="text-sm min-w-0 flex-1">{c.concept}</p>
                            <ChevronDown
                              className={cn(
                                "w-4 h-4 shrink-0 mt-0.5 text-neutral-500 transition-transform",
                                isOpen && "rotate-180",
                              )}
                            />
                          </button>

                          {isOpen && (
                            <div className="px-3.5 pb-3.5 pl-11 space-y-3">
                              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                <span
                                  className={cn(
                                    "rounded-full px-2 py-0.5 border",
                                    c.status === "learned"
                                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                      : c.status === "in_progress"
                                        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                                        : "border-neutral-700 bg-neutral-800/60 text-neutral-400",
                                  )}
                                >
                                  {c.status === "learned"
                                    ? "Crossed"
                                    : c.status === "in_progress"
                                      ? "In progress"
                                      : "Not started"}
                                </span>
                                {c.last_updated && (
                                  <span className="text-neutral-500">
                                    updated {timeAgo(c.last_updated)}
                                  </span>
                                )}
                              </div>

                              {c.description && (
                                <div>
                                  <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">
                                    What it is
                                  </p>
                                  <p className="text-xs text-neutral-400">{c.description}</p>
                                </div>
                              )}

                              {c.why_threshold && (
                                <div>
                                  <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">
                                    Why it's a threshold
                                  </p>
                                  <p className="text-xs text-neutral-400">{c.why_threshold}</p>
                                </div>
                              )}

                              {(c.misconceptions?.length ?? 0) > 0 && (
                                <div>
                                  <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5">
                                    Common misconceptions ({c.misconceptions!.length})
                                  </p>
                                  <div className="space-y-1.5">
                                    {c.misconceptions!.map((m, i) => (
                                      <div
                                        key={i}
                                        className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2"
                                      >
                                        <p className="text-xs text-rose-300/90">{m.misconception}</p>
                                        {m.why_wrong && (
                                          <p className="text-[11px] text-neutral-500 mt-1">
                                            {m.why_wrong}
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {(c.related_chapters?.length ?? 0) > 0 && (
                                <div>
                                  <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5">
                                    Related modules
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {c.related_chapters!.map((ch) => (
                                      <span
                                        key={ch}
                                        className="rounded-full border border-neutral-700 bg-neutral-800/60 px-2 py-0.5 text-[11px] text-neutral-400"
                                      >
                                        {ch}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }),
                  )}
                </div>
              )}
            </div>
            )}

            {/* ── Topic progress, laid out as the live syllabus ── */}
            {progressView === "topics" && (
            <div className="space-y-3">
              {(detail.syllabus ?? []).map((mod, i) => {
                const isOpen = expandedTopics.has(mod.module_id);
                return (
                  <div
                    key={mod.module_id || mod.title}
                    className="rounded-xl border border-neutral-800 bg-neutral-900/50"
                  >
                    <button
                      type="button"
                      onClick={() => toggleTopic(mod.module_id)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition cursor-pointer hover:bg-neutral-800/40"
                    >
                      <span className="text-[11px] tabular-nums text-neutral-600 w-5 shrink-0">
                        {i + 1}.
                      </span>
                      <p className="text-sm font-medium min-w-0 flex-1">{mod.title}</p>
                      <span
                        className={cn(
                          "text-xs tabular-nums shrink-0",
                          pctColor(mod.topics.length ? (mod.learned / mod.topics.length) * 100 : 0),
                        )}
                      >
                        {mod.learned}/{mod.topics.length}
                      </span>
                      <ChevronDown
                        className={cn(
                          "w-4 h-4 shrink-0 text-neutral-500 transition-transform",
                          isOpen && "rotate-180",
                        )}
                      />
                    </button>

                    {isOpen && (
                      <div className="px-3.5 pb-3.5 pl-11 space-y-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5">
                            Topics
                          </p>
                          <div className="space-y-1">
                            {mod.topics.map((t) => (
                              <div key={t.topic}>
                                <div className="flex items-start gap-2">
                                  {statusIcon(t.status)}
                                  <p
                                    className={cn(
                                      "text-xs",
                                      t.status === "not_started"
                                        ? "text-neutral-500"
                                        : "text-neutral-200",
                                    )}
                                  >
                                    {t.topic}
                                  </p>
                                </div>
                                {t.latest_summary && (
                                  <p className="text-[11px] text-neutral-600 pl-5.5 ml-[22px]">
                                    {t.latest_summary}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {mod.learning_objectives.length > 0 && (
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5">
                              Learning objectives
                            </p>
                            <ul className="space-y-1">
                              {mod.learning_objectives.map((o) => (
                                <li key={o} className="text-xs text-neutral-400 flex gap-2">
                                  <span className="text-neutral-600">•</span>
                                  {o}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {mod.concepts.length > 0 && (
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5">
                              Threshold concepts
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {mod.concepts.map((c) => (
                                <span
                                  key={c.concept}
                                  className={cn(
                                    "rounded-full border px-2.5 py-1 text-[11px]",
                                    c.status === "learned"
                                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                      : c.status === "in_progress"
                                        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                                        : "border-neutral-700 bg-neutral-800/60 text-neutral-400",
                                  )}
                                >
                                  {c.concept}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            )}

            {/* ── Topics explored outside the syllabus ── */}
            {progressView === "explored" && (
            <div>
              {(detail.off_plan_topics?.length ?? 0) === 0 ? (
                <p className="text-sm text-neutral-600">
                  Nothing explored outside the syllabus yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {detail.off_plan_topics!.map((t) => {
                    const hasSummary = Boolean(t.latest_summary);
                    const isOpen = expandedTopics.has(t.topic);
                    return (
                      <div
                        key={t.topic}
                        className="rounded-xl border border-neutral-800 bg-neutral-900/50"
                      >
                        <button
                          type="button"
                          onClick={() => hasSummary && toggleTopic(t.topic)}
                          aria-expanded={hasSummary ? isOpen : undefined}
                          className={cn(
                            "w-full flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-left transition",
                            hasSummary ? "cursor-pointer hover:bg-neutral-800/40" : "cursor-default",
                          )}
                        >
                          {statusIcon(t.status)}
                          <p className="text-sm min-w-0 flex-1">{t.topic}</p>
                          {hasSummary && (
                            <ChevronDown
                              className={cn(
                                "w-4 h-4 shrink-0 mt-0.5 text-neutral-500 transition-transform",
                                isOpen && "rotate-180",
                              )}
                            />
                          )}
                        </button>
                        {hasSummary && isOpen && (
                          <p className="px-3.5 pb-2.5 pl-11 text-[11px] text-neutral-500">
                            {t.latest_summary}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            )}

            {progressView === "assets" && (
            <div>
              {assetsLoading ? (
                <Spinner label="Loading assets…" />
              ) : assets.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  This student hasn't created any assets in this course yet.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {assets.map((a) => (
                    <AssetCard
                      key={a.id}
                      asset={toAssetCardModel(a)}
                      showActions={false}
                      onView={() => setOpenAssetId(a.id)}
                    />
                  ))}
                </div>
              )}
            </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="No tracked progress yet"
            sub="This student has joined the course but hasn't covered any syllabus topics with the tutor yet."
          />
        )}
      </div>

      {insightsOpen && (
        <aside
          aria-label="Insights agent"
          className="absolute inset-0 z-20 flex flex-col bg-neutral-950"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-950/95 px-5 py-4">
            <h2 className="text-sm font-semibold text-neutral-100">Insights</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setInsightsHistoryOpen((open) => !open)}
                aria-label="Chat history"
                aria-pressed={insightsHistoryOpen}
                title="Chat history"
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600",
                  insightsHistoryOpen
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100",
                )}
              >
                <History className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setInsightsHistoryOpen(false);
                  setInsightsOpen(false);
                }}
                aria-label="Close insights"
                title="Close insights"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition cursor-pointer hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <StudentInsightsChat
              agentId={agentId}
              students={overview?.students ?? []}
              selectedStudentIds={insightStudentIds}
              onSelectedStudentIdsChange={setInsightStudentIds}
              historyOpen={insightsHistoryOpen}
              onHistoryOpenChange={setInsightsHistoryOpen}
              onEvidenceNavigate={openCitedEvidence}
            />
          </div>
        </aside>
      )}
      </div>

      {openAssetId && (
        <AssetPreview
          agentId={agentId}
          userId={selected}
          assetId={openAssetId}
          onClose={() => setOpenAssetId("")}
        />
      )}
    </div>
  );
}

/** The course plan on its own, shown before any student is picked. */
function CourseOutline({
  curriculum,
  view,
  expandedConcepts,
  onToggleConcept,
  expandedTopics,
  onToggleTopic,
}: {
  curriculum: CourseCurriculum;
  view: "concepts" | "topics";
  expandedConcepts: Set<string>;
  onToggleConcept: (concept: string) => void;
  expandedTopics: Set<string>;
  onToggleTopic: (moduleId: string) => void;
}) {
  const thresholdConcepts = curriculum.threshold_concepts ?? [];
  const syllabus = curriculum.syllabus ?? [];

  if (view === "concepts") {
    if (thresholdConcepts.length === 0) {
      return <p className="text-sm text-neutral-600">This course has no threshold concepts yet.</p>;
    }
    return (
      <div className="space-y-1.5">
        {thresholdConcepts.map((c) => {
          const isOpen = expandedConcepts.has(c.concept);
          const misconceptions = c.misconceptions ?? [];
          const relatedChapters = c.related_chapters ?? [];
          const hasDetail = Boolean(
            c.description || c.why_threshold || misconceptions.length || relatedChapters.length,
          );
          return (
            <div key={c.concept} className="rounded-xl border border-neutral-800 bg-neutral-900/50">
              <button
                type="button"
                onClick={() => hasDetail && onToggleConcept(c.concept)}
                aria-expanded={hasDetail ? isOpen : undefined}
                className={cn(
                  "w-full flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-left transition",
                  hasDetail ? "cursor-pointer hover:bg-neutral-800/40" : "cursor-default",
                )}
              >
                <Diamond
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400"
                  fill="currentColor"
                  fillOpacity={0.3}
                />
                <p className="min-w-0 flex-1 text-sm">{c.concept}</p>
                {hasDetail && (
                  <ChevronDown
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0 text-neutral-500 transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                )}
              </button>
              {hasDetail && isOpen && (
                <div className="space-y-2 px-3.5 pb-3.5 pl-10 text-xs text-neutral-400">
                  {c.description && <p>{c.description}</p>}
                  {c.why_threshold && (
                    <p>
                      <span className="text-neutral-500">Why it is a threshold: </span>
                      {c.why_threshold}
                    </p>
                  )}
                  {misconceptions.length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] uppercase tracking-wider text-neutral-500">
                        Common misconceptions
                      </p>
                      <ul className="list-disc space-y-0.5 pl-4">
                        {misconceptions.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {relatedChapters.length > 0 && (
                    <p className="text-neutral-500">
                      Related chapters: {relatedChapters.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (syllabus.length === 0) {
    return <p className="text-sm text-neutral-600">This course has no syllabus yet.</p>;
  }
  return (
    <div className="space-y-3">
      {syllabus.map((mod, i) => {
        const isOpen = expandedTopics.has(mod.module_id);
        const topics = mod.topics ?? [];
        const concepts = mod.concepts ?? [];
        const learningObjectives = mod.learning_objectives ?? [];
        const prerequisites = mod.prerequisites ?? [];
        return (
          <div
            key={mod.module_id || mod.title}
            className="rounded-xl border border-neutral-800 bg-neutral-900/50"
          >
            <button
              type="button"
              onClick={() => onToggleTopic(mod.module_id)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition cursor-pointer hover:bg-neutral-800/40"
            >
              <span className="w-5 shrink-0 text-[11px] tabular-nums text-neutral-600">{i + 1}.</span>
              <p className="min-w-0 flex-1 text-sm font-medium">{mod.title}</p>
              <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                {topics.length}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-neutral-500 transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </button>
            {isOpen && (
              <div className="space-y-3 px-3.5 pb-3.5 pl-11">
                <div>
                  <p className="mb-1.5 text-[11px] uppercase tracking-wider text-neutral-500">
                    Topics
                  </p>
                  <ul className="space-y-1">
                    {topics.map((t) => (
                      <li key={t} className="flex items-start gap-2 text-xs text-neutral-300">
                        <Layers
                          className="mt-0.5 h-3 w-3 shrink-0 text-sky-400"
                          fill="currentColor"
                          fillOpacity={0.3}
                        />
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {concepts.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] uppercase tracking-wider text-neutral-500">
                      Threshold concepts
                    </p>
                    <ul className="space-y-1">
                      {concepts.map((c) => (
                        <li key={c} className="flex items-start gap-2 text-xs text-neutral-300">
                          <Diamond
                            className="mt-0.5 h-3 w-3 shrink-0 text-violet-400"
                            fill="currentColor"
                            fillOpacity={0.3}
                          />
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {learningObjectives.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] uppercase tracking-wider text-neutral-500">
                      Learning objectives
                    </p>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-neutral-400">
                      {learningObjectives.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {prerequisites.length > 0 && (
                  <p className="text-xs text-neutral-500">
                    Prerequisites: {prerequisites.join(", ")}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Read-only preview of a student-created asset. */
function AssetPreview({
  agentId,
  userId,
  assetId,
  onClose,
}: {
  agentId: string;
  userId: string;
  assetId: string;
  onClose: () => void;
}) {
  const [asset, setAsset] = useState<StudentAssetDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setAsset(null);
    setError("");
    getStudentAsset(agentId, userId, assetId)
      .then((a) => !cancelled && setAsset(a))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [agentId, userId, assetId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={asset?.title || "Asset"}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-6 py-4">
          <h2 className="truncate text-base font-semibold text-neutral-100">
            {asset?.title || "Asset"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {error ? (
            <ErrorNote message={error} />
          ) : !asset ? (
            <Spinner />
          ) : (
            <AssetBody asset={asset} />
          )}
        </div>
      </div>
    </div>
  );
}

function AssetBody({ asset }: { asset: StudentAssetDetail }) {
  if (asset.type === "json") {
    let pretty = asset.content;
    try {
      const parsed = JSON.parse(asset.content) as {
        recordType?: string;
        quiz?: {
          quizId?: string;
          title?: string;
          assessmentType?: "concept_inventory" | "practice_quiz";
          thresholdConcept?: string;
          questions?: QuizQuestion[];
        };
        firstAttempt?: {
          submittedAt?: string;
          score?: number;
          totalQuestions?: number;
          percentage?: number;
          answers?: Array<{
            question?: string;
            selected?: number[];
            selectedOptions?: string[];
            correct?: number[];
            correctOptions?: string[];
            reason?: string;
            isCorrect?: boolean;
          }>;
        };
        agentFeedback?: { content?: string; createdAt?: string };
        submittedAt?: string;
        score?: number;
        totalQuestions?: number;
        percentage?: number;
        answers?: Array<{
          question?: string;
          selected?: number[];
          selectedOptions?: string[];
          correct?: number[];
          correctOptions?: string[];
          reason?: string;
          isCorrect?: boolean;
        }>;
        quizId?: string;
        assessmentType?: "concept_inventory" | "practice_quiz";
        thresholdConcept?: string;
        flashcardId?: string;
        challengeId?: string;
        title?: string;
        questions?: QuizQuestion[];
        cards?: FlashCard[];
        description?: string;
        difficulty?: string;
        hints?: string[];
        solution?: string;
        challengeType?: string;
      };
      const firstAttempt = parsed.firstAttempt
        ?? (parsed.recordType === "concept_inventory_first_attempt" ? parsed : undefined);
      if (firstAttempt) {
        return (
          <ConceptInventoryRecord
            quiz={parsed.quiz}
            attempt={firstAttempt}
            agentFeedback={parsed.agentFeedback}
          />
        );
      }
      // Render generated artifacts with the same blocks students see.
      const quiz = parsed.quiz ?? parsed;
      if (Array.isArray(quiz.questions)) {
        return (
          <div className="space-y-4">
            <ConceptInventoryDiagnosticMapping quiz={quiz} />
            <QuizBlock
              quizId={quiz.quizId || asset.id}
              title={quiz.title || asset.title}
              questions={quiz.questions}
              assessmentType={quiz.assessmentType}
              thresholdConcept={quiz.thresholdConcept}
              readOnly
            />
          </div>
        );
      }
      if (Array.isArray(parsed.cards)) {
        return (
          <FlashcardBlock
            flashcardId={parsed.flashcardId || asset.id}
            title={parsed.title || asset.title}
            cards={parsed.cards}
          />
        );
      }
      if (typeof parsed.solution === "string") {
        return (
          <ChallengeBlock
            challengeId={parsed.challengeId || asset.id}
            title={parsed.title || asset.title}
            description={parsed.description || ""}
            difficulty={parsed.difficulty || "medium"}
            hints={parsed.hints}
            solution={parsed.solution}
            challengeType={parsed.challengeType}
          />
        );
      }
      pretty = JSON.stringify(parsed, null, 2);
    } catch {
      // Not valid JSON — show it as stored.
    }
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-950 p-4 text-xs text-neutral-300">
        {pretty}
      </pre>
    );
  }
  // Markdown renders through rehype-sanitize, so student-authored HTML is safe here.
  return <Markdown>{asset.content}</Markdown>;
}

function ConceptInventoryDiagnosticMapping({
  quiz,
}: {
  quiz?: {
    assessmentType?: "concept_inventory" | "practice_quiz";
    thresholdConcept?: string;
    questions?: QuizQuestion[];
  };
}) {
  const questionMappings = (quiz?.questions ?? []).flatMap((question, index) =>
    question.targetsMisconception
      ? [{ questionNumber: index + 1, misconception: question.targetsMisconception }]
      : [],
  );
  const hasMapping = Boolean(
    quiz?.thresholdConcept
    || questionMappings.length,
  );
  if (!hasMapping) return null;

  return (
    <section className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
        Diagnostic mapping
      </p>
      {quiz?.thresholdConcept && (
        <div className="mt-2">
          <p className="text-xs text-neutral-500">Associated threshold concept</p>
          <p className="mt-1 text-sm leading-relaxed text-neutral-200">
            {quiz.thresholdConcept}
          </p>
        </div>
      )}
      {questionMappings.length > 0 && (
        <div className="mt-3 border-t border-amber-500/15 pt-3">
          <p className="text-xs text-neutral-500">Question mappings</p>
          <div className="mt-2 space-y-2">
            {questionMappings.map((mapping) => (
              <div
                key={`${mapping.questionNumber}-${mapping.misconception}`}
                className="flex items-start gap-2 text-xs leading-relaxed"
              >
                <span className="shrink-0 font-semibold text-rose-300">
                  Q{mapping.questionNumber}
                </span>
                <span className="text-neutral-300">{mapping.misconception}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ConceptInventoryRecord({
  quiz,
  attempt,
  agentFeedback,
}: {
  quiz?: {
    quizId?: string;
    title?: string;
    assessmentType?: "concept_inventory" | "practice_quiz";
    thresholdConcept?: string;
    questions?: QuizQuestion[];
  };
  attempt: {
    submittedAt?: string;
    score?: number;
    totalQuestions?: number;
    percentage?: number;
    answers?: Array<{
      question?: string;
      selected?: number[];
      selectedOptions?: string[];
      correct?: number[];
      correctOptions?: string[];
      reason?: string;
      isCorrect?: boolean;
    }>;
  };
  agentFeedback?: { content?: string; createdAt?: string };
}) {
  const score = attempt.score ?? 0;
  const total = attempt.totalQuestions ?? attempt.answers?.length ?? 0;
  const questions = quiz?.questions ?? [];
  const answers = attempt.answers ?? [];

  return (
    <div>
      <section className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-neutral-800 pb-3">
        <p className="text-sm font-medium text-neutral-300">
          Concept inventory
        </p>
        <span className="text-neutral-700" aria-hidden="true">·</span>
        <time className="text-xs text-neutral-500" dateTime={attempt.submittedAt}>
          {attempt.submittedAt
            ? new Date(attempt.submittedAt).toLocaleString()
            : "Submission time unavailable"}
        </time>
        <span className="ml-auto text-lg font-semibold tabular-nums text-neutral-100">
          {score}/{total}
        </span>
      </section>

      <div className="mb-4">
        <ConceptInventoryDiagnosticMapping quiz={quiz} />
      </div>

      <div className="space-y-3">
        {Array.from({ length: Math.max(questions.length, answers.length) }, (_, index) => {
          const question = questions[index];
          const answer = answers[index];
          const correctIndexes = new Set(
            answer?.correct
            ?? (Array.isArray(question?.correct) ? question.correct : [question?.correct]),
          );
          const selectedIndexes = new Set(answer?.selected ?? []);
          const selectedOptions = new Set(answer?.selectedOptions ?? []);
          return (
            <section
              key={`${index}-${question?.question || answer?.question || "question"}`}
              className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4"
            >
              <div className="flex items-start gap-3">
                {answer?.isCorrect ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-relaxed text-neutral-200">
                    {index + 1}. {question?.question || answer?.question || "Question"}
                  </p>

                  {question?.options?.length ? (
                    <div className="mt-3 grid gap-1.5">
                      {question.options.map((option, optionIndex) => {
                        const selected = selectedIndexes.size > 0
                          ? selectedIndexes.has(optionIndex)
                          : selectedOptions.has(option);
                        const correct = correctIndexes.has(optionIndex);
                        return (
                          <div
                            key={`${optionIndex}-${option}`}
                            className={cn(
                              "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
                              selected && correct
                                ? "border-emerald-400/70 bg-emerald-500/[0.16] text-emerald-100 ring-1 ring-inset ring-emerald-400/20"
                                : selected
                                  ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-200"
                                  : correct
                                    ? "border-emerald-400/70 bg-emerald-500/[0.16] text-emerald-100 ring-1 ring-inset ring-emerald-400/20"
                                    : "border-neutral-800 bg-neutral-900/60 text-neutral-500",
                            )}
                          >
                            <span className="w-4 shrink-0 font-medium">
                              {String.fromCharCode(65 + optionIndex)}
                            </span>
                            <span className="min-w-0 flex-1 leading-relaxed">{option}</span>
                            {(selected || correct) && (
                              <span
                                className={cn(
                                  "inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide",
                                  correct
                                    ? "rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-200"
                                    : "text-rose-300",
                                )}
                              >
                                {correct && <Check className="h-3 w-3" strokeWidth={2.5} />}
                                {selected && correct
                                  ? "Selected · Correct"
                                  : selected
                                    ? "Selected"
                                    : "Correct answer"}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-neutral-500">Student answer</dt>
                        <dd className="mt-1 leading-relaxed text-neutral-300">
                          {answer?.selectedOptions?.join(", ") || "No answer"}
                        </dd>
                      </div>
                      {!answer?.isCorrect && (
                        <div>
                          <dt className="text-neutral-500">Correct answer</dt>
                          <dd className="mt-1 leading-relaxed text-neutral-300">
                            {answer?.correctOptions?.join(", ") || "Unavailable"}
                          </dd>
                        </div>
                      )}
                    </dl>
                  )}

                  <div className="mt-3 border-t border-neutral-800 pt-3">
                    <p className="text-xs text-neutral-500">Student reasoning</p>
                    <p className="mt-1 text-sm leading-relaxed text-neutral-300">
                      {answer?.reason || "No reasoning recorded"}
                    </p>
                  </div>

                  {question?.explanation && (
                    <div className="mt-3 border-t border-neutral-800 pt-3">
                      <p className="text-xs text-neutral-500">Explanation</p>
                      <p className="mt-1 text-xs leading-relaxed text-neutral-400">
                        {question.explanation}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {agentFeedback?.content && (
        <section className="mt-5 rounded-lg border border-sky-500/20 bg-sky-500/[0.06] p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
              Tutor feedback
            </p>
            {agentFeedback.createdAt && (
              <span className="text-[11px] text-neutral-500">
                {new Date(agentFeedback.createdAt).toLocaleString()}
              </span>
            )}
          </div>
          <div className="text-sm text-neutral-300">
            <Markdown>{agentFeedback.content}</Markdown>
          </div>
        </section>
      )}
    </div>
  );
}

function formatInsightSessionTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function InsightHistoryDrawer({
  sessions,
  activeSessionId,
  scopeLabel,
  onSelect,
  onNew,
  onDelete,
  onClose,
}: {
  sessions: InsightChatSession[];
  activeSessionId: string | null;
  scopeLabel: string;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onDelete: (sessionId: string) => void;
  onClose: () => void;
}) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  return (
    <aside
      aria-label="Insights chat history"
      className="absolute inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/40"
    >
      <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-neutral-100">Chat history</h3>
          <p className="truncate text-[11px] text-neutral-500">{scopeLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            onNew();
            onClose();
          }}
          aria-label="New insights chat"
          title="New chat"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100"
        >
          <SquarePen className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat history"
          title="Close history"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <History className="mb-3 h-8 w-8 text-neutral-700" />
            <p className="text-sm font-medium text-neutral-300">No chat history yet</p>
            <p className="mt-1 text-xs text-neutral-600">
              Your first question in this scope will start a history.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {sessions.map((session) => {
              const active = session.id === activeSessionId;
              const lastUserMessage = [...session.messages]
                .reverse()
                .find((message) => message.role === "user");
              const deleting = pendingDeleteId === session.id;
              return (
                <div
                  key={session.id}
                  className={cn(
                    "group rounded-lg border transition",
                    active
                      ? "border-neutral-700 bg-neutral-800/70"
                      : "border-transparent hover:border-neutral-800 hover:bg-neutral-900",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(session.id);
                      onClose();
                    }}
                    className="w-full px-3 pb-2 pt-3 text-left"
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-neutral-200">
                          {session.title}
                        </p>
                        {lastUserMessage && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-neutral-500">
                            {lastUserMessage.content}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] text-neutral-600">
                        {formatInsightSessionTime(session.updatedAt)}
                      </span>
                    </div>
                  </button>

                  <div className="flex items-center justify-end gap-1 px-2 pb-2">
                    {deleting ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                          className="rounded-md px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onDelete(session.id);
                            setPendingDeleteId(null);
                          }}
                          className="rounded-md bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20"
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(session.id)}
                        aria-label={`Delete ${session.title}`}
                        title="Delete chat"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-600 opacity-0 transition hover:bg-neutral-800 hover:text-rose-300 group-hover:opacity-100 focus:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

/** Analytics agent with an independent whole-class or multi-student scope. */
function StudentInsightsChat({
  agentId,
  students,
  selectedStudentIds,
  onSelectedStudentIdsChange,
  historyOpen,
  onHistoryOpenChange,
  onEvidenceNavigate,
}: {
  agentId: string;
  students: StudentSummary[];
  selectedStudentIds: string[];
  onSelectedStudentIdsChange: (studentIds: string[]) => void;
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  onEvidenceNavigate?: (citation: EvidenceCitation) => void;
}) {
  const {
    messages,
    isStreaming,
    isWaitingForResponse,
    send,
    stop,
    sessions,
    activeSessionId,
    newChat,
    selectSession,
    deleteSession,
  } = useLoggingChat(agentId, selectedStudentIds);
  const [input, setInput] = useState("");
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const scopePickerRef = useRef<HTMLDivElement>(null);
  const selectedSet = new Set(selectedStudentIds);
  const selectedStudents = selectedStudentIds.map((studentId) => {
    const student = students.find((candidate) => candidate.user_id === studentId);
    return {
      id: studentId,
      name: student?.display_name || studentId,
    };
  });
  const scopeLabel = selectedStudentIds.length
    ? `${selectedStudentIds.length} selected`
    : "Whole class";

  const applyScope = (studentIds: string[]) => {
    onSelectedStudentIdsChange(studentIds);
  };

  const toggleStudent = (studentId: string) => {
    applyScope(
      selectedSet.has(studentId)
        ? selectedStudentIds.filter((id) => id !== studentId)
        : [...selectedStudentIds, studentId],
    );
  };

  useEffect(() => {
    if (!scopePickerOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!scopePickerRef.current?.contains(event.target as Node)) {
        setScopePickerOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setScopePickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [scopePickerOpen]);

  return (
    <div className="relative h-full overflow-hidden">
      <UnifiedChatContainer
        messages={messages}
      input={input}
      onInputChange={(e) => setInput(e.target.value)}
      onEvidenceNavigate={onEvidenceNavigate}
      onSend={() => {
        const t = input;
        setInput("");
        setScopePickerOpen(false);
        send(t);
      }}
      onStop={stop}
      isSending={isWaitingForResponse || isStreaming}
      isTyping={isStreaming && !isWaitingForResponse}
      placeholder={
        selectedStudentIds.length
          ? `Ask about ${selectedStudentIds.length} selected ${selectedStudentIds.length === 1 ? "student" : "students"}…`
          : "Ask about the whole class…"
      }
      emptyStateTitle={selectedStudentIds.length ? "Student insights" : "Class insights"}
      emptyStateDescription={
        selectedStudentIds.length
          ? `Answers are scoped to ${scopeLabel.toLowerCase()}.`
          : "Answers summarize the whole class until students are selected."
      }
      suggestions={[
        { title: "Where are they stuck?", description: "Which threshold concepts are they struggling with?" },
        { title: "Suggest next steps", description: "What should I teach these students next?" },
      ]}
      onSuggestionClick={(text) => send(text)}
        composerContext={
          <div className="flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">
                {selectedStudents.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setScopePickerOpen(true)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-neutral-600/70 bg-neutral-700/60 px-2 text-xs font-medium text-neutral-200 transition hover:border-neutral-500 hover:bg-neutral-700"
                  >
                    <Users className="h-3 w-3 text-sky-400" />
                    Whole class
                  </button>
                ) : (
                  selectedStudents.map((student) => (
                    <span
                      key={student.id}
                      className="inline-flex h-7 max-w-52 items-center gap-1.5 rounded-lg border border-neutral-600/70 bg-neutral-700/60 pl-1.5 pr-0.5 text-xs text-neutral-200"
                    >
                      <Avatar name={student.name} className="h-5 w-5 text-[8px]" />
                      <span className="truncate">{student.name}</span>
                      <button
                        type="button"
                        onClick={() => toggleStudent(student.id)}
                        aria-label={`Remove ${student.name} from insight scope`}
                        title={`Remove ${student.name}`}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-600 hover:text-neutral-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))
                )}
            </div>
        }
        composerLeadingAction={
          <div ref={scopePickerRef} className="relative">
          {scopePickerOpen && (
            <div className="absolute bottom-12 left-0 z-50 w-72 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/50">
              <div className="flex items-start justify-between gap-3 border-b border-neutral-800 px-3 py-2.5">
                <div>
                  <p className="text-xs font-semibold text-neutral-200">Insight scope</p>
                  <p className="mt-0.5 text-[11px] text-neutral-500">{scopeLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setScopePickerOpen(false)}
                  aria-label="Close insight scope picker"
                  title="Close"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto p-1.5">
                <button
                  type="button"
                  onClick={() => applyScope([])}
                  role="checkbox"
                  aria-checked={selectedStudentIds.length === 0}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
                    selectedStudentIds.length === 0
                      ? "bg-white/[0.08] text-white"
                      : "text-neutral-300 hover:bg-neutral-800",
                  )}
                >
                  <Users className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 text-sm">Whole class</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      selectedStudentIds.length === 0
                        ? "border-white bg-white text-black"
                        : "border-neutral-600",
                    )}
                  >
                    {selectedStudentIds.length === 0 && <Check className="h-3 w-3" />}
                  </span>
                </button>
                <div className="my-1.5 h-px bg-neutral-800" />
                {students.map((student) => {
                  const checked = selectedSet.has(student.user_id);
                  return (
                    <button
                      key={student.user_id}
                      type="button"
                      onClick={() => toggleStudent(student.user_id)}
                      role="checkbox"
                      aria-checked={checked}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
                        checked
                          ? "bg-neutral-800 text-neutral-100"
                          : "text-neutral-400 hover:bg-neutral-800/70 hover:text-neutral-200",
                      )}
                    >
                      <Avatar
                        name={student.display_name || student.user_id}
                        className="h-6 w-6 text-[9px]"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {student.display_name || student.user_id}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          checked
                            ? "border-white bg-white text-black"
                            : "border-neutral-600",
                        )}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setScopePickerOpen((open) => !open);
            }}
            aria-label="Choose students for insights"
            aria-expanded={scopePickerOpen}
            title={`Insight scope: ${scopeLabel}`}
            className="relative flex h-9 w-9 items-center justify-center rounded-full bg-neutral-700 text-neutral-200 transition hover:bg-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <Plus className="h-4.5 w-4.5" />
            {selectedStudentIds.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold text-black">
                {selectedStudentIds.length}
              </span>
            )}
          </button>
          </div>
        }
      />
      {historyOpen && (
        <InsightHistoryDrawer
          sessions={sessions}
          activeSessionId={activeSessionId}
          scopeLabel={scopeLabel}
          onSelect={selectSession}
          onNew={newChat}
          onDelete={deleteSession}
          onClose={() => onHistoryOpenChange(false)}
        />
      )}
    </div>
  );
}

/* ───────────────────────────── Usage ─────────────────────────────── */

type UsageMetric = "tokens" | LearningActivityMetric;

const USAGE_METRICS: Array<{
  id: UsageMetric;
  label: string;
  icon: typeof Coins;
}> = [
  { id: "tokens", label: "Tokens", icon: Coins },
  { id: "threshold_crossings", label: "Threshold crossings", icon: Diamond },
  { id: "assets_created", label: "Assets", icon: Shapes },
];

function UsageTab({ agentId, embedded = false }: { agentId: string; embedded?: boolean }) {
  const [metric, setMetric] = useState<UsageMetric>("tokens");
  const [analytics, setAnalytics] = useState<TokenUsageAnalytics | null>(null);
  const [activityAnalytics, setActivityAnalytics] = useState<LearningActivityAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [granularity, setGranularity] = useState<UsageGranularity>("day");
  const [startDate, setStartDate] = useState(() => relativeDateRange(30).start);
  const [endDate, setEndDate] = useState(() => relativeDateRange(30).end);

  useEffect(() => {
    if (!startDate || !endDate || startDate > endDate) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const request = {
          agentId: agentId || undefined,
          startDate,
          endDate,
          granularity,
        };
        if (metric === "tokens") {
          const result = await getTokenUsageAnalytics(request);
          if (!cancelled) {
            setAnalytics(result);
            setActivityAnalytics(null);
          }
        } else {
          const result = await getLearningActivityAnalytics({ ...request, metric });
          if (!cancelled) {
            setActivityAnalytics(result);
            setAnalytics(null);
          }
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, startDate, endDate, granularity, metric]);

  // The heatmap always spans a rolling year, like a contribution graph, so it
  // stays readable no matter which range the rest of the page is showing.
  const [calendar, setCalendar] = useState<
    TokenUsageAnalytics | LearningActivityAnalytics | null
  >(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const calendarRange = useMemo(() => trailingMonthRange(6), []);

  useEffect(() => {
    let cancelled = false;
    setCalendar(null);
    setCalendarLoading(true);
    const request = {
      agentId: agentId || undefined,
      startDate: calendarRange.start,
      endDate: calendarRange.end,
      granularity: "day" as const,
    };
    const promise = metric === "tokens"
      ? getTokenUsageAnalytics(request)
      : getLearningActivityAnalytics({ ...request, metric });
    promise
      .then((result) => !cancelled && setCalendar(result))
      .catch(() => !cancelled && setCalendar(null))
      .finally(() => !cancelled && setCalendarLoading(false));
    return () => {
      cancelled = true;
    };
  }, [agentId, calendarRange, metric]);

  const invalidRange = Boolean(startDate && endDate && startDate > endDate);
  const hasTrackedUsage = (analytics?.totalTokens ?? 0) > 0;
  const activityCopy = metric === "threshold_crossings"
    ? {
        totalLabel: "Threshold crossings",
        unit: "crossings",
        calendarTitle: "Threshold crossing calendar",
        cumulativeTitle: "Cumulative threshold crossings",
        emptyTitle: "No threshold crossings in this date range",
        icon: Diamond,
      }
    : {
        totalLabel: "Assets created",
        unit: "assets",
        calendarTitle: "Asset creation calendar",
        cumulativeTitle: "Cumulative assets created",
        emptyTitle: "No assets created in this date range",
        icon: Shapes,
      };
  const noRangeData = metric === "tokens"
    ? !analytics || analytics.totalResponses === 0
    : !activityAnalytics || activityAnalytics.totalEvents === 0;
  const distribution = metric === "tokens"
    ? analytics?.distribution ?? []
    : activityAnalytics?.distribution ?? [];
  const distributionSuppressed = metric === "tokens"
    ? analytics?.distributionSuppressed ?? true
    : activityAnalytics?.distributionSuppressed ?? true;
  const minimumDistributionStudents = metric === "tokens"
    ? analytics?.minimumDistributionStudents ?? 5
    : activityAnalytics?.minimumDistributionStudents ?? 5;
  const distributionColors: Record<string, string> = {
    light: "bg-sky-400",
    typical: "bg-emerald-400",
    high: "bg-amber-400",
  };

  return (
    <div className={cn("space-y-3", embedded ? "" : "p-3 sm:p-5")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex h-8 rounded-lg border border-neutral-800 bg-neutral-950 p-0.5"
            role="radiogroup"
            aria-label="Usage metric"
          >
            {USAGE_METRICS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={metric === id}
                onClick={() => setMetric(id)}
                className={cn(
                  "inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition",
                  metric === id
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-200",
                )}
              >
                <Icon
                  className="h-3.5 w-3.5"
                  fill="currentColor"
                  fillOpacity={0.3}
                  aria-hidden
                />
                {label}
              </button>
            ))}
          </div>

          <div
            className="inline-flex h-8 rounded-lg border border-neutral-800 bg-neutral-950 p-0.5"
            role="group"
            aria-label="Usage grouping"
          >
            {(["day", "week", "month"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setGranularity(value)}
                aria-pressed={granularity === value}
                className={cn(
                  "h-full rounded-md px-2.5 text-xs font-medium capitalize transition",
                  granularity === value
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-neutral-500 hover:text-neutral-200",
                )}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950 px-2">
            <input
              type="date"
              aria-label="From"
              value={startDate}
              max={endDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="bg-transparent text-xs text-neutral-300 outline-none"
            />
            <span className="text-neutral-600">→</span>
            <input
              type="date"
              aria-label="To"
              value={endDate}
              min={startDate}
              max={dateInputValue(new Date())}
              onChange={(event) => setEndDate(event.target.value)}
              className="bg-transparent text-xs text-neutral-300 outline-none"
            />
          </div>
        </div>
      </div>

      {invalidRange ? (
        <ErrorNote message="The start date must be on or before the end date." />
      ) : loading || calendarLoading ? (
        <Spinner label="Loading activity…" />
      ) : error ? (
        <ErrorNote message={error} />
      ) : noRangeData ? (
        <EmptyState
          icon={metric === "tokens" ? CalendarDays : activityCopy.icon}
          title={metric === "tokens" ? "No token activity in this date range" : activityCopy.emptyTitle}
        />
      ) : (
        <>
          {metric === "tokens" && analytics ? (
            <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-neutral-800 bg-neutral-800 sm:grid-cols-3">
              <div className="bg-neutral-900 p-3">
                <dt className="text-[11px] text-emerald-400/80">Total tokens</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-200">
                  {formatNumber(analytics.totalTokens)}
                </dd>
                <p className="mt-1 text-[11px] tabular-nums text-neutral-500">
                  <span className="text-sky-400/80">{formatNumber(analytics.totalInputTokens)}</span> in
                  {" · "}
                  <span className="text-amber-400/80">{formatNumber(analytics.totalOutputTokens)}</span> out
                </p>
              </div>
              <div className="bg-neutral-900 p-3">
                <dt className="text-[11px] text-neutral-500">Active students</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-200">
                  {analytics.activeStudents}
                </dd>
                <p className="mt-1 text-[11px] tabular-nums text-neutral-500">
                  {analytics.activeStudents > 0
                    ? `${formatNumber(Math.round(analytics.totalTokens / analytics.activeStudents))} avg each`
                    : "—"}
                </p>
              </div>
              <div className="bg-neutral-900 p-3">
                <dt className="text-[11px] text-neutral-500">Responses</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-200">
                  {analytics.totalResponses}
                </dd>
                <p className="mt-1 text-[11px] tabular-nums text-neutral-500">
                  {analytics.trackedResponses} with token data
                </p>
              </div>
            </dl>
          ) : activityAnalytics ? (
            <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-neutral-800 bg-neutral-800 sm:grid-cols-3">
              <div className="bg-neutral-900 p-3">
                <dt className="text-[11px] text-emerald-400/80">{activityCopy.totalLabel}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-200">
                  {formatNumber(activityAnalytics.totalEvents)}
                </dd>
                <p className="mt-1 text-[11px] text-neutral-500">
                  {activityAnalytics.activeDays} active {activityAnalytics.activeDays === 1 ? "day" : "days"}
                </p>
              </div>
              <div className="bg-neutral-900 p-3">
                <dt className="text-[11px] text-neutral-500">Active students</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-200">
                  {activityAnalytics.activeStudents}
                </dd>
                <p className="mt-1 text-[11px] text-neutral-500">
                  {activityAnalytics.activeStudents > 0
                    ? `${(activityAnalytics.totalEvents / activityAnalytics.activeStudents).toFixed(1)} avg each`
                    : "—"}
                </p>
              </div>
              <div className="bg-neutral-900 p-3">
                <dt className="text-[11px] text-neutral-500">Active days</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-200">
                  {activityAnalytics.activeDays}
                </dd>
                <p className="mt-1 text-[11px] text-neutral-500">
                  {activityAnalytics.activeCourses} {activityAnalytics.activeCourses === 1 ? "course" : "courses"} represented
                </p>
              </div>
            </dl>
          ) : null}

          {metric === "tokens" && !hasTrackedUsage ? (
            <EmptyState icon={Coins} title="No tracked token data in this range" />
          ) : (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
                {calendar && (
                  <TokenConsumptionCalendar
                    points={calendar.dailySeries ?? calendar.series}
                    startDate={calendar.startDate}
                    endDate={calendar.endDate}
                    title={metric === "tokens" ? undefined : activityCopy.calendarTitle}
                    unit={metric === "tokens" ? undefined : activityCopy.unit}
                  />
                )}
                <section className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 sm:p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-medium text-neutral-200">
                        {metric === "tokens" && analytics
                          ? analytics.usageSource === "foundry"
                            ? "Cumulative course usage"
                            : "Cumulative tracked usage"
                          : activityCopy.cumulativeTitle}
                      </h2>
                      {(metric === "tokens" ? analytics?.series : activityAnalytics?.series)?.length ? (
                        <p className="mt-0.5 text-xs text-neutral-500">
                          {metric === "tokens" && analytics
                            ? `${usagePeriodLabel(analytics.series[0], analytics.granularity)} – ${usagePeriodLabel(analytics.series[analytics.series.length - 1], analytics.granularity)}`
                            : activityAnalytics
                              ? `${usagePeriodLabel(activityAnalytics.series[0], activityAnalytics.granularity)} – ${usagePeriodLabel(activityAnalytics.series[activityAnalytics.series.length - 1], activityAnalytics.granularity)}`
                              : ""}
                        </p>
                      ) : null}
                    </div>
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] capitalize text-emerald-300">
                      {granularity}
                    </span>
                  </div>
                  <CumulativeUsageChart
                    points={analytics?.series ?? []}
                    granularity={granularity}
                    activity={metric === "tokens" ? undefined : activityAnalytics?.series}
                    activityLabel={metric === "tokens" ? undefined : activityCopy.unit}
                  />
                </section>
              </div>

              <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 sm:p-4">
                <div className="mb-3 flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-neutral-500" aria-hidden="true" />
                  <h2 className="text-sm font-medium text-neutral-200">Anonymous distribution</h2>
                </div>
                {distributionSuppressed ? (
                  <p className="text-xs text-neutral-500">
                    {metric === "tokens" && analytics?.usageSource === "foundry"
                      ? "Unavailable — course totals cannot be safely linked to individual students."
                      : `Available once at least ${minimumDistributionStudents} students have activity in this range.`}
                  </p>
                ) : (
                  <>
                    <div
                      className="flex h-3 overflow-hidden rounded bg-neutral-800"
                      aria-label="Student activity distribution"
                    >
                      {distribution.map((band) => (
                        <div
                          key={band.key}
                          className={distributionColors[band.key]}
                          style={{ width: `${band.studentPercentage}%` }}
                          title={`${band.label}: ${band.studentPercentage}% of students`}
                        />
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                      {distribution.map((band) => (
                        <div key={band.key} className="flex items-center gap-2 text-xs">
                          <span
                            className={cn("h-2 w-2 rounded-sm", distributionColors[band.key])}
                          />
                          <span className="text-neutral-400">{band.label}</span>
                          <span className="tabular-nums text-neutral-200">
                            {band.studentPercentage}%
                          </span>
                          <span className="tabular-nums text-neutral-600">
                            ({band.studentCount})
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── Feedback ──────────────────────────── */

function sentimentStyle(s: string | null): string {
  const v = (s || "").toLowerCase();
  if (v.includes("pos")) return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
  if (v.includes("neg")) return "bg-rose-500/10 text-rose-300 border-rose-500/20";
  return "bg-neutral-800 text-neutral-400 border-neutral-700";
}

function FeedbackTab() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listFeedback(200);
      setItems(res.feedback);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <SectionTitle>Student feedback ({items.length})</SectionTitle>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200 rounded-lg border border-neutral-800 hover:border-neutral-700 px-2.5 py-1.5 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : items.length === 0 ? (
        <EmptyState icon={Inbox} title="No feedback yet" sub="Feedback from your students will show up here." />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {items.map((f) => (
            <div
              key={f.id}
              className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4 hover:border-neutral-700 transition"
            >
              <div className="flex items-center gap-2.5">
                <Avatar name={f.userName || f.userId} className="w-8 h-8" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{f.userName || f.userId}</p>
                  {f.userEmail && (
                    <p className="text-[11px] text-neutral-500 truncate">{f.userEmail}</p>
                  )}
                </div>
                <span
                  className={cn(
                    "text-[10px] rounded-full border px-2 py-0.5",
                    sentimentStyle(f.sentiment),
                  )}
                >
                  {f.sentiment || f.category}
                </span>
              </div>
              <p className="text-sm text-neutral-300 mt-3 leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

