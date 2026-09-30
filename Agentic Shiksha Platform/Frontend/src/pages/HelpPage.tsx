import { useState } from "react";
import { ArrowLeft, BookOpen, MessageSquare, Upload, Brain, Search, ImageIcon, Globe, Shield, HelpCircle, Mail } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";

export function HelpPage() {
  const navigate = useNavigate();
  const [isScrolled, setIsScrolled] = useState(false);

  const faqs = [
    {
      question: "How do I create a new teaching assistant?",
      answer: "Click the \"Create\" button in the sidebar or on the home screen. Fill in the course details like name, level, and description, then upload your course materials such as PDFs, documents, or question banks."
    },
    {
      question: "What file types can I upload?",
      answer: "Shiksha supports PDFs, Word documents (.docx), PowerPoint presentations (.pptx), and plain text files. You can also add web URLs as reference material."
    },
    {
      question: "How does the Learning Profile work?",
      answer: "The Learning Profile lets you personalize your experience for each course. Set your knowledge level, learning goals, focus areas, and preferred learning style so the AI tutor adapts to your needs."
    },
    {
      question: "Can I have multiple conversations with the same agent?",
      answer: "Yes! Each teaching assistant supports multiple chat threads. Start a new conversation anytime from the course home page while keeping your previous chats accessible."
    },
    {
      question: "How do I edit and present a slide deck?",
      answer: "Ask a teaching assistant with the presentation capability to create slides, then open the presentation card. Use Edit presentation to change text, layouts, themes, speaker notes and sources, or add and reorder slides. Save copy to Assets keeps a private editable copy without replacing the original chat deck. Start presentation opens the slideshow; arrow keys navigate, B blanks the screen and Escape returns to the preview. Download PPTX exports to PowerPoint, while the editor's JSON import/export keeps a reusable backup. Shared chats support viewing and presenting only."
    },
    {
      question: "How can I make better presentations and have them read aloud?",
      answer: "Tell the TA your audience, learning goal, desired length and source material. Ask for a strong opening, useful process/timeline/comparison visuals, a discussion question and clear takeaways. Request a spoken slide/topic introduction plus a specific explanation for each bullet or highlighted component. Both scripts are saved in the presentation and can be reviewed in Edit presentation; its Presentation check flags missing scripts, crowded text and sources. Read aloud reads those exact saved notes in order and highlights their matching components, without generating a second script. You can explicitly choose Slide text instead, select an on-device voice and speed, pause or stop, and enable auto-advance. Missing scripts or voices are reported. PowerPoint files retain both levels of notes, but not recorded audio or in-app highlighting. Course owners can select Update slides in Course Info when an older TA needs the new contract."
    },
    {
      question: "Can presentations use Indian English or Hindi voices?",
      answer: "Yes. In a signed-in presentation, open Read aloud and choose Azure Indian voices. Neerja and Prabhat speak Indian English; Swara and Madhur speak Hindi. Selecting Play sends the chosen saved script to the configured Azure Speech resource and may incur speech usage charges. Scripts are not rewritten or translated, and component highlighting stays synchronized. Your administrator must configure Azure Speech and grant the backend access. On-device voices remain available without cloud processing, with Indian English preferred if installed. Shared public presentations use on-device voices only."
    },
    {
      question: "How do I delete a teaching assistant?",
      answer: "Open the course home page, click the three-dot menu in the top-right corner, and select \"Delete Agent\". This will permanently remove the agent and all associated data."
    },
    {
      question: "Is my data private and secure?",
      answer: "Yes. Your course materials and conversations are stored securely in your account. Each user's data is isolated and not shared with other users. Please review our Data Privacy Notice for more details."
    },
  ];

  const sections = [
    {
      icon: BookOpen,
      title: "Getting Started",
      items: [
        "Create your first teaching assistant from the sidebar",
        "Upload course materials (PDFs, documents, web URLs)",
        "Set your Learning Profile for personalized responses",
        "Start chatting with your AI tutor",
      ]
    },
    {
      icon: MessageSquare,
      title: "Chatting with Agents",
      items: [
        "Ask questions about your course content",
        "Request explanations at different difficulty levels",
        "Ask for practice problems and worked solutions",
        "Use follow-up questions to dive deeper into topics",
      ]
    },
    {
      icon: Upload,
      title: "Managing Materials",
      items: [
        "Upload additional files anytime via Edit Agent",
        "Add reference URLs for web-based content",
        "Remove outdated materials to keep the agent current",
        "The agent automatically indexes new materials",
      ]
    },
    {
      icon: Brain,
      title: "Tips for Best Results",
      items: [
        "Be specific in your questions for more targeted answers",
        "Set your knowledge level so explanations match your understanding",
        "Upload high-quality course materials for better responses",
        "Use separate agents for different courses to stay organized",
      ]
    },
  ];

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      {/* Header - fixed at top */}
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
      />

      {/* Scrollable content */}
      <div 
        className="flex-1 overflow-y-auto"
        onScroll={(e) => setIsScrolled(e.currentTarget.scrollTop > 10)}
      >
        {/* Hero */}
        <div className="w-full px-8 md:px-16 lg:px-24 pt-16 pb-12">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-neutral-800 border border-neutral-700 flex items-center justify-center">
              <HelpCircle className="w-5 h-5 text-neutral-300" />
            </div>
            <h1 className="text-3xl font-semibold text-white tracking-tight">
              Help Center
            </h1>
          </div>
          <p className="text-[15px] text-neutral-400 leading-relaxed max-w-2xl">
            Everything you need to know about using Shiksha. Find answers to common questions, learn how to get the most out of your teaching assistants, and get support.
          </p>
        </div>
      </div>

      {/* Quick Start Guides */}
      <div className="w-full px-8 md:px-16 lg:px-24 pb-12">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold text-white mb-6">Quick Start Guides</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sections.map((section, index) => (
              <div
                key={index}
                className="p-5 rounded-xl border border-neutral-800 bg-neutral-800/30"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-neutral-700/50 flex items-center justify-center">
                    <section.icon className="w-4 h-4 text-neutral-300" />
                  </div>
                  <h3 className="text-sm font-medium text-neutral-200">{section.title}</h3>
                </div>
                <ul className="space-y-2">
                  {section.items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-neutral-600 shrink-0" />
                      <span className="text-xs text-neutral-400 leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts */}
      <div className="w-full px-8 md:px-16 lg:px-24 pb-12">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold text-white mb-6">Keyboard Shortcuts</h2>
          <div className="rounded-xl border border-neutral-800 bg-neutral-800/30 overflow-hidden">
            {[
              { keys: "Enter", action: "Send message" },
              { keys: "Shift + Enter", action: "New line in message" },
              { keys: "Ctrl + N", action: "New conversation" },
            ].map((shortcut, i) => (
              <div
                key={i}
                className={`flex items-center justify-between px-5 py-3 ${i > 0 ? "border-t border-neutral-800/60" : ""}`}
              >
                <span className="text-sm text-neutral-400">{shortcut.action}</span>
                <kbd className="px-2.5 py-1 text-xs font-mono text-neutral-300 bg-neutral-800 border border-neutral-700 rounded-md">
                  {shortcut.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FAQs */}
      <div className="w-full px-8 md:px-16 lg:px-24 pb-12">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold text-white mb-6">Frequently Asked Questions</h2>
          <div className="space-y-3">
            {faqs.map((faq, index) => (
              <details
                key={index}
                className="group rounded-xl border border-neutral-800 bg-neutral-800/30 overflow-hidden"
              >
                <summary className="flex items-center justify-between px-5 py-4 cursor-pointer text-sm font-medium text-neutral-200 hover:text-white transition-colors list-none">
                  {faq.question}
                  <span className="text-neutral-500 group-open:rotate-180 transition-transform duration-200 ml-4 shrink-0">
                    ▾
                  </span>
                </summary>
                <div className="px-5 pb-4 text-xs text-neutral-400 leading-relaxed border-t border-neutral-800/60 pt-3">
                  {faq.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>

      {/* Contact / Support */}
      <div className="w-full px-8 md:px-16 lg:px-24 pb-16">
        <div className="max-w-4xl mx-auto">
          <div className="bg-neutral-800/30 border border-neutral-700/40 rounded-2xl p-8 text-center">
            <Mail className="w-8 h-8 text-neutral-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Still need help?</h3>
            <p className="text-sm text-neutral-400 leading-relaxed max-w-md mx-auto">
              If you couldn't find what you're looking for, reach out to us using the Feedback option in the sidebar menu and we'll get back to you.
            </p>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
