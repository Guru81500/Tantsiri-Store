import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("project contains the public app and Worker entrypoint", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/src/index.js", import.meta.url), "utf8");
  assert.match(html, /Tantsiri/);
  assert.match(worker, /\/api\/orders/);
  assert.match(worker, /\/api\/auth\/verify-otp/);
});
