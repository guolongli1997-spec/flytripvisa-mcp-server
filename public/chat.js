
const form = document.getElementById("chatForm");
const input = document.getElementById("prompt");
const messages = document.getElementById("messages");
const welcome = document.getElementById("welcome");
const send = document.getElementById("send");

function addMessage(text, type) {
  welcome.style.display = "none";

  const div = document.createElement("div");
  div.className = "msg " + type;
  div.textContent = text;

  messages.appendChild(div);
  document.getElementById("main").scrollTop = 999999;

  return div;
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || send.disabled) return;

  addMessage(text, "user");
  input.value = "";
  send.disabled = true;

  const reply = addMessage("Thinking...", "bot");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: text
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "AI request failed");
    }

    reply.textContent = data.reply || "No response received.";

  } catch (error) {
    reply.textContent = "Error: " + error.message;
  } finally {
    send.disabled = false;
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

document.querySelectorAll(".chip").forEach((button) => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.prompt);
  });
});
