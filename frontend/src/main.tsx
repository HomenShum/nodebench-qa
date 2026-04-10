import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ChatProvider } from "./contexts/ChatContext";
import { Landing } from "./pages/Landing";
import { Dashboard } from "./pages/Dashboard";
import { Results } from "./pages/Results";
import { Sitemap } from "./pages/Sitemap";
import { Audit } from "./pages/Audit";
import { Workflows } from "./pages/Workflows";
import { Distill } from "./pages/Distill";
import { Judge } from "./pages/Judge";
import { Compare } from "./pages/Compare";
import { Benchmark } from "./pages/Benchmark";
import { RunAnatomy } from "./pages/RunAnatomy";
import { Proof } from "./pages/Proof";
import { Live } from "./pages/Live";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ChatProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/live" element={<Live />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/distill/:id" element={<Distill />} />
          <Route path="/judge" element={<Judge />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/anatomy" element={<RunAnatomy />} />
          <Route path="/benchmark" element={<Benchmark />} />
          <Route path="/proof" element={<Proof />} />
          {/* Legacy QA routes (kept for backward compatibility) */}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/results/:id" element={<Results />} />
          <Route path="/sitemap" element={<Sitemap />} />
          <Route path="/audit" element={<Audit />} />
        </Routes>
      </ChatProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
