/* ==== 28-google-drive ==== */
/* ============================================================================
   GOOGLE DRIVE INTEGRATION & GOOGLE WORKSPACE AUTHENTICATION
   Provides seamless Google Drive integration for client tax documents, report
   exports, scenario backups, and file browsing.
   Uses Firebase Authentication for client-side OAuth token retrieval with
   in-memory access token caching, and Google Drive REST API v3.
   ========================================================================== */

const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.activity",
  "https://www.googleapis.com/auth/drive.activity.readonly",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.apps.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.install",
  "https://www.googleapis.com/auth/drive.meet.readonly",
  "https://www.googleapis.com/auth/drive.metadata",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.photos.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.scripts",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/spreadsheets.readonly"
];

const DEFAULT_FIREBASE_CONFIG = {
  projectId: "gen-lang-client-0858870142",
  appId: "1:718309637335:web:9e855888ada70fd50b0492",
  apiKey: "AIzaSyBuzviHo4CQx_OCEIIL7-ScufQpCS3GVIg",
  authDomain: "gen-lang-client-0858870142.firebaseapp.com",
  storageBucket: "gen-lang-client-0858870142.firebasestorage.app",
  messagingSenderId: "718309637335",
  oAuthClientId: "718309637335-ftnu0da9s0gungofgv1d39otd5796opt.apps.googleusercontent.com"
};

// In-memory token cache (never stored in localStorage or sessionStorage)
let cachedDriveAccessToken = null;
let isDriveSigningIn = false;
let driveAuthListeners = [];

function getDriveFirebaseApp() {
  if (typeof window === "undefined" || !window.firebase) return null;
  const cfg = window.FIREBASE_CONFIG || DEFAULT_FIREBASE_CONFIG;
  if (!window.firebase.apps || !window.firebase.apps.length) {
    return window.firebase.initializeApp(cfg);
  }
  return window.firebase.app();
}

function getDriveFirebaseAuth() {
  const app = getDriveFirebaseApp();
  if (!app) return null;
  return window.firebase.auth();
}

function getDriveGoogleProvider() {
  if (typeof window === "undefined" || !window.firebase) return null;
  const provider = new window.firebase.auth.GoogleAuthProvider();
  GOOGLE_DRIVE_SCOPES.forEach(scope => provider.addScope(scope));
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

function initDriveAuth(onSuccess, onFailure) {
  const auth = getDriveFirebaseAuth();
  if (!auth) {
    if (onFailure) onFailure();
    return () => {};
  }
  const unsubscribe = auth.onAuthStateChanged(user => {
    if (user && cachedDriveAccessToken) {
      if (onSuccess) onSuccess(user, cachedDriveAccessToken);
    } else {
      if (!isDriveSigningIn) {
        cachedDriveAccessToken = null;
        if (onFailure) onFailure();
      }
    }
  });
  return unsubscribe;
}

async function getDriveAccessToken() {
  return cachedDriveAccessToken;
}

async function googleDriveSignIn() {
  const auth = getDriveFirebaseAuth();
  const provider = getDriveGoogleProvider();
  if (!auth || !provider) {
    throw new Error("Google Authentication SDK is not loaded. Please verify your connection.");
  }
  isDriveSigningIn = true;
  try {
    const result = await auth.signInWithPopup(provider);
    const credential = result && result.credential;
    if (!credential || !credential.accessToken) {
      throw new Error("Sign-in succeeded, but no OAuth access token was returned.");
    }
    cachedDriveAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedDriveAccessToken };
  } finally {
    isDriveSigningIn = false;
  }
}

async function googleDriveSignOut() {
  const auth = getDriveFirebaseAuth();
  if (auth) {
    await auth.signOut();
  }
  cachedDriveAccessToken = null;
}

/* ============================================================================
   GOOGLE DRIVE REST API (v3)
   ========================================================================== */
