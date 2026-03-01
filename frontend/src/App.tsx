import { Navigate, Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoginPage } from "@/pages/LoginPage";
import { BackupsPage } from "@/pages/BackupsPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { HostsPage } from "@/pages/HostsPage";
import { LandingPage } from "@/pages/LandingPage";
import { LiveMonitorPage } from "@/pages/LiveMonitorPage";
import { PlannedEventsPage } from "@/pages/PlannedEventsPage";
import { SettingsPage } from "@/pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/hosts" element={<HostsPage />} />
        <Route path="/backups" element={<BackupsPage />} />
        <Route path="/planned-events" element={<PlannedEventsPage />} />
        <Route path="/monitor" element={<LiveMonitorPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
