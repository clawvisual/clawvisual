#!/usr/bin/env node

const BASE_URL = process.env.CLAWVISUAL_MCP_URL || "http://localhost:3000/api/mcp";
const API_KEY = process.env.CLAWVISUAL_API_KEY || "";

function usage() {
  console.log(`clawvisual MCP client

Usage:
  node skills/clawvisual-mcp/scripts/clawvisual-mcp-client.mjs <command> [flags]

Commands:
  initialize
  tools
  convert --input <text> [--lang <code>] [--slides <1-8>] [--ratio 4:5|1:1|9:16|16:9] [--session <uuid>] [--review auto|required]
  status --job <job_id>
  revise --job <job_id> --instruction <text> [--intent rewrite_copy_style|regenerate_cover|regenerate_slides]
  regenerate-cover (--job <job_id> [--instruction <text>] | --prompt <text>) [--ratio 4:5|1:1|9:16|16:9]
  call --name <tool_name> --args <json>
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

async function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));

  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "initialize") {
    const result = await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "clawvisual-skill-client", version: "0.1.0" }
    });
    print(result);
    return;
  }

  if (command === "tools") {
    const result = await rpc("tools/list", {});
    print(result);
    return;
  }

  if (command === "convert") {
    if (!args.input || typeof args.input !== "string") {
      throw new Error("convert requires --input <text>");
    }

    const slides = Number(args.slides ?? 8);
    const ratio =
      args.ratio === "1:1" || args.ratio === "9:16" || args.ratio === "16:9"
        ? args.ratio
        : "4:5";

    const payload = {
      session_id: typeof args.session === "string" ? args.session : undefined,
      input_text: args.input,
      max_slides: Number.isFinite(slides) ? Math.max(1, Math.min(8, Math.round(slides))) : 8,
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
    if (!args.job || typeof args.job !== "string") {
      throw new Error("status requires --job <job_id>");
    }
    const result = await callTool("job_status", { job_id: args.job });
    print(result);
    return;
  }

  if (command === "revise") {
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
