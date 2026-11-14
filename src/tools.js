
export function createTools(env, userId) {
  return [
    {
      name: "flytripvisa-mcp-server",
      description: "Get the current user's recent chat history.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of chats to retrieve, maximum 10."
          }
        }
      },
      function: async ({ limit = 5 }) => {
        const safeLimit = Math.max(1, Math.min(10, Number(limit) || 5));

        const result = await env.DB.prepare(`
          SELECT id, title, created_at
          FROM chats
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `).bind(userId, safeLimit).all();

        return JSON.stringify(result.results || []);
      }
    },

    {
      name: "list_my_files",
      description: "List files uploaded by the current user.",
      parameters: {
        type: "object",
        properties: {}
      },
      function: async () => {
        const result = await env.DB.prepare(`
          SELECT id, filename, content_type, size, created_at
          FROM files
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 20
        `).bind(userId).all();

        return JSON.stringify(result.results || []);
      }
    },

    {
      name: "save_private_note",
      description: "Save a private note for the authenticated user.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Note title"
          },
          content: {
            type: "string",
            description: "Note content"
          }
        },
        required: ["title", "content"]
      },
      function: async ({ title, content }) => {
        if (!title || !content) {
          throw new Error("Title and content are required.");
        }

        if (title.length > 200 || content.length > 10000) {
          throw new Error("Note is too long.");
        }

        const id = crypto.randomUUID();

        await env.DB.prepare(`
          INSERT INTO notes (id, user_id, title, content)
          VALUES (?, ?, ?, ?)
        `).bind(id, userId, title, content).run();

        return JSON.stringify({
          success: true,
          noteId: id
        });
      }
    }
  ];
}
