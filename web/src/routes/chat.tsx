import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API_BASE =
	typeof window !== "undefined" && window.location.hostname.includes("pages.dev")
		? "wss://repomind.codyboring.workers.dev"
		: "ws://localhost:8787";

interface Message {
	id: string;
	role: "user" | "assistant";
	content: string;
	sources?: Array<{
		filePath: string;
		lineStart: number;
		lineEnd: number;
		content: string;
		score: number;
	}>;
}

export default function Chat() {
	const { owner, name } = useParams();
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [status, setStatus] = useState<"disconnected" | "connecting" | "connected" | "streaming">("disconnected");
	const [error, setError] = useState<string | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const connect = useCallback(() => {
		if (!owner || !name) return;

		setStatus("connecting");
		setError(null);

		const wsUrl = `${API_BASE}/chat/${owner}/${name}`;
		const ws = new WebSocket(wsUrl);

		ws.onopen = () => {
			setStatus("connected");
			setError(null);
		};

		ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);

				switch (data.type) {
					case "text":
						setMessages((prev) => {
							const last = prev[prev.length - 1];
							if (last && last.role === "assistant" && !data.done) {
								// Append to existing assistant message
								return [
									...prev.slice(0, -1),
									{ ...last, content: last.content + data.content },
								];
							}
							// Add new message
							return [
								...prev,
								{
									id: `msg-${Date.now()}`,
									role: "assistant",
									content: data.content,
								},
							];
						});
						setStatus("streaming");
						break;
					case "done":
						setStatus("connected");
						if (data.sources) {
							setMessages((prev) => {
								const last = prev[prev.length - 1];
								if (last && last.role === "assistant") {
									return [
										...prev.slice(0, -1),
										{ ...last, sources: data.sources },
									];
								}
								return prev;
							});
						}
						break;
					case "error":
						setError(data.error);
						setStatus("connected");
						break;
					case "pong":
						// Heartbeat response
						break;
				}
			} catch (e) {
				console.error("Failed to parse message:", e);
			}
		};

		ws.onerror = () => {
			setError("WebSocket error occurred");
			setStatus("disconnected");
		};

		ws.onclose = () => {
			setStatus("disconnected");
			// Attempt to reconnect after 3 seconds
			reconnectTimeoutRef.current = setTimeout(() => {
				connect();
			}, 3000);
		};

		wsRef.current = ws;
	}, [owner, name]);

	useEffect(() => {
		connect();

		return () => {
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
			}
			if (wsRef.current) {
				wsRef.current.close();
			}
		};
	}, [connect]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!input.trim() || status !== "connected" || !wsRef.current) return;

		const messageText = input.trim();
		setInput("");

		// Add user message
		setMessages((prev) => [
			...prev,
			{
				id: `msg-${Date.now()}`,
				role: "user",
				content: messageText,
			},
		]);

		// Send to server
		wsRef.current.send(
			JSON.stringify({
				type: "chat",
				content: messageText,
			})
		);

		setStatus("streaming");
	}

	return (
		<div className="min-h-screen bg-gray-50 flex flex-col">
			<header className="bg-white shadow px-4 py-3">
				<div className="max-w-4xl mx-auto flex items-center gap-4">
					<Link to="/" className="text-blue-600 hover:underline">
						← Back
					</Link>
					<h1 className="font-semibold">
						{owner}/{name}
					</h1>
					<span className="text-sm text-gray-500">
						{status === "connected"
							? "Connected"
							: status === "connecting"
								? "Connecting..."
								: status === "streaming"
									? "Thinking..."
									: "Disconnected"}
					</span>
				</div>
			</header>

			<main className="flex-1 max-w-4xl w-full mx-auto p-4 flex flex-col">
				{error && (
					<div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
						{error}
					</div>
				)}

				<div className="flex-1 bg-white rounded-lg shadow p-4 mb-4 overflow-y-auto max-h-[calc(100vh-220px)]">
					{messages.length === 0 && (
						<div className="text-center text-gray-500 py-8">
							<p>Ask anything about this codebase.</p>
							<p className="text-sm mt-2">
								Example: "How does auth work?" or "Find all uses of streamText"
							</p>
						</div>
					)}

					{messages.map((msg) => (
						<MessageBubble key={msg.id} message={msg} />
					))}
					<div ref={messagesEndRef} />
				</div>

				<form onSubmit={handleSubmit} className="flex gap-2">
					<input
						type="text"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="Ask about the code..."
						className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
						disabled={status !== "connected"}
					/>
					<button
						type="submit"
						disabled={status !== "connected" || !input.trim()}
						className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
					>
						{status === "streaming" ? "..." : "Send"}
					</button>
				</form>
			</main>
		</div>
	);
}

function MessageBubble({ message }: { message: Message }) {
	const isUser = message.role === "user";

	return (
		<div className={`mb-4 ${isUser ? "text-right" : "text-left"}`}>
			<div
				className={`inline-block max-w-[80%] px-4 py-2 rounded-lg ${
					isUser ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"
				}`}
			>
				<div className="prose prose-sm max-w-none">
					<ReactMarkdown remarkPlugins={[remarkGfm]}>
						{message.content}
					</ReactMarkdown>
				</div>
				{message.sources && message.sources.length > 0 && (
					<div className="mt-2 pt-2 border-t border-gray-300 text-xs text-gray-600">
						<p className="font-semibold">Sources:</p>
						<ul className="mt-1 space-y-1">
							{message.sources.map((source, i) => (
								<li key={i}>
									{source.filePath} (lines {source.lineStart}-{source.lineEnd})
									<span className="text-gray-400 ml-1">
										(score: {source.score.toFixed(2)})
									</span>
								</li>
							))}
						</ul>
					</div>
				)}
			</div>
		</div>
	);
}
