// src/pages/AssetsView.tsx
// Full page view for Assets/Artifacts

import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Loader2,
  Search,
  X,
  ArrowRight,
  AlertCircle,
  Library
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn, getCourseName } from "@/lib/utils";
import { AssetCard } from "@/components/assets/AssetCard";
import { chatApi } from "@/lib/chatApi";
import type { Asset, AssetCategory } from "@/lib/types";
import { useCurrentUserId } from "@/lib/userStore";
import { useChatStore } from "@/lib/chatStore";
import { toast } from "sonner";
import { getAssetCategory, parseAssetPayload } from "@/components/assets/assetPayload";
import { SlidesDialog } from "@/features/chat/SlidesBlock";
import { parseSlidesBlock, SLIDES_INVALID_MESSAGE, type CompleteSlidesBlock } from "@/lib/slides";

const assetTypeFilters: { key: AssetCategory; label: string; primary?: boolean }[] = [
  { key: "document", label: "Document", primary: true },
  { key: "quiz", label: "Quiz", primary: true },
  { key: "presentation", label: "Presentation", primary: true },
  { key: "challenge", label: "Challenge", primary: true },
  { key: "simulation", label: "Simulation", primary: true },
  { key: "diagram", label: "Diagram" },
  { key: "summary", label: "Summary" },
  { key: "code", label: "Code" },
  { key: "visualization", label: "Visualization" },
  { key: "other", label: "Other" },
];

