/* Same-origin Responses API gateway for the planner's browser-side tools.
 * The credential stays on the server. Conversation and calculation tool results
 * remain in memory in the browser; OpenAI response storage is disabled.
 */
const DEFAULT_MODEL = "gpt-5.6-sol";
const { createHash, timingSafeEqual } = require("node:crypto");
const MAX_BODY_BYTES = 400 * 1024;
const MAX_INPUT_ITEMS = 180;
const TIMEOUT_MS = 50 * 1000;
const TOOL_NAMES = new Set([
  "get_client_return", "get_tax_scenarios", "get_filing_calendar",
  "get_1040_schedule", "get_rental_analysis", "get_strategy", "list_findings",
  "what_if", "set_input", "open_view"
]);
const rateBuckets = new Map();

function access(req, env) {
  const headers = req.headers || {};
  const peer = req.socket && req.socket.remoteAddress;
  let hostname = '';
  try { hostname = new URL('http://' + (headers.host || '')).hostname; } catch (_) {}
  const local = env.NODE_ENV !== 'production' && !env.VERCEL && !env.VERCEL_ENV && !env.AWS_LAMBDA_FUNCTION_NAME &&
    !headers['x-forwarded-for'] && !headers['forwarded'] && !headers['x-forwarded-host'] &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (local) return { allowed: true, local: true };
  const expected = env.ADVISOR_ACCESS_TOKEN;
  if (!expected) return { allowed: false, status: 503, error: 'Private AI access is not configured. Set ADVISOR_ACCESS_TOKEN on the server and enter that app access token in Advisor Settings. Local calculations and line explanations remain available.' };
  const auth = typeof headers.authorization === 'string' ? headers.authorization : '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  // Compare fixed-size hashes so wrong-length tokens also take the same path.
  const digest = token => createHash('sha256').update(token).digest();
  if (!timingSafeEqual(digest(provided), digest(expected))) return { allowed: false, status: 401, error: 'Private AI access requires the app access token. Enter it in Advisor Settings; it is separate from the OpenAI API key.' };
  return { allowed: true, local: false };
}

function limited(ip) {
  const now = Date.now();
  const recent = (rateBuckets.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 40) return true;
  recent.push(now);
  if (rateBuckets.size >= 5000 && !rateBuckets.has(ip)) rateBuckets.clear();
  rateBuckets.set(ip, recent);
  return false;
}

function extractText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  return data.output.filter(item => item && item.type === "message")
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .filter(part => part && part.type === "output_text" && typeof part.text === "string")
    .map(part => part.text).join("\n\n");
}

function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Invalid request body.";
  if (!Array.isArray(body.input) || !body.input.length) return "A conversation is required.";
  if (body.input.length > MAX_INPUT_ITEMS) return "The conversation is too long. Start a new conversation.";
  if (typeof body.instructions !== "string" || body.instructions.length > 50000) return "Invalid advisor instructions.";
  if (!Array.isArray(body.tools) || body.tools.length > TOOL_NAMES.size) return "Invalid advisor tools.";
  for (const tool of body.tools) {
    if (!tool || tool.type !== "function" || !TOOL_NAMES.has(tool.name) ||
        typeof tool.description !== "string" || !tool.parameters || tool.parameters.type !== "object") return "Invalid advisor tool.";
  }
  for (const item of body.input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "Invalid conversation item.";
    if (item.type === "function_call") {
      if (!TOOL_NAMES.has(item.name) || typeof item.call_id !== "string" || typeof item.arguments !== "string") return "Invalid tool call.";
    } else if (item.type === "function_call_output") {
      if (typeof item.call_id !== "string" || typeof item.output !== "string") return "Invalid tool result.";
    } else if (item.type === "reasoning") {
      // Encrypted reasoning returned by Responses is needed with tool results.
      if (!Array.isArray(item.summary) || (item.encrypted_content != null && typeof item.encrypted_content !== "string")) return "Invalid reasoning item.";
    } else if ((!item.type || item.type === "message") && ["user", "assistant"].includes(item.role)) {
      if (typeof item.content !== "string" && !Array.isArray(item.content)) return "Invalid message content.";
    } else return "Unsupported conversation item.";
  }
  const last = body.input[body.input.length - 1];
  if (last.type !== "function_call_output" && last.role !== "user") return "The conversation must end with a question or tool result.";
  return null;
}

