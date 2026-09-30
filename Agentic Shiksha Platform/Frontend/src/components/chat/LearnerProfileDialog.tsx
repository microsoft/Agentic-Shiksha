import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Circle, CircleDot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getLearnerProfile, updateLearnerProfile, type LearnerProfile } from "@/lib/api";
import {
  chatApi, type LearnerLearningProgress, type LearnerLearningSnapshot, type LearnerProgressItem,
} from "@/lib/chatApi";
import { useChatStore } from "@/lib/chatStore";
import { useUserStore } from "@/lib/userStore";
import { useAppContext } from "@/layouts/MainLayout";
import { GraphMemoryPanel } from "@/features/memory/GraphMemoryPanel";
import type { MemoryConfig } from "@/lib/learnerMemoryApi";
import { summarizeTopicProgress, type TopicProgressSummary } from "@/lib/learningProgress";

type LoadState<T> = { status: "loading" } | { status: "error" } | { status: "ready"; data: T };
type ProfileProps = { agentId: string; courseName: string; userId: string; onClose: () => void; memoryConfig?: MemoryConfig | null; progressRevision?: number };
type Observation = { text: string; sources: string[] };
const panelClass = "rounded-xl border border-neutral-800 bg-neutral-950/20 p-4";
const headingClass = "text-[13px] font-semibold leading-5 text-neutral-200";
const mutedClass = "text-xs leading-5 text-neutral-400";
const actionClass = "h-9 rounded-lg text-[13px] leading-5 focus-visible:ring-2 focus-visible:ring-neutral-400";
const instructionSuggestions = [
  { label: "Step by step", text: "Guide me one step at a time and let me try before moving on." },
  { label: "Everyday examples", text: "Use familiar, real-world examples and connect them to the underlying concept." },
  { label: "Check understanding", text: "Ask me a short question to check my understanding before introducing the next idea." },
  { label: "Hints first", text: "When I am stuck, give me a small hint before showing a full explanation." },
  { label: "Clear language", text: "Use clear, simple language and explain unfamiliar terms when you first introduce them." },
];

