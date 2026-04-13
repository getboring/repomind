// Compatibility shim for DurableObject in non-Workers environments (tests)
// In production Workers runtime, these are built-in globals

// biome-ignore-all: This file intentionally uses any types for cross-environment compatibility

// WebSocketPair shim for tests
class WebSocketPairShim {
	0: WebSocket;
	1: WebSocket;
	constructor() {
		// Minimal shim for testing
		this[0] = {} as WebSocket;
		this[1] = {} as WebSocket;
	}
}

// biome-ignore lint/suspicious/noExplicitAny: Cross-environment compatibility shim
export const WebSocketPairClass: any =
	typeof globalThis !== "undefined" &&
	"WebSocketPair" in globalThis &&
	(globalThis as unknown as { WebSocketPair?: typeof WebSocketPair }).WebSocketPair
		? (globalThis as unknown as { WebSocketPair: typeof WebSocketPair }).WebSocketPair
		: (WebSocketPairShim as unknown as typeof WebSocketPair);

// biome-ignore lint/suspicious/noExplicitAny: Cross-environment compatibility shim
export const DurableObjectClass: any =
	typeof globalThis !== "undefined" &&
	"DurableObject" in globalThis &&
	(globalThis as unknown as { DurableObject?: unknown }).DurableObject
		? (globalThis as unknown as { DurableObject: unknown }).DurableObject
		: (class DurableObjectShim {
				constructor(
					protected ctx: DurableObjectState,
					protected env: unknown
				) {}
				async fetch(_request: Request): Promise<Response> {
					throw new Error("Not implemented");
				}
				async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {}
				async webSocketClose(
					_ws: WebSocket,
					_code: number,
					_reason: string,
					_wasClean: boolean
				): Promise<void> {}
			} as unknown as any);

// biome-ignore lint/suspicious/noExplicitAny: Cross-environment compatibility shim
export const WebSocketRequestResponsePairClass: any =
	typeof globalThis !== "undefined" &&
	"WebSocketRequestResponsePair" in globalThis &&
	(globalThis as unknown as { WebSocketRequestResponsePair?: unknown }).WebSocketRequestResponsePair
		? (globalThis as unknown as { WebSocketRequestResponsePair: unknown })
				.WebSocketRequestResponsePair
		: (class WebSocketRequestResponsePairShim {
				constructor(
					public readonly request: string,
					public readonly response: string
				) {}
			} as unknown as typeof WebSocketRequestResponsePair);
