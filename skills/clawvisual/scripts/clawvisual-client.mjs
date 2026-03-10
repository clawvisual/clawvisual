#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const CONFIG_DIR = path.join(os.homedir(), ".clawvisual");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const SERVICE_FILE = path.join(CONFIG_DIR, "service.json");
const CONFIG_ALIASES = {
  LLM_API_KEY: "CLAWVISUAL_LLM_API_KEY",
  CLAWVISUAL_LLM_API_KEY: "CLAWVISUAL_LLM_API_KEY",
  LLM_API_URL: "CLAWVISUAL_LLM_API_URL",
  CLAWVISUAL_LLM_API_URL: "CLAWVISUAL_LLM_API_URL",
  LLM_MODEL: "CLAWVISUAL_LLM_MODEL",
  CLAWVISUAL_LLM_MODEL: "CLAWVISUAL_LLM_MODEL",
  MCP_URL: "CLAWVISUAL_MCP_URL",
  CLAWVISUAL_MCP_URL: "CLAWVISUAL_MCP_URL",
  CLAWVISUAL_API_KEY: "CLAWVISUAL_API_KEY",
  GEMINI_API_KEY: "CLAWVISUAL_GEMINI_API_KEY",
  CLAWVISUAL_GEMINI_API_KEY: "CLAWVISUAL_GEMINI_API_KEY"
};
const SECRET_KEYS = new Set(["CLAWVISUAL_LLM_API_KEY", "CLAWVISUAL_API_KEY", "CLAWVISUAL_GEMINI_API_KEY"]);
const REQUIRED_TOOLS = new Set(["convert", "job_status", "revise", "regenerate_cover"]);
const LOCAL_CONFIG = readLocalConfig();
const BASE_URL = process.env.CLAWVISUAL_MCP_URL || getConfigValue(LOCAL_CONFIG, "CLAWVISUAL_MCP_URL") || "http://localhost:3000/api/mcp";
const API_KEY = process.env.CLAWVISUAL_API_KEY || getConfigValue(LOCAL_CONFIG, "CLAWVISUAL_API_KEY");
const AUTO_START_DISABLED = process.env.CLAWVISUAL_NO_AUTO_START === "1";

function readLocalConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeLocalConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function readServiceState() {
  try {
    const raw = fs.readFileSync(SERVICE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeServiceState(state) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SERVICE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function clearServiceState() {
  try {
    fs.rmSync(SERVICE_FILE, { force: true });
  } catch {
    // Ignore cleanup errors.
  }
}

function normalizeConfigKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") return null;
  const normalized = rawKey.trim().toUpperCase();
  return CONFIG_ALIASES[normalized] ?? null;
}

function getConfigValue(config, key) {
  return typeof config[key] === "string" ? config[key] : "";
}

function getEffectiveServerEnv() {
  const env = { ...process.env };
  if (!env.LLM_API_KEY) env.LLM_API_KEY = getConfigValue(LOCAL_CONFIG, "CLAWVISUAL_LLM_API_KEY");
  if (!env.LLM_API_URL) env.LLM_API_URL = getConfigValue(LOCAL_CONFIG, "CLAWVISUAL_LLM_API_URL");
  if (!env.LLM_MODEL) env.LLM_MODEL = getConfigValue(LOCAL_CONFIG, "CLAWVISUAL_LLM_MODEL");
  if (!env.GEMINI_API_KEY) env.GEMINI_API_KEY = getConfigValue(LOCAL_CONFIG, "CLAWVISUAL_GEMINI_API_KEY");
  return env;
}

function maskConfigValue(key, value) {
  if (!value) return "";
  if (!SECRET_KEYS.has(key)) return value;
  return value.length <= 8 ? "********" : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseBaseUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isLocalhostUrl(raw) {
  const parsed = parseBaseUrl(raw);
  if (!parsed) return false;
  return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
}

function getWebUrl(raw) {
  const parsed = parseBaseUrl(raw);
  if (!parsed) return "http://localhost:3000";
  return `${parsed.protocol}//${parsed.host}`;
}

function getPort(raw) {
  const parsed = parseBaseUrl(raw);
  if (!parsed) return 3000;
  if (parsed.port) return Number(parsed.port);
  return parsed.protocol === "https:" ? 443 : 80;
}

function resolveNextBin() {
  return path.join(PACKAGE_ROOT, "node_modules", "next", "dist", "bin", "next");
}

function normalizeToolNames(payload) {
  const tools = payload?.payload?.result?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => (tool && typeof tool === "object" ? tool.name : undefined)).filter((name) => typeof name === "string");
}

function isClawvisualInitialize(payload) {
  return payload?.payload?.result?.serverInfo?.name === "clawvisual";
}

async function probeServiceIdentity() {
  try {
    const init = await rpc(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "clawvisual-skill-client", version: "0.1.0" }
      },
      9001
    );
    if (!init.ok) {
      return { reachable: false, clawvisual: false, reason: "unreachable" };
    }
    if (!isClawvisualInitialize(init)) {
      return { reachable: true, clawvisual: false, reason: "serverInfo mismatch", payload: init.payload };
    }
    const tools = await rpc("tools/list", {}, 9002);
    if (!tools.ok) {
      return { reachable: true, clawvisual: false, reason: "tools/list failed", payload: tools.payload };
    }
    const names = normalizeToolNames(tools);
    const hasAllRequiredTools = [...REQUIRED_TOOLS].every((name) => names.includes(name));
    return {
      reachable: true,
      clawvisual: hasAllRequiredTools,
      reason: hasAllRequiredTools ? "ok" : "missing required tools",
      serverName: init.payload?.result?.serverInfo?.name,
      serverVersion: init.payload?.result?.serverInfo?.version,
      tools: names
    };
  } catch {
    return { reachable: false, clawvisual: false, reason: "unreachable" };
  }
}

