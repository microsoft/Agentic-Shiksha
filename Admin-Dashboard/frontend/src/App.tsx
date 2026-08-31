import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { DashboardView } from "@/pages/DashboardView";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/overview" element={<DashboardView />} />
        <Route path="/analytics" element={<DashboardView />} />
        <Route path="/user-directory" element={<DashboardView />} />
        <Route path="/feedback" element={<DashboardView />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
