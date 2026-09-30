// src/pages/OnboardingPage.tsx
// Step-by-step conversational onboarding for new users.

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useChatStore, flushUserProfileSync } from "@/lib/chatStore";
import { useUserStore } from "@/lib/userStore";
import { useShallow } from "zustand/react/shallow";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import confetti from "canvas-confetti";

// ─── Step definitions ────────────────────────────────────────────────
interface Step {
  id: string;
  question: (name?: string) => string;
  placeholder: string;
  multiline?: boolean;
  required?: boolean;
  readOnly?: boolean;            // for college / department confirmation
  readOnlyValues?: () => string; // computed display value for read-only steps
  hint?: string;
  skipLabel?: string;            // label shown on skip link (optional steps)
}

// ─── Component ───────────────────────────────────────────────────────
export function OnboardingPage() {
  const navigate = useNavigate();
  const userEmail = useUserStore((s) => s.email);
  const oauthDisplayName = useUserStore((s) => s.displayName);

  const {
    userFullName,
    userNickname,
    setUserFullName,
    setUserNickname,
    setUserLanguage,
    setUserCurrentLocation,
    setUserPassionateAbout,
    setUserPreferences,
    setOnboardingCompleted,
    setUserName,
  } = useChatStore(
    useShallow((s) => ({
      userFullName: s.userFullName,
      userNickname: s.userNickname,
      setUserFullName: s.setUserFullName,
      setUserNickname: s.setUserNickname,
      setUserLanguage: s.setUserLanguage,
      setUserCurrentLocation: s.setUserCurrentLocation,
      setUserPassionateAbout: s.setUserPassionateAbout,
      setUserPreferences: s.setUserPreferences,
      setOnboardingCompleted: s.setOnboardingCompleted,
      setUserName: s.setUserName,
    }))
  );

  // All answers keyed by step id
  const [answers, setAnswers] = React.useState<Record<string, string>>({
    preferredName: userNickname || "",
    language: "",
    location: "",
    passionateAbout: "",
    moreAboutMe: "",
  });

  const [step, setStep] = React.useState(0);
  const [animDir, setAnimDir] = React.useState<"forward" | "back">("forward");
  const [saving, setSaving] = React.useState(false);
  const [showName, setShowName] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const avatarRef = React.useRef<HTMLDivElement>(null);

  // Close name popover on outside click
  React.useEffect(() => {
    if (!showName) return;
    const handler = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setShowName(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showName]);

  // Focus the input whenever step changes
  React.useEffect(() => {
    // Small delay to let the transition finish so the element is mounted
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [step]);

  // Prefer userFullName from Cosmos; fall back to OAuth displayName from userStore
  const effectiveFullName = userFullName || oauthDisplayName || "";

  // Derive first name for personalised questions
  const firstName =
    answers.preferredName?.trim() ||
    effectiveFullName?.trim().split(" ")[0] ||
    "";



  const steps: Step[] = React.useMemo(
    () => [
      {
        id: "preferredName",
        question: () => "Hi there!\nWhat would you like me to call you?",
        placeholder: "A name or nickname you prefer",
        required: true,
      },
      {
        id: "location",
        question: (n) => `${n || "Hey"},\nWhat is your hometown?`,
        placeholder: "e.g. Bengaluru, Mumbai, Hyderabad…",
        skipLabel: "Skip",
      },
      {
        id: "language",
        question: () =>
          "Besides English,\nWhich language do you speak the most?",
        placeholder: "e.g. Hindi, Kannada, Tamil, Telugu, Bengali…",
        skipLabel: "Skip",
      },
      {
        id: "moreAboutMe",
        question: (n) =>
          `What are you passionate about${n ? `, ${n}` : ""}?`,
        placeholder:
          "Describe a few things you love — passions, hobbies and interests…",
        multiline: true,
        skipLabel: "Skip & finish",
      },
    ],
    []
  );

  const current = steps[step];
  const isLast = step === steps.length - 1;
  const value = answers[current.id] ?? "";

  // ─── Typing hint effect for moreAboutMe ──────────────────────────
  const typingExamples = [
    "I'm passionate about outdoor activities and challenges such as kayaking, trekking, and endurance cycling.",
    "Music is a big part of my life, and I like spending time playing the guitar and keyboard.",
    "Cooking is my thing. I love experimenting with South Indian and Thai flavors, especially tempering and that sweet-spicy-sour balance.",
  ];
  const [typingHint, setTypingHint] = React.useState("");
  const [typingActive, setTypingActive] = React.useState(false);
  const typingIndexRef = React.useRef(0);

  React.useEffect(() => {
    // Only on the moreAboutMe step when the field is empty
    if (current.id !== "moreAboutMe" || value.trim()) {
      setTypingHint("");
      setTypingActive(false);
      return;
    }

    // Wait 3 seconds of idle before starting the typing animation
    const idleTimer = setTimeout(() => {
      setTypingActive(true);
    }, 3000);

    return () => {
      clearTimeout(idleTimer);
    };
  }, [current.id, value]);

  React.useEffect(() => {
    if (!typingActive) return;

    const example = typingExamples[typingIndexRef.current % typingExamples.length];
    let charIndex = 0;
    setTypingHint("");

    const pauseTimers: ReturnType<typeof setTimeout>[] = [];
    const typeInterval = setInterval(() => {
      charIndex++;
      setTypingHint(example.slice(0, charIndex));
      if (charIndex >= example.length) {
        clearInterval(typeInterval);
        // After a pause, clear and start the next example
        pauseTimers.push(setTimeout(() => {
          typingIndexRef.current++;
          setTypingHint("");
          setTypingActive(false);
          // Re-trigger after a brief gap
          pauseTimers.push(setTimeout(() => setTypingActive(true), 2000));
        }, 5000));
      }
    }, 50);

    return () => {
      clearInterval(typeInterval);
      // These outlive the interval; leaving them behind stacks a fresh animation
      // on top of the running one every time this effect re-runs.
      pauseTimers.forEach(clearTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typingActive]);

  // ─── Navigation helpers ──────────────────────────────────────────
  const goNext = () => {
    if (isLast) {
      finishOnboarding();
      return;
    }
    setAnimDir("forward");
    setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const goBack = () => {
    setAnimDir("back");
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleChange = (val: string) => {
    setAnswers((prev) => ({ ...prev, [current.id]: val }));
    // Stop typing hint as soon as user types
    if (typingActive) {
      setTypingActive(false);
      setTypingHint("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter submits for single-line, Ctrl+Enter for multiline
    if (e.key === "Enter" && (!current.multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (current.required && !value.trim()) return;
      goNext();
    }
  };

  const handleSkip = () => {
    // Clear the field and move on
    setAnswers((prev) => ({ ...prev, [current.id]: "" }));
    if (isLast) {
      finishOnboarding();
    } else {
      setAnimDir("forward");
      setStep((s) => s + 1);
    }
  };

  // ─── Party popper confetti ───────────────────────────────────────
  const fireConfetti = () => {
    const end = Date.now() + 800;
    const frame = () => {
      confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 0.7 } });
      confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.7 } });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  };

  // ─── Save & finish ──────────────────────────────────────────────
  const finishOnboarding = async () => {
    setSaving(true);
    fireConfetti();
    try {
      const a = answers;
      const nick = a.preferredName.trim() || userFullName?.trim().split(" ")[0] || "";
      setUserName(nick);
      setUserNickname(a.preferredName.trim());
      setUserLanguage(a.language.trim());
      setUserCurrentLocation(a.location.trim());
      setUserPassionateAbout(a.moreAboutMe.trim());
      setUserPreferences("");
      setOnboardingCompleted(true);

      // Flush profile sync to Cosmos DB before navigating
      // (prevents race condition where loadUserProfileFromBackend
      // on /home overwrites fresh data with stale backend values)
      await flushUserProfileSync();
      navigate("/home", { replace: true });
    } catch (err) {
      console.error("[Onboarding] Error saving profile:", err);
      setSaving(false);
    }
  };

  // ─── Initials avatar ────────────────────────────────────────────
  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name ? name.slice(0, 2).toUpperCase() : "";
  };

  const initials = getInitials(effectiveFullName);

  // ─── Progress ────────────────────────────────────────────────────
  const progress = ((step + 1) / steps.length) * 100;

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col relative select-none">
      {/* Thin progress bar */}
      <div className="h-0.5 bg-neutral-900 w-full">
        <div
          className="h-full bg-neutral-500 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Top-right user identity */}
      <div ref={avatarRef} className="absolute top-3 right-3">
        <button
          type="button"
          onClick={() => setShowName((prev) => !prev)}
          className="size-10 rounded-full bg-neutral-700 border border-neutral-600 flex items-center justify-center text-neutral-400 text-sm font-semibold cursor-pointer hover:bg-neutral-600 transition-colors"
        >
          {initials || "?"}
        </button>
        {showName && (
          <div className="absolute right-0 mt-2 flex items-center gap-3 px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-xl shadow-lg whitespace-nowrap animate-fadeInUp">
            <div className="size-10 rounded-full bg-neutral-700 border border-neutral-600 flex items-center justify-center text-neutral-300 text-sm font-semibold shrink-0">
              {initials || "?"}
            </div>
            <div>
              <div className="text-sm font-medium text-neutral-200">{effectiveFullName}</div>
              {userEmail && <div className="text-xs text-neutral-500 mt-0.5">{userEmail}</div>}
            </div>
          </div>
        )}
      </div>

      {/* Main content — vertically centered */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="flex items-center gap-14 w-full max-w-4xl">

          {/* Back button (left side) */}
          <div className="flex-shrink-0 w-20">
            {step > 0 && (
              <button
                type="button"
                onClick={goBack}
                className="size-20 rounded-xl bg-neutral-700 hover:bg-neutral-600 flex flex-col items-center justify-center gap-1 text-neutral-200 transition-colors"
              >
                <ChevronLeft className="size-7" />
                <span className="text-xs font-medium">Back</span>
              </button>
            )}
          </div>

          {/* Center content: question + input */}
          <div className="flex-1 min-w-0">
            {/* Question text — animated on change */}
            <h1
              key={`q-${step}`}
              className={`text-2xl md:text-3xl font-semibold text-white mb-5 leading-relaxed whitespace-pre-line
                ${animDir === "forward" ? "animate-slideInRight" : "animate-slideInLeft"}`}
            >
              {current.question(firstName)}
            </h1>

            {/* Input area — animated */}
            <div
              key={`input-${step}`}
              className={`${animDir === "forward" ? "animate-fadeInUp" : "animate-fadeInUp"}`}
            >
              {current.readOnly ? (
                /* Read-only confirmation (college / department) */
                <div>
                  <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl px-5 py-4 text-neutral-200 text-base">
                    {current.readOnlyValues?.() || "—"}
                  </div>
                  {current.hint && (
                    <p className="text-xs text-neutral-600 mt-2 ml-1">{current.hint}</p>
                  )}
                </div>
              ) : current.id === "preferredName" ? (
                /* Preferred name input */
                <div className="flex items-center bg-neutral-900/60 border border-neutral-800 rounded-xl overflow-hidden focus-within:border-neutral-700 transition-colors">
                  <input
                    ref={inputRef as React.RefObject<HTMLInputElement>}
                    type="text"
                    value={value}
                    onChange={(e) => handleChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={current.placeholder}
                    className="flex-1 bg-transparent px-5 py-4 text-neutral-100 placeholder:text-neutral-600 text-base outline-none select-text"
                  />
                </div>
              ) : current.multiline ? (
                /* Textarea input with typing hint overlay */
                <div className="relative">
                  <textarea
                    ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                    value={value}
                    onChange={(e) => handleChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={typingHint ? "" : current.placeholder}
                    rows={3}
                    className="w-full bg-neutral-900/60 border border-neutral-800 rounded-xl px-5 py-4 text-neutral-100 placeholder:text-neutral-600 text-base outline-none focus:border-neutral-700 transition-colors resize-none select-text relative z-10"
                  />
                  {typingHint && !value && (
                    <div className="absolute top-0 left-0 px-5 py-4 text-neutral-500 text-base pointer-events-none">
                      {typingHint}<span className="animate-pulse">|</span>
                    </div>
                  )}
                </div>
              ) : (
                /* Single-line input */
                <div className="flex items-center bg-neutral-900/60 border border-neutral-800 rounded-xl overflow-hidden focus-within:border-neutral-700 transition-colors">
                  <input
                    ref={inputRef as React.RefObject<HTMLInputElement>}
                    type="text"
                    value={value}
                    onChange={(e) => handleChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={current.placeholder}
                    className="flex-1 bg-transparent px-4 py-4 text-neutral-100 placeholder:text-neutral-600 text-base outline-none select-text"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Next button (right side) */}
          <div className="flex-shrink-0 w-20">
            {saving ? (
              <span className="flex items-center justify-center">
                <Loader2 className="size-7 animate-spin text-neutral-400" />
              </span>
            ) : (
              <button
                type="button"
                onClick={goNext}
                disabled={!value.trim()}
                className="size-20 rounded-xl bg-neutral-700 hover:bg-neutral-600 disabled:bg-neutral-800 disabled:text-neutral-600 flex flex-col items-center justify-center gap-1 text-neutral-200 transition-colors"
              >
                {isLast ? (
                  <span className="text-sm font-medium text-center leading-tight">Let's<br/>Go</span>
                ) : (
                  <>
                    <ChevronRight className="size-7" />
                    <span className="text-xs font-medium">Next</span>
                  </>
                )}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
