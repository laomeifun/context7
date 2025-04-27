import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Runs a simple MCP client to test the Streamable HTTP server.
 */
async function runClient(): Promise<void> {
  const client = new Client({
    name: 'test-client-script',
    version: '1.0.0'
  });

  try {
    const transport = new StreamableHTTPClientTransport(
      new URL('http://localhost:3000/mcp') // Ensure this matches the server endpoint
    );
    console.log("Waiting 1 second before connecting...");
    await new Promise(resolve => setTimeout(resolve, 1000)); // Add 1 second delay

    console.log("Attempting to connect to http://localhost:3000/mcp...");
    await client.connect(transport);
    console.log("Connected successfully!");

    // Optional: Try calling a tool to further test the connection
    try {
        console.log("Attempting to call resolve-library-id with 'react'...");
        const result = await client.callTool({
            name: "resolve-library-id",
            arguments: { libraryName: "react" }
        });
        console.log("Tool call 'resolve-library-id' result:", JSON.stringify(result, null, 2));
    } catch (toolError) {
        console.error("Error calling tool 'resolve-library-id':", toolError);
    }

    console.log("Closing connection...");
    await client.close();
    console.log("Connection closed.");

  } catch (error) {
    console.error("Client connection failed:", error);
  }
}

runClient().catch(error => {
  console.error("Unhandled error in client script:", error);
  process.exit(1);
});
