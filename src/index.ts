
import { runWithTools } from "@cloudflare/ai-utils";
import { createTools } from "./tools.js";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers
    }
  });

const cookieName = "fly_session";
const encoder = new TextEncoder();

function cookie(request) {
  const raw = request.headers.get("Cookie") || "";
  const match = raw.match(/(?:^|;\s*)fly_session=([^;]+)/);
  return match ? match[1] : null;
}

function setCookie(token) {
  return `${cookieName}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;
}

function clearCookie() {
  return `${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function base64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function decodeBase64(value) {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt,
    iterations: 210000,
    hash: "SHA-256"
  }, key, 256);

  return base64(bits);
}

async function authenticate(request, env) {
  const token = cookie(request);
  if (!token) return null;

  const result = await env.DB.prepare(`
    SELECT users.id, users.email, users.name
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > datetime('now')
    LIMIT 1
  `).bind(await hashToken(token)).first();

  return result || null;
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(token)
  );
  return base64(digest);
}

async function createSession(userId, env) {
  const token = randomToken();

  await env.DB.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, datetime('now', '+7 days'))
  `).bind(
    crypto.randomUUID(),
    userId,
    await hashToken(token)
  ).run();

  return token;
}

async function requireUser(request, env) {
  const user = await authenticate(request, env);
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

async function signup(request, env) {
  const body = await request.json();

  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");

  if (!email || !name || password.length < 8) {
    return json({ error: "Name, valid email and password (8+ characters) required." }, 400);
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE email = ?"
  ).bind(email).first();

  if (existing) return json({ error: "Email already registered." }, 409);

  const id = crypto.randomUUID();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await hashPassword(password, salt);

  await env.DB.prepare(`
    INSERT INTO users (id, name, email, password_hash, password_salt)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, name, email, passwordHash, base64(salt)).run();

  const token = await createSession(id, env);

  return json({
    user: { id, name, email }
  }, 201, {
    "Set-Cookie": setCookie(token)
  });
}

async function login(request, env) {
  const body = await request.json();

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  const user = await env.DB.prepare(`
    SELECT id, name, email, password_hash, password_salt
    FROM users WHERE email = ?
  `).bind(email).first();

  if (!user) return json({ error: "Invalid email or password." }, 401);

  const salt = decodeBase64(user.password_salt);
  const calculated = await hashPassword(password, salt);

  if (calculated !== user.password_hash) {
    return json({ error: "Invalid email or password." }, 401);
  }

  const token = await createSession(user.id, env);

  return json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
  }, 200, {
    "Set-Cookie": setCookie(token)
  });
}

async function logout(request, env) {
  const token = cookie(request);

  if (token) {
    await env.DB.prepare(
      "DELETE FROM sessions WHERE token_hash = ?"
    ).bind(await hashToken(token)).run();
  }

  return json({ success: true }, 200, {
    "Set-Cookie": clearCookie()
  });
}

