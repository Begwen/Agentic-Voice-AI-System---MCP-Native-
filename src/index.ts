#!/usr/bin/env node
import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeFile, readFile } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { ElevenLabsClient } from "./elevenlabs-client.js";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Error: ELEVENLABS_API_KEY environment variable is required.");
  process.exit(1);
}

const client = new ElevenLabsClient(apiKey);
const OUTPUT_DIR = resolve(process.env.ELEVENLABS_OUTPUT_DIR || process.cwd());

const server = new McpServer({
  name: "elevenlabs-mcp-server",
  version: "2.0.0",
});

// ─── TOOLS ───────────────────────────────────────────────────────────────────

server.registerTool(
  "list_voices",
  {
    description: "List all voices available in ElevenLabs. Returns voice IDs, names, and labels.",
  },
  async () => {
    const voices = await client.listVoices();
    const summary = voices.map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    };
  },
);

server.registerTool(
  "get_voice",
  {
    description: "Get detailed information about a specific ElevenLabs voice by its ID.",
    inputSchema: {
      voice_id: z.string().describe("The ID of the voice to retrieve"),
    },
  },
  async ({ voice_id }) => {
    const voice = await client.getVoice(voice_id);
    return {
      content: [{ type: "text", text: JSON.stringify(voice, null, 2) }],
    };
  },
);

server.registerTool(
  "list_models",
  {
    description:
      "List all available ElevenLabs TTS models with their capabilities and supported languages.",
  },
  async () => {
    const models = await client.listModels();
    const summary = models.map((m) => ({
      model_id: m.model_id,
      name: m.name,
      description: m.description,
      can_do_text_to_speech: m.can_do_text_to_speech,
      languages: m.languages.map((l) => l.name),
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    };
  },
);

server.registerTool(
  "text_to_speech",
  {
    description:
      "Convert text to speech using ElevenLabs. Saves the audio as an MP3 file and returns the file path.",
    inputSchema: {
      text: z.string().describe("The text to convert to speech"),
      voice_id: z
        .string()
        .optional()
        .describe("Voice ID to use (default: Rachel — 21m00Tcm4TlvDq8ikWAM)"),
      model_id: z
        .string()
        .optional()
        .describe("Model ID (default: eleven_multilingual_v2)"),
      output_filename: z
        .string()
        .optional()
        .describe("Output filename (default: output_<timestamp>.mp3)"),
      stability: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Voice stability 0-1 (default: 0.5)"),
      similarity_boost: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Voice similarity boost 0-1 (default: 0.75)"),
    },
  },
  async ({ text, voice_id, model_id, output_filename, stability, similarity_boost }) => {
    const vid = voice_id ?? "21m00Tcm4TlvDq8ikWAM"; // Rachel
    const mid = model_id ?? "eleven_multilingual_v2";
    const fname = output_filename ?? `output_${Date.now()}.mp3`;
    const filePath = join(OUTPUT_DIR, fname);

    const settings =
      stability !== undefined || similarity_boost !== undefined
        ? { stability: stability ?? 0.5, similarity_boost: similarity_boost ?? 0.75 }
        : undefined;

    const audio = await client.textToSpeech(vid, text, mid, settings);
    await writeFile(filePath, audio);

    return {
      content: [
        {
          type: "text",
          text: `Audio saved to: ${filePath} (${audio.length} bytes, voice: ${vid}, model: ${mid})`,
        },
      ],
    };
  },
);

server.registerTool(
  "speech_to_text",
  {
    description:
      "Transcribe an audio file to text using ElevenLabs Speech-to-Text (scribe_v1). Supports WAV, MP3, and other common formats.",
    inputSchema: {
      file_path: z.string().describe("Absolute path to the audio file to transcribe"),
      model_id: z.string().optional().describe("STT model ID (default: scribe_v1)"),
      language_code: z
        .string()
        .optional()
        .describe("BCP-47 language code to force recognition language (e.g. 'en', 'hi', 'es'). Leave unset for auto-detect."),
    },
  },
  async ({ file_path, model_id, language_code }) => {
    const audioBuffer = await readFile(file_path);
    const filename = basename(file_path);
    const transcript = await client.speechToText(
      audioBuffer,
      filename,
      model_id ?? "scribe_v1",
      language_code,
    );
    return {
      content: [{ type: "text", text: transcript }],
    };
  },
);

server.registerTool(
  "get_user_info",
  {
    description:
      "Get the current ElevenLabs user/subscription info including character usage and limits.",
  },
  async () => {
    const info = await client.getUserInfo();
    return {
      content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
    };
  },
);

server.registerTool(
  "get_history",
  {
    description: "Retrieve the history of TTS generations from ElevenLabs.",
    inputSchema: {
      page_size: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of history items to retrieve (default: 20)"),
    },
  },
  async ({ page_size }) => {
    const history = await client.getHistory(page_size ?? 20);
    return {
      content: [{ type: "text", text: JSON.stringify(history, null, 2) }],
    };
  },
);

// ─── PROMPTS ─────────────────────────────────────────────────────────────────

server.registerPrompt(
  "voice_agent_persona",
  {
    description:
      "Create a voice AI agent with a specific persona. The agent picks a matching ElevenLabs voice and speaks every response aloud via text_to_speech.",
    argsSchema: {
      name: z.string().describe("Agent name (e.g., 'Aria', 'Max')"),
      personality: z
        .string()
        .describe(
          "Agent personality (e.g., 'friendly and professional', 'witty and casual')",
        ),
      voice_style: z
        .string()
        .optional()
        .describe(
          "Preferred voice character (e.g., 'deep and calm', 'bright and energetic')",
        ),
    },
  },
  async ({ name, personality, voice_style }) => {
    const voices = await client.listVoices();
    const voiceList = voices
      .slice(0, 20)
      .map((v) => `  - ${v.name} [${v.voice_id}]: ${JSON.stringify(v.labels)}`)
      .join("\n");

    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are ${name}, a voice AI agent.
Personality: ${personality}.${voice_style ? `\nVoice character: ${voice_style}.` : ""}

CRITICAL RULES:
1. EVERY response MUST end with a call to text_to_speech to speak it aloud.
2. Choose the most fitting voice from the list below for your persona.
3. Keep responses to 2-3 sentences — you are speaking, not writing.
4. Use natural spoken language: contractions, short sentences, no bullet points or markdown.

Available voices (pick the best fit):
${voiceList}

Begin by introducing yourself briefly and asking how you can help. Speak this aloud via text_to_speech.`,
          },
        },
      ],
    };
  },
);

server.registerPrompt(
  "start_voice_session",
  {
    description:
      "Initialize a live voice conversation. The agent listens via speech_to_text and responds aloud via text_to_speech in a continuous loop.",
    argsSchema: {
      topic: z
        .string()
        .optional()
        .describe(
          "Conversation domain (e.g., 'customer support', 'language tutor', 'trivia host')",
        ),
      language: z.string().optional().describe("Conversation language (default: English)"),
      voice_id: z
        .string()
        .optional()
        .describe("ElevenLabs voice ID to use throughout the session"),
    },
  },
  async ({ topic, language, voice_id }) => {
    const lang = language ?? "English";
    const topicLine = topic
      ? `You are specialized in: ${topic}.`
      : "You are a general-purpose voice assistant.";
    const voiceLine = voice_id
      ? `Use voice ID "${voice_id}" for ALL text_to_speech calls in this session.`
      : "Call list_voices once, pick the voice that best suits the conversation, then use it consistently.";

    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are a voice AI assistant conducting a spoken conversation in ${lang}. ${topicLine}

${voiceLine}

STRICT RULES for this session:
1. ALWAYS call text_to_speech with your response before returning any text.
2. Responses must be brief and conversational — imagine you are talking, not writing.
3. No markdown, no lists, no headers. Plain spoken sentences only.
4. If the user provides an audio file path, call speech_to_text to transcribe it first.

The session is now live. Greet the user and speak the greeting aloud via text_to_speech.`,
          },
        },
      ],
    };
  },
);