export function AssetsView() {
  const navigate = useNavigate();
  const userId = useCurrentUserId();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<AssetCategory[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [openSlides, setOpenSlides] = useState<{ block: CompleteSlidesBlock; agentId?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAssets() {
      if (!userId) return;
      
      setIsLoading(true);
      setLoadError(false);
      try {
        const result = await chatApi.listAssets(userId, { limit: 50 });
        if (!cancelled) {
          setAssets(result.assets);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch assets:", error);
          setAssets([]);
          setLoadError(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    
    fetchAssets();
    return () => {
      cancelled = true;
    };
  }, [userId, reloadCount]);

  const categorizedAssets = useMemo(() => assets.map(asset => ({
    asset, category: getAssetCategory(asset),
  })), [assets]);
  const availableFilters = assetTypeFilters.filter(({ key, primary }) =>
    primary || categorizedAssets.some(({ category }) => category === key) || selectedTypes.includes(key),
  );
  const query = searchQuery.trim().toLowerCase();
  const filteredAssets = categorizedAssets.filter(({ asset, category }) => {
    if (selectedTypes.length > 0 && !selectedTypes.includes(category)) return false;
    if (!query) return true;
    return (
      asset.title.toLowerCase().includes(query) ||
      asset.description?.toLowerCase().includes(query) ||
      asset.tags?.some((t) => t.toLowerCase().includes(query))
    );
  }).map(({ asset }) => asset);

  const toggleType = (category: AssetCategory) => {
    setSelectedTypes((previous) => previous.includes(category)
      ? previous.filter((selected) => selected !== category)
      : [...previous, category],
    );
  };

  const clearSearch = () => {
    setSearchQuery("");
    searchInputRef.current?.focus();
  };

  const handleViewAsset = (asset: Asset) => {
    const payload = parseAssetPayload(asset.content);
    const slides = payload?.type === "slides" ? parseSlidesBlock(payload) : null;
    if (payload?.type === "slides" && !slides) {
      toast.error(SLIDES_INVALID_MESSAGE);
      return;
    }
    // If the asset has a threadId, navigate to the specific chat where it was created
    if (asset.threadId) {
      // Try to get courseName from: 1) asset tags, 2) thread context, 3) thread agentId
      let courseName = "";
      
      // Check tags for course:name pattern
      const courseTag = asset.tags?.find((t) => t.startsWith("course:"));
      if (courseTag) {
        courseName = courseTag.replace("course:", "");
      }
      
      // Fallback: look up thread in chatStore for courseSlug or agentName
      if (!courseName) {
        const threads = useChatStore.getState().threads;
        const thread = threads[asset.threadId];
        if (thread?.context?.courseSlug) {
          courseName = thread.context.courseSlug;
        } else if (thread?.context?.agentName) {
          courseName = getCourseName(thread.context.agentName);
        }
      }
      
      // Fallback: derive courseName from asset description (e.g. "generated by course-X")
      if (!courseName && asset.description) {
        const match = asset.description.match(/generated by\s+(course-\S+|.+)/i);
        if (match?.[1]) {
          courseName = getCourseName(match[1]);
        }
      }
      
      if (courseName) {
        // Set the active thread before navigating so ChatView loads the right thread
        useChatStore.getState().setActiveThread(asset.threadId);
        navigate(`/chat/${encodeURIComponent(courseName)}/${asset.threadId}`, {
          state: { openAsset: { id: asset.id, title: asset.title, content: asset.content } },
        });
        return;
      }
    }
    
    if (slides) {
      setOpenSlides({ block: slides, agentId: asset.agentId });
      return;
    }
    // Fallback: show toast for assets without navigation info
    toast.info(`Viewing: ${asset.title}`);
  };

  const handleDeleteAsset = async (asset: Asset) => {
    if (!userId) return;
    try {
      await chatApi.deleteAsset(asset.id, userId);
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      toast.success("Asset deleted");
    } catch {
      toast.error("Failed to delete asset");
    }
  };

  const handleShareAsset = async (asset: Asset) => {
    if (!userId) return;
    try {
      const updated = await chatApi.updateAsset(asset.id, userId, {
        isPublic: !asset.isPublic,
      });
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? updated : a)));
      toast.success(updated.isPublic ? "Asset is now public" : "Asset is now private");
    } catch {
      toast.error("Failed to update asset");
    }
  };

  const hasAssets = assets.length > 0;

  return (
    <div 
      className="h-full overflow-y-auto bg-neutral-900"
      onScroll={(e) => setIsScrolled(e.currentTarget.scrollTop > 10)}
    >
      <PageHeader title="Assets" showBorder={isScrolled} />

      <div className="mx-auto w-full max-w-4xl px-4 pb-10 pt-8 sm:px-6 sm:pt-10 lg:px-8">
        <div className="mb-6">
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Your Assets
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400 sm:text-base">
            Challenges, documents, presentations, quizzes, and simulations from your learning sessions.
          </p>
        </div>

        {!isLoading && !loadError && (
          <div className="sticky top-14 z-20 -mx-1 mb-5 bg-neutral-900/95 px-1 py-3 backdrop-blur-sm">
            <div role="search" className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500"
              />
              <Input
                ref={searchInputRef}
                type="text"
                role="searchbox"
                aria-label="Search assets"
                placeholder="Search your assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-12 rounded-xl border-neutral-700/60 bg-neutral-950/40 pl-12 pr-12 text-base text-white shadow-none placeholder:text-neutral-500 hover:border-neutral-600 focus-visible:border-neutral-500 focus-visible:ring-1 focus-visible:ring-neutral-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={clearSearch}
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-400"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </div>
            <div role="group" aria-label="Filter assets by type" className="mt-3 flex flex-wrap items-center gap-2">
              {availableFilters.map(({ key, label }) => {
                const selected = selectedTypes.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    title={label}
                    aria-pressed={selected}
                    aria-controls="saved-assets"
                    onClick={() => toggleType(key)}
                    className={cn(
                      "inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-dashed px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900",
                      selected
                        ? "border-neutral-400 bg-neutral-800 text-white"
                        : "border-neutral-700 bg-transparent text-neutral-400 hover:border-neutral-500 hover:text-neutral-200",
                    )}
                  >
                    <span className="truncate">{label}</span>
                    {selected && <X aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-neutral-400" />}
                  </button>
                );
              })}
              {selectedTypes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedTypes([])}
                  className="h-8 rounded-lg px-2 text-xs text-neutral-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}

        <section id="saved-assets" aria-label="Saved assets" aria-busy={isLoading}>
          {isLoading ? (
            <div role="status" className="flex min-h-80 flex-col items-center justify-center gap-4">
              <Loader2 aria-hidden="true" className="h-7 w-7 animate-spin text-neutral-400" />
              <p className="text-sm text-neutral-400">Loading your assets...</p>
            </div>
          ) : loadError ? (
            <div role="alert" className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-800/20 px-6 py-12 text-center">
              <AlertCircle aria-hidden="true" className="mb-4 h-8 w-8 text-neutral-400" />
              <h3 className="text-lg font-semibold text-white">Unable to load your assets</h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-400">
                Something went wrong while loading your assets. Please try again.
              </p>
              <Button
                onClick={() => setReloadCount((count) => count + 1)}
                variant="outline"
                className="mt-6 border-neutral-700 text-neutral-200 hover:bg-neutral-800 hover:text-white"
              >
                Try again
              </Button>
            </div>
          ) : !hasAssets ? (
            <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-700/60 bg-neutral-800/20 px-6 py-12 text-center">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-800">
                <Library aria-hidden="true" className="h-6 w-6 text-neutral-400" />
              </div>
              <h3 className="text-xl font-semibold text-white">No assets yet</h3>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-neutral-400">
                Create challenges, documents, presentations, quizzes, and simulations in a chat with a teaching assistant. They will be saved here.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Button
                  onClick={() => navigate("/library")}
                  className="h-10 rounded-lg bg-white px-5 text-sm font-medium text-neutral-900 hover:bg-neutral-200"
                >
                  <Library aria-hidden="true" className="mr-2 h-4 w-4" />
                  Explore Agents
                </Button>
                <Button
                  onClick={() => navigate("/learn#assets")}
                  variant="outline"
                  className="h-10 rounded-lg border-neutral-700 px-5 text-sm font-medium text-neutral-300 hover:bg-neutral-800 hover:text-white"
                >
                  Learn More
                  <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-700/60 px-6 py-12 text-center">
              <Search aria-hidden="true" className="mb-4 h-8 w-8 text-neutral-500" />
              <h3 className="text-lg font-semibold text-white">No matching assets</h3>
              <p className="mt-2 w-full max-w-md break-words text-sm leading-relaxed text-neutral-400">
                {query ? (
                  <>No results for &quot;{searchQuery.trim()}&quot;{selectedTypes.length > 0 && " in the selected asset types"}. Try a different title, description, or tag.</>
                ) : (
                  "No assets match the selected types. Choose another type or clear the filters."
                )}
              </p>
              <Button
                onClick={() => {
                  setSelectedTypes([]);
                  clearSearch();
                }}
                variant="outline"
                className="mt-6 border-neutral-700 text-neutral-200 hover:bg-neutral-800 hover:text-white"
              >
                {selectedTypes.length > 0 ? "Clear filters" : "Clear search"}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredAssets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onView={handleViewAsset}
                  onDelete={handleDeleteAsset}
                  onShare={handleShareAsset}
                  showActions={true}
                />
              ))}
            </div>
          )}
        </section>
      </div>
      {openSlides && <SlidesDialog block={openSlides.block} agentId={openSlides.agentId} open onSaved={() => setReloadCount(count => count + 1)} onOpenChange={open => { if (!open) setOpenSlides(null); }} />}
    </div>
  );
}