async function ensureServerReady() {
  const initialProbe = await probeServiceIdentity();
  if (initialProbe.clawvisual) {
    return { ready: true, started: false };
  }
  if (initialProbe.reachable && !initialProbe.clawvisual) {
    throw new Error(
      `MCP endpoint is reachable at ${BASE_URL}, but it is not clawvisual (${initialProbe.reason}). Set CLAWVISUAL_MCP_URL to your clawvisual service.`
    );
  }

  if (AUTO_START_DISABLED) {
    throw new Error(`Cannot connect to MCP server: ${BASE_URL}. Auto-start is disabled by CLAWVISUAL_NO_AUTO_START=1.`);
  }

  if (!isLocalhostUrl(BASE_URL)) {
    throw new Error(
      `Cannot connect to MCP server: ${BASE_URL}. Auto-start only works for localhost/127.0.0.1; set CLAWVISUAL_MCP_URL to a reachable endpoint.`
    );
  }

  const nextBin = resolveNextBin();
  if (!fs.existsSync(nextBin)) {
    throw new Error(
      "Cannot auto-start local service because Next.js runtime is missing in this package. Reinstall clawvisual from npm."
    );
  }
  const port = getPort(BASE_URL);
  const child = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: PACKAGE_ROOT,
    env: getEffectiveServerEnv(),
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  if (Number.isInteger(child.pid) && child.pid > 0) {
    writeServiceState({
      pid: child.pid,
      mcp_url: BASE_URL,
      web_url: getWebUrl(BASE_URL),
      started_at: new Date().toISOString()
    });
  }

  for (let i = 0; i < 120; i += 1) {
    await sleep(500);
    const probe = await probeServiceIdentity();
    if (probe.clawvisual) {
      return { ready: true, started: true, webUrl: getWebUrl(BASE_URL) };
    }
    if (probe.reachable && !probe.clawvisual) {
      throw new Error(
        `MCP endpoint at ${BASE_URL} responded but is not clawvisual (${probe.reason}). Another service may be using this port.`
      );
    }
  }

  throw new Error(
    `Auto-start attempted, but MCP server is still unavailable at ${BASE_URL}. Try running 'npm run dev' in the clawvisual package directory.`
  );
}

