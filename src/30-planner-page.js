/* ----------------------------------------------------------------------------
   Tax Master Planner page — embeds the planning-and-compliance app that lives
   in planner/ (also published as a claude.ai Artifact) so it opens from the
   Workbench navigation. The planner keeps its own data and engine; nothing
   here reads or writes Workbench client data.
   -------------------------------------------------------------------------- */
const TP_PLANNER_HOSTED = "https://nasi118.github.io/AI-Tax/planner/";
/* Resolved from this script's own URL so it works under any base path. In the
   single-file standalone build scripts are inlined (no src), so there is no
   planner/ folder next to the page and we link to the hosted copy instead. */
const TP_PLANNER_URL = (() => {
  try {
    const s = document.currentScript && document.currentScript.src;
    return s ? new URL("../planner/", s).href : null;
  } catch (e) {
    return null;
  }
})();

function PlannerPage() {
  const [loaded, setLoaded] = useState(false);
  const url = TP_PLANNER_URL;
  return EL("div", {
    className: "tp-stack tp-planner-page"
  }, EL("div", {
    className: "tp-planner-head"
  }, EL("p", null, "Runs on its own engine and demo data, separate from the Workbench clients."),
  EL("a", {
    className: "tp-mini",
    href: url || TP_PLANNER_HOSTED,
    target: "_blank",
    rel: "noopener"
  }, "Open in new tab")), url ? EL("div", {
    className: "tp-card tp-planner-frame"
  }, !loaded && EL("p", {
    className: "tp-planner-loading"
  }, "Loading the planner…"), EL("iframe", {
    title: "Tax Master Planner",
    src: url,
    onLoad: () => setLoaded(true)
  })) : EL("div", {
    className: "tp-card"
  }, EL("p", null, "This single-file copy of the Workbench does not include the planner. ",
    EL("a", { href: TP_PLANNER_HOSTED, target: "_blank", rel: "noopener" }, "Open the Tax Master Planner"),
    " in a new tab, or build its own single file with ", EL("code", null, "node planner/build.mjs"), ".")));
}
