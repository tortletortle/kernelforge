import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("./web/trace-viewer.html", import.meta.url), "utf8");
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match, "viewer script exists");
const cut = match[1].indexOf('$("fileInput").addEventListener');
assert.ok(cut > 0, "viewer setup boundary exists");
const api = new Function(match[1].slice(0, cut) + "\nreturn { demoData, parseTrace, buildModel };")();

const records = api.parseTrace(api.demoData());
const model = api.buildModel(records);
assert.equal(model.switches.length, 11);
assert.equal(model.wakeups.length, 6);
assert.equal(model.cpuCount, 2);
assert.equal(model.segments.length, 10);
assert.equal(model.processes.length, 4);
assert.equal(model.summaryPresent, true);
assert.equal(model.summary.dropped, 0);
assert.equal(model.latencies.length, 6);
assert.throws(() => api.parseTrace('{"type":"switch"'), /JSON 格式错误/);

const incomplete = api.buildModel(records.filter(r => r.type !== "summary"));
assert.equal(incomplete.summaryPresent, false);
console.log("trace viewer fixtures passed: demo reconstruction, parser rejection, missing-summary handling");
