import { useEffect } from "react";
import { useNavigate, useRouteError, isRouteErrorResponse } from "react-router-dom";
import { ArrowLeft, Home } from "lucide-react";

/** Standalone 404 page used as both a catch-all route and an errorElement. */
export function NotFoundPage() {
  const navigate = useNavigate();
  const error = useRouteError?.() as unknown;
  const is404 =
    !error || (isRouteErrorResponse(error) && error.status === 404);

  // Without this the router swallows render errors and only shows "Oops".
  useEffect(() => {
    if (error && !is404) console.error("[route error]", error);
  }, [error, is404]);

  const detail = error instanceof Error
    ? `${error.name}: ${error.message}\n\n${error.stack ?? ""}`
    : error && !is404
      ? String(error)
      : "";

  return (
    <div className="min-h-screen bg-neutral-900 flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Large 404 indicator */}
        <div className="space-y-2">
          <p className="text-7xl font-bold text-neutral-300 tracking-tight select-none">
            {is404 ? "404" : "Oops"}
          </p>

        </div>

        {/* Message */}
        <div className="space-y-3">
          <h1 className="text-xl font-semibold text-white">
            {is404 ? "Page not found" : "Something went wrong"}
          </h1>
          <p className="text-sm text-neutral-400 leading-relaxed">
            {is404
              ? "The page you're looking for doesn't exist or has been moved. Let's get you back on track."
              : "An unexpected error occurred. Try going back or returning home."}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-neutral-300 bg-neutral-800 border border-neutral-700 rounded-lg hover:bg-neutral-700 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Go back
          </button>
          <button
            onClick={() => navigate("/home")}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors"
          >
            <Home className="h-4 w-4" />
            Home
          </button>
        </div>

        {import.meta.env.DEV && detail && (
          <pre className="mt-6 max-h-72 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-left text-[11px] leading-relaxed text-rose-300">
            {detail}
          </pre>
        )}
      </div>
    </div>
  );
}
