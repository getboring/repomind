import { renderToString } from "react-dom/server";
import { ServerRouter } from "react-router";

export default function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: unknown
) {
	const html = renderToString(
		<ServerRouter context={routerContext as never} url={request.url} />
	);

	responseHeaders.set("Content-Type", "text/html");

	return new Response("<!DOCTYPE html>" + html, {
		status: responseStatusCode,
		headers: responseHeaders,
	});
}
