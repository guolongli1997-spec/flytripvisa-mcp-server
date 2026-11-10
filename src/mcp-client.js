
const MCP_URL =
  "https://flytripvisa-mcp-server.jingpay.workers.dev/mcp";

/**
 * Server-side MCP request.
 * MCP token must be stored as a Worker secret.
 */
export async function callMCP(env, method, params = {}) {
  if (!env.MCP_ACCESS_TOKEN) {
    throw new Error("MCP_ACCESS_TOKEN is not configured.");
  }

  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.MCP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`MCP server returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    const dataLines = text
      .split("\n")
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim());

    const last = dataLines[dataLines.length - 1];

    if (!last) throw new Error("Empty MCP response.");

    const result = JSON.parse(last);

    if (result.error) {
      throw new Error(result.error.message || "MCP error");
    }

    return result.result;
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message || "MCP error");
  }

  return data.result;
}

export async function discoverMCPTools(env) {
  const result = await callMCP(env, "tools/list");
  return result.tools || [];
}
