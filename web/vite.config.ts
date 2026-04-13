import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { reactRouter } from "@react-router/dev/vite";

export default defineConfig({
	plugins: [react(), reactRouter()],
	server: {
		port: 5173,
		proxy: {
			"/api": "http://localhost:8787",
			"/chat": "http://localhost:8787",
		},
	},
	build: {
		outDir: "build",
	},
	define: {
		"import.meta.env.VITE_API_BASE": JSON.stringify(
			process.env.VITE_API_BASE || "https://repomind.codyboring.workers.dev"
		),
	},
});