async function stopManagedService() {
  const state = readServiceState();
  if (!state) {
    return {
      ok: false,
      stopped: false,
      reason: "No managed clawvisual service record found. If service was started manually, stop it from that terminal."
    };
  }

  const pid = Number(state.pid);
  if (!isPidAlive(pid)) {
    clearServiceState();
    return {
      ok: true,
      stopped: false,
      pid,
      reason: "Managed process is already stopped; cleaned up stale PID record."
    };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    return {
      ok: false,
      stopped: false,
      pid,
      reason: `Failed to stop process ${pid}: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  for (let i = 0; i < 20; i += 1) {
    await sleep(150);
    if (!isPidAlive(pid)) {
      clearServiceState();
      return {
        ok: true,
        stopped: true,
        pid,
        mcp_url: state.mcp_url ?? BASE_URL,
        web_url: state.web_url ?? getWebUrl(BASE_URL)
      };
    }
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Best effort.
  }

  await sleep(150);
  const alive = isPidAlive(pid);
  if (!alive) {
    clearServiceState();
  }

  return {
    ok: !alive,
    stopped: !alive,
    pid,
    mcp_url: state.mcp_url ?? BASE_URL,
    web_url: state.web_url ?? getWebUrl(BASE_URL),
    reason: alive ? "Process is still running after SIGTERM/SIGKILL attempt." : undefined
  };
}

function usage() {
  console.log(`clawvisual MCP client

Usage:
  clawvisual <command> [flags]

Commands:
  initialize                                  (auto-start local web service when needed)
  stop                                        (stop local service started by clawvisual initialize)
  restart                                     (stop then initialize)
  set <key> <value>                           (store CLI config values)
  get <key>
  unset <key>
  config                                      (list stored config values)
  tools
  convert --input <text> [--lang <code>] [--slides auto|1-8] [--ratio 4:5|1:1|9:16|16:9] [--session <uuid>] [--review auto|required]
  status [--job <job_id>]
  revise --job <job_id> --instruction <text> [--intent rewrite_copy_style|regenerate_cover|regenerate_slides]
  regenerate-cover (--job <job_id> [--instruction <text>] | --prompt <text>) [--ratio 4:5|1:1|9:16|16:9]
  call --name <tool_name> --args <json>

Config keys:
  CLAWVISUAL_LLM_API_KEY | CLAWVISUAL_LLM_API_URL | CLAWVISUAL_LLM_MODEL | CLAWVISUAL_GEMINI_API_KEY | CLAWVISUAL_MCP_URL | CLAWVISUAL_API_KEY
`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

async function rpc(method, params = {}, id = 1) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (API_KEY) {
    headers["x-api-key"] = API_KEY;
  }

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    })
  });

  const payload = await res.json().catch(() => ({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: `Non-JSON response (${res.status})`
    }
  }));

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      payload
    };
  }

  return {
    ok: true,
    status: res.status,
    payload
  };
}

async function callTool(name, args, id = 2) {
  return rpc("tools/call", { name, arguments: args }, id);
}

function print(data) {
  console.log(JSON.stringify(data, null, 2));
}

function parseJsonOrThrow(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

function handleSetCommand(argv) {
  const key = normalizeConfigKey(argv[0]);
  const value = argv[1];
  if (!key || typeof value !== "string") {
    throw new Error("set requires: clawvisual set <key> <value>");
  }
  const config = readLocalConfig();
  config[key] = value;
  writeLocalConfig(config);
  print({
    ok: true,
    action: "set",
    key,
    value: maskConfigValue(key, value),
    config_file: CONFIG_FILE
  });
}

function handleGetCommand(argv) {
  const key = normalizeConfigKey(argv[0]);
  if (!key) {
    throw new Error("get requires: clawvisual get <key>");
  }
  const config = readLocalConfig();
  const value = getConfigValue(config, key);
  print({
    ok: Boolean(value),
    key,
    value: maskConfigValue(key, value),
    config_file: CONFIG_FILE
  });
}

function handleUnsetCommand(argv) {
  const key = normalizeConfigKey(argv[0]);
  if (!key) {
    throw new Error("unset requires: clawvisual unset <key>");
  }
  const config = readLocalConfig();
  delete config[key];
  writeLocalConfig(config);
  print({
    ok: true,
    action: "unset",
    key,
    config_file: CONFIG_FILE
  });
}

function handleConfigCommand() {
  const config = readLocalConfig();
  const values = Object.entries(config)
    .map(([key, value]) => {
      const normalizedKey = normalizeConfigKey(key);
      if (!normalizedKey) return null;
      return {
        key: normalizedKey,
        value: maskConfigValue(normalizedKey, typeof value === "string" ? value : "")
      };
    })
    .filter(Boolean);
  print({
    ok: true,
    config_file: CONFIG_FILE,
    values
  });
}

async function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));
  const positional = process.argv.slice(3).filter((token) => !token.startsWith("--"));

  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "set") {
    handleSetCommand(positional);
    return;
  }

  if (command === "get") {
    handleGetCommand(positional);
    return;
  }

  if (command === "unset") {
    handleUnsetCommand(positional);
    return;
  }

  if (command === "config") {
    handleConfigCommand();
    return;
  }

  if (command === "stop") {
    const result = await stopManagedService();
    print(result);
    return;
  }

  if (command === "restart") {
    const stopped = await stopManagedService();
    const server = await ensureServerReady();
    const result = await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "clawvisual-skill-client", version: "0.1.0" }
    });
    const webUrl = server.webUrl || getWebUrl(BASE_URL);
    console.log(`Service restarted. Web UI: ${webUrl}`);
    print({ restarted: true, stop: stopped, initialize: result });
    return;
  }

  if (command === "initialize") {
    const server = await ensureServerReady();
    const result = await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "clawvisual-skill-client", version: "0.1.0" }
    });
    const webUrl = server.webUrl || getWebUrl(BASE_URL);
    console.log(server.started ? `Service started. Web UI: ${webUrl}` : `Service ready. Web UI: ${webUrl}`);
    print(result);
    return;
  }

  if (command === "tools") {
    await ensureServerReady();
    const result = await rpc("tools/list", {});
    print(result);
    return;
  }

  if (command === "convert") {
    await ensureServerReady();
    if (!args.input || typeof args.input !== "string") {
      throw new Error("convert requires --input <text>");
    }

    const normalizedSlidesArg = typeof args.slides === "string" ? args.slides.trim().toLowerCase() : "";
    const parsedSlides = normalizedSlidesArg && normalizedSlidesArg !== "auto" ? Number(normalizedSlidesArg) : NaN;
    const slideCount = Number.isFinite(parsedSlides) ? Math.max(1, Math.min(8, Math.round(parsedSlides))) : undefined;
    const ratio =
      args.ratio === "1:1" || args.ratio === "9:16" || args.ratio === "16:9"
        ? args.ratio
        : "4:5";

    const payload = {
      session_id: typeof args.session === "string" ? args.session : undefined,
      input_text: args.input,
      max_slides: slideCount,
      aspect_ratios: [ratio],
      style_preset: typeof args.style === "string" ? args.style : "auto",
      tone: typeof args.tone === "string" ? args.tone : "auto",
      generation_mode: typeof args.mode === "string" ? args.mode : "quote_slides",
      output_language: typeof args.lang === "string" ? args.lang : "en-US",
      review_mode: args.review === "required" ? "required" : "auto"
    };

    const result = await callTool("convert", payload);
    print(result);
    return;
  }

  if (command === "status") {
    if (!args.job) {
      const probe = await probeServiceIdentity();
      print({
        ok: probe.clawvisual,
        service: probe.serverName ?? null,
        version: probe.serverVersion ?? null,
        endpoint: BASE_URL,
        web_url: getWebUrl(BASE_URL),
        reason: probe.reason,
        tools: probe.tools ?? []
      });
      return;
    }
    await ensureServerReady();
    if (typeof args.job !== "string") {
      throw new Error("status --job requires <job_id>");
    }
    const result = await callTool("job_status", { job_id: args.job });
    print(result);
    return;
  }

  if (command === "revise") {
    await ensureServerReady();
    if (!args.job || typeof args.job !== "string") {
      throw new Error("revise requires --job <job_id>");
    }
    if (!args.instruction || typeof args.instruction !== "string") {
      throw new Error("revise requires --instruction <text>");
    }

    const payload = {
      job_id: args.job,
      intent:
        args.intent === "regenerate_cover" || args.intent === "regenerate_slides"
          ? args.intent
          : "rewrite_copy_style",
      instruction: args.instruction,
      preserve_facts: true,
      preserve_slide_structure: true,
      preserve_layout: true
    };

    const result = await callTool("revise", payload);
    print(result);
    return;
  }

  if (command === "regenerate-cover") {
    await ensureServerReady();
    const ratio = args.ratio === "1:1" || args.ratio === "9:16" || args.ratio === "16:9" ? args.ratio : "4:5";

    if (args.job && typeof args.job === "string") {
      const result = await callTool("regenerate_cover", {
        job_id: args.job,
        instruction:
          typeof args.instruction === "string"
            ? args.instruction
            : "Regenerate cover with stronger hook and contrast",
        mode: "reprompt"
      });
      print(result);
      return;
    }

    if (args.prompt && typeof args.prompt === "string") {
      const result = await callTool("regenerate_cover", {
        prompt: args.prompt,
        aspect_ratio: ratio
      });
      print(result);
      return;
    }

    throw new Error("regenerate-cover requires either --job <job_id> or --prompt <text>");
  }

  if (command === "call") {
    await ensureServerReady();
    if (!args.name || typeof args.name !== "string") {
      throw new Error("call requires --name <tool_name>");
    }
    const toolArgs = typeof args.args === "string" ? parseJsonOrThrow(args.args, "--args") : {};
    const result = await callTool(args.name, toolArgs);
    print(result);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  print({ ok: false, error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
