
/* ==========================================
   FLY DRAGON AI
   Frontend Chat + Authentication + Menu
   ========================================== */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const form = $("chatForm");
  const input = $("messageInput") || $("prompt");
  const messages = $("messages");
  const welcome = $("welcome");
  const sendButton = $("sendButton") || $("send");
  const main = $("main");

  if (!form || !input || !messages || !sendButton) {
    console.error("Fly Dragon AI: Required chat elements not found.");
    return;
  }

  const API = {
    me: "/api/auth/me",
    login: "/api/auth/login",
    signup: "/api/auth/signup",
    logout: "/api/auth/logout",
    chat: "/api/chat",
    history: "/api/chats",
    newChat: "/api/chats",
    tools: "/api/mcp/tools",
    files: "/api/files"
  };

  let currentUser = null;
  let currentChatId = null;
  let busy = false;

  const request = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...options.headers
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || data.message || "Request failed");
    }

    return data;
  };

  const escapeHTML = (value) =>
    String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);

  function addMessage(text, type = "bot") {
    if (welcome) welcome.style.display = "none";

    const div = document.createElement("div");
    div.className = "msg " + type;
    div.textContent = text;

    messages.appendChild(div);

    if (main) main.scrollTop = main.scrollHeight;

    return div;
  }

  function showNotice(message) {
    let notice = $("flyNotice");

    if (!notice) {
      notice = document.createElement("div");
      notice.id = "flyNotice";
      notice.style.cssText = `
        position:fixed;bottom:90px;left:50%;
        transform:translateX(-50%);
        z-index:99999;background:#202124;color:white;
        padding:12px 18px;border-radius:12px;
        font-size:13px;max-width:85%;text-align:center;
        box-shadow:0 5px 25px #0008;
      `;
      document.body.appendChild(notice);
    }

    notice.textContent = message;
    notice.style.display = "block";

    clearTimeout(notice._timer);
    notice._timer = setTimeout(() => {
      notice.style.display = "none";
    }, 3000);
  }

  /* ==========================================
     AUTH SCREEN
     ========================================== */

  function createAuthScreen() {
    if ($("flyAuthScreen")) return;

    const style = document.createElement("style");
    style.id = "flyAuthStyle";
    style.textContent = `
      #flyAuthScreen {
        position:fixed;inset:0;z-index:100000;
        background:#08090d;color:#fff;
        display:flex;align-items:center;
        justify-content:center;padding:20px;
        font-family:inherit;
      }
      .fly-auth-card {
        width:100%;max-width:390px;
        background:#12141b;border:1px solid #292d38;
        border-radius:20px;padding:28px;
        box-shadow:0 20px 80px #0009;
      }
      .fly-auth-card h2 {
        text-align:center;margin:0 0 8px;font-size:25px;
      }
      .fly-auth-card p {
        text-align:center;color:#9ba1ad;
        font-size:13px;margin-bottom:24px;
      }
      .fly-auth-card input {
        width:100%;box-sizing:border-box;
        background:#080a10;color:white;
        border:1px solid #343945;border-radius:10px;
        padding:13px;margin:7px 0;
        outline:none;font:inherit;
      }
      .fly-auth-card input:focus {
        border-color:#07c160;
      }
      .fly-auth-card button {
        width:100%;padding:13px;
        margin-top:12px;border:0;border-radius:10px;
        background:#07c160;color:#07130c;
        font-weight:700;cursor:pointer;
      }
      .fly-auth-switch {
        color:#07c160;cursor:pointer;
        text-align:center;margin-top:18px;
        font-size:13px;
      }
      .fly-auth-error {
        color:#ff7777;font-size:13px;
        text-align:center;min-height:18px;
      }
      #flyMenu {
        position:fixed;right:12px;top:58px;
        z-index:90000;width:225px;
        padding:7px;background:#171922;
        border:1px solid #303440;border-radius:14px;
        box-shadow:0 12px 40px #0009;
        display:none;
      }
      #flyMenu button {
        display:block;width:100%;text-align:left;
        border:0;background:transparent;color:#eee;
        padding:12px;border-radius:8px;
        cursor:pointer;font-size:13px;
      }
      #flyMenu button:hover {
        background:#292e39;
      }
      #flyMenu .fly-menu-danger {color:#ff7777}
    `;
    document.head.appendChild(style);

    const screen = document.createElement("div");
    screen.id = "flyAuthScreen";

    screen.innerHTML = `
      <div class="fly-auth-card">
        <h2>🐉 Fly Dragon AI</h2>
        <p>Your personal AI workspace</p>

        <div id="flyAuthError" class="fly-auth-error"></div>

        <form id="flyAuthForm">
          <input id="flyAuthName"
            placeholder="Full name"
            autocomplete="name"
            style="display:none">

          <input id="flyAuthEmail"
            type="email"
            placeholder="Email address"
            autocomplete="email"
            required>

          <input id="flyAuthPassword"
            type="password"
            placeholder="Password"
            autocomplete="current-password"
            minlength="8"
            required>

          <button id="flyAuthSubmit" type="submit">
            Login
          </button>
        </form>

        <div id="flyAuthSwitch" class="fly-auth-switch">
          Create a new account
        </div>
      </div>
    `;

    document.body.appendChild(screen);

    let signupMode = false;

    $("flyAuthSwitch").addEventListener("click", () => {
      signupMode = !signupMode;

      $("flyAuthName").style.display =
        signupMode ? "block" : "none";

      $("flyAuthName").required = signupMode;

      $("flyAuthSubmit").textContent =
        signupMode ? "Create Account" : "Login";

      $("flyAuthSwitch").textContent =
        signupMode ? "Already have an account? Login" :
        "Create a new account";
    });

    $("flyAuthForm").addEventListener("submit", async (event) => {
      event.preventDefault();

      const button = $("flyAuthSubmit");
      const error = $("flyAuthError");

      button.disabled = true;
      error.textContent = "";

      try {
        const payload = {
          email: $("flyAuthEmail").value.trim(),
          password: $("flyAuthPassword").value
        };

        if (signupMode) {
          payload.name = $("flyAuthName").value.trim();
        }

        const result = await request(
          signupMode ? API.signup : API.login,
          {
            method: "POST",
            body: JSON.stringify(payload)
          }
        );

        currentUser = result.user || result;
        screen.remove();

        await initializeWorkspace();

      } catch (err) {
        error.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  async function checkAuthentication() {
    try {
      const result = await request(API.me);
      currentUser = result.user || null;
      return !!currentUser;
    } catch {
      currentUser = null;
      return false;
    }
  }

  /* ==========================================
     HEADER DROPDOWN MENU
     ========================================== */

  function createMenu() {
    let menu = $("flyMenu");

    if (!menu) {
      menu = document.createElement("div");
      menu.id = "flyMenu";

      menu.innerHTML = `
        <button data-action="new">＋ New Chat</button>
        <button data-action="history">◷ Chat History</button>
        <button data-action="files">▤ File Manager</button>
        <button data-action="tools">⚙ Tools & MCP Plugins</button>
        <button data-action="uploads">▧ Images & Uploads</button>
        <button data-action="database">▦ Database Manager</button>
        <button data-action="r2">☁ Cloudflare R2 Storage</button>
        <button data-action="settings">⚙ Settings</button>
        <button data-action="logout" class="fly-menu-danger">
          ↪ Logout
        </button>
      `;

      document.body.appendChild(menu);
    }

    const trigger = $("newChatButton");

    if (trigger && !trigger.dataset.flyMenuReady) {
      trigger.dataset.flyMenuReady = "1";

      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        menu.style.display =
          menu.style.display === "block" ? "none" : "block";
      });
    }

    document.addEventListener("click", (event) => {
      if (!menu.contains(event.target) && event.target !== trigger) {
        menu.style.display = "none";
      }
    });

    menu.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      menu.style.display = "none";

      const action = button.dataset.action;

      try {
        switch (action) {
          case "new":
            await createNewChat();
            break;

          case "history":
            await loadHistory();
            break;

          case "files":
          case "uploads":
            await openFeature(action);
            break;

          case "tools":
          case "database":
          case "r2":
          case "settings":
            await openFeature(action);
            break;

          case "logout":
            await logout();
            break;
        }
      } catch (err) {
        showNotice(err.message);
      }
    });
  }

  async function openFeature(feature) {
    const labels = {
      files: "File Manager",
      uploads: "Images & Uploads",
      tools: "Tools & MCP Plugins",
      database: "Database Manager",
      r2: "Cloudflare R2 Storage",
      settings: "Settings"
    };

    try {
      const result = await request(
        `/api/workspace/${feature}`
      );

      showNotice(result.message || labels[feature] + " connected.");
    } catch (err) {
      if (err.message.includes("404")) {
        showNotice(labels[feature] + " backend endpoint is not installed yet.");
      } else {
        showNotice(err.message);
      }
    }
  }

  /* ==========================================
     CHAT
     ========================================== */

  async function sendMessage(text) {
    text = String(text || "").trim();

    if (!text || busy || !currentUser) return;

    busy = true;
    sendButton.disabled = true;

    addMessage(text, "user");
    input.value = "";

    const reply = addMessage("Thinking...", "bot");

    try {
      const selectedFiles =
        typeof window.getSelectedFiles === "function"
          ? window.getSelectedFiles()
          : [];

      const formData = new FormData();

      formData.append("message", text);
      formData.append("source", "website");

      if (currentChatId) {
        formData.append("chatId", currentChatId);
      }

      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch(API.chat, {
        method: "POST",
        credentials: "include",
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "AI request failed");
      }

      reply.textContent =
        data.reply || data.response || "No response received.";

      if (data.chatId) currentChatId = data.chatId;

      if (typeof window.clearSelectedFiles === "function") {
        window.clearSelectedFiles();
      }

    } catch (error) {
      reply.textContent = "Error: " + error.message;
    } finally {
      busy = false;
      sendButton.disabled = false;
      input.focus();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  const promptButtons = document.querySelectorAll(
    ".chip, .quick-prompt, [data-prompt]"
  );

  promptButtons.forEach((button) => {
    button.addEventListener("click", () => {
      sendMessage(
        button.dataset.prompt ||
        button.textContent.trim()
      );
    });
  });

  /* ==========================================
     NEW CHAT
     ========================================== */

  async function createNewChat() {
    const result = await request(API.newChat, {
      method: "POST",
      body: JSON.stringify({ title: "New Chat" })
    });

    currentChatId = result.chat?.id || result.id || null;

    messages.innerHTML = "";

    if (welcome) welcome.style.display = "";

    input.value = "";
    input.focus();

    showNotice("New chat created.");
  }

  /* ==========================================
     CHAT HISTORY
     ========================================== */

  async function loadHistory() {
    const result = await request(API.history);

    const chats = result.chats || [];

    let panel = $("flyHistoryPanel");

    if (panel) panel.remove();

    panel = document.createElement("div");
    panel.id = "flyHistoryPanel";

    panel.style.cssText = `
      position:fixed;inset:0;z-index:99990;
      background:#000a;display:flex;
      justify-content:flex-end;
    `;

    const list = chats.length
      ? chats.map((chat) => `
          <button data-chat-id="${escapeHTML(chat.id)}"
            style="display:block;width:100%;padding:13px;
            margin:5px 0;text-align:left;background:#20232d;
            color:white;border:0;border-radius:9px;cursor:pointer">
            ${escapeHTML(chat.title || "New Chat")}
          </button>
        `).join("")
      : `<p style="color:#aaa">No chat history yet.</p>`;

    panel.innerHTML = `
      <div style="width:min(340px,85vw);height:100%;
        background:#101219;padding:20px;overflow:auto;color:white">
        <button id="flyHistoryClose"
          style="float:right;background:none;color:white;
          border:0;font-size:20px">✕</button>
        <h3>Chat History</h3>
        <div>${list}</div>
      </div>
    `;

    document.body.appendChild(panel);

    $("flyHistoryClose").onclick = () => panel.remove();

    panel.querySelectorAll("[data-chat-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const id = button.dataset.chatId;
          const result = await request(
            `/api/chats/${encodeURIComponent(id)}`
          );

          currentChatId = id;
          messages.innerHTML = "";

          if (welcome) welcome.style.display = "none";

          (result.messages || []).forEach((item) => {
            addMessage(item.content || item.message || "",
              item.role === "user" ? "user" : "bot");
          });

          panel.remove();

        } catch (err) {
          showNotice(err.message);
        }
      });
    });
  }

  /* ==========================================
     LOGOUT
     ========================================== */

  async function logout() {
    try {
      await request(API.logout, { method: "POST" });
    } catch (error) {
      console.error("Logout request:", error);
    }

    currentUser = null;
    currentChatId = null;

    messages.innerHTML = "";

    createAuthScreen();
  }

  /* ==========================================
     START APPLICATION
     ========================================== */

  async function initializeWorkspace() {
    createMenu();

    if (currentUser) {
      const trigger = $("newChatButton");
      if (trigger) trigger.style.display = "";
    }
  }

  async function start() {
    const authenticated = await checkAuthentication();

    if (!authenticated) {
      const trigger = $("newChatButton");
      if (trigger) trigger.style.display = "none";

      createAuthScreen();
      return;
    }

    await initializeWorkspace();
  }

  start();

})();
