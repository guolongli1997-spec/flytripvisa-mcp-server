
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

interface Env {
  GITHUB_TOKEN: string;
  MCP_ACCESS_TOKEN: string;
  GITHUB_REPOSITORY: string;
  ASSETS: Fetcher;
  AI: {
    run(
      model: string,
      input: {
        messages: { role: string; content: string }[];
      },
    ): Promise<{ response?: string }>;
  };
}

const API = "https://api.github.com";
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

async function github(env: Env, path: string, options: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data: any = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `GitHub API error: ${response.status}`);
  }
  return data;
}

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function decodeBase64(value: string) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function result(value: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(value, null, 2),
    }],
  };
}

function createServer(env: Env) {
  const server = new McpServer({
    name: "FlyTripVisa GitHub Agent",
    version: "1.0.0",
  });

  const repo = env.GITHUB_REPOSITORY;
  const branch = "main";

  server.registerTool("list_files", {
    description: "List files and folders in the GitHub repository.",
    inputSchema: z.object({ path: z.string().default("") }),
  }, async ({ path }) => {
    try {
      const data = await github(env, `/repos/${repo}/contents/${path}?ref=${branch}`);
      const files = (Array.isArray(data) ? data : [data]).map((item: any) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        sha: item.sha,
      }));
      return result(files);
    } catch (error) {
      return { ...result({ error: String(error) }), isError: true };
    }
  });

  server.registerTool("read_file", {
    description: "Read a file from the GitHub repository.",
    inputSchema: z.object({ path: z.string().min(1) }),
  }, async ({ path }) => {
    try {
      const data = await github(env, `/repos/${repo}/contents/${path}?ref=${branch}`);
      if (Array.isArray(data) || data.type !== "file") {
        throw new Error("The requested path is not a file.");
      }
      return result({
        path: data.path,
        sha: data.sha,
        content: decodeBase64(data.content),
      });
    } catch (error) {
      return { ...result({ error: String(error) }), isError: true };
    }
  });

  server.registerTool("write_file", {
    description: "Create or update a GitHub file. Supply sha when updating.",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
      message: z.string().default("Update file using FlyTripVisa AI"),
      sha: z.string().optional(),
    }),
  }, async ({ path, content, message, sha }) => {
    try {
      const data = await github(env, `/repos/${repo}/contents/${path}`, {
        method: "PUT",
        body: JSON.stringify({
          message,
          content: encodeBase64(content),
          branch,
          ...(sha ? { sha } : {}),
        }),
      });
      return result({
        success: true,
        path,
        commit: data.commit?.sha,
      });
    } catch (error) {
      return { ...result({ error: String(error) }), isError: true };
    }
  });

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // AI Chat API
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json() as { message?: string };

        if (!body.message || typeof body.message !== "string") {
          return Response.json({ error: "Message is required." }, { status: 400 });
        }

        if (body.message.length > 12000) {
          return Response.json({ error: "Message is too long." }, { status: 413 });
        }

        const output = await env.AI.run(MODEL, {
          messages: [
            {
              role: "system",
              content: `You are FlyTripVisa AI, a helpful coding assistant.
You help users understand and develop their GitHub project.
Repository: ${env.GITHUB_REPOSITORY}
Be accurate. Never claim that you changed or deployed files unless an actual tool confirms it.
Reply in the user's language.`,
            },
            { role: "user", content: body.message },
          ],
        });

        return Response.json({ reply: output.response || "No response from AI." });
      } catch (error) {
        return Response.json(
          { error: "AI request failed.", details: String(error) },
          { status: 500 },
        );
      }
    }

    // GitHub MCP endpoint
    if (url.pathname === "/mcp") {
      if (!env.GITHUB_TOKEN || !env.MCP_ACCESS_TOKEN || !env.GITHUB_REPOSITORY) {
        return Response.json({ error: "Server configuration missing." }, { status: 500 });
      }

      if (request.headers.get("Authorization") !== `Bearer ${env.MCP_ACCESS_TOKEN}`) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      const handler = createMcpHandler(() => createServer(env));
      return handler(request, env, ctx);
    }

    // Website and Chat UI
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
