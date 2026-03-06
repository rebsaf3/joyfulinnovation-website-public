import { Navigate, Route, Routes } from "react-router-dom";
import SwarmDashboard from "./pages/SwarmDashboard";

export default function App() {
  return (
    <Routes>
      <Route path="/swarm-dashboard" element={<SwarmDashboard />} />
      <Route path="/agent-monitor" element={<SwarmDashboard />} />
      <Route path="/agent-activity" element={<SwarmDashboard />} />
      <Route path="/agent-verification" element={<SwarmDashboard />} />
      <Route path="*" element={<Navigate to="/swarm-dashboard" replace />} />
    </Routes>
  );
}