server.registerPrompt(
  "find_voice_for_role",
  {
    description:
      "Analyze available voices and recommend the best matches for a specific use case, with audio samples for each.",
    argsSchema: {
      role: z
        .string()
        .describe(
          "The role or use case (e.g., 'podcast narrator', 'children story reader', 'corporate IVR')",
        ),
      phrase: z
        .string()
        .optional()
        .describe(
          "Custom sample phrase to use for the audio samples. If omitted, a role-appropriate phrase is generated automatically.",
        ),
    },
  },
  ({ role, phrase }) =>
    Promise.resolve({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Find the best ElevenLabs voice for this role: "${role}"

Steps:
1. Call list_voices to get all available voices with metadata and labels.
2. Analyze names, categories, and labels to match the role requirements.
3. Pick the top 3 best-fit voices with a clear one-sentence reason for each.
4. For each of the 3 voices, call text_to_speech using the sample phrase: ${phrase ? `"${phrase}"` : "a short phrase that fits the role naturally"}.
5. Return a final recommendation: best voice ID, name, and why it fits best.`,
          },
        },
      ],
    }),
);

server.registerPrompt(
  "voice_showcase",
  {
    description:
      "Render the same phrase in multiple different ElevenLabs voices for side-by-side comparison.",
    argsSchema: {
      phrase: z.string().describe("The phrase to render across multiple voices"),
      count: z
        .string()
        .optional()
        .describe("Number of voices to showcase (default: 4, max: 8)"),
    },
  },
  ({ phrase, count }) => {
    const n = Math.min(parseInt(count ?? "4", 10) || 4, 8);
    return Promise.resolve({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Create a voice showcase for: "${phrase}"

Steps:
1. Call list_voices to see all available voices.
2. Pick ${n} voices that are diverse — different genders, accents, and styles.
3. Call text_to_speech for each voice with the exact phrase.
4. Report each result: voice name, voice_id, output file path, one-word character description.
5. End with a summary table of all ${n} voices and their output file paths.`,
          },
        },
      ],
    });
  },
);

// ─── RESOURCES ───────────────────────────────────────────────────────────────

server.resource(
  "voices",
  "elevenlabs://voices",
  {
    description:
      "Live list of all ElevenLabs voices with IDs, categories, and labels. Read this before calling text_to_speech to pick the right voice.",
    mimeType: "application/json",
  },
  async () => {
    const voices = await client.listVoices();
    return {
      contents: [
        {
          uri: "elevenlabs://voices",
          mimeType: "application/json",
          text: JSON.stringify(voices, null, 2),
        },
      ],
    };
  },
);

server.resource(
  "models",
  "elevenlabs://models",
  {
    description:
      "Available ElevenLabs TTS and STT models with capabilities and supported languages.",
    mimeType: "application/json",
  },
  async () => {
    const models = await client.listModels();
    return {
      contents: [
        {
          uri: "elevenlabs://models",
          mimeType: "application/json",
          text: JSON.stringify(models, null, 2),
        },
      ],
    };
  },
);

// ─── START ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ElevenLabs MCP Server v2 running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
