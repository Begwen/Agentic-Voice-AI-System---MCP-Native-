#!/usr/bin/env node
import "dotenv/config";

/**
 * Standalone MCP Client — connects to the ElevenLabs MCP server and routes
 * tool calls through either Anthropic (Claude) or OpenAI (GPT).
 *
 * Usage:
 *   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-... npm run client
 *   LLM_PROVIDER=openai   OPENAI_API_KEY=sk-...   npm run client
 *
 * REPL commands:
 *   /prompts                   — list all MCP prompts
 *   /prompt <name> [key=value] — invoke an MCP prompt (args as key=value pairs)
 *   /voice                     — enter voice conversation mode (requires sox)
 *   exit / quit                — exit
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import * as readline from "node:readline";
import { spawn, execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unlinkSync, existsSync } from "node:fs";

// ─── Config ──────────────────────────────────────────────────────────────────

const LLM_PROVIDER = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
const SERVER_PATH = fileURLToPath(new URL("../build/index.js", import.meta.url));

const DEFAULT_SYSTEM =
  "You are a helpful assistant with access to ElevenLabs text-to-speech and speech-to-text tools. Use them when the user asks about voices, TTS, audio generation, or transcription.";

const VOICE_SYSTEM =
  "You are a voice AI assistant. IMPORTANT: After composing your reply, you MUST call text_to_speech to speak it aloud. Keep every response to 2-3 sentences — natural spoken language only, no markdown or lists.";

// ─── MCP Client ──────────────────────────────────────────────────────────────

async function createMcpClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_PATH],
    env: {
      ...(process.env as Record<string, string>),
      ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || "",
    },
  });
  const mcpClient = new Client({ name: "elevenlabs-cli-client", version: "2.0.0" });
  await mcpClient.connect(transport);
  return mcpClient;
}

// ─── Tool helpers ─────────────────────────────────────────────────────────────

interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

async function getMcpTools(mcpClient: Client): Promise<McpTool[]> {
  const { tools } = await mcpClient.listTools();
  return tools as McpTool[];
}

function toAnthropicTools(tools: McpTool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description || "",
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
  }));
}

function toOpenAITools(tools: McpTool[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.inputSchema as OpenAI.FunctionParameters,
    },
  }));
}

async function callTool(
  mcpClient: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await mcpClient.callTool({ name, arguments: args });
  return (result.content as { type: string; text: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

// ─── Anthropic chat loop ──────────────────────────────────────────────────────

async function chatAnthropic(
  mcpClient: Client,
  tools: McpTool[],
  userMessage: string,
  history: Anthropic.MessageParam[],
  systemOverride?: string,
): Promise<string> {
  const anthropic = new Anthropic();
  const anthropicTools = toAnthropicTools(tools);
  const system = systemOverride ?? DEFAULT_SYSTEM;

  history.push({ role: "user", content: userMessage });

  let response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system,
    tools: anthropicTools,
    messages: history,
  });

  const collectedMp3Paths: string[] = [];

  while (response.stop_reason === "tool_use") {
    const assistantContent = response.content;
    history.push({ role: "assistant", content: assistantContent });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of assistantContent) {
      if (block.type === "tool_use") {
        console.log(`  [tool: ${block.name}]`);
        const result = await callTool(
          mcpClient,
          block.name,
          block.input as Record<string, unknown>,
        );
        const mp3 = extractMp3Path(result);
        if (mp3) collectedMp3Paths.push(mp3);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
    }

    history.push({ role: "user", content: toolResults });

    response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system,
      tools: anthropicTools,
      messages: history,
    });
  }

  const finalText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  history.push({ role: "assistant", content: response.content });

  // Append the last MP3 path so callers can extract it via extractMp3Path
  const mp3Suffix =
    collectedMp3Paths.length > 0
      ? `\nAudio saved to: ${collectedMp3Paths[collectedMp3Paths.length - 1]}`
      : "";
  return finalText + mp3Suffix;
}

// ─── OpenAI chat loop ─────────────────────────────────────────────────────────

async function chatOpenAI(
  mcpClient: Client,
  tools: McpTool[],
  userMessage: string,
  history: OpenAI.ChatCompletionMessageParam[],
): Promise<string> {
  const openai = new OpenAI();
  const openaiTools = toOpenAITools(tools);

  history.push({ role: "user", content: userMessage });

  let response = await openai.chat.completions.create({
    model: "gpt-4o",
    tools: openaiTools,
    messages: history,
  });
  let message = response.choices[0].message;

  const collectedMp3Paths: string[] = [];

  while (message.tool_calls && message.tool_calls.length > 0) {
    history.push(message);
    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") continue;
      console.log(`  [tool: ${toolCall.function.name}]`);
      const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      const result = await callTool(mcpClient, toolCall.function.name, args);
      const mp3 = extractMp3Path(result);
      if (mp3) collectedMp3Paths.push(mp3);
      history.push({ role: "tool", tool_call_id: toolCall.id, content: result });
    }
    response = await openai.chat.completions.create({
      model: "gpt-4o",
      tools: openaiTools,
      messages: history,
    });
    message = response.choices[0].message;
  }

  const finalText = message.content || "(no response)";
  history.push(message);

  const mp3Suffix =
    collectedMp3Paths.length > 0
      ? `\nAudio saved to: ${collectedMp3Paths[collectedMp3Paths.length - 1]}`
      : "";
  return finalText + mp3Suffix;
}

// ─── Audio utilities ──────────────────────────────────────────────────────────

function playAudio(filePath: string): Promise<void> {
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];

    if (process.platform === "darwin") {
      cmd = "afplay";
      args = [filePath];
    } else if (process.platform === "linux") {
      cmd = "mpg123";
      args = ["-q", filePath];
    } else {
      console.log(`  [Audio saved: ${filePath} — open manually on Windows]`);
      resolve();
      return;
    }

    console.log(`  [Playing audio: ${filePath}]`);
    const player = spawn(cmd, args, { stdio: "pipe" });
    player.on("close", (code) => {
      if (code !== 0) console.warn(`  [afplay exited with code ${code} — check file: ${filePath}]`);
      resolve();
    });
    player.on("error", (err) => {
      console.warn(`  [Could not auto-play (${err.message}) — open manually: ${filePath}]`);
      resolve();
    });
  });
}

function isSoxInstalled(): boolean {
  try {
    execSync("which rec", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function startRecording(filePath: string): ReturnType<typeof spawn> {
  // sox `rec` command: brew install sox (macOS) or apt install sox (Linux)
  return spawn(
    "rec",
    ["-r", "16000", "-c", "1", "-b", "16", "-e", "signed-integer", filePath],
    { stdio: "ignore" },
  );
}

// Extract MP3 path from a text_to_speech tool result string
function extractMp3Path(text: string): string | null {
  const m = text.match(/Audio saved to:\s*(.+?\.mp3)/);
  return m ? m[1].trim() : null;
}

// ─── Prompt commands ──────────────────────────────────────────────────────────

async function listPromptsCmd(mcpClient: Client): Promise<void> {
  const { prompts } = await mcpClient.listPrompts();
  if (prompts.length === 0) {
    console.log("No prompts available.\n");
    return;
  }
  console.log("\nAvailable prompts:");
  for (const p of prompts) {
    console.log(`  ${p.name}${p.description ? ` — ${p.description}` : ""}`);
    if (p.arguments && p.arguments.length > 0) {
      const argList = p.arguments
        .map((a) => (a.required ? a.name : `[${a.name}]`))
        .join(", ");
      console.log(`    args: ${argList}`);
    }
  }
  console.log(
    '\nUsage: /prompt <name> key="value" [key2="value2"]\n',
  );
}

function parseKvArgs(str: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]*)"|([\S]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    result[m[1]] = m[2] ?? m[3] ?? "";
  }
  return result;
}

async function invokePromptCmd(
  argsStr: string,
  mcpClient: Client,
  tools: McpTool[],
  anthropicHistory: Anthropic.MessageParam[],
  openaiHistory: OpenAI.ChatCompletionMessageParam[],
): Promise<void> {
  const spaceIdx = argsStr.indexOf(" ");
  const promptName = spaceIdx === -1 ? argsStr : argsStr.slice(0, spaceIdx);
  const kvStr = spaceIdx === -1 ? "" : argsStr.slice(spaceIdx + 1);
  const promptArgs = parseKvArgs(kvStr);

  console.log(`\nLoading prompt "${promptName}"...\n`);

  let result: Awaited<ReturnType<typeof mcpClient.getPrompt>>;
  try {
    result = await mcpClient.getPrompt({ name: promptName, arguments: promptArgs });
  } catch (err) {
    console.error(`  Error: ${err}\n`);
    return;
  }

  // Inject all-but-last messages as prior context, use the last as the user turn
  const messages = result.messages;
  for (const msg of messages.slice(0, -1)) {
    if (msg.content.type === "text") {
      const role = msg.role as "user" | "assistant";
      anthropicHistory.push({ role, content: msg.content.text });
      openaiHistory.push({ role, content: msg.content.text });
    }
  }

  const last = messages[messages.length - 1];
  const userText =
    last && last.content.type === "text" ? last.content.text : "Please begin.";

  try {
    let reply: string;
    if (LLM_PROVIDER === "anthropic") {
      reply = await chatAnthropic(mcpClient, tools, userText, anthropicHistory);
    } else {
      reply = await chatOpenAI(mcpClient, tools, userText, openaiHistory);
    }
    console.log(`\nAssistant: ${reply}\n`);

    // Auto-play any audio that was generated
    const mp3 = extractMp3Path(reply);
    if (mp3) await playAudio(mp3);
  } catch (err) {
    console.error(`  Error: ${err}\n`);
  }
}

// ─── Voice loop ───────────────────────────────────────────────────────────────

async function voiceLoop(
  rl: readline.Interface,
  mcpClient: Client,
  tools: McpTool[],
  anthropicHistory: Anthropic.MessageParam[],
  openaiHistory: OpenAI.ChatCompletionMessageParam[],
): Promise<void> {
  if (!isSoxInstalled()) {
    console.error(
      "  sox not found. Install it first:\n" +
        "    macOS:  brew install sox\n" +
        "    Linux:  sudo apt install sox\n",
    );
    return;
  }

  console.log("\n[Voice Mode] The agent will listen and speak back.");
  console.log("[Voice Mode] Type 'exit' at any prompt to return to text mode.\n");

  // Reuse the shared histories so /prompt context carries into voice mode
  const voiceAnthropicHistory = anthropicHistory;
  const voiceOpenAIHistory = openaiHistory;

  const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

  while (true) {
    const start = await ask("Press ENTER to speak (or type 'exit'): ");
    if (start.trim().toLowerCase() === "exit") break;

    const tmpFile = join(tmpdir(), `elabs_${Date.now()}.wav`);
    const rec = startRecording(tmpFile);

    const stop = await ask("  Recording... Press ENTER to stop: ");
    rec.kill("SIGTERM");

    if (stop.trim().toLowerCase() === "exit") {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
      break;
    }

    // Let sox flush the file
    await new Promise((r) => setTimeout(r, 400));

    if (!existsSync(tmpFile)) {
      console.log("  (No audio captured — try again)\n");
      continue;
    }

    // Transcribe
    console.log("  Transcribing...");
    let transcript: string;
    try {
      transcript = await callTool(mcpClient, "speech_to_text", { file_path: tmpFile, language_code: "en" });
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    } catch (err) {
      console.error(`  STT error: ${err}\n`);
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
      continue;
    }

    if (!transcript.trim()) {
      console.log("  (No speech detected — try again)\n");
      continue;
    }

    console.log(`\nYou: "${transcript}"`);

    // Get LLM response
    let reply: string;
    try {
      if (LLM_PROVIDER === "anthropic") {
        reply = await chatAnthropic(
          mcpClient,
          tools,
          transcript,
          voiceAnthropicHistory,
          VOICE_SYSTEM,
        );
      } else {
        reply = await chatOpenAI(mcpClient, tools, transcript, voiceOpenAIHistory);
      }
    } catch (err) {
      console.error(`  LLM error: ${err}\n`);
      continue;
    }

    console.log(`\nAssistant: ${reply}\n`);

    // Play audio — try what the LLM generated, fall back to a manual TTS call
    const mp3 = extractMp3Path(reply);
    if (mp3) {
      await playAudio(mp3);
    } else {
      console.log("  (Generating audio...)");
      try {
        const ttsOut = await callTool(mcpClient, "text_to_speech", {
          text: reply.slice(0, 500),
        });
        const fallbackMp3 = extractMp3Path(ttsOut);
        if (fallbackMp3) await playAudio(fallbackMp3);
      } catch { /* playback is best-effort */ }
    }

    console.log();
  }

  console.log("\n[Returned to text mode]\n");
}

