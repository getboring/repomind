import type { CodeChunk } from "../types";

interface ChunkOptions {
	maxChunkSize?: number;
	minChunkSize?: number;
}

export function chunkCode(
	content: string,
	filePath: string,
	options: ChunkOptions = {}
): CodeChunk[] {
	const { maxChunkSize = 1000, minChunkSize = 20 } = options;
	const chunks: CodeChunk[] = [];
	const lines = content.split("\n");

	// Detect file type
	const isTypeScript = filePath.endsWith(".ts") || filePath.endsWith(".tsx");
	const isJavaScript = filePath.endsWith(".js") || filePath.endsWith(".jsx");

	if (!isTypeScript && !isJavaScript) {
		// For non-JS/TS files, chunk by line groups
		return chunkByLines(content, filePath, lines, maxChunkSize, minChunkSize);
	}

	// Parse and chunk by constructs
	let currentChunk: string[] = [];
	let currentStart = 0;
	let inComment = false;
	let braceDepth = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		// Track brace depth for function/class boundaries
		if (!inComment) {
			braceDepth += (line.match(/{/g) ?? []).length;
			braceDepth -= (line.match(/}/g) ?? []).length;
		}

		// Detect chunk boundaries
		const isBoundary =
			isFunctionStart(trimmed) ||
			isClassStart(trimmed) ||
			isInterfaceStart(trimmed) ||
			isTypeStart(trimmed) ||
			isExportBlock(trimmed);

		// Start new chunk at boundary if current is big enough
		if (isBoundary && currentChunk.length > 0) {
			const currentChunkText = currentChunk.join("\n");
			if (currentChunkText.length >= minChunkSize) {
				chunks.push(
					createChunk(filePath, currentChunk, currentStart, detectChunkType(currentChunk))
				);
			}
			currentChunk = [];
			currentStart = i;
		}

		currentChunk.push(line);

		// Force chunk if too big (use >= to chunk at or before max)
		const currentChunkText = currentChunk.join("\n");
		if (currentChunkText.length >= maxChunkSize) {
			chunks.push(
				createChunk(filePath, currentChunk, currentStart, detectChunkType(currentChunk))
			);
			currentChunk = [];
			currentStart = i + 1;
		}
	}

	// Add remaining chunk
	if (currentChunk.length > 0) {
		const text = currentChunk.join("\n");
		if (text.length >= minChunkSize) {
			chunks.push(
				createChunk(filePath, currentChunk, currentStart, detectChunkType(currentChunk))
			);
		}
	}

	return chunks;
}

function chunkByLines(
	content: string,
	filePath: string,
	lines: string[],
	maxChunkSize: number,
	minChunkSize: number
): CodeChunk[] {
	const chunks: CodeChunk[] = [];
	let currentChunk: string[] = [];
	let currentStart = 0;

	for (let i = 0; i < lines.length; i++) {
		currentChunk.push(lines[i]);

		const currentText = currentChunk.join("\n");

		if (currentText.length >= maxChunkSize) {
			if (currentText.length >= minChunkSize) {
				chunks.push(
					createChunk(filePath, currentChunk, currentStart, "other")
				);
			}
			currentChunk = [];
			currentStart = i + 1;
		}
	}

	if (currentChunk.length > 0) {
		const text = currentChunk.join("\n");
		if (text.length >= minChunkSize) {
			chunks.push(createChunk(filePath, currentChunk, currentStart, "other"));
		}
	}

	return chunks;
}

function createChunk(
	filePath: string,
	lines: string[],
	startLine: number,
	chunkType: CodeChunk["chunkType"]
): CodeChunk {
	const content = lines.join("\n");
	return {
		id: `${filePath}-${startLine}`,
		repoId: "", // Set by caller
		filePath,
		lineStart: startLine + 1, // 1-indexed
		lineEnd: startLine + lines.length,
		content,
		chunkType,
	};
}

function detectChunkType(lines: string[]): CodeChunk["chunkType"] {
	const firstLine = lines[0]?.trim() ?? "";

	if (isFunctionStart(firstLine)) return "function";
	if (isClassStart(firstLine)) return "class";
	if (isInterfaceStart(firstLine)) return "interface";
	if (isTypeStart(firstLine)) return "type";
	if (isImportBlock(lines)) return "import";
	if (isExportBlock(firstLine)) return "export";
	if (isCommentBlock(lines)) return "comment";

	return "other";
}

function isFunctionStart(line: string): boolean {
	// Don't match constructor as a function boundary (it's part of a class)
	if (/^\s*constructor\s*\(/.test(line)) return false;

	return (
		/^\s*(export\s+)?\s*(async\s+)?function\s+\w+/.test(line) ||
		/^\s*(export\s+)?\s*const\s+\w+\s*=\s*(async\s+)?\(/.test(line) ||
		/^\s*(export\s+)?\s*const\s+\w+\s*=\s+async\s/.test(line) ||
		/^\s*(export\s+)?\s*const\s+\w+\s*=\s*\(/.test(line) // Arrow function with parens
	);
}

function isClassStart(line: string): boolean {
	return /^\s*(export\s+)?\s*class\s+\w+/.test(line);
}

function isInterfaceStart(line: string): boolean {
	return /^\s*(export\s+)?\s*interface\s+\w+/.test(line);
}

function isTypeStart(line: string): boolean {
	return /^\s*(export\s+)?\s*type\s+\w+/.test(line);
}

function isImportBlock(lines: string[]): boolean {
	return lines.every((line) =>
		/^\s*import\s/.test(line) ||
		line.trim() === "" ||
		line.trim().startsWith("//")
	);
}

function isExportBlock(line: string): boolean {
	// Match export { ... } or export * from "..."
	if (/^\s*export\s*\{/.test(line)) return true;
	if (/^\s*export\s+\*/.test(line)) return true;
	return /^\s*export\s/.test(line) && !line.includes("function") && !line.includes("class") && !line.includes("const") && !line.includes("type") && !line.includes("interface") && !line.includes("default");
}

function isCommentBlock(lines: string[]): boolean {
	return lines.every((line) =>
		/^\s*\/\//.test(line) ||
		/^\s*\/\*/.test(line) ||
		/^\s*\*/.test(line) ||
		/^\s*\*\//.test(line) ||
		line.trim() === ""
	);
}
