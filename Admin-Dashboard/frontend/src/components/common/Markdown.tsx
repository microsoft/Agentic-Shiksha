// src/components/common/Markdown.tsx
import React, { useState } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { Copy, Check } from "lucide-react";
import "katex/dist/katex.min.css";

// Code block with copy button component
function CodeBlock({ children, className, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false);
  
  // Extract language from className (e.g., "language-cpp" -> "cpp")
  type CodeProps = { className?: string; children?: React.ReactNode };
  const codeElement = React.Children.toArray(children)[0] as React.ReactElement<CodeProps>;
  const codeClassName = codeElement?.props?.className || "";
  const languageMatch = codeClassName.match(/language-(\w+)/);
  const language = languageMatch ? languageMatch[1] : "code";
  
  // Get the text content for copying
  const getCodeText = (): string => {
    const extractText = (node: React.ReactNode): string => {
      if (typeof node === "string") return node;
      if (typeof node === "number") return String(node);
      if (Array.isArray(node)) return node.map(extractText).join("");
      if (React.isValidElement(node)) {
        const props = node.props as CodeProps;
        if (props?.children) {
          return extractText(props.children);
        }
      }
      return "";
    };
    return extractText(codeElement?.props?.children || "");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getCodeText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="my-4 rounded-xl overflow-hidden bg-[#1e1e1e]">
      {/* Header bar with language and copy button */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#2d2d2d]">
        <span className="text-xs font-mono text-neutral-400 tracking-wide">
          {language}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-neutral-400 hover:text-white hover:bg-white/10 transition-all duration-150"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-white" />
              <span className="text-white">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>
      {/* Code content */}
      <pre
        className="px-5 py-4 overflow-x-auto text-[13px] leading-[1.6] font-mono bg-[#1e1e1e]"
        style={{ border: 'none', boxShadow: 'none', outline: 'none', margin: 0 }}
        {...props}
      >
        {children}
      </pre>
    </div>
  );
}

type SourceItem = {
  type?: string;
  title: string;
  url?: string;
  domain?: string;
  favicon?: string;
  filename?: string;
  file_id?: string;
};

type Props = {
  children: string;
  className?: string;
  // turn off math/highlight if you don't need them
  math?: boolean;
  highlight?: boolean;
  // Sources for linking inline citations
  sources?: SourceItem[];
};

/**
 * Preprocess LaTeX delimiters to standard format that remark-math understands
 * Converts \[ ... \] to $$ ... $$ and \( ... \) to $ ... $
 * ONLY handles explicit LaTeX delimiters - does NOT try to guess math from parentheses
 */
function preprocessMathDelimiters(content: string): string {
  let processed = content;
  
  // Convert display math: \[ ... \] to $$ ... $$
  processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `\n$$\n${math.trim()}\n$$\n`);
  
  // Convert inline math: \( ... \) to $ ... $
  processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math}$`);
  
  return processed;
}

/**
 * Extract URL citations from the end of content and build arrays
 * URL Citation format: URL Citation: [title](url)
 */
function extractUrlCitations(content: string): { cleanContent: string; citations: Array<{ title: string; url: string }> } {
  const citations: Array<{ title: string; url: string }> = [];
  const seenUrls = new Set<string>();
  
  // Find all URL Citation lines
  const urlCitationPattern = /URL Citation:\s*\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  
  while ((match = urlCitationPattern.exec(content)) !== null) {
    const url = match[2];
    // Only add unique URLs
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      citations.push({ title: match[1], url });
    }
  }
  
  // Remove URL Citation lines from content
  const cleanContent = content
    .replace(/\n*URL Citation:\s*\[([^\]]+)\]\(([^)]+)\)\s*/g, '')
    .trim();
  
  return { cleanContent, citations };
}

/**
 * Preprocess content to convert citation patterns like 【83:11†source】 to clickable links
 * Shows domain name in the citation for better context
 */
function preprocessCitations(content: string, sources?: SourceItem[]): string {
  // First extract URL citations from the end
  const { cleanContent, citations } = extractUrlCitations(content);
  
  // Combine sources with extracted citations, preferring sources
  const allSources: SourceItem[] = 
    sources && sources.length > 0 ? sources : citations;
  
  // Pattern for citations like 【83:11†source】 or 【1†Bing Search】
  const citationPattern = /【(\d+)(?::(\d+))?†([^】]+)】/g;
  
  // If we have sources, try to match them to inline references
  return cleanContent.replace(citationPattern, (_match, mainNum, subNum, text) => {
    const displayNum = subNum ? `${mainNum}:${subNum}` : mainNum;
    
    // Try to find a matching source
    if (allSources.length > 0) {
      // Use modulo to cycle through available sources
      const sourceIndex = (parseInt(mainNum, 10) - 1) % allSources.length;
      const source = allSources[sourceIndex];
      if (source) {
        if (source.url) {
          // URL citation — render as clickable link with domain name
          let domainDisplay = source.domain || '';
          if (!domainDisplay && source.url) {
            try {
              const urlObj = new URL(source.url);
              domainDisplay = urlObj.hostname.replace(/^www\./, '');
            } catch {
              domainDisplay = source.url;
            }
          }
          const title = source.title || domainDisplay || source.url;
          return `<a href="${source.url}" target="_blank" rel="noopener noreferrer" class="citation-link" title="${title}">${domainDisplay}</a>`;
        } else {
          // File citation (knowledge base) — render as styled chip with filename
          const displayName = source.filename || source.title || "Document";
          // Strip file extension for cleaner display
          const cleanName = displayName.replace(/\.[^.]+$/, '');
          return `<span class="citation-ref" title="${displayName}">${cleanName}</span>`;
        }
      }
    }
    
    // Fallback: if text is the generic "source" placeholder, show a clean numbered reference
    // Otherwise show the actual text (e.g. "Bing Search")
    const isGenericSource = text.toLowerCase() === 'source';
    if (isGenericSource) {
      // Show as a small numbered superscript instead of uninformative "source"
      return `<sup class="citation-ref" title="Reference ${displayNum}">[${displayNum}]</sup>`;
    }
    return `<span class="citation-ref">${text}</span>`;
  });
}

// Custom sanitize schema that allows class attributes on links and spans for citation styling
// Also allows KaTeX elements for math rendering
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    // KaTeX elements - both MathML and HTML output
    'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msub', 'msup', 'msubsup',
    'mfrac', 'munder', 'mover', 'munderover', 'msqrt', 'mroot', 'mtable', 'mtr',
    'mtd', 'mtext', 'mspace', 'annotation', 'svg', 'path', 'line', 'rect', 'g',
    // Image elements
    'img', 'figure', 'figcaption',
  ],
  attributes: {
    ...defaultSchema.attributes,
    // Allow class and style on all elements for KaTeX
    '*': ['className', 'class', 'style', 'aria-hidden', 'role'],
    a: [...(defaultSchema.attributes?.a || []), 'class', 'target', 'rel', 'title'],
    span: [...(defaultSchema.attributes?.span || []), 'class', 'style', 'aria-hidden'],
    // Allow code elements with class for remark-math (language-math)
    code: [...(defaultSchema.attributes?.code || []), 'class', 'className'],
    // Allow all attributes on KaTeX-generated elements
    div: [...(defaultSchema.attributes?.div || []), 'class', 'style', 'aria-hidden'],
    // Allow image attributes
    img: ['src', 'alt', 'title', 'width', 'height', 'class', 'loading'],
    sup: ['class', 'title'],
    figure: ['class'],
    figcaption: ['class'],
    math: ['xmlns', 'display', 'class', 'style'],
    semantics: ['class'],
    annotation: ['encoding'],
    mrow: ['class'],
    mi: ['class', 'mathvariant'],
    mo: ['class', 'fence', 'stretchy', 'symmetric', 'separator', 'lspace', 'rspace', 'minsize', 'maxsize'],
    mn: ['class'],
    msub: ['class'],
    msup: ['class'],
    msubsup: ['class'],
    mfrac: ['class', 'linethickness'],
    munder: ['class'],
    mover: ['class', 'accent'],
    munderover: ['class'],
    msqrt: ['class'],
    mroot: ['class'],
    mtable: ['class', 'columnalign', 'columnspacing', 'rowspacing'],
    mtr: ['class'],
    mtd: ['class', 'columnalign'],
    mtext: ['class'],
    mspace: ['class', 'width', 'height', 'depth'],
    svg: ['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'class', 'style', 'role', 'focusable'],
    path: ['d', 'fill', 'stroke', 'stroke-width', 'class'],
    line: ['x1', 'x2', 'y1', 'y2', 'stroke', 'stroke-width', 'class'],
    rect: ['x', 'y', 'width', 'height', 'fill', 'stroke', 'class'],
    g: ['transform', 'class'],
  },
};

const components: Components = {
  // paragraphs – brighter text
  p({ children }) {
    return (
      <p className="my-2 text-[15px] leading-[1.7] text-neutral-100">
        {children}
      </p>
    );
  },

  // unordered list – bright text + visible bullets
  ul({ children }) {
    return (
      <ul className="my-2 list-disc pl-6 space-y-1 text-neutral-100 marker:text-neutral-400">
        {children}
      </ul>
    );
  },

  // ordered list
  ol({ children }) {
    return (
      <ol className="my-2 list-decimal pl-6 space-y-1 text-neutral-100 marker:text-neutral-400">
        {children}
      </ol>
    );
  },

  li({ children }) {
    return <li className="leading-[1.7]">{children}</li>;
  },

  // headings – higher contrast, no underlines
  h1({ children, id, ...props }) {
    return (
      <h1 id={id} className="mt-5 mb-3 text-2xl font-bold text-neutral-50" {...props}>
        {children}
      </h1>
    );
  },
  h2({ children, id, ...props }) {
    return (
      <h2 id={id} className="mt-4 mb-2 text-xl font-semibold text-neutral-50" {...props}>
        {children}
      </h2>
    );
  },
  h3({ children, id, ...props }) {
    return (
      <h3 id={id} className="mt-3 mb-2 text-lg font-semibold text-neutral-50" {...props}>
        {children}
      </h3>
    );
  },
  h4({ children, id, ...props }) {
    return (
      <h4 id={id} className="mt-2 mb-1 text-base font-semibold text-neutral-100" {...props}>
        {children}
      </h4>
    );
  },

  blockquote({ children }) {
    return (
      <blockquote className="my-4 pl-5 pr-4 py-3 border-l-4 border-neutral-400 bg-neutral-700/70 text-neutral-100 italic rounded-r-lg">
        {children}
      </blockquote>
    );
  },

  a({ href, children, className, title, ...props }) {
    // Check if this is a citation link (has citation-link class from preprocessing)
    const isCitationLink = className?.includes('citation-link');
    
    if (isCitationLink) {
      // Render as a chip/pill style - subtle but visible
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={title}
          className="inline-flex items-center px-2 py-0.5 mx-0.5 bg-neutral-600/80 hover:bg-neutral-500 text-neutral-200 hover:text-white rounded-full text-[11px] font-normal no-underline transition-colors"
          {...props}
        >
          {children}
        </a>
      );
    }
    
    // For anchor links (like heading autolinks), prevent navigation
    const isAnchorLink = href?.startsWith('#');
    const isExternalLink = href?.startsWith('http://') || href?.startsWith('https://');
    
    if (isAnchorLink) {
      // Scroll to the target heading within the document pane
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            const targetId = href?.slice(1);
            if (targetId) {
              const target = document.getElementById(targetId);
              if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }
          }}
          className="!text-neutral-50 underline decoration-neutral-500 hover:decoration-neutral-300 cursor-pointer visited:!text-neutral-50"
          style={{ color: 'inherit' }}
          {...props}
        >
          {children}
        </a>
      );
    }
    
    return (
      <a
        href={href}
        target={isExternalLink ? "_blank" : undefined}
        rel={isExternalLink ? "noopener noreferrer" : undefined}
        onClick={isExternalLink ? undefined : (e) => e.preventDefault()}
        className="text-blue-300 hover:text-blue-200"
        {...props}
      >
        {children}
      </a>
    );
  },

  strong({ children }) {
    return <strong className="font-semibold text-neutral-50">{children}</strong>;
  },

  em({ children }) {
    return <em className="italic text-neutral-100">{children}</em>;
  },

  // table wrapper
  table(props) {
    return (
      <div className="my-4 overflow-x-auto rounded-lg border border-neutral-700/70">
        <table className="min-w-full divide-y divide-neutral-700/70" {...props} />
      </div>
    );
  },

  thead({ children }) {
    return (
      <thead className="bg-neutral-800/80 text-neutral-50">{children}</thead>
    );
  },

  tbody({ children }) {
    return (
      <tbody className="bg-neutral-900/60 divide-y divide-neutral-700/60 text-neutral-100">
        {children}
      </tbody>
    );
  },

  tr({ children }) {
    return (
      <tr className="hover:bg-neutral-800/40 transition-colors">{children}</tr>
    );
  },

  th({ children }) {
    return (
      <th className="px-4 py-3 text-left text-sm font-semibold">
        {children}
      </th>
    );
  },

  td({ children }) {
    return <td className="px-4 py-3 text-sm">{children}</td>;
  },

  // images - styled for educational content
  img({ src, alt, title, ...props }) {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    
    if (hasError) {
      return (
        <span className="inline-flex items-center gap-2 text-neutral-400 text-sm italic">
          [Image: {alt || 'Unable to load'}]
        </span>
      );
    }
    
    return (
      <span className="inline-block my-3">
        <span className="relative inline-block rounded-lg overflow-hidden border border-neutral-700/50 bg-neutral-800/50">
          {isLoading && (
            <span className="absolute inset-0 flex items-center justify-center bg-neutral-800">
              <span className="animate-pulse text-neutral-400 text-sm">Loading image...</span>
            </span>
          )}
          <img
            src={src}
            alt={alt || ''}
            title={title}
            loading="lazy"
            onLoad={() => setIsLoading(false)}
            onError={() => { setIsLoading(false); setHasError(true); }}
            className={`max-w-full h-auto max-h-[400px] object-contain ${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-200`}
            {...props}
          />
        </span>
        {alt && (
          <span className="block text-xs text-neutral-400 mt-1 text-center italic">
            {alt}
          </span>
        )}
      </span>
    );
  },

  // inline code
  code({ className, children, ...props }) {
    return (
      <code
        className={`rounded-md px-1.5 py-0.5 bg-neutral-900/70 text-neutral-50 ${className || ""}`}
        {...props}
      >
        {children}
      </code>
    );
  },

  // code blocks
  pre(props) {
    return <CodeBlock {...props} />;
  },
};

export default function Markdown({
  children,
  className,
  math = true,
  highlight = true,
  sources,
}: Props) {
  // Debug: log if children is not a string
  if (typeof children !== 'string') {
    console.warn('Markdown component received non-string children:', typeof children, children);
  }
  
  // Ensure children is a string
  const contentString = typeof children === 'string' ? children : String(children || '');
  
  // Preprocess math delimiters first, then citations
  const mathProcessed = math ? preprocessMathDelimiters(contentString) : contentString;
  const processedContent = preprocessCitations(mathProcessed, sources);
  
  return (
    <div className={`max-w-none ${className || ""}`}>
      <style>{`
        /* KaTeX error styling - show gracefully instead of red */
        .katex-error {
          color: rgb(163, 163, 163) !important;
          font-family: 'KaTeX_Main', 'Times New Roman', serif;
          font-style: italic;
        }
        /* Hide KaTeX MathML output (accessibility layer) to prevent duplicate display */
        .katex .katex-mathml {
          display: none !important;
        }
        .katex-display .katex-mathml {
          display: none !important;
        }
        /* Hide MathML annotation elements */
        math annotation {
          display: none !important;
        }
        /* Ensure KaTeX displays properly */
        .katex-display {
          margin: 1em 0;
          text-align: center;
        }
        .katex {
          font-size: 1.1em;
        }
        .citation-link {
          display: inline-flex;
          align-items: center;
          padding: 3px 10px;
          margin: 1px 3px 1px 0;
          background: rgb(55, 55, 55);
          color: rgb(180, 180, 180);
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 400;
          text-decoration: none;
          transition: all 0.15s ease;
          vertical-align: middle;
        }
        .citation-link:hover {
          background: rgb(75, 75, 75);
          color: rgb(220, 220, 220);
        }
        .citation-ref {
          display: inline-flex;
          align-items: center;
          padding: 3px 10px;
          margin: 1px 3px 1px 0;
          background: rgb(55, 55, 55);
          color: rgb(150, 150, 150);
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 400;
          vertical-align: middle;
        }
        sup.citation-ref {
          display: inline;
          padding: 0 2px;
          margin: 0 1px;
          background: none;
          color: rgb(140, 140, 140);
          border-radius: 0;
          font-size: 0.7em;
          font-weight: 500;
          vertical-align: super;
        }
      `}</style>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, ...(math ? [remarkMath] : [])]}
        rehypePlugins={[
          rehypeRaw,
          // Model output can contain raw HTML, so it is always sanitized. KaTeX runs
          // afterwards so its generated markup is never stripped.
          [rehypeSanitize, sanitizeSchema],
          ...(math ? [[rehypeKatex, { output: 'html', throwOnError: false, strict: false }]] : []),
          rehypeSlug,
          ...(highlight ? ([rehypeHighlight] as any) : []),
        ]}
        components={components}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
