import { describe, expect, it } from "vitest";
import { chunkCode } from "../src/lib/chunker";

describe("chunkCode", () => {
	it("should chunk a simple function", () => {
		const code = `
function hello() {
  return "world";
}
    `.trim();

		const chunks = chunkCode(code, "test.ts");
		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks[0].chunkType).toBe("function");
	});

	it("should chunk multiple functions", () => {
		const code = `
function foo() {
  return 1;
}

function bar() {
  return 2;
}
    `.trim();

		const chunks = chunkCode(code, "test.ts");
		const functions = chunks.filter((c) => c.chunkType === "function");
		expect(functions.length).toBeGreaterThanOrEqual(2);
	});

	it("should detect class definitions", () => {
		const code = `
class MyClass {
  constructor() {
    this.value = 1;
  }
  method() {
    return this.value;
  }
}
    `.trim();

		const chunks = chunkCode(code, "test.ts");
		const classes = chunks.filter((c) => c.chunkType === "class");
		expect(classes.length).toBeGreaterThan(0);
	});

	it("should detect interface definitions", () => {
		const code = `
interface Config {
  name: string;
  value: number;
}
    `.trim();

		const chunks = chunkCode(code, "test.ts");
		const interfaces = chunks.filter((c) => c.chunkType === "interface");
		expect(interfaces.length).toBeGreaterThan(0);
	});

	it("should detect type definitions", () => {
		const code = `
type ID = string;
type User = { name: string };
    `.trim();

		const chunks = chunkCode(code, "test.ts");
		const types = chunks.filter((c) => c.chunkType === "type");
		expect(types.length).toBeGreaterThan(0);
	});

	it("should chunk by lines for non-JS files", () => {
		const code = `
Line 1
Line 2
Line 3
Line 4
Line 5
    `.trim();

		const chunks = chunkCode(code, "test.md");
		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks[0].chunkType).toBe("other");
	});

	it("should respect max chunk size", () => {
		// Create code with many lines, each line is ~10 chars
		// 200 lines = ~2000 chars, should create multiple chunks with max 1000
		const lines = Array.from({ length: 200 }, (_, i) => `const x${i} = ${i};`);
		const code = lines.join("\n");
		const chunks = chunkCode(code, "test.ts", { maxChunkSize: 1000 });
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			// Allow some tolerance since we chunk at line boundaries
			expect(chunk.content.length).toBeLessThanOrEqual(1100);
		}
	});

	it("should skip chunks smaller than min size", () => {
		const code = `const x = 1;`;
		const chunks = chunkCode(code, "test.ts", { minChunkSize: 100 });
		expect(chunks.length).toBe(0);
	});

	it("should detect import blocks", () => {
		const code = `
import { a } from "a";
import { b } from "b";
import { c } from "c";

const x = 1;
    `.trim();

		const chunks = chunkCode(code, "test.ts");
		// The imports should be in a chunk (either as import type or grouped)
		const hasImports = chunks.some(
			(c) => c.content.includes("import { a }") && c.content.includes("import { b }")
		);
		expect(hasImports).toBe(true);
	});

	it("should detect export blocks", () => {
		const code = `
export { somethingLonger, anotherThing };
export { yetAnother, oneMore };
    `.trim();

		const chunks = chunkCode(code, "test.ts");
		// export statements should be in chunks
		const hasExports = chunks.some((c) => c.content.includes("export {"));
		expect(hasExports).toBe(true);
	});

	it("should handle arrow functions", () => {
		const code = `
const fn = () => {
  return 42;
};
    `.trim();

		const chunks = chunkCode(code, "test.ts");
		const functions = chunks.filter((c) => c.chunkType === "function");
		expect(functions.length).toBeGreaterThan(0);
	});

	it("should handle async functions", () => {
		const code = `
async function fetchData() {
  return await fetch("/api");
}
    `.trim();

		const chunks = chunkCode(code, "test.ts");
		const functions = chunks.filter((c) => c.chunkType === "function");
		expect(functions.length).toBeGreaterThan(0);
	});

	it("should set correct line numbers", () => {
		const code = `
function first() {
  return 1;
}

function second() {
  return 2;
}
    `.trim();

		const chunks = chunkCode(code, "test.ts");
		for (const chunk of chunks) {
			expect(chunk.lineStart).toBeGreaterThan(0);
			expect(chunk.lineEnd).toBeGreaterThanOrEqual(chunk.lineStart);
		}
	});

	it("should include file path in chunk ID", () => {
		const code = `function test() { return 1; }`;
		const chunks = chunkCode(code, "src/utils/helpers.ts");
		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks[0].id).toContain("src/utils/helpers.ts");
	});
});
