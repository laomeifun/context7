#!/usr/bin/env node

import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { searchLibraries, fetchLibraryDocumentation } from "./lib/api.js";
import { formatSearchResults } from "./lib/utils.js";

const DEFAULT_MINIMUM_TOKENS: number = 5000;
const PORT: number = 3000; // Define a port for the server

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// Create server instance
const server = new McpServer({
  name: "Context7",
  description: "Retrieves up-to-date documentation and code examples for any library.",
  version: "1.0.6",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Register Context7 tools
server.tool(
  "resolve-library-id",
  "Required first step: Resolves a general package name into a Context7-compatible library ID. Must be called before using 'get-library-docs' to retrieve a valid Context7-compatible library ID.",
  {
    libraryName: z
      .string()
      .describe("Library name to search for and retrieve a Context7-compatible library ID."),
  },
  async ({ libraryName }) => {
    const searchResponse = await searchLibraries(libraryName);

    if (!searchResponse || !searchResponse.results) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve library documentation data from Context7",
          },
        ],
      };
    }

    if (searchResponse.results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No documentation libraries available",
          },
        ],
      };
    }

    const resultsText = formatSearchResults(searchResponse);

    return {
      content: [
        {
          type: "text",
          text: "Available libraries and their Context7-compatible library IDs:\n\n" + resultsText,
        },
      ],
    };
  }
);

server.tool(
  "get-library-docs",
  "Fetches up-to-date documentation for a library. You must call 'resolve-library-id' first to obtain the exact Context7-compatible library ID required to use this tool.",
  {
    context7CompatibleLibraryID: z
      .string()
      .describe(
        "Exact Context7-compatible library ID (e.g., 'mongodb/docs', 'vercel/nextjs') retrieved from 'resolve-library-id'."
      ),
    topic: z
      .string()
      .optional()
      .describe("Topic to focus documentation on (e.g., 'hooks', 'routing')."),
    tokens: z
      .preprocess((val) => (typeof val === "string" ? Number(val) : val), z.number())
      .transform((val) => (val < DEFAULT_MINIMUM_TOKENS ? DEFAULT_MINIMUM_TOKENS : val))
      .optional()
      .describe(
        `Maximum number of tokens of documentation to retrieve (default: ${DEFAULT_MINIMUM_TOKENS}). Higher values provide more context but consume more tokens.`
      ),
  },
  async ({ context7CompatibleLibraryID, tokens = DEFAULT_MINIMUM_TOKENS, topic = "" }) => {
    // Extract folders parameter if present in the ID
    let folders = "";
    let libraryId = context7CompatibleLibraryID;

    if (context7CompatibleLibraryID.includes("?folders=")) {
      const [id, foldersParam] = context7CompatibleLibraryID.split("?folders=");
      libraryId = id;
      folders = foldersParam;
    }

    const documentationText = await fetchLibraryDocumentation(libraryId, {
      tokens,
      topic,
      folders,
    });

    if (!documentationText) {
      return {
        content: [
          {
            type: "text",
            text: "Documentation not found or not finalized for this library. This might have happened because you used an invalid Context7-compatible library ID. To get a valid Context7-compatible library ID, use the 'resolve-library-id' with the package name you wish to retrieve documentation for.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: documentationText,
        },
      ],
    };
  }
);

// Create Express app
const app = express();
app.use(express.json());

// Handle POST requests for client-to-server communication
app.post('/mcp', async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    // Reuse existing transport
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New initialization request
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId: string) => {
        // Store the transport by session ID
        transports[newSessionId] = transport;
        // console.error(`Session initialized: ${newSessionId}`); // Removed log
      }
    });

    // Clean up transport when closed
    transport.onclose = () => {
      if (transport.sessionId) {
        // console.error(`Session closed: ${transport.sessionId}`); // Removed log
        delete transports[transport.sessionId];
      }
    };

    // Connect to the MCP server (server instance is defined above)
    await server.connect(transport);
    // console.error("MCP Server connected to new transport"); // Removed log
  } else {
    // Invalid request
    // console.error("Invalid request: No valid session ID provided or not an initialization request."); // Removed log
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Bad Request: No valid session ID provided or not an initialization request.',
      },
      id: null,
    });
    return;
  }

  // Handle the request
  // console.error(`Handling POST request for session: ${transport.sessionId || 'new session'}`); // Removed log
  await transport.handleRequest(req, res, req.body);
});

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (req: express.Request, res: express.Response): Promise<void> => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    // console.error(`Invalid session request: ${req.method} - Session ID: ${sessionId}`); // Removed log
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const transport = transports[sessionId];
  // console.error(`Handling ${req.method} request for session: ${sessionId}`); // Removed log
  await transport.handleRequest(req, res);
};

// Handle GET requests for server-to-client notifications via SSE
app.get('/mcp', handleSessionRequest);

// Handle DELETE requests for session termination
app.delete('/mcp', handleSessionRequest);

// Start the server
app.listen(PORT, () => {
  // console.error(`Context7 Documentation MCP Server running on http://localhost:${PORT}/mcp`); // Removed log
  console.log(`Context7 Documentation MCP Server running on http://localhost:${PORT}/mcp`); // Use console.log for standard output
});

// Graceful shutdown
process.on('SIGINT', () => {
  // console.error('Shutting down server...'); // Removed log
  console.log('Shutting down server...'); // Use console.log
  // Close all active transports
  Object.values(transports).forEach(transport => transport.close());
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
    // console.error('Shutting down server...'); // Removed log
    console.log('Shutting down server...'); // Use console.log
    // Close all active transports
    Object.values(transports).forEach(transport => transport.close());
    server.close();
    process.exit(0);
});
