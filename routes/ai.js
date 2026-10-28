import express from "express";
import axios from "axios";
import process from "node:process";
import buildPrompt from "../utils/promptBuilder.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
// Read env lazily: server.js imports this file before dotenv.config() runs.
const groqModel = (env) => env.GROQ_MODEL || "openai/gpt-oss-120b";
const completionOptions = (env, landing = false) => ({
  temperature: 1,
  max_completion_tokens: landing
    ? Number(env.GROQ_LANDING_MAX_TOKENS) || 8192
    : Number(env.GROQ_MAX_TOKENS) || 4096,
  top_p: 1,
  reasoning_effort: "medium",
  stop: null,
});
const MAX_INPUT_LENGTH = 12000;
const REQUEST_TIMEOUT = 90000;
const MAX_RATE_LIMIT_RETRIES = 2;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** The only message visitors ever see when something goes wrong on our side. Details go to the server log. */
export const BUSY_MESSAGE = "We're investing in our servers right now. Please try again after some time.";

function logProblem(label, error) {
  console.error(`[ai] ${label}:`, error?.response?.status ?? "", error?.code ?? "", error?.message ?? error);
}

export function createAIRouter({ client = axios, env = process.env, sleep = wait } = {}) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    const { tool, input: rawInput } = req.body || {};
    const input = normalizeInput(rawInput);
    const validationError = validateRequest(tool, input);
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    try {
      const prompt = buildPrompt(tool, input);
      const response = await requestGroq(client, env, sleep, {
        model: groqModel(env),
        messages: [{ role: "user", content: prompt }],
        ...completionOptions(env),
      });
      const content = response.data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        logProblem("empty result", null);
        return res.status(502).json({ success: false, error: BUSY_MESSAGE });
      }
      return res.json({ success: true, data: content, provider: "groq" });
    } catch (error) {
      return sendProviderError(res, error);
    }
  });

  router.post("/landing", async (req, res) => {
    const input = normalizeInput(req.body?.input);
    const validationError = validateRequest("landing", input);
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    try {
      JSON.parse(input);
      const prompt = buildPrompt("landing", input);
      const response = await requestGroq(client, env, sleep, {
        model: groqModel(env),
        messages: [
          {
            role: "system",
            content: "You are an expert frontend developer. Output ONLY raw HTML starting with <!DOCTYPE html> and ending with </html>. No markdown, code fences, or explanations.",
          },
          { role: "user", content: prompt },
        ],
        ...completionOptions(env, true),
        stream: true,
      }, { responseType: "stream" });

      return streamGroqResponse(req, res, response.data);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return res.status(400).json({ success: false, error: "Landing input must be valid JSON" });
      }
      return sendProviderError(res, error);
    }
  });

  return router;
}

function normalizeInput(input) {
  if (typeof input === "string") return input.trim();
  if (input && typeof input === "object" && !Array.isArray(input)) return JSON.stringify(input);
  return "";
}

function validateRequest(tool, input) {
  if (typeof tool !== "string" || !/^[a-zA-Z0-9_-]+$/.test(tool)) return "A valid tool name is required";
  if (typeof input !== "string" || !input.trim()) return "Input is required";
  if (input.length > MAX_INPUT_LENGTH) return "Input is too large";
  return null;
}

async function requestGroq(client, env, sleep, body, options = {}) {
  if (!env.GROQ_API_KEY) {
    const error = new Error("GROQ_API_KEY is missing on the backend.");
    error.status = 503;
    throw error;
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.post(GROQ_API_URL, body, {
        ...options,
        timeout: REQUEST_TIMEOUT,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
      });
    } catch (error) {
      if (error.response?.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) throw error;
      const retryAfter = Number(error.response.headers?.["retry-after"]);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 10000)
        : 500 * (attempt + 1));
    }
  }
}

function sendProviderError(res, error) {
  const status = error.response?.status || error.status || (error.code === "ECONNABORTED" ? 504 : 502);
  logProblem("provider error", error);
  // Keep the status code (the frontend retries on some of them), but never expose provider details.
  return res.status(status).json({ success: false, error: BUSY_MESSAGE });
}

function streamGroqResponse(req, res, stream) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  let buffer = "";
  let contentSent = false;
  let streamEnded = false;

  const finish = (errorMessage) => {
    if (streamEnded) return;
    if (errorMessage) res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
    streamEnded = true;
    res.write("data: [DONE]\n\n");
    res.end();
  };

  const processLine = (line) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const parsed = JSON.parse(data);
      const content = parsed.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content) {
        contentSent = true;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      }
      if (parsed.error) { logProblem("stream error event", parsed.error); finish(BUSY_MESSAGE); }
    } catch {
      logProblem("invalid stream event", null);
      finish(BUSY_MESSAGE);
    }
  };

  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    lines.forEach(processLine);
  });
  stream.on("end", () => {
    if (buffer.trim()) processLine(buffer.trim());
    if (!contentSent) logProblem("stream had no content", null);
    finish(contentSent ? null : BUSY_MESSAGE);
  });
  stream.on("error", (error) => { logProblem("stream interrupted", error); finish(BUSY_MESSAGE); });
  res.on("close", () => {
    if (!res.writableEnded && !stream.destroyed) stream.destroy();
  });
}

export default createAIRouter();