async function driveFetch(url, options = {}) {
  const token = await getDriveAccessToken();
  if (!token) {
    throw new Error("Authentication required: Sign in with Google to access Google Drive.");
  }
  const headers = {
    Authorization: "Bearer " + token,
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    let errMessage = "Google Drive API request failed with status " + res.status;
    try {
      const errData = await res.json();
      if (errData && errData.error && errData.error.message) {
        errMessage = errData.error.message;
      }
    } catch (e) {
      // ignore JSON parse error
    }
    throw new Error(errMessage);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function driveListFiles({ q = "trashed = false", pageSize = 50, pageToken = null, fields = "files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,thumbnailLink,parents)" } = {}) {
  const params = new URLSearchParams({
    q,
    pageSize: String(pageSize),
    fields,
    orderBy: "folder,modifiedTime desc"
  });
  if (pageToken) params.set("pageToken", pageToken);
  return driveFetch("https://www.googleapis.com/drive/v3/files?" + params.toString());
}

async function driveCreateFolder(name, parentId = null) {
  const metadata = {
    name,
    mimeType: "application/vnd.google-apps.folder"
  };
  if (parentId) metadata.parents = [parentId];
  return driveFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata)
  });
}

async function driveFindOrCreateFolder(name, parentId = null) {
  let q = "mimeType = 'application/vnd.google-apps.folder' and name = '" + name.replace(/'/g, "\\'") + "' and trashed = false";
  if (parentId) q += " and '" + parentId + "' in parents";
  const list = await driveListFiles({ q, pageSize: 5 });
  if (list && list.files && list.files.length > 0) {
    return list.files[0];
  }
  return driveCreateFolder(name, parentId);
}

async function driveUploadFile({ name, mimeType = "text/plain", content, parentId = null }) {
  const token = await getDriveAccessToken();
  if (!token) throw new Error("Authentication required: Sign in with Google to upload files.");

  const metadata = {
    name,
    mimeType
  };
  if (parentId) metadata.parents = [parentId];

  const boundary = "-------314159265358979323846";
  const delimiter = "\r\n--" + boundary + "\r\n";
  const closeDelim = "\r\n--" + boundary + "--";

  const multipartRequestBody =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    "Content-Type: " + mimeType + "\r\n\r\n" +
    content +
    closeDelim;

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "multipart/related; boundary=" + boundary
    },
    body: multipartRequestBody
  });

  if (!res.ok) {
    let errMessage = "Upload failed with status " + res.status;
    try {
      const err = await res.json();
      if (err && err.error && err.error.message) errMessage = err.error.message;
    } catch (e) {}
    throw new Error(errMessage);
  }
  return res.json();
}

async function driveDeleteFile(fileId) {
  return driveFetch("https://www.googleapis.com/drive/v3/files/" + fileId, {
    method: "DELETE"
  });
}

/* ============================================================================
   UI COMPONENTS
   ========================================================================== */

function GoogleSignInButton({ onClick, loading, label }) {
  return EL("button", {
    className: "gsi-material-button",
    type: "button",
    disabled: !!loading,
    onClick
  },
    EL("div", { className: "gsi-material-button-state" }),
    EL("div", { className: "gsi-material-button-content-wrapper" },
      EL("div", { className: "gsi-material-button-icon" },
        EL("svg", {
          version: "1.1",
          xmlns: "http://www.w3.org/2000/svg",
          viewBox: "0 0 48 48",
          style: { display: "block" }
        },
          EL("path", { fill: "#EA4335", d: "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" }),
          EL("path", { fill: "#4285F4", d: "M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" }),
          EL("path", { fill: "#FBBC05", d: "M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" }),
          EL("path", { fill: "#34A853", d: "M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" }),
          EL("path", { fill: "none", d: "M0 0h48v48H0z" })
        )
      ),
      EL("span", { className: "gsi-material-button-contents" },
        loading ? "Connecting to Google…" : (label || "Sign in with Google")
      )
    )
  );
}

