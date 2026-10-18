#!/usr/bin/env node
import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { TimeClient } from './client/time-client.js';
import { clearSavedAuth, loadSavedAuth, saveAuth } from './client/auth-store.js';
import { loginWithBrowser } from './client/browser-auth.js';
import { messageTools } from './tools/messages.js';
import { threadTools } from './tools/threads.js';
import { channelTools } from './tools/channels.js';
import { teamTools } from './tools/teams.js';
import { userTools } from './tools/users.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const allTools: any[] = [...messageTools, ...threadTools, ...channelTools, ...teamTools, ...userTools];

const browserAuthTools = [
  {
    name: 'time_login',
    description: 'Open Chrome and sign in to TiME through the CU SSO page',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'time_auth_status',
    description: 'Check whether the current TiME session is authenticated',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'time_logout',
    description: 'Forget the TiME API token stored by this MCP server',
    inputSchema: { type: 'object', properties: {} },
  },
];

class TimeMcpServer {
  private server: Server;
  private client: TimeClient | null = null;
  private userId: string = '';
  private timeUrl: string;
  private timeToken: string | undefined;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.timeUrl = process.env.TIME_URL || 'https://time.cu.ru';
    this.timeToken = process.env.TIME_TOKEN;

    this.server = new Server(
      {
        name: 'cu-time-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private async ensureClient(): Promise<TimeClient> {
    if (this.client) {
      return this.client;
    }

    if (this.initPromise) {
      await this.initPromise;
      if (!this.client) {
        throw new Error('TiME authentication did not produce a valid session');
      }
      return this.client;
    }

    this.initPromise = this.initClient().finally(() => {
      this.initPromise = null;
    });
    await this.initPromise;
    if (!this.client) {
      throw new Error('TiME authentication did not produce a valid session');
    }
    return this.client;
  }

  private async initClient(): Promise<void> {
    // 1. Try TIME_TOKEN env var first
    if (this.timeToken) {
      this.client = new TimeClient(this.timeUrl, this.timeToken);
      try {
        const me = await this.client.getMe();
        this.userId = me.id;
        console.error('Authenticated with TIME_TOKEN');
        return;
      } catch {
        console.error('TIME_TOKEN is invalid, falling back to saved/session auth');
        this.client = null;
      }
    }

    // 2. Try saved auth token
    const saved = loadSavedAuth(this.timeUrl);
    if (saved) {
      this.client = new TimeClient(this.timeUrl, saved.token);
      try {
        const me = await this.client.getMe();
        this.userId = me.id;
        console.error('Authenticated with saved token');
        return;
      } catch {
        console.error('Saved token expired; opening CU sign-in...');
        this.client = null;
        clearSavedAuth(this.timeUrl);
      }
    }

    // 3. Interactive CU SSO in a dedicated browser profile.
    const authenticated = await loginWithBrowser(this.timeUrl);
    await this.onClientAuthenticated(authenticated.client, authenticated.userId);
  }

  private async onClientAuthenticated(client: TimeClient, knownUserId?: string): Promise<void> {
    this.client = client;
    try {
      this.userId = knownUserId || (await client.getMe()).id;
      saveAuth(client.baseUrlValue, client.tokenValue, this.userId);
      console.error('TiME session saved for future launches');
    } catch (error) {
      this.client = null;
      throw error;
    }
  }

  private async forceBrowserLogin() {
    this.client = null;
    this.userId = '';
    clearSavedAuth(this.timeUrl);
    const authenticated = await loginWithBrowser(this.timeUrl);
    await this.onClientAuthenticated(authenticated.client, authenticated.userId);
    return {
      content: [{ type: 'text' as const, text: 'Signed in to CU TiME successfully.' }],
    };
  }

  private async authStatus() {
    const candidates = [
      this.client,
      this.timeToken ? new TimeClient(this.timeUrl, this.timeToken) : null,
      (() => {
        const saved = loadSavedAuth(this.timeUrl);
        return saved ? new TimeClient(this.timeUrl, saved.token) : null;
      })(),
    ].filter((candidate): candidate is TimeClient => candidate !== null);

    for (const candidate of candidates) {
      try {
        const me = await candidate.getMe();
        this.client = candidate;
        this.userId = me.id;
        return {
          content: [{ type: 'text' as const, text: `Authenticated as @${me.username} (${me.id}).` }],
        };
      } catch {
        // Try the next available token without opening the browser.
      }
    }

    return {
      content: [{ type: 'text' as const, text: 'Not authenticated. Call time_login.' }],
    };
  }

  private logout() {
    clearSavedAuth(this.timeUrl);
    this.client = null;
    this.userId = '';
    return {
      content: [{ type: 'text' as const, text: 'Saved TiME API token removed.' }],
    };
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = [...browserAuthTools, ...allTools].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === 'time_login') {
          return await this.forceBrowserLogin();
        }
        if (name === 'time_auth_status') {
          return await this.authStatus();
        }
        if (name === 'time_logout') {
          return this.logout();
        }

        const tool = allTools.find((candidate) => candidate.name === name);
        if (!tool) {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }

        const client = await this.ensureClient();

        if (!this.userId) {
          const me = await client.getMe();
          this.userId = me.id;
        }

        const result = await tool.handler(client, args, this.userId);
        return result;
      } catch (error) {
        if (error instanceof Error) {
          throw new McpError(ErrorCode.InternalError, error.message);
        }
        throw error;
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Time MCP server running on stdio');
    void this.ensureClient().catch((error) => {
      console.error(`Initial TiME sign-in failed: ${error instanceof Error ? error.message : error}`);
    });
  }
}

const server = new TimeMcpServer();
server.run().catch(console.error);
