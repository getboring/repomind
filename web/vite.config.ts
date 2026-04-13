import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { reactRouter } from "@react-router/dev/vite";

export default defineConfig({
	plugins: [react(), reactRouter()],
	server: {
		port: 5173,
		proxy: {
			"/api": "http://localhost:8787",
			"/agents": "http://localhost:8787",
		},
	},
	build: {
		outDir: "build",
	},
});
