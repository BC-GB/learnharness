/** Session launcher and browser host adapter tests.
 *
 * The launcher is exercised against the recorded frontend host plus an injected
 * native session host, so no network or sessionStorage is touched. The adapter
 * test separately locks the same-origin POST shape and opening-prompt payload.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionLauncher } from "../src/session-launcher.ts";
import { createBrowserSessionHost } from "../src/native-session-host.ts";
import type { NativeSessionHost } from "../src/native-session-host.ts";
import { makePath } from "./fixtures.ts";
import { createViewFixture } from "./view-host.ts";
import type { ViewFixture } from "./view-host.ts";

interface FakeHost extends NativeSessionHost {
  readonly created: { title: string; kind: string }[];
  readonly staged: { chatId: string; text: string }[];
  readonly cleared: string[];
}

function fakeHost(
  fixture: ViewFixture,
  options: { chatId?: string; failStage?: boolean; failCreate?: boolean } = {},
): FakeHost {
  const created: { title: string; kind: string }[] = [];
  const staged: { chatId: string; text: string }[] = [];
  const cleared: string[] = [];
  return {
    created,
    staged,
    cleared,
    async create(input) {
      if (options.failCreate) throw new Error("host refused session creation");
      created.push({ title: input.title, kind: input.kind });
      const chatId = options.chatId ?? "chat-new";
      fixture.nativeChats.set(chatId, {
        id: chatId,
        title: input.title,
        kind: input.kind === "practice" ? "practice" : "teach",
      });
      return { chatId };
    },
    stageOpeningPrompt(chatId, text) {
      if (options.failStage) return false;
      staged.push({ chatId, text });
      return true;
    },
    clearOpeningPrompt(chatId) {
      cleared.push(chatId);
    },
  };
}

test("starting a teaching chat prepares, creates, stages, links and opens it", async () => {
  const path = makePath();
  const fixture = createViewFixture({ paths: [path] });
  try {
    const host = fakeHost(fixture);
    const launcher = createSessionLauncher(fixture.context, { host });

    const result = await launcher.start({
      pathId: path.id,
      nodeId: "n-skill",
      kind: "teaching",
    });

    assert.equal(result.chatId, "chat-new");
    assert.deepEqual(host.created, [{ title: "Teaching: Node n-skill", kind: "teaching" }]);
    assert.equal(host.staged.length, 1);
    assert.equal(host.staged[0]!.chatId, "chat-new");
    assert.match(host.staged[0]!.text, /# Learning Path child session brief/);
    assert.match(host.staged[0]!.text, /Drops a sign while expanding/);
    assert.deepEqual(
      fixture.calls.filter((call) => call.name.startsWith("sessions.")).map((call) => call.name),
      ["sessions.prepare", "sessions.link"],
    );
    assert.deepEqual(fixture.openedSessions, ["chat-new"], "the newly linked chat opens immediately");
    const linked = fixture.paths
      .get(path.id)!
      .modules.flatMap((module) => module.nodes)
      .find((node) => node.id === "n-skill")!
      .childSessions.find((entry) => entry.chatId === "chat-new");
    assert.ok(linked);
    assert.equal(linked.kind, "teaching");
    assert.equal(result.link.chatId, "chat-new");
  } finally {
    fixture.restore();
  }
});

test("a practice start sends kind practice in both creation and link", async () => {
  const path = makePath();
  const fixture = createViewFixture({ paths: [path] });
  try {
    const host = fakeHost(fixture, { chatId: "chat-practice-new" });
    const launcher = createSessionLauncher(fixture.context, { host });
    await launcher.start({ pathId: path.id, nodeId: "n-concept", kind: "practice" });
    assert.deepEqual(host.created, [{ title: "Practice: Node n-concept", kind: "practice" }]);
    const linkCall = fixture.calls.find((call) => call.name === "sessions.link")!;
    assert.equal((linkCall.input as { kind: string }).kind, "practice");
  } finally {
    fixture.restore();
  }
});

test("a staging failure creates no link, so an existing session can still be attached", async () => {
  const path = makePath();
  const fixture = createViewFixture({ paths: [path] });
  try {
    const host = fakeHost(fixture, { failStage: true });
    const launcher = createSessionLauncher(fixture.context, { host });
    await assert.rejects(
      () => launcher.start({ pathId: path.id, nodeId: "n-skill", kind: "teaching" }),
      /opening brief could not be staged/,
    );
    assert.equal(fixture.calls.some((call) => call.name === "sessions.link"), false);
    assert.equal(
      fixture.paths
        .get(path.id)!
        .modules.flatMap((module) => module.nodes)
        .find((node) => node.id === "n-skill")!
        .childSessions.length,
      0,
    );
    assert.deepEqual(fixture.openedSessions, []);
    assert.deepEqual(host.cleared, []);
  } finally {
    fixture.restore();
  }
});

test("a link failure clears the staged prompt and does not navigate", async () => {
  const path = makePath();
  const fixture = createViewFixture({ paths: [path] });
  try {
    // chat-1 is already linked to n-concept in the fixture path.
    const host = fakeHost(fixture, { chatId: "chat-1" });
    const launcher = createSessionLauncher(fixture.context, { host });
    await assert.rejects(
      () => launcher.start({ pathId: path.id, nodeId: "n-skill", kind: "teaching" }),
      /already linked/,
    );
    assert.deepEqual(host.cleared, ["chat-1"]);
    assert.deepEqual(fixture.openedSessions, []);
  } finally {
    fixture.restore();
  }
});

test("available lists native chats with their link state; attach only writes a link", async () => {
  const path = makePath();
  const fixture = createViewFixture({
    paths: [path],
    nativeChats: [{ id: "chat-free", title: "Free practice", kind: "practice" }],
  });
  try {
    const host = fakeHost(fixture);
    const launcher = createSessionLauncher(fixture.context, { host });

    const sessions = await launcher.available();
    assert.deepEqual(
      sessions
        .map((entry) => [entry.chatId, entry.kind, entry.linked && "nodeId" in entry.linked ? entry.linked.nodeId : null] as const)
        .sort((a, b) => a[0].localeCompare(b[0])),
      [
        ["chat-1", "teaching", "n-concept"],
        ["chat-free", "practice", null],
      ],
    );

    const linked = await launcher.attach({
      pathId: path.id,
      nodeId: "n-skill",
      chatId: "chat-free",
      kind: "practice",
      label: "Free practice",
    });
    assert.equal(linked.link.chatId, "chat-free");
    assert.equal(host.created.length, 0, "attaching never creates a native chat");
    assert.equal(host.staged.length, 0);
    assert.equal(fixture.openedSessions.length, 0);
  } finally {
    fixture.restore();
  }
});

test("browser adapter delegates course ownership and drafts to the host", async () => {
  const requests: unknown[] = [], drafts: string[] = [];
  const host = createBrowserSessionHost({ app: { createSession: async input => {
    requests.push(input); return { id: "created", stageOpeningPrompt: text => { drafts.push(text); return true; }, clearOpeningPrompt: () => { drafts.length = 0; } };
  } } });
  assert.equal(host.stageOpeningPrompt("unowned", "brief"), false);
  const result = await host.create({ title: "Teaching: Node", kind: "teaching" });
  assert.deepEqual(requests, [{ title: "Teaching: Node", kind: "teaching" }]);
  assert.equal(host.stageOpeningPrompt(result.chatId, "brief"), true); assert.deepEqual(drafts, ["brief"]);
  host.clearOpeningPrompt(result.chatId); assert.deepEqual(drafts, []); assert.equal(host.stageOpeningPrompt(result.chatId, "late"), false);
});
test("browser adapter refuses invalid IDs and reports host creation failures", async () => {
  const bad = createBrowserSessionHost({ app: { createSession: async () => ({ id: "../escape", stageOpeningPrompt: () => true, clearOpeningPrompt() {} }) } });
  await assert.rejects(bad.create({ title: "A", kind: "teaching" }), /Could not open/);
  const failed = createBrowserSessionHost({ app: { createSession: async () => { throw Error("refused"); } } });
  await assert.rejects(failed.create({ title: "A", kind: "practice" }), /Could not open/);
});