// ─── Main REPL ────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("Error: ELEVENLABS_API_KEY is required.");
    process.exit(1);
  }
  if (LLM_PROVIDER === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY is required when using Anthropic provider.");
    process.exit(1);
  }
  if (LLM_PROVIDER === "openai" && !process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY is required when using OpenAI provider.");
    process.exit(1);
  }

  console.log(`ElevenLabs Voice Agent — MCP Client (provider: ${LLM_PROVIDER})\n`);

  const mcpClient = await createMcpClient();
  const tools = await getMcpTools(mcpClient);

  console.log(`Connected! ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
  console.log("Commands: /prompts  /prompt <name> [args]  /voice  exit\n");

  const anthropicHistory: Anthropic.MessageParam[] = [];
  const openaiHistory: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: DEFAULT_SYSTEM },
  ];

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { ask(); return; }

      if (trimmed === "exit" || trimmed === "quit") {
        console.log("Goodbye!");
        rl.close();
        process.exit(0);
      }

      if (trimmed === "/prompts") {
        await listPromptsCmd(mcpClient).catch(console.error);
        ask();
        return;
      }

      if (trimmed.startsWith("/prompt ")) {
        await invokePromptCmd(
          trimmed.slice(8).trim(),
          mcpClient,
          tools,
          anthropicHistory,
          openaiHistory,
        ).catch(console.error);
        ask();
        return;
      }

      if (trimmed === "/voice") {
        await voiceLoop(rl, mcpClient, tools, anthropicHistory, openaiHistory).catch(console.error);
        ask();
        return;
      }

      // Regular text chat
      try {
        let reply: string;
        if (LLM_PROVIDER === "anthropic") {
          reply = await chatAnthropic(mcpClient, tools, trimmed, anthropicHistory);
        } else {
          reply = await chatOpenAI(mcpClient, tools, trimmed, openaiHistory);
        }
        console.log(`\nAssistant: ${reply}\n`);

        // Auto-play any audio the LLM generated
        const mp3 = extractMp3Path(reply);
        if (mp3) await playAudio(mp3);
      } catch (err) {
        console.error(`\nError: ${err}\n`);
      }

      ask();
    });
  };

  ask();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
