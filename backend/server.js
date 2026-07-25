// server.js
import express from "express";
import cors from "cors";
import "dotenv/config";
import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";
import { isRestError } from "@azure/core-rest-pipeline";

const endpoint = process.env.PROJECT_ENDPOINT;   // e.g. https://lionel-7414-resource.services.ai.azure.com/api/projects/lionel-7414
const agentName = process.env.FOUNDRY_AGENT_NAME; // e.g. "customer-support-agent"

if (!endpoint || !agentName) {
  console.error(
    "Missing required environment variables. Make sure PROJECT_ENDPOINT and FOUNDRY_AGENT_NAME are set in .env"
  );
  process.exit(1);
}

const project = new AIProjectClient(endpoint, new DefaultAzureCredential());
const openAIClient = project.getOpenAIClient();

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Centralized error handler for the two agent routes below.
 * Distinguishes auth failures (bad/missing service principal, missing
 * role assignment) from generic upstream failures so the frontend
 * (and you, while debugging) get an actionable message.
 */
function handleAgentError(err, res) {
  if (isRestError(err)) {
    console.error(`Foundry request failed — status: ${err.code}, message: ${err.message}`);

    if (err.statusCode === 401) {
      return res.status(502).json({
        error:
          "Authentication to Microsoft Foundry failed. Check AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET in your .env, and confirm the app registration has the Azure AI User / Foundry User role assigned on the project (Access control (IAM)).",
      });
    }

    if (err.statusCode === 403) {
      return res.status(502).json({
        error:
          "Authenticated successfully, but the service principal does not have permission to call this agent. Verify the role assignment on the Foundry project resource.",
      });
    }

    if (err.statusCode === 404) {
      return res.status(502).json({
        error: `Agent or conversation not found. Double check FOUNDRY_AGENT_NAME ("${agentName}") matches the agent name exactly (case-sensitive) in the Foundry portal.`,
      });
    }

    return res.status(502).json({ error: `Foundry request failed: ${err.message}` });
  }

  console.error("Unexpected error:", err);
  return res.status(500).json({ error: "Unexpected server error. Check server logs." });
}

// Start a conversation with the first user message
app.post("/api/agent/start", async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Request body must include a non-empty 'text' field." });
  }

  try {
    const conversation = await openAIClient.conversations.create({
      items: [{ type: "message", role: "user", content: text }],
    });

    const response = await openAIClient.responses.create(
      { conversation: conversation.id },
      { body: { agent_reference: { name: agentName, type: "agent_reference" } } }
    );

    res.json({ conversationId: conversation.id, reply: response.output_text });
  } catch (err) {
    handleAgentError(err, res);
  }
});

// Continue an existing conversation
app.post("/api/agent/message", async (req, res) => {
  const { conversationId, text } = req.body;

  if (!conversationId) {
    return res.status(400).json({ error: "Request body must include 'conversationId'." });
  }
  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Request body must include a non-empty 'text' field." });
  }

  try {
    await openAIClient.conversations.items.create(conversationId, {
      items: [{ type: "message", role: "user", content: text }],
    });

    const response = await openAIClient.responses.create(
      { conversation: conversationId },
      { body: { agent_reference: { name: agentName, type: "agent_reference" } } }
    );

    res.json({ reply: response.output_text });
  } catch (err) {
    handleAgentError(err, res);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Foundry agent backend listening on :${PORT}`));
