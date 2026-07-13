# How to Study the 3 Source Files

## Recommended Order

| Order | File | Why this order |
|---|---|---|
| 1st | `01-elevenlabs-client.md` | Simplest file. Pure HTTP calls to ElevenLabs. No MCP, no AI, no audio. Start here to understand what data the system works with. |
| 2nd | `02-index-server.md` | The MCP server. Uses the client from file 1. Understand how tools, prompts, and resources are registered and exposed to an AI. |
| 3rd | `03-client.md` | The most complex file. Ties everything together — spawns the server, talks to Claude/GPT, handles voice input/output. Study last because it depends on understanding both previous files. |

## How the 3 Files Relate to Each Other

```
elevenlabs-client.ts          index.ts (MCP Server)         client.ts (CLI Client)
─────────────────────         ─────────────────────         ──────────────────────
Pure HTTP wrapper.            Imports and uses               Spawns index.ts as a
Knows nothing about           elevenlabs-client.ts.         child process.
MCP or AI.                    Wraps its methods as           Talks to it over stdio
                              MCP tools, prompts,           using the MCP protocol.
                              and resources.                Sends tool calls to it,
                                                            gets results back.
                                                            Also calls Claude/GPT.
```

## Mental Model Before You Start

- **ElevenLabs** is the service that does AI voice work (text → speech, speech → text).
- **MCP (Model Context Protocol)** is a standard way to give an AI model access to external tools. Think of it as a "plugin system" for AI.
- **The MCP Server** (`index.ts`) is the plugin — it defines what tools and capabilities are available.
- **The MCP Client** (`client.ts`) is the host — it runs the server, connects to it, and routes the AI's tool requests to it.
- **Claude / GPT** is the brain. It decides when to call a tool, which one, and with what arguments.
