#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const out = { toolsModulePath: "", toolName: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--tools-module") {
      out.toolsModulePath = argv[i + 1] ?? "";
      i += 1;
    } else if (argv[i] === "--tool") {
      out.toolName = argv[i + 1] ?? "";
      i += 1;
    }
  }
  return out;
}

function blockNetwork() {
  const fail = () => {
    throw new Error("Network access is blocked in PromptManager tool subprocess.");
  };

  globalThis.fetch = async () => {
    throw new Error("Network access is blocked in PromptManager tool subprocess.");
  };

  http.request = fail;
  http.get = fail;
  https.request = fail;
  https.get = fail;
  net.connect = fail;
  net.createConnection = fail;
  tls.connect = fail;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeResponse(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

(async () => {
  try {
    const { toolsModulePath, toolName } = parseArgs(process.argv.slice(2));

    if (!toolsModulePath || !toolName) {
      writeResponse({
        ok: false,
        error: { code: "INVALID_WORKER_ARGS", message: "Missing --tools-module or --tool." },
      });
      process.exit(1);
      return;
    }

    if ((process.env.PROMPTMGR_BLOCK_NETWORK ?? "true") !== "false") {
      blockNetwork();
    }

    const payloadRaw = await readStdin();
    const payload = payloadRaw ? JSON.parse(payloadRaw) : {};

    const resolvedModulePath = path.resolve(process.cwd(), toolsModulePath);
    if (!fs.existsSync(resolvedModulePath)) {
      writeResponse({
        ok: false,
        error: {
          code: "TOOLS_MODULE_NOT_FOUND",
          message: `Tools module not found: ${resolvedModulePath}`,
        },
      });
      process.exit(1);
      return;
    }

    const moduleUrl = `${pathToFileURL(resolvedModulePath).href}?v=${Date.now()}`;
    const mod = await import(moduleUrl);
    const handlers = mod.handlers ?? mod.default?.handlers;

    if (!handlers || typeof handlers !== "object") {
      writeResponse({
        ok: false,
        error: {
          code: "HANDLERS_MISSING",
          message: "Tools module must export a 'handlers' object.",
        },
      });
      process.exit(1);
      return;
    }

    const handler = handlers[toolName];
    if (typeof handler !== "function") {
      writeResponse({
        ok: false,
        error: {
          code: "TOOL_NOT_FOUND",
          message: `No handler exported for tool '${toolName}'.`,
        },
      });
      process.exit(1);
      return;
    }

    const args = payload.args ?? null;
    const context = payload.context ?? {};
    const result = await handler(args, context);
    writeResponse({ ok: true, result });
  } catch (error) {
    writeResponse({
      ok: false,
      error: {
        code: "TOOL_EXECUTION_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    });
    process.exit(1);
  }
})();
