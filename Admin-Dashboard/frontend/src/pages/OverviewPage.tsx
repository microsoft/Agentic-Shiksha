/**
 * OverviewPage — All-courses analytics table.
 *
 * Shows: Course, Institute, Department, Professors,
 * Users (Active/Total), Total Tokens, Avg Tokens/Student, Avg Rounds/Student.
 *
 * All data comes from Cosmos DB via a single endpoint.
 */

import { useEffect, useState, useMemo, useCallback } from "react";
import ImageQuotaCard from "@/components/ImageQuotaCard";
import {
  Users,
  Coins,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  GraduationCap,
  Building2,
  Zap,
  MessageCircle,
  ChevronDown,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  getCoursesOverview,
  getTokenUsagePerStudent,
  getPeriodStats,
  type CourseOverviewItem,
  type StudentTokenUsage,
  type TodayStats,
} from "@/lib/dashboardApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/* ── Helpers ── */

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type PeriodKey = "today" | "week" | "month" | "custom";

const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  custom: "Custom",
};

function getPeriodRange(key: PeriodKey): { start: string; end: string } {
  const now = new Date();
  const end = toISODate(now);
  if (key === "today") return { start: end, end };
  if (key === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay()); // Sunday start
    return { start: toISODate(d), end };
  }
  if (key === "month") {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: toISODate(d), end };
  }
  return { start: end, end }; // custom handled separately
}

type SortKey =
  | "course"
  | "institute"
  | "department"
  | "activeUsers"
  | "totalTokens"
  | "avgTokens"
  | "avgRounds";
type SortDir = "asc" | "desc";

/* ── Merged row type ── */
type CourseRow = CourseOverviewItem & {
  avgTokensPerStudent: number | null;
  avgRoundsPerStudent: number | null;
};

/* ── Component ── */

