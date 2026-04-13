import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "ai";

export default function Chat() {
	const { owner, name } = useParams();
	const agentName = `RepoMind:${owner}:${name}`;
	const agent = useAgent({ agent: "RepoMindAgent", name: agentName });
	const { messages, sendMessage, status } = useAgentChat({ agent });
	const [input, setInput] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!input.trim() || status === "streaming") return;

		sendMessage({ text: input });
		setInput("");
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
						{agent.status === "connected"
							? "Connected"
							: agent.status === "connecting"
								? "Connecting..."
								: "Disconnected"}
					</span>
				</div>
			</header>

			<main className="flex-1 max-w-4xl w-full mx-auto p-4 flex flex-col">
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
						disabled={status === "streaming"}
					/>
					<button
						type="submit"
						disabled={status === "streaming" || !input.trim()}
						className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
					>
						{status === "streaming" ? "..." : "Send"}
					</button>
				</form>
			</main>
		</div>
	);
}

function MessageBubble({ message }: { message: UIMessage }) {
	const isUser = message.role === "user";

	return (
		<div className={`mb-4 ${isUser ? "text-right" : "text-left"}`}>
			<div
				className={`inline-block max-w-[80%] px-4 py-2 rounded-lg ${
					isUser ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"
				}`}
			>
				{message.parts?.map((part, i) => {
					if (part.type === "text") {
						return (
							<div key={i} className="prose prose-sm max-w-none">
								<ReactMarkdown remarkPlugins={[remarkGfm]}>
									{part.text}
								</ReactMarkdown>
							</div>
						);
					}
					return null;
				})}
			</div>
		</div>
	);
}