function ProgressEntries({ title, entries, concepts = false }: {
  title: string;
  entries: [string, LearnerProgressItem][];
  concepts?: boolean;
}) {
  if (!entries.length) return null;
  return (
    <details className="group rounded-xl border border-neutral-800">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-[13px] font-medium leading-5 text-neutral-300 transition-colors hover:bg-neutral-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 [&::-webkit-details-marker]:hidden">
        <span className="flex-1">{title}</span>
        <span className="text-xs text-neutral-500">{entries.length}</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="divide-y divide-neutral-800 border-t border-neutral-800 px-4">
        {entries.map(([name, entry]) => {
          const learned = entry.status === "learned";
          const started = entry.status === "in_progress";
          const StatusIcon = learned ? Check : started ? CircleDot : Circle;
          const label = learned ? concepts ? "Crossed" : "Learned" : started ? "In progress" : "Not started";
          const tone = learned ? "text-neutral-200" : started ? "text-neutral-400" : "text-neutral-500";
          return (
            <li key={name} className="flex items-start gap-2.5 py-3">
              <StatusIcon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
              <div className="min-w-0 flex-1">
                <p className="break-words text-[13px] leading-5 text-neutral-200">{name}</p>
                {entry.module && <p className="mt-0.5 break-words text-xs text-neutral-500">{entry.module}</p>}
                {entry.latest_summary && <p className="mt-1 break-words text-xs leading-relaxed text-neutral-400">{entry.latest_summary}</p>}
                <p className={`mt-1 text-xs ${tone}`}>{label}</p>
                {!!entry.misconceptions_addressed?.length && (
                  <div className="mt-2">
                    <p className="text-xs text-neutral-400">Addressed misconceptions</p>
                    <ul className="mt-1 list-inside list-disc text-xs text-neutral-500">
                      {entry.misconceptions_addressed.map((item, index) => <li key={index} className="break-words">{item}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function ProgressOverview({ progress, topicSummary }: { progress: LearnerLearningProgress | null; topicSummary: TopicProgressSummary | null }) {
  const concepts = progress?.threshold_concepts ? Object.values(progress.threshold_concepts) : null;
  const crossed = concepts?.filter(entry => entry.status === "learned").length ?? 0;
  const percent = topicSummary?.total ? topicSummary.percent : null;
  return (
    <section aria-labelledby="learner-progress-label" className={panelClass}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="learner-progress-label" className={headingClass}>Progress</h2>
          <p className={`mt-1 ${mutedClass}`}>
            {percent !== null && topicSummary
              ? `${topicSummary.learned} of ${topicSummary.total} topics completed`
              : progress && topicSummary === null
                ? "Topic progress is not available for this TA."
                : "No progress recorded yet. Your tracked topics will appear here as you learn."}
          </p>
        </div>
        {percent !== null && <span className="shrink-0 text-2xl font-semibold leading-8 tracking-tight tabular-nums text-neutral-100">{percent}%</span>}
      </div>
      {percent !== null && topicSummary && (
        <div className="mt-3">
          <div role="progressbar" aria-label="Course topic progress" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={percent} aria-valuetext={`${topicSummary.learned} of ${topicSummary.total} topics completed`}
            className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full rounded-full bg-neutral-300 transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-5 text-neutral-400">
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-neutral-400" />{topicSummary.inProgress} in progress</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full border border-neutral-500" />{topicSummary.notStarted} not started</span>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-col gap-1 border-t border-neutral-800 pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h3 className={headingClass}>Threshold concepts</h3>
        <p className={mutedClass}>
          {concepts ? `${crossed} of ${concepts.length} threshold concepts crossed` : "Threshold concept progress is not recorded yet."}
        </p>
      </div>
      <p className={`mt-2 ${mutedClass}`}>Based on your TA's recorded progress, not message counts.</p>
    </section>
  );
}

function TopicsCovered({ summary, unavailable }: { summary: TopicProgressSummary | null; unavailable: boolean }) {
  return (
    <section aria-label="Topics covered" className={`${panelClass} space-y-3`}>
      <div className="flex items-center gap-2">
        <h2 className={headingClass}>Topics covered</h2>
        {!!summary?.coveredTopics.length && <span className="rounded-md bg-neutral-800 px-1.5 text-xs leading-5 tabular-nums text-neutral-400">{summary.coveredTopics.length}</span>}
      </div>
      {summary?.coveredTopics.length ? (
        <>
          <p className={mutedClass}>Learned and in-progress topics from Your progress. In-progress topics are not counted as completed.</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {summary.coveredTopics.map(topic => {
              const learned = topic.status === "learned";
              const StatusIcon = learned ? Check : CircleDot;
              return (
                <li key={topic.name} className="flex min-w-0 items-start gap-2 rounded-lg bg-neutral-800/50 px-3 py-2 text-[13px] leading-5 text-neutral-300">
                  <StatusIcon aria-hidden="true" className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${learned ? "text-neutral-200" : "text-neutral-400"}`} />
                  <div className="min-w-0">
                    <p className="break-words">{topic.name}</p>
                    <p className="text-xs leading-5 text-neutral-400">{learned ? "Learned" : "In progress"}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : <p className={mutedClass}>{unavailable ? "Covered topics are not available for this TA." : "No topics covered yet. Topics will appear here when your TA records progress."}</p>}
    </section>
  );
}

function Tags({ title, items, empty, description }: { title: string; items: string[]; empty: string; description?: string }) {
  return (
    <section aria-label={title} className={`${panelClass} space-y-3`}>
      <div className="flex items-center gap-2">
        <h2 className={headingClass}>{title}</h2>
        {!!items.length && <span className="rounded-md bg-neutral-800 px-1.5 text-xs leading-5 tabular-nums text-neutral-400">{items.length}</span>}
      </div>
      {items.length ? (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {items.map(item => (
            <li key={item} className="flex min-w-0 items-start gap-2 rounded-lg bg-neutral-800/50 px-3 py-2 text-[13px] leading-5 text-neutral-300">
              <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-500" />
              <span className="min-w-0 break-words">{item}</span>
            </li>
          ))}
        </ul>
      ) : <p className={mutedClass}>{empty}</p>}
      {description && <p className={mutedClass}>{description}</p>}
    </section>
  );
}

function observationsFrom(progress: LearnerLearningProgress | null): Observation[] {
  const observations = new Map<string, Observation>();
  const add = (text: string | null | undefined, source: string) => {
    const trimmed = text?.trim();
    if (!trimmed) return;
    const existing = observations.get(trimmed);
    if (existing) existing.sources.push(source);
    else observations.set(trimmed, { text: trimmed, sources: [source] });
  };
  for (const [name, entry] of Object.entries(progress?.topics ?? {})) add(entry.latest_summary, `Topic: ${name}`);
  for (const [name, entry] of Object.entries(progress?.threshold_concepts ?? {})) {
    add(entry.latest_summary, `Threshold concept: ${name}`);
    for (const [misconception, note] of Object.entries(entry.misconception_notes ?? {})) {
      add(note.note, `Addressed misconception · ${name}: ${misconception}`);
    }
  }
  for (const [name, entry] of Object.entries(progress?.objectives ?? {})) add(entry.evidence, `Learning objective: ${name}`);
  return [...observations.values()];
}

function LearningStatus({ state, retry }: { state: LoadState<LearnerLearningSnapshot>; retry: () => void }) {
  if (state.status === "ready") return null;
  if (state.status === "loading") return (
    <p role="status" className={`flex items-center gap-2 ${panelClass} ${mutedClass}`}>
      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Loading your learning data...
    </p>
  );
  return (
    <div className="space-y-2 rounded-xl border border-red-400/20 bg-red-400/5 p-4">
      <p role="alert" className="text-[13px] leading-5 text-red-300">Could not load your learning data. Progress and memory are unavailable.</p>
      <Button size="sm" variant="ghost" className={actionClass} onClick={retry}>Retry learning data</Button>
    </div>
  );
}

export function LearnerProfileDialog(props: ProfileProps) {
  const currentUserId = useUserStore(state => state.userId);
  if (currentUserId !== props.userId) return null;
  return <ScopedLearnerProfile key={`${props.userId}:${props.agentId}`} {...props} />;
}

function ScopedLearnerProfile({ agentId, courseName, userId, onClose, memoryConfig, progressRevision = 0 }: ProfileProps) {
  const { setPendingInputText } = useAppContext();
  const [tab, setTab] = useState("overview");
  const graphEnabled = Boolean(memoryConfig?.enabled && memoryConfig.mode !== "off");
  const authoritative = graphEnabled && memoryConfig?.mode === "authoritative";
  const [profile, setProfile] = useState<LoadState<LearnerProfile>>({ status: "loading" });
  const [learning, setLearning] = useState<LoadState<LearnerLearningSnapshot>>({ status: "loading" });
  const [instructions, setInstructions] = useState("");
  const [profileRequest, setProfileRequest] = useState(0);
  const [learningRequest, setLearningRequest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const memoryDetails = useRef<HTMLElement>(null);
  const scrollContent = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const isCurrent = useCallback(() => mounted.current && useUserStore.getState().userId === userId, [userId]);
  const hasChanges = profile.status === "ready" && instructions !== profile.data.customInstructions;
  const showSave = tab === "learning" || hasChanges || saving || saveError;
  const progress = learning.status === "ready" ? learning.data.progress : null;
  const topics = Object.entries(progress?.topics ?? {});
  const topicSummary = summarizeTopicProgress(progress?.topics);
  const concepts = Object.entries(progress?.threshold_concepts ?? {});
  const focuses = topics.filter(([, entry]) => entry.status === "in_progress").sort((a, b) => {
    const touched = (entry: LearnerProgressItem) => Date.parse(entry.last_touched ?? "") || 0;
    return touched(b[1]) - touched(a[1]);
  });
  const nextTopic = focuses[0]?.[0];
  const observations = observationsFrom(progress);
  const hasEvidenceCollections = progress !== null && Object.values(progress).every(collection => collection !== null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getLearnerProfile().then(data => {
      if (cancelled || !isCurrent()) return;
      setProfile({ status: "ready", data });
      setInstructions(data.customInstructions);
      useChatStore.setState({ userCustomInstructions: data.customInstructions });
    }).catch(() => {
      if (!cancelled && isCurrent()) setProfile({ status: "error" });
    });
    return () => { cancelled = true; };
  }, [profileRequest, isCurrent]);

  useEffect(() => {
    if (authoritative) {
      setLearning({ status: "ready", data: { user_id: userId, agent_id: agentId, status: "no_state", progress: null, learning_preferences: [] } });
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLearning({ status: "loading" });
    chatApi.getLearnerLearning(agentId, userId, controller.signal).then(data => {
      if (!cancelled && isCurrent()) setLearning({ status: "ready", data });
    }).catch(() => {
      if (!cancelled && isCurrent()) setLearning({ status: "error" });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [agentId, userId, learningRequest, progressRevision, isCurrent, authoritative]);

  useEffect(() => {
    if (memoryOpen) memoryDetails.current?.focus();
  }, [memoryOpen]);

  const retryLearning = () => {
    setLearning({ status: "loading" });
    setLearningRequest(value => value + 1);
  };
  const close = () => {
    if (saving) return;
    if (hasChanges) setConfirmDiscard(true);
    else onClose();
  };
  const practice = () => {
    if (!nextTopic || hasChanges || saving || !isCurrent()) return;
    setPendingInputText(`Help me practice "${nextTopic}".`);
    onClose();
  };
  const save = async () => {
    if (saving || !hasChanges || !isCurrent()) return;
    const submitted = instructions;
    setSaving(true);
    setSaveError(false);
    try {
      const data = await updateLearnerProfile(submitted);
      if (!isCurrent()) return;
      if (data.customInstructions !== submitted || !data.updatedAt?.trim()) {
        throw new Error("Instruction save was not acknowledged");
      }
      useChatStore.setState({ userCustomInstructions: data.customInstructions });
      setProfile({ status: "ready", data });
      setInstructions(data.customInstructions);
      toast.success("Default instructions saved.");
    } catch {
      if (isCurrent()) setSaveError(true);
    } finally {
      if (isCurrent()) setSaving(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={open => { if (!open) close(); }}>
        <DialogContent className="flex h-[min(42rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-[640px] flex-col gap-0 overflow-hidden rounded-2xl border-neutral-800 bg-neutral-900 p-0 text-[13px] leading-5 text-neutral-200 shadow-2xl sm:rounded-2xl [--ring:0_0%_64%]">
          <DialogHeader className="shrink-0 space-y-1 px-4 pb-4 pt-4 pr-32 text-left sm:px-5 sm:pr-32">
            <DialogTitle className="text-lg font-semibold leading-6 tracking-tight text-neutral-100">Learner profile</DialogTitle>
            <DialogDescription className="text-xs leading-5 text-neutral-400">Your progress, learning preferences and recorded memory.</DialogDescription>
          </DialogHeader>
          <Button size="sm" variant="ghost" aria-label="Refresh progress" title="Refresh progress, preferences and memory"
            disabled={learning.status === "loading"}
            aria-busy={learning.status === "loading"}
            className="absolute right-12 top-4 h-7 rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 text-xs leading-4 text-neutral-400 hover:bg-neutral-700 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-400"
            onClick={retryLearning}>
            Refresh
          </Button>

          <Tabs value={tab} onValueChange={value => { setTab(value); scrollContent.current?.scrollTo({ top: 0 }); }} className="flex min-h-0 flex-1 flex-col">
            <TabsList aria-label="Learner profile sections" className="mx-4 grid h-10 shrink-0 grid-cols-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-1 text-neutral-400 sm:mx-5">
              {["Overview", "Learning", "Memory"].map(name => (
                <TabsTrigger key={name} value={name.toLowerCase()}
                  className="h-full min-w-0 text-[13px] leading-5 text-neutral-400 hover:text-neutral-200 focus-visible:ring-1 focus-visible:ring-neutral-400 focus-visible:ring-offset-0 data-[state=active]:bg-neutral-800 data-[state=active]:text-neutral-100 data-[state=active]:shadow-sm">
                  {name}
                </TabsTrigger>
              ))}
            </TabsList>
            <div ref={scrollContent} data-testid="learner-profile-scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-gutter:stable] sm:px-5">
              <TabsContent value="overview" className="m-0 space-y-3 focus-visible:ring-neutral-400 focus-visible:ring-offset-neutral-900">
                {authoritative && memoryConfig ? <GraphMemoryPanel key={`overview:${learningRequest}`} agentId={agentId} studentId={userId} config={memoryConfig} /> : <LearningStatus state={learning} retry={retryLearning} />}
                {!authoritative && learning.status === "ready" && (
                  <>
                    <ProgressOverview progress={progress} topicSummary={topicSummary} />
                    <section aria-labelledby="learner-next-label" className={panelClass}>
                      <h2 id="learner-next-label" className={headingClass}>Next recommended</h2>
                      {nextTopic ? (
                        <>
                          <p className={`mb-3 mt-1 ${mutedClass}`}>Pick up where you left off. This opens a draft; nothing is sent automatically.</p>
                          <Button variant="outline" onClick={practice} disabled={hasChanges || saving}
                            className={`${actionClass} h-auto min-h-9 w-full justify-between gap-3 whitespace-normal border-neutral-700/70 bg-neutral-800/60 px-3 py-2 text-left text-neutral-200 shadow-none hover:bg-neutral-800 hover:text-white`}>
                            <span className="min-w-0 flex-1 break-words">Practice {nextTopic}</span>
                            <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0" />
                          </Button>
                          {hasChanges && <p className={`mt-2 ${mutedClass}`}>Save or discard your instruction edits before starting practice.</p>}
                        </>
                      ) : <p className={`mt-2 ${mutedClass}`}>No practice recommendation is available until a topic is recorded as in progress.</p>}
                    </section>
                    <TopicsCovered summary={topicSummary} unavailable={progress !== null && progress.topics === null} />
                  </>
                )}
              </TabsContent>

              <TabsContent value="learning" className="m-0 space-y-3 focus-visible:ring-neutral-400 focus-visible:ring-offset-neutral-900">
                {authoritative && <p className={mutedClass}>Assessed strengths, diagnostic gaps and the server-derived learning profile are shown in Overview and Memory. Your instructions below are preferences, not mastery evidence.</p>}
                {!authoritative && <LearningStatus state={learning} retry={retryLearning} />}
                <section aria-labelledby="learner-instructions-label" className={`${panelClass} space-y-3`}>
                  <div>
                    <h2 id="learner-instructions-label" className={headingClass}>Custom instructions</h2>
                    <label htmlFor="learner-instructions" className="sr-only">Default instructions</label>
                    <p id="learner-instructions-help" className={`mt-1 ${mutedClass}`}>
                      Tell your TAs how you like to learn. Saved instructions apply across your courses, starting with your next message.
                    </p>
                  </div>
                  {profile.status === "loading" ? (
                    <p role="status" className={`flex items-center gap-2 py-4 ${mutedClass}`}>
                      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Loading your instructions...
                    </p>
                  ) : profile.status === "error" ? (
                    <div className="space-y-2 rounded-xl border border-red-400/20 bg-red-400/5 p-4">
                      <p role="alert" className="text-[13px] leading-5 text-red-300">Could not load your instructions. Please try again.</p>
                      <Button size="sm" variant="ghost" className={actionClass} onClick={() => { setProfile({ status: "loading" }); setProfileRequest(value => value + 1); }}>
                        Retry instructions
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div role="group" aria-label="Suggested default instructions" className="space-y-2">
                        <p className="text-xs font-medium text-neutral-300">Suggested defaults</p>
                        <div className="flex flex-wrap gap-1.5">
                          {instructionSuggestions.map(suggestion => {
                            const added = instructions.includes(suggestion.text);
                            return (
                              <Button key={suggestion.label} type="button" size="sm" variant="outline"
                                disabled={saving || added}
                                title={added ? "Already in your draft" : suggestion.text}
                                className="h-auto min-h-8 whitespace-normal rounded-lg border-neutral-700/70 bg-neutral-800/40 px-2.5 py-1.5 text-xs leading-4 text-neutral-300 shadow-none hover:bg-neutral-800 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-400"
                                onClick={() => {
                                  setInstructions(current => `${current}${current && !current.endsWith("\n") ? "\n" : ""}${suggestion.text}`);
                                  setSaveError(false);
                                }}>
                                {added && <Check aria-hidden="true" className="h-3 w-3 shrink-0" />}
                                {suggestion.label}
                              </Button>
                            );
                          })}
                        </div>
                        <p id="learner-instructions-suggestions-help" className={mutedClass}>
                          Choose one or more to add to your draft. Edit them below, then save to apply.
                        </p>
                      </div>
                      <Textarea id="learner-instructions" aria-describedby="learner-instructions-help learner-instructions-suggestions-help"
                        value={instructions} onChange={event => { setInstructions(event.target.value); setSaveError(false); }}
                        disabled={saving} rows={5}
                        placeholder="For example: Explain step by step, use everyday examples, and ask me a quick question before moving on."
                        className="min-h-32 resize-y rounded-lg border-neutral-700/70 bg-neutral-950/40 px-3 py-2.5 text-[13px] leading-6 text-neutral-200 shadow-none placeholder:text-neutral-500 focus-visible:ring-1 focus-visible:ring-neutral-400" />
                      <p className={mutedClass}>Leave this blank and save to remove your default instructions.</p>
                    </>
                  )}
                </section>
                {!authoritative && learning.status === "ready" && (
                  <>
                    <Tags title="Learning preferences" items={learning.data.learning_preferences}
                      empty="No learning preferences saved." description="Only saved account preferences appear here; instruction drafts do not create tags." />
                    <Tags title="Strengths" items={topics.filter(([, entry]) => entry.status === "learned").map(([name]) => name)}
                      empty={progress && progress.topics === null ? "Strengths are unavailable without recorded topics." : "No strengths recorded yet."}
                      description="Topics your TA has recorded as learned." />
                    <Tags title="Focus areas" items={[...new Set([
                      ...focuses.map(([name]) => name),
                      ...concepts.filter(([, entry]) => entry.status === "in_progress").map(([name]) => name),
                    ])]} empty="No focus areas recorded yet." description="Topics and threshold concepts currently in progress." />
                  </>
                )}
              </TabsContent>

              <TabsContent value="memory" className="m-0 space-y-3 focus-visible:ring-neutral-400 focus-visible:ring-offset-neutral-900">
                {graphEnabled && memoryConfig ? <GraphMemoryPanel key={`memory:${learningRequest}`} agentId={agentId} studentId={userId} config={memoryConfig} /> : <>
                <h2 className={headingClass}>Learning memory</h2>
                <LearningStatus state={learning} retry={retryLearning} />
                {learning.status === "ready" && (
                  <>
                    <dl className="grid grid-cols-2 gap-2.5">
                      {[
                        ["Active misconceptions", null],
                        ["Concepts developing", progress?.threshold_concepts ? concepts.filter(([, entry]) => entry.status === "in_progress").length : null],
                        ["Threshold concepts crossed", progress?.threshold_concepts ? concepts.filter(([, entry]) => entry.status === "learned").length : null],
                        ["Evidence observations", hasEvidenceCollections ? observations.length : null],
                      ].map(([label, value]) => (
                        <div key={label} role="group" aria-label={String(label)} className={`${panelClass} flex flex-col justify-between gap-2`}>
                          <dt className="text-xs leading-5 text-neutral-400">{label}</dt>
                          <dd className={`flex min-h-8 items-center ${value === null ? "text-[13px] leading-5 text-neutral-400" : "text-2xl font-semibold leading-8 tracking-tight tabular-nums text-neutral-100"}`}>
                            {value ?? "Unavailable"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <div className="space-y-1.5 px-1">
                      <p className={mutedClass}>Active misconceptions are not tracked. Addressed misconceptions are not counted as active.</p>
                      <p className={mutedClass}>Observations are unique saved summaries and notes from this TA's progress record, not a complete conversation history.</p>
                      {progress && !hasEvidenceCollections && (
                        <p className={mutedClass}>Some progress collections are unavailable, so an observation total cannot be confirmed.</p>
                      )}
                    </div>
                    <Button variant="outline" aria-expanded={memoryOpen} aria-controls="learner-memory-details"
                      className={`${actionClass} w-full justify-between border-neutral-700/70 bg-neutral-800/40 px-3 text-neutral-300 shadow-none hover:bg-neutral-800 hover:text-neutral-100`}
                      onClick={() => setMemoryOpen(value => !value)}>
                      {memoryOpen ? "Hide learning memory" : "View learning memory"}
                      <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform motion-reduce:transition-none ${memoryOpen ? "rotate-180" : ""}`} />
                    </Button>
                    {memoryOpen && (
                      <section id="learner-memory-details" aria-labelledby="learner-memory-heading" tabIndex={-1} ref={memoryDetails}
                        className="space-y-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400">
                        <h3 id="learner-memory-heading" className={headingClass}>Recorded learning memory</h3>
                        <p className={`${mutedClass} break-words`}>{courseName} · This learner and TA only</p>
                        {!topics.length && !concepts.length && !observations.length && (
                          <p className={`${panelClass} ${mutedClass}`}>No learning memory recorded for this TA yet.</p>
                        )}
                        <ProgressEntries title="Topics" entries={topics} />
                        <ProgressEntries title="Threshold concepts" entries={concepts} concepts />
                        <h4 className={headingClass}>Evidence observations</h4>
                        {observations.length ? (
                          <ol className="space-y-3">
                            {observations.map(observation => (
                              <li key={observation.text} className={panelClass}>
                                <p className="break-words text-[13px] leading-5 text-neutral-300">{observation.text}</p>
                                <ul className="mt-2 space-y-1">
                                  {observation.sources.map(source => <li key={source} className={`break-words ${mutedClass}`}>{source}</li>)}
                                </ul>
                              </li>
                            ))}
                          </ol>
                        ) : <p className={mutedClass}>No evidence observations recorded yet.</p>}
                      </section>
                    )}
                  </>
                )}
                </>}
              </TabsContent>
            </div>
          </Tabs>
          <div className="shrink-0 border-t border-neutral-800 bg-neutral-950/30 px-4 py-3 sm:px-5">
            {saveError && <p role="alert" className="mb-3 text-[13px] leading-5 text-red-300">Could not save your instructions. Your edits are still here; please try again.</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span role="status" className="mr-auto text-xs leading-5 text-neutral-400">{saving ? "Saving..." : hasChanges ? "Unsaved changes" : ""}</span>
              <Button variant="ghost" disabled={saving} onClick={close}
                className={`${actionClass} px-3 text-neutral-300 hover:bg-neutral-800 hover:text-white`}>Done</Button>
              {showSave && <Button disabled={profile.status !== "ready" || !hasChanges || saving} onClick={() => void save()}
                className={`${actionClass} border border-transparent bg-neutral-200 px-3 text-neutral-950 shadow-none hover:bg-white disabled:border-neutral-700/60 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:opacity-100`}>
                {saving && <Loader2 aria-hidden="true" className="animate-spin" />}
                Save instructions
              </Button>}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent className="w-[92vw] rounded-xl border-neutral-700 bg-neutral-900 text-neutral-200">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved instructions?</AlertDialogTitle>
            <AlertDialogDescription className="text-neutral-400">Your saved instructions will stay unchanged.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-neutral-700 bg-neutral-800 hover:bg-neutral-700">Keep editing</AlertDialogCancel>
            <AlertDialogAction className="bg-red-500 text-white hover:bg-red-400" onClick={onClose}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
