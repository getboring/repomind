const WebSocket = require("ws");

const ws = new WebSocket(
	"wss://repomind.codyboring.workers.dev/agents/RepoMindAgent/getboring-repomind"
);

ws.on("open", () => {
	console.log("Connected");
	// Send init message
	ws.send(JSON.stringify({ type: "cf_agent_chat_init" }));
	// Send a user message
	setTimeout(() => {
		ws.send(
			JSON.stringify({
				type: "chat",
				messages: [
					{
						id: "msg-1",
						role: "user",
						content: "What does this repo do?",
						parts: [{ type: "text", text: "What does this repo do?" }],
					},
				],
			})
		);
	}, 1000);
});

ws.on("message", (data) => {
	console.log("Received:", data.toString());
});

ws.on("error", (err) => {
	console.error("Error:", err.message);
});

ws.on("close", () => {
	console.log("Closed");
	process.exit(0);
});

setTimeout(() => {
	ws.close();
}, 30000);
