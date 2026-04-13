import { routeAgentRequest } from "agents";
import app from "./api/routes";
import type { Env } from "./types";
import { RepoMindAgent } from "./agents/RepoMindAgent";

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Try agent routing first for WebSocket and agent requests
		const agentResponse = await routeAgentRequest(request, env);
		if (agentResponse) {
			return agentResponse;
		}

		// Fall back to REST API
		return app.fetch(request, env, ctx);
	},
};

export { RepoMindAgent };
