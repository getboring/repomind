import type { RouteConfig } from "@react-router/dev/routes";
import { index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("chat/:owner/:name", "routes/chat.tsx"),
] satisfies RouteConfig;
