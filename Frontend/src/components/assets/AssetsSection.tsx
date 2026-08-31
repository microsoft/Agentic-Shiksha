// src/components/assets/AssetsSection.tsx
// Assets section component for LibraryView

import { useState, useEffect, useMemo } from "react";
import { 
  Plus,
  Sparkles,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  BookOpen,
  GitBranch,
  FileText,
  Code,
  LayoutGrid,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AssetCard } from "./AssetCard";
import { chatApi } from "@/lib/chatApi";
import type { Asset, AssetCategory } from "@/lib/types";
import { toast } from "sonner";

interface AssetsSectionProps {
  userId: string;
  onViewAsset?: (asset: Asset) => void;
  className?: string;
}

type TabKey = "inspiration" | "yours";

const categoryFilters: { key: AssetCategory; label: string; icon: React.ElementType }[] = [
  { key: "all", label: "All", icon: LayoutGrid },
  { key: "quiz", label: "Quiz", icon: HelpCircle },
  { key: "flashcard", label: "Flashcard", icon: BookOpen },
  { key: "diagram", label: "Diagram", icon: GitBranch },
  { key: "summary", label: "Summary", icon: FileText },
  { key: "code", label: "Code", icon: Code },
  { key: "visualization", label: "Visual", icon: Sparkles },
];

export function AssetsSection({ userId, onViewAsset, className }: AssetsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("yours");
  const [activeCategory, setActiveCategory] = useState<AssetCategory>("all");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch assets based on tab and category
  useEffect(() => {
    async function fetchAssets() {
      setIsLoading(true);
      try {
        if (activeTab === "yours") {
          const result = await chatApi.listAssets(userId, {
            category: activeCategory === "all" ? undefined : activeCategory,
            limit: 20,
          });
          setAssets(result.assets);
        } else {
          const result = await chatApi.listPublicAssets({
            category: activeCategory === "all" ? undefined : activeCategory,
            limit: 20,
          });
          setAssets(result.assets);
        }
      } catch (error) {
        console.error("Failed to fetch assets:", error);
        setAssets([]);
      } finally {
        setIsLoading(false);
      }
    }
    
    if (userId) {
      fetchAssets();
    }
  }, [userId, activeTab, activeCategory]);

  const handleDeleteAsset = async (asset: Asset) => {
    try {
      await chatApi.deleteAsset(asset.id, userId);
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      toast.success("Asset deleted");
    } catch (error) {
      toast.error("Failed to delete asset");
    }
  };

  const handleShareAsset = async (asset: Asset) => {
    try {
      // Toggle public status
      const updated = await chatApi.updateAsset(asset.id, userId, {
        isPublic: !asset.isPublic,
      });
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? updated : a)));
      toast.success(updated.isPublic ? "Asset is now public" : "Asset is now private");
    } catch (error) {
      toast.error("Failed to update asset");
    }
  };

  return (
    <div className={cn("mb-8", className)}>
      {/* Section Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-3 w-full text-left mb-4 group"
      >
        {isExpanded ? (
          <ChevronDown className="h-5 w-5 text-neutral-400" />
        ) : (
          <ChevronRight className="h-5 w-5 text-neutral-400" />
        )}
        <h2 className="text-2xl font-bold text-white">Assets</h2>
        <span className="text-sm text-neutral-500">
          {assets.length} {assets.length === 1 ? "item" : "items"}
        </span>
      </button>

      {isExpanded && (
        <div className="space-y-4">
          {/* Tabs and Create Button */}
          <div className="flex items-center justify-between">
            {/* Tabs */}
            <div className="flex items-center gap-1 bg-neutral-800/60 p-1 rounded-lg">
              <button
                type="button"
                className={cn(
                  "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                  activeTab === "inspiration"
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-400 hover:text-white"
                )}
                onClick={() => setActiveTab("inspiration")}
              >
                Inspiration
              </button>
              <button
                type="button"
                className={cn(
                  "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                  activeTab === "yours"
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-400 hover:text-white"
                )}
                onClick={() => setActiveTab("yours")}
              >
                Your Assets
              </button>
            </div>

            {/* Create Button - only show on "Your Assets" tab */}
            {activeTab === "yours" && (
              <Button
                variant="outline"
                size="sm"
                className="border-neutral-700 hover:border-neutral-600 bg-neutral-800/50 hover:bg-neutral-800 text-neutral-300 hover:text-white"
                onClick={() => {
                  // TODO: Open create asset modal
                  toast.info("Create asset feature coming soon");
                }}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                New
              </Button>
            )}
          </div>

          {/* Category Filters */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 -mb-2 scrollbar-thin scrollbar-thumb-neutral-700">
            {categoryFilters.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveCategory(key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full whitespace-nowrap transition-colors",
                  activeCategory === key
                    ? "bg-white text-neutral-900"
                    : "bg-neutral-800/60 text-neutral-400 hover:text-white hover:bg-neutral-800"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Assets Grid */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 text-neutral-400 animate-spin" />
            </div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 border-2 border-dashed border-neutral-700/50 rounded-xl">
              <Sparkles className="h-10 w-10 text-neutral-600 mb-3" />
              <p className="text-neutral-400 text-center text-sm">
                {activeTab === "yours"
                  ? "No assets yet. Assets created from chat will appear here."
                  : "No public assets available in this category."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {assets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onView={onViewAsset}
                  onDelete={activeTab === "yours" ? handleDeleteAsset : undefined}
                  onShare={activeTab === "yours" ? handleShareAsset : undefined}
                  showActions={activeTab === "yours"}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