async function chat(request, env, user) {
  const form = await request.formData();

  const message = String(form.get("message") || "").trim();
  let chatId = String(form.get("chatId") || "");

  if (!message) return json({ error: "Message is required." }, 400);
  if (message.length > 20000) return json({ error: "Message too long." }, 413);

  if (chatId) {
    const owned = await env.DB.prepare(
      "SELECT id FROM chats WHERE id = ? AND user_id = ?"
    ).bind(chatId, user.id).first();

    if (!owned) return json({ error: "Chat not found." }, 404);
  } else {
    chatId = crypto.randomUUID();

    await env.DB.prepare(`
      INSERT INTO chats (id, user_id, title)
      VALUES (?, ?, ?)
    `).bind(chatId, user.id, message.slice(0, 70)).run();
  }

  await env.DB.prepare(`
    INSERT INTO messages (id, chat_id, user_id, role, content)
    VALUES (?, ?, ?, 'user', ?)
  `).bind(crypto.randomUUID(), chatId, user.id, message).run();

  // Save uploaded files privately in R2.
  const uploadedNames = [];

  for (const entry of form.getAll("files")) {
    if (!entry || typeof entry === "string" || !entry.size) continue;

    if (entry.size > 10 * 1024 * 1024) {
      return json({ error: "Each file must be under 10 MB." }, 413);
    }

    const safeName = entry.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileId = crypto.randomUUID();
    const key = `${user.id}/${chatId}/${fileId}-${safeName}`;

    await env.FILES.put(key, await entry.arrayBuffer(), {
      httpMetadata: {
        contentType: entry.type || "application/octet-stream"
      }
    });

    await env.DB.prepare(`
      INSERT INTO files
      (id, user_id, chat_id, filename, object_key, content_type, size)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      fileId, user.id, chatId, entry.name,
      key, entry.type || "application/octet-stream", entry.size
    ).run();

    uploadedNames.push(entry.name);
  }

  const previous = await env.DB.prepare(`
    SELECT role, content
    FROM messages
    WHERE chat_id = ? AND user_id = ?
    ORDER BY created_at DESC
    LIMIT 12
  `).bind(chatId, user.id).all();

  const history = (previous.results || []).reverse().map(row => ({
    role: row.role,
    content: row.content
  }));

  const systemMessage = {
    role: "system",
    content:
      "You are Fly Dragon AI, the assistant for FlyTripVisa. " +
      "Be accurate. Never claim a booking, payment, email or external action " +
      "has succeeded unless a real tool confirms it. " +
      "Never access another user's data. " +
      (uploadedNames.length
        ? "The user uploaded these files: " + uploadedNames.join(", ") +
          ". Their contents have not been extracted automatically."
        : "")
  };

  const result = await runWithTools(
    env.AI,
    env.AI_MODEL || "@hf/nousresearch/hermes-2-pro-mistral-7b",
    {
      messages: [systemMessage, ...history],
      tools: createTools(env, user.id)
    }
  );

  const reply =
    typeof result === "string"
      ? result
      : result.response || result.result?.response || "I couldn't generate a response.";

  await env.DB.prepare(`
    INSERT INTO messages (id, chat_id, user_id, role, content)
    VALUES (?, ?, ?, 'assistant', ?)
  `).bind(
    crypto.randomUUID(), chatId, user.id, reply
  ).run();

  return json({ reply, chatId });
}

async function listChats(env, user) {
  const result = await env.DB.prepare(`
    SELECT id, title, created_at
    FROM chats
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(user.id).all();

  return json({ chats: result.results || [] });
}

async function getChat(env, user, id) {
  const chat = await env.DB.prepare(`
    SELECT id, title
    FROM chats WHERE id = ? AND user_id = ?
  `).bind(id, user.id).first();

  if (!chat) return json({ error: "Chat not found." }, 404);

  const result = await env.DB.prepare(`
    SELECT role, content, created_at
    FROM messages
    WHERE chat_id = ? AND user_id = ?
    ORDER BY created_at ASC
  `).bind(id, user.id).all();

  return json({ chat, messages: result.results || [] });
}

async function createChat(env, user, body) {
  const id = crypto.randomUUID();
  const title = String(body.title || "New Chat").slice(0, 100);

  await env.DB.prepare(`
    INSERT INTO chats (id, user_id, title)
    VALUES (?, ?, ?)
  `).bind(id, user.id, title).run();

  return json({ id, chat: { id, title } }, 201);
}

async function listFiles(env, user) {
  const result = await env.DB.prepare(`
    SELECT id, filename, content_type, size, created_at
    FROM files WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(user.id).all();

  return json({ files: result.results || [] });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/auth/signup" && method === "POST") {
    return signup(request, env);
  }

  if (path === "/api/auth/login" && method === "POST") {
    return login(request, env);
  }

  if (path === "/api/auth/logout" && method === "POST") {
    return logout(request, env);
  }

  if (path === "/api/auth/me" && method === "GET") {
    const user = await authenticate(request, env);
    if (!user) return json({ error: "Not logged in." }, 401);
    return json({ user });
  }

  const user = await requireUser(request, env);

  if (path === "/api/chat" && method === "POST") {
    return chat(request, env, user);
  }

  if (path === "/api/chats" && method === "GET") {
    return listChats(env, user);
  }

  if (path === "/api/chats" && method === "POST") {
    return createChat(env, user, await request.json());
  }

  if (path.startsWith("/api/chats/") && method === "GET") {
    const id = decodeURIComponent(path.split("/").pop());
    return getChat(env, user, id);
  }

  if (path === "/api/files" && method === "GET") {
    return listFiles(env, user);
  }

  if (path === "/api/mcp/tools" && method === "GET") {
    return json({
      tools: [
        "get_my_recent_chats",
        "list_my_files",
        "save_private_note"
      ]
    });
  }

  if (path.startsWith("/api/workspace/")) {
    return json({
      error: "This workspace module has not been connected yet."
    }, 501);
  }

  return json({ error: "API route not found." }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/api/")) {
        if (!env.DB || !env.AI || !env.FILES) {
          return json({
            error: "Worker bindings are incomplete. Check DB, AI and FILES."
          }, 500);
        }

        return await route(request, env);
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response("Fly Dragon AI is running.");
    } catch (error) {
      if (error.message === "UNAUTHORIZED") {
        return json({ error: "Please login first." }, 401);
      }

      console.error("Fly Dragon Worker error:", error);

      return json({ error: "Internal server error." }, 500);
    }
  }
};
