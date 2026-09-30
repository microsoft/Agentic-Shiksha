import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquareMore, Smile, Frown, Meh, Send, Loader2, Paperclip, X, FileIcon, Plus } from "lucide-react";
import { API_BASE_URL } from "@/lib/config";
import { useAuth } from "@/lib/useAuth";
import { useUserStore } from "@/lib/userStore";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SentimentType = "positive" | "neutral" | "negative" | null;

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const [sentiment, setSentiment] = React.useState<SentimentType>(null);
  const [feedbackText, setFeedbackText] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [imageFiles, setImageFiles] = React.useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = React.useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const { user } = useAuth();
  const userId = useUserStore((s) => s.userId);

  const resetForm = () => {
    setSentiment(null);
    setFeedbackText("");
    setSubmitted(false);
    setSubmitting(false);
    setError(null);
    setImageFiles([]);
    setImagePreviews([]);
    setUploadingImage(false);
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      // Reset after close animation
      setTimeout(resetForm, 200);
    }
    onOpenChange(value);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const maxTotal = 5;
    const remaining = maxTotal - imageFiles.length;
    if (remaining <= 0) {
      setError("Maximum 5 files allowed.");
      return;
    }
    const toAdd = files.slice(0, remaining);
    const oversized = toAdd.find((f) => f.size > 5 * 1024 * 1024);
    if (oversized) {
      setError("Each file must be under 5 MB.");
      return;
    }
    setError(null);
    setImageFiles((prev) => [...prev, ...toAdd]);
    toAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) =>
        setImagePreviews((prev) => [...prev, ev.target?.result as string]);
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (index: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const base = (API_BASE_URL || "").replace(/\/+$/, "");

      // Upload images if attached
      const imageUrls: string[] = [];
      if (imageFiles.length > 0) {
        setUploadingImage(true);
        for (const imgFile of imageFiles) {
          const formData = new FormData();
          formData.append("file", imgFile);
          const imgRes = await fetch(`${base}/api/feedback/upload-image`, {
            method: "POST",
            body: formData,
          });
          if (!imgRes.ok) throw new Error("Failed to upload image.");
          const imgData = await imgRes.json();
          imageUrls.push(imgData.imageUrl);
        }
        setUploadingImage(false);
      }

      const apiUrl = `${base}/api/feedback`;
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId || "anonymous",
          sentiment,
          text: feedbackText,
          userName: user?.displayName || "",
          userEmail: user?.email || "",
          imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setSubmitted(true);
    } catch (err: any) {
      console.error("Feedback submission failed:", err);
      setError("Failed to submit feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const sentimentOptions = [
    { value: "positive" as SentimentType, icon: Smile, label: "Good", activeColor: "border-green-500/50 bg-green-500/10 text-green-400" },
    { value: "neutral" as SentimentType, icon: Meh, label: "Okay", activeColor: "border-yellow-500/50 bg-yellow-500/10 text-yellow-400" },
    { value: "negative" as SentimentType, icon: Frown, label: "Poor", activeColor: "border-red-500/50 bg-red-500/10 text-red-400" },
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-neutral-900 border-neutral-700/50 rounded-2xl max-w-sm p-0 gap-0">
        {submitted ? (
          /* Success state */
          <div className="flex flex-col items-center justify-center py-8 px-5">
            <div className="w-12 h-12 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center mb-4">
              <Smile className="w-5 h-5 text-neutral-300" />
            </div>
            <DialogTitle className="text-lg font-semibold text-neutral-100 mb-2">
              Thank you for your feedback!
            </DialogTitle>
            <p className="text-sm text-neutral-400 text-center max-w-xs">
              Your feedback helps us improve Shiksha for everyone.
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-5 pt-3.5 pb-2.5 border-b border-neutral-800/60 flex items-center">
              <DialogTitle className="text-[15px] font-semibold text-neutral-100">
                Send Feedback
              </DialogTitle>
            </div>

            {/* Content */}
            <div className="px-5 py-3 space-y-3 overflow-y-auto max-h-[75vh]">
              {/* Sentiment */}
              <div>
                <label className="text-sm font-medium text-neutral-300 mb-2.5 block">
                  How's your experience?
                </label>
                <div className="flex gap-2">
                  {sentimentOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setSentiment(option.value)}
                      className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg border transition-all text-xs ${
                        sentiment === option.value
                          ? option.activeColor
                          : "border-neutral-700 bg-neutral-800/50 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300"
                      }`}
                    >
                      <option.icon className="w-3.5 h-3.5" />
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Feedback text */}
              <div>
                <label className="text-sm font-medium text-neutral-300 mb-2.5 block">
                  Your feedback
                </label>
                <Textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder="Help us improve your experience"
                  className="bg-neutral-800/50 border-neutral-700 text-neutral-200 placeholder:text-neutral-600 rounded-xl resize-none h-28 text-sm focus:border-neutral-600 focus:ring-0"
                />
              </div>

              {/* Attachments */}
              <div>
                <label className="text-sm font-medium text-neutral-300 mb-2.5 flex items-center justify-between">
                  <span>Attachments</span>
                  {imageFiles.length > 0 && (
                    <span className="text-xs text-neutral-500 font-normal">{imageFiles.length}/5</span>
                  )}
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleImageSelect}
                  className="hidden"
                />
                {imageFiles.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {imageFiles.map((file, idx) => {
                        const isImage = file.type.startsWith('image/');
                        return (
                          <div key={idx} className="relative group">
                            {isImage && imagePreviews[idx] ? (
                              <img
                                src={imagePreviews[idx]}
                                alt={`Attachment ${idx + 1}`}
                                className="h-14 w-14 rounded-lg border border-neutral-700 object-cover"
                              />
                            ) : (
                              <div className="h-14 w-14 rounded-lg border border-neutral-700 bg-neutral-800 flex flex-col items-center justify-center" title={file.name}>
                                <FileIcon className="w-5 h-5 text-neutral-400" />
                                <span className="text-[8px] text-neutral-500 mt-0.5 max-w-[48px] truncate px-1">{file.name.split('.').pop()?.toUpperCase()}</span>
                              </div>
                            )}
                            <button
                              onClick={() => removeImage(idx)}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-neutral-700 border border-neutral-600 flex items-center justify-center hover:bg-neutral-600 transition-colors"
                            >
                              <X className="w-3 h-3 text-neutral-300" />
                            </button>
                          </div>
                        );
                      })}
                      {imageFiles.length < 5 && (
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="h-14 w-14 rounded-lg border border-dashed border-neutral-700 bg-neutral-800/30 flex items-center justify-center text-neutral-500 hover:text-neutral-300 hover:border-neutral-600 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center gap-1.5 h-14 w-full rounded-lg border border-dashed border-neutral-700 bg-neutral-800/30 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800/50 transition-all cursor-pointer"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    <span className="text-xs">Attach files (max 5)</span>
                  </button>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-2 border-t border-neutral-800/60 flex items-center justify-end gap-2">
              {error && (
                <p className="text-xs text-red-400 mr-auto">{error}</p>
              )}
              <button
                onClick={() => onOpenChange(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
              <Button
                onClick={handleSubmit}
                disabled={!feedbackText.trim() || submitting}
                className="bg-white hover:bg-neutral-200 text-neutral-900 text-xs font-medium rounded-lg px-5 py-2 h-auto shadow-none disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? "Submitting..." : "Submit"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
