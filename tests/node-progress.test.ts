import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveNodeCoverage, mainIdeaLabels, type ProgressMessage, type ProgressPart } from "../components/node-progress-core.ts";
import type { PlanTree } from "../src/core/contracts/plan.ts";
import { projectView } from "../src/core/view.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
const tree: PlanTree = { version: 1, nodes: [{ id: "a", title: "Sampling" }, { id: "b", title: "Inference" }], edges: [] };
const text = (value: string): ProgressPart => ({ type: "text", text: value.replace(/^## (.+)$/gm, "**$1** means a named idea.") });
const tag = (nodeId: string, type = "check"): ProgressPart => ({ type: "tool-quiz", input: { nodeId, type } });
const assistant = (...parts: ProgressPart[]): ProgressMessage => ({ id: "group", role: "assistant", parts });

test("topic names replace rhetorical headings and worked-example steps", () => {
 const lesson = "## Did the model leave useful information behind?\n**Autocorrelation** means correlation over time.\n- **Sales autocorrelation:** patterns in sales.\n- **Residual autocorrelation:** patterns left over.\n## 1. One month, three numbers\n## 2. Now compare across months\n## Given\n**OLS chooses the coefficients.**\n**positive** residual autocorrelation";
 assert.deepEqual(mainIdeaLabels(lesson), ["Autocorrelation", "Sales autocorrelation", "Residual autocorrelation"]);
});
test("only explicit definitions count before concept extraction; code and worked headings stay out", () => {
 assert.deepEqual(mainIdeaLabels("## 1. Instrument relevance\n## Rule A\n**Instrument relevance** means an instrument predicts X.\n**remaining misses:** a casual description.\n```md\n**Hidden** means code.\n```"), ["Instrument relevance"]);
});
test("only tagged teacher prose counts; user guesses and source-reading results do not", () => {
 const result=deriveNodeCoverage(tree,[{id:"user",role:"user",parts:[text("## User guess")]},assistant({type:"tool-read",input:{text:"## Source"}},text("## Sample variation"),tag("a"))]);
 assert.equal(result.current,"a");assert.deepEqual(result.nodes[0]!.ideas,["Sample variation"]);
 assert.equal(deriveNodeCoverage(tree,[assistant(text("## Not tagged"),tag("unknown"))]).current,null);
});
test("checks follow explanations; predictions leave the preceding node's material with that node", () => {
 const result=deriveNodeCoverage(tree,[assistant(text("## Sample variation"),tag("a"),text("## Sample size"),tag("b","predict"),text("## Standard errors"))]);
 assert.equal(result.current,"b");assert.deepEqual(result.nodes.map(n=>n.ideas),[["Sample variation","Sample size"],["Standard errors"]]);
});
test("revisits deduplicate topic labels and preserve first-appearance order", () => {
 const result=deriveNodeCoverage(tree,[assistant(text("## 1. Sample variation"),tag("a"),text("## Standard errors"),tag("b"),text("## 2. Sample variation\n**Sample size:** the number of observations."),tag("a"))]);
 assert.equal(result.current,"a");assert.deepEqual(result.nodes[0]!.ideas,["Sample variation","Sample size"]);
});
test("answer results and reading notes are never even read", () => {
 const part={...tag("a"),get output(){throw Error("Question results must not be read");}};
 assert.deepEqual(deriveNodeCoverage(tree,[assistant(text("## Sample variation"),part)]).nodes[0]!.ideas,["Sample variation"]);
});
test("native assistant grouping still exposes literal topic definitions", () => {
 const native=[{id:"m1",role:"assistant",content:[{type:"text",text:"**Sample variation** means differences across samples."}],stopReason:"stop"},{id:"m2",role:"assistant",content:[{type:"toolCall",id:"q1",name:"explain",arguments:{nodeId:"a",type:"check"}}],stopReason:"toolUse"}] as unknown as LhMessage[];
 assert.deepEqual(deriveNodeCoverage(tree,projectView(native)).nodes[0]!.ideas,["Sample variation"]);
});
test("no completion, model state or persistent outline is written", () => {
 const messages=[assistant(text("## Sample variation"),tag("a"))];const before=JSON.stringify({tree,messages});
 function freeze(v: unknown){if(v&&typeof v==="object"){Object.freeze(v);for(const x of Object.values(v))freeze(x);}}
 freeze(messages);freeze(tree);deriveNodeCoverage(tree,messages);assert.equal(JSON.stringify({tree,messages}),before);
});

test("existing concepts are scoped by chat and native teacher provenance, with no new extraction", () => {
 const messages=[assistant({type:"text",id:"native-a-t0",text:"An explanation without formatted headings."},tag("a"),{type:"text",id:"native-b-t0",text:"**Standard errors** measure uncertainty."},tag("b"))];
 const concepts=[{name:"Sampling variation",provenance:[{chatId:"current",messageId:"native-a"}]},{name:"Wrong chat",provenance:[{chatId:"other",messageId:"native-b"}]},{name:"Canonical standard error",provenance:[{chatId:"current",messageId:"native-b"}]}];
 const result=deriveNodeCoverage(tree,messages,concepts,"current");
 assert.deepEqual(result.nodes.map(n=>n.ideas),[["Sampling variation"],["Canonical standard error"]]);
});
test("saved concepts remain stable instead of collecting every intervening definition", () => {
 const messages=[assistant({type:"text",id:"native-a-t0",text:"A saved explanation."},tag("a"),{type:"text",id:"native-b-t0",text:"**Sample size** means the number of observations."})];
 const concepts=[{name:"Sampling variation",provenance:[{chatId:"current",messageId:"native-a"}]}];
 assert.deepEqual(deriveNodeCoverage(tree,messages,concepts,"current").nodes[0]!.ideas,["Sampling variation"]);
});