export default function OverviewContent() {
  const [courses, setCourses] = useState<CourseOverviewItem[]>([]);
  const [uniqueTotalUsers, setUniqueTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("activeUsers");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Course-wise token dialog (Total Tokens card)
  const [courseTokenDialogOpen, setCourseTokenDialogOpen] = useState(false);
  const [courseTokenSearch, setCourseTokenSearch] = useState("");

  // Per-student token dialog (Avg Tokens/Student cell)
  const [studentTokenDialogOpen, setStudentTokenDialogOpen] = useState(false);
  const [studentTokens, setStudentTokens] = useState<StudentTokenUsage[]>([]);
  const [studentTokenDialogLoading, setStudentTokenDialogLoading] = useState(false);
  const [studentTokenError, setStudentTokenError] = useState<string | null>(null);
  const [studentTokenDialogCourse, setStudentTokenDialogCourse] = useState("");

  // Per-student rounds dialog (Avg Rounds/Student cell)
  const [studentRoundsDialogOpen, setStudentRoundsDialogOpen] = useState(false);
  const [studentRounds, setStudentRounds] = useState<StudentTokenUsage[]>([]);
  const [studentRoundsDialogLoading, setStudentRoundsDialogLoading] = useState(false);
  const [studentRoundsError, setStudentRoundsError] = useState<string | null>(null);
  const [studentRoundsDialogCourse, setStudentRoundsDialogCourse] = useState("");

  const openCourseTokenDialog = () => {
    setCourseTokenSearch("");
    setCourseTokenDialogOpen(true);
  };

  const openStudentTokenDialog = async (agentId: string, courseName: string) => {
    setStudentTokenDialogOpen(true);
    setStudentTokenDialogLoading(true);
    setStudentTokenError(null);
    setStudentTokens([]);
    setStudentTokenDialogCourse(courseName);
    try {
      const data = await getTokenUsagePerStudent(agentId);
      setStudentTokens(data.students);
    } catch {
      setStudentTokenError("Student token usage could not be loaded. Please try again.");
    } finally {
      setStudentTokenDialogLoading(false);
    }
  };

  const openStudentRoundsDialog = async (agentId: string, courseName: string) => {
    setStudentRoundsDialogOpen(true);
    setStudentRoundsDialogLoading(true);
    setStudentRoundsError(null);
    setStudentRounds([]);
    setStudentRoundsDialogCourse(courseName);
    try {
      const data = await getTokenUsagePerStudent(agentId);
      // Sort by rounds descending
      setStudentRounds([...data.students].sort((a, b) => b.rounds - a.rounds));
    } catch {
      setStudentRoundsError("Student rounds could not be loaded. Please try again.");
    } finally {
      setStudentRoundsDialogLoading(false);
    }
  };

  // Period stats
  const [periodStats, setPeriodStats] = useState<TodayStats | null>(null);
  const [periodLoading, setPeriodLoading] = useState(true);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [periodKey, setPeriodKey] = useState<PeriodKey>("today");
  const [customStart, setCustomStart] = useState(toISODate(new Date()));
  const [customEnd, setCustomEnd] = useState(toISODate(new Date()));
  const [periodDropdownOpen, setPeriodDropdownOpen] = useState(false);

  const fetchPeriodStats = useCallback(async (key: PeriodKey, cStart?: string, cEnd?: string) => {
    setPeriodLoading(true);
    setPeriodError(null);
    try {
      const range = key === "custom"
        ? { start: cStart || customStart, end: cEnd || customEnd }
        : getPeriodRange(key);
      const data = await getPeriodStats(range.start, range.end);
      setPeriodStats(data);
    } catch {
      setPeriodStats(null);
      setPeriodError("Usage for this period could not be loaded.");
    } finally {
      setPeriodLoading(false);
    }
  }, [customStart, customEnd]);

  const handlePeriodChange = (key: PeriodKey) => {
    setPeriodKey(key);
    setPeriodDropdownOpen(false);
    if (key !== "custom") fetchPeriodStats(key);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const coursesData = await getCoursesOverview();
      setCourses(coursesData.courses);
      setUniqueTotalUsers(coursesData.uniqueTotalUsers ?? 0);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchPeriodStats("today");
  }, []);

  // Compute derived fields
  const rows: CourseRow[] = useMemo(() => {
    return courses.map((c) => {
      const active = c.attributedStudents ?? c.activeUsers;
      return {
        ...c,
        avgTokensPerStudent: active > 0 ? Math.round((c.attributedTokens ?? c.totalTokens ?? 0) / active) : null,
        avgRoundsPerStudent:
          active > 0 ? Math.round(((c.attributedRounds ?? c.rounds ?? 0) / active) * 10) / 10 : null,
      };
    });
  }, [courses]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "course":
          cmp = a.course.localeCompare(b.course);
          break;
        case "institute":
          cmp = a.institute.localeCompare(b.institute);
          break;
        case "department":
          cmp = a.department.localeCompare(b.department);
          break;
        case "activeUsers":
          cmp = a.activeUsers - b.activeUsers;
          break;
        case "totalTokens":
          cmp = (a.totalTokens ?? 0) - (b.totalTokens ?? 0);
          break;
        case "avgTokens":
          cmp = (a.avgTokensPerStudent ?? -1) - (b.avgTokensPerStudent ?? -1);
          break;
        case "avgRounds":
          cmp = (a.avgRoundsPerStudent ?? -1) - (b.avgRoundsPerStudent ?? -1);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col)
      return <ArrowUpDown className="w-3 h-3 text-neutral-600 ml-1 inline" />;
    return sortDir === "asc" ? (
      <ArrowUp className="w-3 h-3 text-blue-400 ml-1 inline" />
    ) : (
      <ArrowDown className="w-3 h-3 text-blue-400 ml-1 inline" />
    );
  };

  // Totals
  const totals = useMemo(() => {
    const totalActive = rows.reduce((s, r) => s + r.activeUsers, 0);
    const totalTok = rows.reduce((s, r) => s + (r.totalTokens ?? 0), 0);
    return { totalActive, totalTok, courseCount: rows.length };
  }, [rows]);

  const tokenCourses = rows
    .filter((course) => (course.totalTokens ?? 0) > 0)
    .sort((first, second) => second.totalTokens - first.totalTokens || first.course.localeCompare(second.course));
  const courseQuery = courseTokenSearch.trim().toLocaleLowerCase();
  const matchingTokenCourses = tokenCourses.filter((course) => course.course.toLocaleLowerCase().includes(courseQuery));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-6 h-6 text-neutral-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ImageQuotaCard />

      {/* ── Summary Cards: Today | Overall ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Period Stats */}
        <div className="bg-neutral-900/50 rounded-2xl border border-neutral-800/40 p-3">
          <div className="flex items-center justify-end gap-1.5 mb-2">
            {/* Custom date range inputs inline */}
            {periodKey === "custom" && (
              <div className="flex items-center gap-1.5 mr-auto">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-1.5 py-0.5 text-[11px] bg-neutral-800 border border-neutral-700 rounded text-neutral-300 outline-none focus:border-blue-500"
                />
                <span className="text-neutral-600 text-[11px]">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-1.5 py-0.5 text-[11px] bg-neutral-800 border border-neutral-700 rounded text-neutral-300 outline-none focus:border-blue-500"
                />
                <button
                  onClick={() => fetchPeriodStats("custom", customStart, customEnd)}
                  className="px-2 py-0.5 text-[11px] bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                >
                  Go
                </button>
              </div>
            )}
            {/* Period selector dropdown — right aligned */}
            <div className="relative">
              <button
                onClick={() => setPeriodDropdownOpen((v) => !v)}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px] bg-neutral-800 border border-neutral-700 rounded text-neutral-300 hover:bg-neutral-700 transition-colors"
              >
                {PERIOD_LABELS[periodKey]}
                <ChevronDown className="w-2.5 h-2.5" />
              </button>
              {periodDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1 min-w-[110px]">
                  {(["today", "week", "month", "custom"] as PeriodKey[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => handlePeriodChange(k)}
                      className={`w-full text-left px-2.5 py-1 text-[11px] hover:bg-neutral-700 transition-colors ${
                        periodKey === k ? "text-blue-400" : "text-neutral-300"
                      }`}
                    >
                      {PERIOD_LABELS[k]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {periodError && (
            <div role="alert" className="mb-2 flex items-center justify-between gap-2 text-xs text-red-400">
              <span>{periodError}</span>
              <button
                type="button"
                onClick={() => fetchPeriodStats(periodKey)}
                aria-label="Retry period statistics"
                title="Retry period statistics"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <SummaryCard
              icon={<Users className="w-4 h-4" />}
              label="Active Students"
              value={periodStats?.activeStudents ?? "Unavailable"}
              accent="emerald"
              loading={periodLoading}
            />
            <SummaryCard
              icon={<Coins className="w-4 h-4" />}
              label="Tokens Used"
              value={periodStats ? formatNumber(periodStats.tokens) : "Unavailable"}
              accent="purple"
              loading={periodLoading}
            />
            <SummaryCard
              icon={<Zap className="w-4 h-4" />}
              label="Rounds"
              value={periodStats?.rounds ?? "Unavailable"}
              accent="blue"
              loading={periodLoading}
            />
            <SummaryCard
              icon={<MessageCircle className="w-4 h-4" />}
              label="New Conversations"
              value={periodStats?.newConversations ?? "Unavailable"}
              accent="amber"
              loading={periodLoading}
            />
          </div>
        </div>

        {/* Overall */}
        <div className="bg-neutral-900/50 rounded-2xl border border-neutral-800/40 p-3">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Overall</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SummaryCard
              icon={<GraduationCap className="w-4 h-4" />}
              label="Courses"
              value={totals.courseCount}
              accent="blue"
            />
            <SummaryCard
              icon={<Users className="w-4 h-4" />}
              label="Active Students"
              value={totals.totalActive}
              accent="emerald"
            />
            <SummaryCard
              icon={<Building2 className="w-4 h-4" />}
              label="Total Users"
              value={uniqueTotalUsers}
              accent="amber"
            />
            <SummaryCard
              icon={<Coins className="w-4 h-4" />}
              label="Total Tokens"
              value={formatNumber(totals.totalTok)}
              accent="purple"
              onClick={openCourseTokenDialog}
            />
          </div>
        </div>
      </div>

      {/* ── Course-wise Token Distribution Dialog ── */}
      <Dialog open={courseTokenDialogOpen} onOpenChange={setCourseTokenDialogOpen}>
        <DialogContent className="flex max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-4xl flex-col gap-0 overflow-hidden rounded-lg border-neutral-800 bg-neutral-900 p-0">
          <DialogHeader className="shrink-0 space-y-2 px-4 pb-4 pt-5 pr-12 text-left sm:px-6 sm:pr-14">
            <DialogTitle className="text-lg leading-tight tracking-normal text-neutral-100">
              Token Usage by Course
            </DialogTitle>
            <DialogDescription className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-neutral-400">
              <span>{tokenCourses.length} courses</span>
              <span>{totals.totalTok.toLocaleString()} tokens total</span>
            </DialogDescription>
          </DialogHeader>
          <div className="shrink-0 border-y border-neutral-800 px-4 py-3 sm:px-6">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
              <input
                type="search"
                aria-label="Search courses"
                placeholder="Search courses"
                value={courseTokenSearch}
                onChange={(event) => setCourseTokenSearch(event.target.value)}
                className="h-9 w-full min-w-0 rounded-md border border-neutral-700 bg-neutral-950 py-2 pl-9 pr-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
              />
            </div>
          </div>
          <div className="flex shrink-0 justify-between gap-3 px-4 py-2 text-xs text-neutral-500 sm:px-6">
            <span aria-live="polite">
              {courseQuery ? `${matchingTokenCourses.length} of ${tokenCourses.length} courses` : "Course"}
            </span>
            <span className="shrink-0">Tokens / Share</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
            {matchingTokenCourses.length === 0 ? (
              <div role="status" className="px-4 py-12 text-center text-sm text-neutral-400">
                {courseQuery ? "No matching courses." : "No token usage recorded."}
              </div>
            ) : (
              <ol aria-label="Course token usage" className="divide-y divide-neutral-800/70">
                {matchingTokenCourses.map((course) => {
                  const share = totals.totalTok > 0 ? (course.totalTokens / totals.totalTok) * 100 : 0;
                  return (
                    <li key={course.agentId} className="px-4 py-3 sm:px-6">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                        <span className="min-w-0 text-sm font-medium leading-5 text-neutral-100 [overflow-wrap:anywhere]">
                          {course.course}
                        </span>
                        <div className="text-right tabular-nums">
                          <span className="block whitespace-nowrap text-sm font-semibold text-neutral-100">
                            {course.totalTokens.toLocaleString()}
                          </span>
                          <span className="block text-xs text-neutral-400">
                            {share > 0 && share < 0.1 ? "<0.1" : share.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-sm bg-neutral-800">
                        <div className="h-full bg-purple-400" style={{ width: `${share}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Per-Student Token Distribution Dialog ── */}
      <Dialog open={studentTokenDialogOpen} onOpenChange={setStudentTokenDialogOpen}>
        <DialogContent className="max-w-4xl bg-neutral-900 border-neutral-800 max-h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between pr-8">
              <DialogTitle className="text-neutral-100">
                Student Token Usage — {studentTokenDialogCourse}
              </DialogTitle>
              {!studentTokenDialogLoading && studentTokens.length > 0 && (
                <div className="flex items-center gap-4 text-xs text-neutral-500">
                  <span>{studentTokens.length} students</span>
                  <span>Total: {formatNumber(studentTokens.reduce((s, r) => s + r.totalTokens, 0))} tokens</span>
                </div>
              )}
            </div>
          </DialogHeader>
          {studentTokenDialogLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-neutral-400 animate-spin" />
            </div>
          ) : studentTokenError ? (
            <div role="alert" className="py-12 text-center text-red-400">
              {studentTokenError}
            </div>
          ) : studentTokens.length === 0 ? (
            <div className="text-center py-12 text-neutral-500">
              No student token usage found for this course.
            </div>
          ) : (
            <div className="flex-1 -mx-6 px-6 overflow-x-auto">
              <LineChart
                data={studentTokens.map((s) => ({
                  label: s.displayName,
                  value: s.totalTokens,
                  tooltip: `${s.displayName}${s.email ? ` (${s.email})` : ""}\n${formatNumber(s.totalTokens)} tokens · ${s.rounds} rounds`,
                }))}
                color="rgb(52,211,153)"
                gradientId="studentTokenGrad"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Per-Student Rounds Distribution Dialog ── */}
      <Dialog open={studentRoundsDialogOpen} onOpenChange={setStudentRoundsDialogOpen}>
        <DialogContent className="max-w-4xl bg-neutral-900 border-neutral-800 max-h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between pr-8">
              <DialogTitle className="text-neutral-100">
                Rounds per Student — {studentRoundsDialogCourse}
              </DialogTitle>
              {!studentRoundsDialogLoading && studentRounds.length > 0 && (
                <div className="flex items-center gap-4 text-xs text-neutral-500">
                  <span>{studentRounds.length} students</span>
                  <span>Total: {studentRounds.reduce((s, r) => s + r.rounds, 0)} rounds</span>
                </div>
              )}
            </div>
          </DialogHeader>
          {studentRoundsDialogLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-neutral-400 animate-spin" />
            </div>
          ) : studentRoundsError ? (
            <div role="alert" className="py-12 text-center text-red-400">
              {studentRoundsError}
            </div>
          ) : studentRounds.length === 0 ? (
            <div className="text-center py-12 text-neutral-500">
              No student rounds data found for this course.
            </div>
          ) : (
            <div className="flex-1 -mx-6 px-6 overflow-x-auto">
              <LineChart
                data={studentRounds.map((s) => ({
                  label: s.displayName,
                  value: s.rounds,
                  tooltip: `${s.displayName}${s.email ? ` (${s.email})` : ""}\n${s.rounds} rounds · ${formatNumber(s.totalTokens)} tokens`,
                }))}
                color="rgb(96,165,250)"
                gradientId="studentRoundsGrad"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Table ── */}
      <div className="bg-neutral-900/80 rounded-2xl border border-neutral-800/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-neutral-800/60">
                <Th onClick={() => toggleSort("course")} className="min-w-[180px]">
                  Course <SortIcon col="course" />
                </Th>
                <Th onClick={() => toggleSort("institute")} className="min-w-[140px]">
                  Institute <SortIcon col="institute" />
                </Th>
                <Th onClick={() => toggleSort("department")} className="min-w-[140px]">
                  Department <SortIcon col="department" />
                </Th>
                <Th className="min-w-[160px]">Professors</Th>
                <Th onClick={() => toggleSort("activeUsers")} className="text-center min-w-[100px]">
                  Users <SortIcon col="activeUsers" />
                </Th>
                <Th onClick={() => toggleSort("totalTokens")} className="text-right min-w-[110px]">
                  Total Tokens <SortIcon col="totalTokens" />
                </Th>
                <Th onClick={() => toggleSort("avgTokens")} className="text-right min-w-[120px]">
                  Avg Tokens/Student <SortIcon col="avgTokens" />
                </Th>
                <Th onClick={() => toggleSort("avgRounds")} className="text-right min-w-[120px]">
                  Avg Rounds/Student <SortIcon col="avgRounds" />
                </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/40">
              {sorted.map((row) => (
                <tr
                  key={row.agentId}
                  className="hover:bg-neutral-800/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-neutral-100">
                    {row.course}
                    {(row.progress_available === false || row.graph_memory_mode === "authoritative" || row.graph_memory_mode === "shadow") && (
                      <p className="mt-1 max-w-sm text-xs font-normal text-amber-300" role="status">
                        Graph Memory ({row.graph_memory_mode || "enabled"}): legacy progress unavailable. Use the authorized teacher view.
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    {row.institute || "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    {row.department || "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-300 text-xs leading-relaxed">
                    {row.professors.length > 0
                      ? row.professors.join(", ")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-emerald-400 font-semibold">
                      {row.activeUsers}
                    </span>
                    <span className="text-neutral-600">/</span>
                    <span className="text-neutral-400">{row.totalUsers}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-neutral-200">
                    {formatNumber(row.totalTokens ?? 0)}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-mono cursor-pointer hover:text-purple-400 transition-colors"
                    onClick={() => openStudentTokenDialog(row.agentId, row.course)}
                    title="Click to see student breakdown"
                  >
                    <span className="border-b border-dashed border-neutral-500 hover:border-purple-400 text-neutral-200">{row.avgTokensPerStudent === null ? "Unavailable" : formatNumber(row.avgTokensPerStudent)}</span>
                  </td>
                  <td
                    className="px-4 py-3 text-right font-mono cursor-pointer hover:text-emerald-400 transition-colors"
                    onClick={() => openStudentRoundsDialog(row.agentId, row.course)}
                    title="Click to see rounds breakdown"
                  >
                    <span className="border-b border-dashed border-neutral-500 hover:border-emerald-400 text-neutral-200">{row.avgRoundsPerStudent ?? "Unavailable"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function Th({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider whitespace-nowrap select-none ${
        onClick ? "cursor-pointer hover:text-neutral-200" : ""
      } ${className}`}
      onClick={onClick}
    >
      {children}
    </th>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  accent,
  loading,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent: string;
  loading?: boolean;
  onClick?: () => void;
}) {
  const colors: Record<string, string> = {
    blue: "text-blue-400",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    purple: "text-purple-400",
  };
  const Card = onClick ? "button" : "div";
  return (
    <Card
      type={onClick ? "button" : undefined}
      aria-label={onClick ? `View ${label.toLowerCase()}` : undefined}
      className={`bg-neutral-900/80 rounded-lg border border-neutral-800/60 px-3 py-2.5 flex items-center gap-2.5 ${
        onClick ? "w-full cursor-pointer text-left hover:border-neutral-700 hover:bg-neutral-800/80 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400" : ""
      }`}
      onClick={onClick}
    >
      <div className={`${colors[accent] || "text-neutral-400"}`}>{icon}</div>
      <div className="min-w-0">
        <div className={`${value === "Unavailable" ? "text-xs" : "text-xl"} font-bold text-neutral-100 flex items-center gap-1.5 leading-tight break-words`}>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-neutral-500" />
          ) : (
            <span className="min-w-0 break-words">{value}</span>
          )}
        </div>
        <div className="text-[11px] text-neutral-500">
          {label}
          {onClick && <span className="ml-1 text-neutral-600">▸</span>}
        </div>
      </div>
    </Card>
  );
}

/* ── Reusable Line Chart ── */

interface LineChartDatum {
  label: string;
  value: number;
  tooltip: string;
}

function LineChart({
  data,
  color,
  gradientId,
  showLabels,
}: {
  data: LineChartDatum[];
  color: string;
  gradientId: string;
  showLabels?: boolean;
}) {
  if (data.length === 0) return null;

  const maxVal = Math.max(...data.map((d) => d.value));
  const chartHeight = showLabels ? 240 : 220;
  const fixedWidth = 700;
  const padLeft = 60;
  const padRight = 20;
  const padTop = 20;
  const padBottom = showLabels ? 50 : 30;
  const plotW = fixedWidth - padLeft - padRight;
  const plotH = chartHeight - padTop - padBottom;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    value: Math.round(maxVal * f),
    y: padTop + plotH - plotH * f,
  }));

  const points = data.map((d, i) => ({
    x: padLeft + (plotW / Math.max(data.length - 1, 1)) * i,
    y: padTop + plotH - (d.value / (maxVal || 1)) * plotH,
    d,
    idx: i,
  }));

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padTop + plotH} L ${points[0].x} ${padTop + plotH} Z`;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${fixedWidth} ${chartHeight}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map((t) => (
          <g key={t.value}>
            <line
              x1={padLeft} y1={t.y} x2={fixedWidth - padRight} y2={t.y}
              stroke="rgb(64,64,64)" strokeWidth="1" strokeDasharray="4 3"
            />
            <text x={padLeft - 6} y={t.y + 3} textAnchor="end" fill="rgb(115,115,115)" fontSize="10" fontFamily="monospace">
              {formatNumber(t.value)}
            </text>
          </g>
        ))}
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {(() => {
          // Calculate label interval: show ~10-15 labels max
          const maxLabels = 15;
          const interval = data.length <= maxLabels ? 1 : Math.ceil(data.length / maxLabels);
          return points.map((p) => {
            const showXLabel = showLabels
              ? true  // course names always shown
              : (p.idx % interval === 0 || p.idx === data.length - 1);
            return (
              <g key={p.idx}>
                <circle cx={p.x} cy={p.y} r="4" fill={color} stroke="rgb(23,23,23)" strokeWidth="2" />
                <circle cx={p.x} cy={p.y} r="14" fill="transparent" className="cursor-pointer">
                  <title>{p.d.tooltip}</title>
                </circle>
                {showLabels ? (
                  (() => {
                    const maxChars = Math.max(Math.floor(plotW / data.length / 5.5), 8);
                    const label = p.d.label;
                    let line1 = "";
                    let line2 = "";
                    if (label.length <= maxChars) {
                      line1 = label;
                    } else {
                      const breakIdx = label.lastIndexOf(" ", maxChars);
                      const splitAt = breakIdx > 3 ? breakIdx : maxChars;
                      line1 = label.slice(0, splitAt).trim();
                      const rest = label.slice(splitAt).trim();
                      line2 = rest.length > maxChars ? rest.slice(0, maxChars - 1) + "…" : rest;
                    }
                    return (
                      <text
                        x={p.x} y={padTop + plotH + 12}
                        textAnchor="middle"
                        fill="rgb(163,163,163)" fontSize="8.5"
                      >
                        <tspan x={p.x} dy="0">{line1}</tspan>
                        {line2 && <tspan x={p.x} dy="10">{line2}</tspan>}
                      </text>
                    );
                  })()
                ) : showXLabel ? (
                  <text x={p.x} y={padTop + plotH + 16} textAnchor="middle" fill="rgb(115,115,115)" fontSize="10">
                    {p.idx + 1}
                  </text>
                ) : null}
              </g>
            );
          });
        })()}
      </svg>
    </div>
  );
}
