import { createBrowserRouter, Navigate } from "react-router-dom";
import { MainLayout } from "./layouts/MainLayout";
import { ChatView } from "./pages/ChatView";
import { LibraryView } from "./pages/LibraryView";
import { AssetsView } from "./pages/AssetsView";
import { CreateView } from "./features/create/CreateView";
import { EditView } from "./features/edit/EditView";
import { SettingsPage } from "./pages/SettingsPage";
import { LearnPage } from "./pages/LearnPage";
import { HelpPage } from "./pages/HelpPage";
import { AuthGuard } from "./components/auth/AuthGuard";
import { LoginPage } from "./components/auth/LoginPage";
import { AuthCallback } from "./components/auth/AuthCallback";
import { SignOutPage } from "./components/auth/SignOutPage";
import { SharedChatView } from "./pages/SharedChatView";
import JoinAgentPage from "./pages/JoinAgentPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { TeacherDashboard } from "./features/dashboard/TeacherDashboardPage";
import { useUserRole } from "./hooks/useUserRole";

// Protected layout wrapper that requires authentication
function ProtectedLayout() {
  return (
    <AuthGuard>
      <MainLayout />
    </AuthGuard>
  );
}

// Full-page Teacher/Admin dashboard — requires teacher or admin role.
function DashboardRoute() {
  const { can } = useUserRole();
  if (!can("page:dashboard")) return <Navigate to="/home" replace />;
  return <TeacherDashboard />;
}

// Router configuration with all application routes
export const router = createBrowserRouter([
  // Public route - Shared chat view (no authentication required)
  {
    path: "/shared/:shareToken",
    element: <SharedChatView />,
    errorElement: <NotFoundPage />,
  },
  // Invite link - handles its own auth so the code survives the login round trip
  {
    path: "/join/:code",
    element: <JoinAgentPage />,
    errorElement: <NotFoundPage />,
  },
  // Auth route - login/signup page
  {
    path: "/auth",
    element: <LoginPage />,
  },
  // Auth callback - receives JWT token from backend after Microsoft auth
  {
    path: "/auth/callback",
    element: <AuthCallback />,
  },
  // Sign out route - clears session and redirects to auth
  {
    path: "/signout",
    element: <SignOutPage />,
  },
  // Onboarding route - collects new user profile details (requires auth, no sidebar)
  {
    path: "/onboarding",
    element: (
      <AuthGuard>
        <OnboardingPage />
      </AuthGuard>
    ),
  },
  {
    path: "/",
    element: <ProtectedLayout />,
    errorElement: <NotFoundPage />,
    children: [
      // Redirect root to home
      {
        index: true,
        element: <Navigate to="/home" replace />,
      },
      // Home/Chat view - the main chat interface
      {
        path: "home",
        element: <ChatView />,
      },
      // Chat with specific course and thread (uses course name in URL)
      {
        path: "chat/:courseName/:threadId",
        element: <ChatView />,
      },
      // Agent Library
      {
        path: "library",
        element: <LibraryView />,
      },
      // Assets / Artifacts
      {
        path: "assets",
        element: <AssetsView />,
      },
      // Teacher/Admin dashboard — renders inside the Shiksha layout (teacher/admin only)
      {
        path: "dashboard",
        element: <DashboardRoute />,
      },
      // Individual dashboard sections (Students, Usage, Feedback, Evaluation, Analytics)
      {
        path: "dashboard/:section",
        element: <DashboardRoute />,
      },
      // Create new agent (teachers/admins only — students redirected to library)
      {
        path: "create",
        element: <CreateView />,
      },
      // Edit existing agent (uses course name in URL)
      {
        path: "edit/:courseName",
        element: <EditView />,
      },
      // Course page — same as chat, just without a threadId yet
      {
        path: "course/:courseName",
        element: <ChatView />,
      },
      // Settings page
      {
        path: "settings",
        element: <SettingsPage />,
      },
      // Learn more about Shiksha
      {
        path: "learn",
        element: <LearnPage />,
      },
      // Help page
      {
        path: "help",
        element: <HelpPage />,
      },
      // Catch-all for unknown routes
      {
        path: "*",
        element: <NotFoundPage />,
      },
    ],
  },
]);
