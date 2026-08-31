import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, Brain, MessageSquare, FileText, Target, Lightbulb, Users, Library, Search, Sparkles, BookOpen, Code, Box, Filter, FolderOpen, Download } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { CreateButton } from "@/components/ui/CreateButton";
import { SectionScrollRail } from "@/components/common/SectionScrollRail";

export function LearnPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to hash section on mount
  useEffect(() => {
    const hash = location.hash.replace("#", "");
    if (hash) {
      setTimeout(() => {
        const el = document.getElementById(hash);
        if (el && scrollRef.current) {
          const top = el.offsetTop - 80;
          scrollRef.current.scrollTo({ top, behavior: "smooth" });
        }
      }, 100);
    }
  }, [location.hash]);

  const sections = [
    { id: "what-is-shiksha", label: "Overview" },
    { id: "how-it-works", label: "How it works" },
    { id: "key-features", label: "Key features" },
    { id: "why-agents", label: "Why agents" },
    { id: "capabilities", label: "Capabilities" },
    { id: "agent-library", label: "Agent Library" },
    { id: "assets", label: "Assets" },
  ];

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setIsScrolled(el.scrollTop > 10);

    // Find which section is most visible
    const sectionEls = sections.map(s => document.getElementById(s.id));
    const scrollTop = el.scrollTop + 120;
    let current = 0;
    sectionEls.forEach((sec, i) => {
      if (sec && sec.offsetTop <= scrollTop) {
        current = i;
      }
    });
    setActiveSection(current);
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el && scrollRef.current) {
      const top = el.offsetTop - 80;
      scrollRef.current.scrollTo({ top, behavior: "smooth" });
    }
  };

  const features = [
    {
      icon: Brain,
      title: "AI-Powered Learning",
      description: "Get personalized explanations and adaptive learning paths tailored to your understanding level."
    },
    {
      icon: MessageSquare,
      title: "Interactive Conversations",
      description: "Ask questions, explore concepts, and have meaningful discussions with your teaching assistant."
    },
    {
      icon: FileText,
      title: "Document Understanding",
      description: "Upload course materials and let the AI help you understand complex topics from your syllabus."
    },
    {
      icon: Target,
      title: "Focused Practice",
      description: "Get targeted practice questions and explanations to reinforce your understanding."
    },
    {
      icon: Lightbulb,
      title: "Concept Exploration",
      description: "Dive deep into any topic with guided exploration and connected concepts."
    },
    {
      icon: Users,
      title: "Multi-Course Support",
      description: "Create separate agents for different courses to keep your learning organized."
    }
  ];

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      {/* Header with Back and Create - fixed at top */}
      <PageHeader
        showBorder={isScrolled}
        sticky={false}
        leftContent={
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-sm font-medium text-neutral-400 hover:text-white transition-all duration-300 px-5 py-1.5 rounded-lg border border-neutral-700 hover:border-neutral-600 hover:bg-neutral-800/50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        }
      >
        <CreateButton onClick={() => navigate("/create")} />
      </PageHeader>

      {/* Scrollable content */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto relative"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        onScroll={handleScroll}
      >
        {/* Section scroll nav - right side */}
        <SectionScrollRail
          items={sections}
          activeIndex={activeSection}
          onSelect={(index) => scrollToSection(sections[index].id)}
          ariaLabel="Page sections"
          className="fixed right-4 top-1/2 z-30 -translate-y-1/2"
        />

        {/* Hero */}
        <div id="what-is-shiksha" className="w-full px-8 md:px-16 lg:px-24 pt-16 pb-12">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-semibold text-white tracking-tight">
            What is Shiksha?
          </h1>
          <p className="mt-4 text-[15px] text-neutral-400 leading-relaxed">
            Shiksha is an AI-powered tutoring platform that enables educators to create personalized learning agents for any subject. Upload your course materials — PDFs, documents, question banks — and Shiksha builds an intelligent tutor that understands your curriculum.
          </p>
        </div>
      </div>

      {/* How it works */}
      <div id="how-it-works" className="w-full px-8 md:px-16 lg:px-24 pb-12">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold text-white mb-6">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 rounded-xl border border-neutral-800 bg-neutral-800/30 shadow-lg shadow-black/20">
              <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-neutral-800 border border-neutral-700 text-xs font-medium text-neutral-300 mb-3">1</span>
              <p className="text-sm font-medium text-neutral-200">Create an agent</p>
              <p className="text-xs text-neutral-500 mt-1.5 leading-relaxed">Define your course name, level, duration, and description.</p>
            </div>
            <div className="p-5 rounded-xl border border-neutral-800 bg-neutral-800/30 shadow-lg shadow-black/20">
              <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-neutral-800 border border-neutral-700 text-xs font-medium text-neutral-300 mb-3">2</span>
              <p className="text-sm font-medium text-neutral-200">Upload course materials</p>
              <p className="text-xs text-neutral-500 mt-1.5 leading-relaxed">Add learning materials, exam papers, question banks, and reference URLs.</p>
            </div>
            <div className="p-5 rounded-xl border border-neutral-800 bg-neutral-800/30 shadow-lg shadow-black/20">
              <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-neutral-800 border border-neutral-700 text-xs font-medium text-neutral-300 mb-3">3</span>
              <p className="text-sm font-medium text-neutral-200">Start learning</p>
              <p className="text-xs text-neutral-500 mt-1.5 leading-relaxed">Chat with your personalized AI tutor that understands your specific course content.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Key features */}
      <div id="key-features" className="w-full px-8 md:px-16 lg:px-24 pb-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold text-white mb-6">Key features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              "Personalized AI tutors built from your own course materials",
              "Support for PDFs, documents, question banks, and web resources",
              "Separate learning and exam preparation agents",
              "Deep research capabilities for complex topics",
              "Multi-modal support including image-based interactions",
            ].map((feature) => (
              <div key={feature} className="flex items-start gap-3 p-3.5 rounded-lg border border-neutral-800/60 bg-neutral-800/20 shadow-lg shadow-black/20">
                <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-neutral-500 shrink-0" />
                <span className="text-sm text-neutral-400">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Why Use Teaching Assistants */}
      <div id="why-agents" className="w-full px-8 md:px-16 lg:px-24 pb-12">
        <div className="max-w-4xl mx-auto">
          <div className="bg-neutral-800/30 border border-neutral-700/40 rounded-2xl p-8 shadow-lg shadow-black/20">
            <h3 className="text-lg font-semibold text-white mb-4">Why Use Teaching Assistants?</h3>
            <p className="text-sm text-neutral-400 leading-relaxed mb-4">
              Traditional learning often leaves students struggling with complex concepts on their own. Teaching Assistants bridge this gap by providing instant, personalized explanations tailored to your specific course materials. Whether you're preparing for exams, working through homework, or simply trying to understand a difficult topic, your AI companion is always ready to help.
            </p>
            <p className="text-sm text-neutral-400 leading-relaxed">
              Unlike generic AI tools, Teaching Assistants are trained on your actual syllabus and study materials. This means every answer, example, and explanation is relevant to what you're learning in class. Think of it as having a knowledgeable study partner who's available 24/7 and never gets tired of explaining things in different ways until you truly understand.
            </p>
          </div>
        </div>
      </div>

      {/* What Can Teaching Assistants Do - Features Grid */}
      <div id="capabilities" className="w-full px-8 md:px-16 lg:px-24 pb-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold text-white mb-6">What Can Teaching Assistants Do?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((feature, index) => (
              <div
                key={index}
                className="p-5 rounded-xl border border-neutral-800 bg-neutral-800/30 shadow-lg shadow-black/20 hover:bg-neutral-800/50 hover:border-neutral-700 transition-all duration-200"
              >
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-neutral-700/50 mb-3">
                  <feature.icon className="w-5 h-5 text-neutral-300" />
                </div>
                <h3 className="text-sm font-medium text-neutral-200 mb-1.5">
                  {feature.title}
                </h3>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Agent Library Section */}
      <div id="agent-library" className="w-full px-8 md:px-16 lg:px-24 pb-16">
        <div className="max-w-4xl mx-auto">
          <div className="bg-neutral-800/30 border border-neutral-700/40 rounded-2xl p-8 shadow-lg shadow-black/20">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-neutral-700/50">
                  <Library className="w-4.5 h-4.5 text-neutral-300" />
                </div>
                <h3 className="text-base font-semibold text-white">Agent Library</h3>
              </div>
              <button
                onClick={() => navigate("/library")}
                className="px-4 h-9 bg-white hover:bg-neutral-200 text-neutral-900 font-medium text-sm rounded-lg transition-colors duration-200"
              >
                Explore
              </button>
            </div>
            <p className="text-sm text-neutral-400 leading-relaxed mb-6">
              The Agent Library is your central hub for discovering and managing all teaching assistants. Browse through available agents created by educators, search for specific subjects, and start learning instantly.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="flex items-start gap-3 p-4 rounded-xl border border-neutral-700/40 bg-neutral-800/40 shadow-lg shadow-black/20">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-700/50 shrink-0">
                  <Search className="w-4 h-4 text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-200">Search & Discover</p>
                  <p className="text-xs text-neutral-500 mt-1 leading-relaxed">Find agents by course name, subject, or topic. Filter to see only your created agents.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl border border-neutral-700/40 bg-neutral-800/40 shadow-lg shadow-black/20">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-700/50 shrink-0">
                  <Sparkles className="w-4 h-4 text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-200">Instant Chat</p>
                  <p className="text-xs text-neutral-500 mt-1 leading-relaxed">Click on any agent to start a conversation immediately. Use suggested prompts to get started quickly.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl border border-neutral-700/40 bg-neutral-800/40 shadow-lg shadow-black/20">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-700/50 shrink-0">
                  <BookOpen className="w-4 h-4 text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-200">Agent Preview</p>
                  <p className="text-xs text-neutral-500 mt-1 leading-relaxed">Preview agent details, descriptions, and conversation starters before beginning a session.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl border border-neutral-700/40 bg-neutral-800/40 shadow-lg shadow-black/20">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-700/50 shrink-0">
                  <Code className="w-4 h-4 text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-200">Edit & Customize</p>
                  <p className="text-xs text-neutral-500 mt-1 leading-relaxed">Modify your agents with simple or advanced editing modes. Update instructions, materials, and settings.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Assets Section */}
      <div id="assets" className="w-full px-8 md:px-16 lg:px-24 pb-16">
        <div className="max-w-4xl mx-auto">
          <div className="bg-neutral-800/30 border border-neutral-700/40 rounded-2xl p-8 shadow-lg shadow-black/20">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-neutral-700/50">
                  <Box className="w-4.5 h-4.5 text-neutral-300" />
                </div>
                <h3 className="text-base font-semibold text-white">Assets</h3>
              </div>
              <button
                onClick={() => navigate("/assets")}
                className="px-4 h-9 bg-white hover:bg-neutral-200 text-neutral-900 font-medium text-sm rounded-lg transition-colors duration-200"
              >
                Explore
              </button>
            </div>
            <p className="text-sm text-neutral-400 leading-relaxed mb-6">
              Assets are learning materials automatically generated during your chat sessions with teaching assistants. Quizzes, flashcards, code snippets, and documents are saved and organized for easy review.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-4 rounded-xl border border-neutral-700/40 bg-neutral-800/40 shadow-lg shadow-black/20">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-700/50 shrink-0">
                  <FileText className="w-4 h-4 text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-200">Auto-Generated Content</p>
                  <p className="text-xs text-neutral-500 mt-1 leading-relaxed">Quizzes, flashcards, code snippets, and documents are created automatically from your conversations.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl border border-neutral-700/40 bg-neutral-800/40 shadow-lg shadow-black/20">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-700/50 shrink-0">
                  <Filter className="w-4 h-4 text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-200">Filter by Type</p>
                  <p className="text-xs text-neutral-500 mt-1 leading-relaxed">Quickly find what you need by filtering assets by documents, quizzes, flashcards, or code.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl border border-neutral-700/40 bg-neutral-800/40 shadow-lg shadow-black/20">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-700/50 shrink-0">
                  <FolderOpen className="w-4 h-4 text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-200">Organized Collection</p>
                  <p className="text-xs text-neutral-500 mt-1 leading-relaxed">All your generated materials are stored in one place, organized across all your teaching assistants.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl border border-neutral-700/40 bg-neutral-800/40 shadow-lg shadow-black/20">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-700/50 shrink-0">
                  <Download className="w-4 h-4 text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-200">Review & Export</p>
                  <p className="text-xs text-neutral-500 mt-1 leading-relaxed">Review your saved assets anytime and export them for offline study or sharing with others.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