// Mandatory confirmation dialog for destructive operations
function GoogleDriveConfirmModal({ open, title, message, itemDetails, onConfirm, onCancel, confirmLabel, loading }) {
  if (!open) return null;
  return EL("div", {
    className: "tp-ai-overlay",
    style: { zIndex: 120 }
  },
    EL("div", {
      className: "tp-card",
      style: {
        maxWidth: "480px",
        width: "100%",
        padding: "20px",
        borderRadius: "12px",
        boxShadow: "0 20px 45px rgba(15,23,42,0.25)"
      }
    },
      EL("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" } },
        EL("span", { style: { fontSize: "22px" } }, "⚠️"),
        EL("h3", { style: { fontSize: "16px", fontWeight: "700", color: "var(--red)" } }, title || "Confirm Action")
      ),
      EL("p", { style: { fontSize: "13px", lineHeight: "1.55", color: "var(--ink2)", marginBottom: "12px" } }, message),
      itemDetails && EL("div", {
        style: {
          background: "var(--red-bg)",
          border: "1px solid var(--red-line)",
          padding: "8px 12px",
          borderRadius: "6px",
          fontSize: "12px",
          marginBottom: "16px",
          wordBreak: "break-all"
        }
      }, itemDetails),
      EL("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px" } },
        EL("button", {
          className: "tp-btn ghost sm",
          type: "button",
          disabled: !!loading,
          onClick: onCancel
        }, "Cancel"),
        EL("button", {
          className: "tp-btn solid sm",
          style: { background: "var(--red)", borderColor: "var(--red)" },
          type: "button",
          disabled: !!loading,
          onClick: onConfirm
        }, loading ? "Deleting…" : (confirmLabel || "Confirm Delete"))
      )
    )
  );
}