function makeHandler({ fetchImpl = (...args) => fetch(...args), timeoutMs = TIMEOUT_MS, env = process.env } = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const model = env.OPENAI_MODEL || DEFAULT_MODEL;
    const permission = access(req, env);
    if (req.method === "GET") {
      return res.status(200).json({ provider: "openai", configured: permission.allowed && !!env.OPENAI_API_KEY, model,
        accessRequired: !permission.allowed, message: permission.error || (!env.OPENAI_API_KEY ? 'Set OPENAI_API_KEY in the server environment to connect OpenAI.' : '') });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Use POST to ask the advisor." });
    }
    if (!permission.allowed) return res.status(permission.status).json({ error: permission.error });
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: "OpenAI is not connected. Set OPENAI_API_KEY in the server or deployment environment. Line explanations and tax calculations remain available." });
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: "Invalid JSON request." }); }
    }
    if (Buffer.byteLength(JSON.stringify(body) || "") > MAX_BODY_BYTES) return res.status(413).json({ error: "The conversation is too large. Start a new conversation." });
    const problem = validate(body);
    if (problem) return res.status(400).json({ error: problem });
    const ip = String(req.socket?.remoteAddress || req.ip || "unknown");
    if (limited(ip)) return res.status(429).json({ error: "Too many advisor requests. Wait a minute and try again." });

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const disconnected = () => controller.abort();
    const closed = () => { if (!res.writableEnded) disconnected(); };
    req.on?.("aborted", disconnected);
    res.on?.("close", closed);
    try {
      const upstream = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          instructions: body.instructions,
          input: body.input,
          tools: body.tools.map(tool => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
          parallel_tool_calls: false,
          max_output_tokens: 6000,
          reasoning: { effort: "low" },
          include: ["reasoning.encrypted_content"],
          store: false
        })
      });
      if (!upstream.ok) {
        // Never forward upstream bodies: errors can include submitted tax data.
        const error = upstream.status === 401 || upstream.status === 403
          ? "OpenAI rejected the server credential or model access. Check the deployment's OpenAI project settings."
          : upstream.status === 429 ? "OpenAI is limiting requests or the project has no available credits. Check its usage and billing, then try again."
          : "OpenAI could not process this request (status " + upstream.status + "). Try a shorter question or start a new conversation.";
        return res.status(upstream.status === 429 ? 429 : 502).json({ error });
      }
      const data = await upstream.json();
      if (!data || !Array.isArray(data.output)) return res.status(502).json({ error: "OpenAI returned an unreadable response." });
      if (data.status === "failed" || data.status === "cancelled") return res.status(502).json({ error: "OpenAI did not complete the response. Try again." });
      if (data.output.some(item => item.type === "message" && item.content?.some(part => part.type === "refusal"))) return res.status(502).json({ error: "OpenAI declined this request. Rephrase the question." });
      const text = extractText(data);
      const calls = data.output.filter(item => item.type === "function_call");
      if (!text && !calls.length) return res.status(502).json({ error: "OpenAI returned no answer. Try a narrower question." });
      return res.status(200).json({
        provider: "openai", model: data.model || model, output: data.output, text,
        status: data.status || "completed",
        truncated: data.status === "incomplete"
      });
    } catch (_) {
      if (controller.signal.aborted && !timedOut) return;
      return res.status(timedOut ? 504 : 502).json({ error: timedOut ? "The advisor request timed out. Try a narrower question." : "The OpenAI connection failed. Try again shortly." });
    } finally {
      clearTimeout(timer);
      req.removeListener?.("aborted", disconnected);
      res.removeListener?.("close", closed);
    }
  };
}

module.exports = { makeHandler, DEFAULT_MODEL };
