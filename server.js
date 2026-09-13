const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API Routes
const grokHandler = require("./api/grok.js");
const analyzeHandler = require("./api/ai/analyze.js");
const buildReportHandler = require("./api/ai/build-report.js");
const optimizeHandler = require("./api/ai/optimize.js");

app.all("/api/grok", grokHandler);
app.all("/api/ai/analyze", analyzeHandler);
app.all("/api/ai/build-report", buildReportHandler);
app.all("/api/ai/optimize", optimizeHandler);

// Static assets
app.use(express.static(path.join(__dirname, ".")));

// Fallback for root / SPA routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Tax Planning Workbench running on http://0.0.0.0:${PORT}`);
});