function GoogleDrivePage({
  client,
  scenarios,
  results,
  bestId,
  baseline,
  status,
  year,
  auditLog,
  notes,
  goto
}) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState("info");
  const [exporting, setExporting] = useState(false);

  // Destructive action confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState(null); // file object to delete
  const [deleteLoading, setDeleteLoading] = useState(false);

  const flash = (msg, type = "info") => {
    setNotice(msg);
    setNoticeType(type);
    setTimeout(() => setNotice(""), 5000);
  };

  useEffect(() => {
    const unsub = initDriveAuth(
      (u, tok) => {
        setUser(u);
        setToken(tok);
      },
      () => {
        setUser(null);
        setToken(null);
      }
    );
    return () => unsub();
  }, []);

  const handleSignIn = async () => {
    setAuthLoading(true);
    try {
      const res = await googleDriveSignIn();
      if (res) {
        setUser(res.user);
        setToken(res.accessToken);
        flash("Connected to Google Drive as " + res.user.email, "success");
        loadFiles();
      }
    } catch (err) {
      console.error("Sign in failed:", err);
      flash("Sign in failed: " + err.message, "error");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await googleDriveSignOut();
      setUser(null);
      setToken(null);
      setFiles([]);
      flash("Disconnected from Google Drive.", "info");
    } catch (err) {
      flash("Disconnect error: " + err.message, "error");
    }
  };

  const loadFiles = async () => {
    setFilesLoading(true);
    try {
      let q = "trashed = false";
      if (searchQuery.trim()) {
        const cleanQ = searchQuery.replace(/'/g, "\\'");
        q += " and (name contains '" + cleanQ + "')";
      }
      const res = await driveListFiles({ q, pageSize: 60 });
      setFiles(res.files || []);
    } catch (err) {
      console.error("Failed to list files:", err);
      flash("Failed to load Google Drive files: " + err.message, "error");
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadFiles();
    }
  }, [token, searchQuery]);

  // One-click Export client tax report to Google Drive
  const handleExportReportToDrive = async () => {
    if (!token) {
      flash("Please connect your Google Drive account first.", "error");
      return;
    }
    setExporting(true);
    try {
      // Create or locate AI Tax Strategy Advisors root folder
      const rootFolder = await driveFindOrCreateFolder("AI Tax Strategy Advisors");
      // Create or locate Client folder
      const clientFolder = await driveFindOrCreateFolder((client.name || "Client") + " — TY" + year, rootFolder.id);

      // Generate HTML report package
      const reportHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${client.name} — TY${year} Tax Advisory Deliverable</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; padding: 30px; color: #1e293b; background: #fff; }
    h1 { color: #1e40af; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
    .kpi { display: inline-block; padding: 12px 18px; margin: 8px 8px 8px 0; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; }
    .kpi strong { display: block; font-size: 18px; color: #047857; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
    th { background: #f1f5f9; }
  </style>
</head>
<body>
  <h1>AI Tax Strategy Advisors — Tax Planning Report</h1>
  <p><strong>Client:</strong> ${client.name} (TY${year} · ${status.toUpperCase()})</p>
  <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
  <hr/>
  <div class="kpi">
    <span>Lowest Modeled Federal Tax</span>
    <strong>${usd$(results.find(x => x.s.id === bestId)?.r.totalTax || 0)}</strong>
  </div>
  <div class="kpi">
    <span>Baseline Modeled Tax</span>
    <strong>${usd$(baseline?.r.totalTax || 0)}</strong>
  </div>
  <h2>Scenario Analysis</h2>
  <table>
    <thead>
      <tr>
        <th>Scenario</th>
        <th>Total Tax</th>
        <th>Effective Rate</th>
        <th>Spendable Cash</th>
      </tr>
    </thead>
    <tbody>
      ${results.map(r => `<tr>
        <td><strong>${r.s.name}</strong></td>
        <td>${usd$(r.r.totalTax)}</td>
        <td>${pct(r.r.effectiveRate)}</td>
        <td>${usd$(r.r.spendableAfterTaxCash)}</td>
      </tr>`).join("")}
    </tbody>
  </table>
  <footer style="margin-top: 40px; font-size: 11px; color: #64748b;">
    © 2026 AI Tax Strategy Advisors. Confidential tax planning deliverable.
  </footer>
</body>
</html>`;

      const fileName = `${client.name.replace(/[^\w-]+/g, "_")}_TY${year}_Advisory_Report.html`;
      const uploaded = await driveUploadFile({
        name: fileName,
        mimeType: "text/html",
        content: reportHtml,
        parentId: clientFolder.id
      });

      flash("Report saved to Google Drive in folder '" + clientFolder.name + "'! File ID: " + uploaded.id, "success");
      loadFiles();
    } catch (err) {
      console.error("Export report error:", err);
      flash("Error saving report to Drive: " + err.message, "error");
    } finally {
      setExporting(false);
    }
  };

  // Back up client scenario JSON package to Google Drive
  const handleBackupScenariosToDrive = async () => {
    if (!token) {
      flash("Please connect your Google Drive account first.", "error");
      return;
    }
    setExporting(true);
    try {
      const rootFolder = await driveFindOrCreateFolder("AI Tax Strategy Advisors");
      const clientFolder = await driveFindOrCreateFolder((client.name || "Client") + " — TY" + year, rootFolder.id);

      const backupPackage = {
        app: "Tax Planning Workbench",
        engineVersion: ENGINE_VERSION,
        rulesVersion: RULES_VERSION,
        exportTimestamp: Date.now(),
        client: {
          id: client.id,
          name: client.name,
          profile: client.profile,
          goals: client.goals,
          constraints: client.constraints,
          missingFacts: client.missingFacts
        },
        year,
        status,
        scenarios,
        notes,
        auditLog
      };

      const fileName = `${client.name.replace(/[^\w-]+/g, "_")}_TY${year}_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      const uploaded = await driveUploadFile({
        name: fileName,
        mimeType: "application/json",
        content: JSON.stringify(backupPackage, null, 2),
        parentId: clientFolder.id
      });

      flash("Client scenario backup uploaded to Google Drive! File ID: " + uploaded.id, "success");
      loadFiles();
    } catch (err) {
      console.error("Backup error:", err);
      flash("Error backing up to Drive: " + err.message, "error");
    } finally {
      setExporting(false);
    }
  };

  // Execute confirmed file deletion
  const executeDeleteFile = async () => {
    if (!deleteConfirm) return;
    setDeleteLoading(true);
    try {
      await driveDeleteFile(deleteConfirm.id);
      flash(`File "${deleteConfirm.name}" was permanently removed from Google Drive.`, "info");
      setDeleteConfirm(null);
      loadFiles();
    } catch (err) {
      flash("Failed to delete file: " + err.message, "error");
    } finally {
      setDeleteLoading(false);
    }
  };

  // Filtered files view
  const filteredFiles = files.filter(f => {
    if (categoryFilter === "reports") return f.name.includes("Report") || f.mimeType === "text/html";
    if (categoryFilter === "spreadsheets") return f.mimeType.includes("spreadsheet") || f.name.endsWith(".tsv") || f.name.endsWith(".xlsx");
    if (categoryFilter === "pdf") return f.mimeType.includes("pdf") || f.name.endsWith(".pdf");
    if (categoryFilter === "folders") return f.mimeType === "application/vnd.google-apps.folder";
    return true;
  });

  return EL("div", { className: "tp-stack" },
    notice && EL("div", {
      className: "tp-validbar " + (noticeType === "error" ? "has-error" : (noticeType === "success" ? "is-clean" : "has-missing")),
      style: { marginBottom: "14px" }
    },
      EL("strong", null, noticeType === "error" ? "🛑 Error: " : (noticeType === "success" ? "✓ Success: " : "ℹ️ Note: ")),
      notice
    ),

    // Account & Google Drive Connection Header
    EL(Card, { title: "Google Drive Workspace Integration" },
      EL("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" } },
        EL("div", { style: { maxWidth: "600px" } },
          EL("p", { style: { fontSize: "13px", lineHeight: "1.6", color: "var(--ink2)" } },
            "Connect Google Drive with permission to access, organize, and store tax returns, Form W-2/1099 records, scenario workbooks, and client advisory reports. All files sync directly to your authorized Google account under Google Cloud Project ",
            EL("code", { style: { background: "var(--hdr)", padding: "1px 5px", borderRadius: "4px" } }, "gen-lang-client-0858870142"),
            "."
          ),
          EL("div", { style: { display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" } },
            EL("span", { className: "tp-tag" }, "Cloud Project: gen-lang-client-0858870142"),
            EL("span", { className: "tp-tag" }, "API: Drive v3"),
            user ? EL("span", { className: "tp-tag green" }, "Connected: " + user.email) : EL("span", { className: "tp-tag gray" }, "Status: Not connected")
          )
        ),
        EL("div", { style: { display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end" } },
          !user ? EL(GoogleSignInButton, {
            onClick: handleSignIn,
            loading: authLoading,
            label: "Sign in with Google to Connect Drive"
          }) : EL("div", { style: { display: "flex", alignItems: "center", gap: "10px" } },
            user.photoURL && EL("img", {
              src: user.photoURL,
              alt: user.displayName || "User",
              style: { width: "32px", height: "32px", borderRadius: "50%", border: "1px solid var(--line)" }
            }),
            EL("div", { style: { textAlign: "right" } },
              EL("strong", { style: { display: "block", fontSize: "12.5px" } }, user.displayName || "Google User"),
              EL("span", { style: { fontSize: "11px", color: "var(--muted)" } }, user.email)
            ),
            EL("button", {
              className: "tp-btn ghost sm",
              type: "button",
              onClick: handleSignOut
            }, "Disconnect")
          )
        )
      )
    ),

    // Quick Actions for Current Active Client
    user && EL(Card, { title: "Quick Actions — " + client.name + " (TY" + year + ")" },
      EL("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } },
        EL("button", {
          className: "tp-btn solid sm",
          type: "button",
          disabled: exporting,
          onClick: handleExportReportToDrive
        }, I.drive, exporting ? " Exporting…" : " Save Client Report to Google Drive"),
        EL("button", {
          className: "tp-btn ghost sm",
          type: "button",
          disabled: exporting,
          onClick: handleBackupScenariosToDrive
        }, I.copy, " Backup Scenarios (.json) to Drive"),
        EL("button", {
          className: "tp-btn ghost sm",
          type: "button",
          onClick: () => goto && goto("sheets")
        }, I.sheets, " Open Google Sheets Hub →"),
        EL("button", {
          className: "tp-btn ghost sm",
          type: "button",
          onClick: loadFiles,
          disabled: filesLoading
        }, "⟳ Refresh Drive Files"),
        EL("button", {
          className: "tp-btn ghost sm",
          type: "button",
          onClick: () => goto && goto("report")
        }, "Go to Report Builder →")
      )
    ),

    // Google Drive File Browser
    user && EL(Card, { title: "Google Drive Files & Tax Records" },
      EL("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "12px", flexWrap: "wrap" } },
        EL("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
          EL("span", { style: { fontSize: "12px", fontWeight: "600", color: "var(--muted)" } }, "Filter:"),
          EL(Seg, {
            small: true,
            value: categoryFilter,
            onChange: setCategoryFilter,
            options: [
              { v: "all", l: "All Files (" + files.length + ")" },
              { v: "reports", l: "Reports" },
              { v: "spreadsheets", l: "Sheets/TSV" },
              { v: "pdf", l: "PDFs" },
              { v: "folders", l: "Folders" }
            ]
          })
        ),
        EL("div", { style: { display: "flex", alignItems: "center", gap: "6px" } },
          EL("input", {
            className: "tp-txt sm",
            style: { width: "220px", fontSize: "12px" },
            placeholder: "Search file name or client…",
            value: searchQuery,
            onChange: e => setSearchQuery(e.target.value)
          }),
          searchQuery && EL("button", {
            className: "tp-mini",
            onClick: () => setSearchQuery("")
          }, "✕")
        )
      ),

      filesLoading ? EL("div", { style: { padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: "12.5px" } },
        "Loading files from Google Drive…"
      ) : filteredFiles.length === 0 ? EL("div", {
        style: { padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: "12.5px" }
      },
        files.length === 0
          ? "No files found in your Google Drive. Use the actions above to export reports or backup scenarios."
          : "No files match the selected filter."
      ) : EL("div", { style: { overflowX: "auto" } },
        EL("table", { className: "tp-table", style: { width: "100%", fontSize: "12px" } },
          EL("thead", null,
            EL("tr", null,
              EL("th", null, "Name"),
              EL("th", null, "Type"),
              EL("th", null, "Size"),
              EL("th", null, "Modified"),
              EL("th", { style: { textAlign: "right" } }, "Actions")
            )
          ),
          EL("tbody", null,
            filteredFiles.map(f => {
              const isFolder = f.mimeType === "application/vnd.google-apps.folder";
              const isSheet = f.mimeType === "application/vnd.google-apps.spreadsheet" || f.name.endsWith(".xlsx") || f.name.endsWith(".tsv");
              const sizeLabel = f.size ? (parseInt(f.size, 10) / 1024).toFixed(1) + " KB" : (isFolder ? "—" : "0 KB");
              const modifiedDate = f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() + " " + new Date(f.modifiedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—";
              return EL("tr", { key: f.id },
                EL("td", { style: { fontWeight: isFolder ? "700" : "500", display: "flex", alignItems: "center", gap: "8px" } },
                  isFolder ? "📁" : (isSheet ? "📊" : (f.name.endsWith(".json") ? "📋" : (f.name.endsWith(".html") ? "📄" : "📄"))),
                  EL("span", { title: f.name }, f.name)
                ),
                EL("td", { style: { color: "var(--muted)", fontSize: "11px" } },
                  isFolder ? "Folder" : (isSheet ? "Spreadsheet" : f.mimeType.split("/").pop())
                ),
                EL("td", { style: { color: "var(--muted)", fontVariantNumeric: "tabular-nums" } }, sizeLabel),
                EL("td", { style: { color: "var(--muted)", fontVariantNumeric: "tabular-nums", fontSize: "11px" } }, modifiedDate),
                EL("td", { style: { textAlign: "right", whiteSpace: "nowrap" } },
                  f.webViewLink && EL("a", {
                    href: f.webViewLink,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    className: "tp-mini primary",
                    style: { textDecoration: "none", marginRight: "6px" }
                  }, isSheet ? "Open in Sheets ↗" : "Open in Drive ↗"),
                  EL("button", {
                    className: "tp-mini",
                    style: { color: "var(--red)" },
                    title: "Delete file from Google Drive (requires confirmation)",
                    onClick: () => setDeleteConfirm(f)
                  }, "Delete")
                )
              );
            })
          )
        )
      )
    ),

    // Mandatory Destructive Action Confirmation Dialog
    EL(GoogleDriveConfirmModal, {
      open: !!deleteConfirm,
      title: "Delete File from Google Drive",
      message: deleteConfirm ? `Are you sure you want to permanently delete "${deleteConfirm.name}" from your Google Drive? This action modifies your cloud storage and cannot be undone.` : "",
      itemDetails: deleteConfirm ? `File ID: ${deleteConfirm.id} · Type: ${deleteConfirm.mimeType}` : null,
      confirmLabel: "Delete from Drive",
      loading: deleteLoading,
      onConfirm: executeDeleteFile,
      onCancel: () => setDeleteConfirm(null)
    })
  );
}
