import assert from "node:assert/strict";
import { test } from "node:test";
import { providerCapabilities, providerSetupDenied } from "../src/server/provider-capabilities.ts";

test("capabilities report deployment restrictions without secrets or provider probes", async () => {
 const before = process.env.LH_BROKER_MODE;
 try {
  process.env.LH_BROKER_MODE = "1";
  const caps = providerCapabilities();
  assert.equal(caps.mode, "isolated-broker"); assert.equal(caps.directProviderSetup, false);
  assert.equal(caps.supportedProtocol, "openai-responses");
  assert.match(caps.explanation!, /Adding a key would not make them work/);
  const denied = providerSetupDenied(); assert.equal(denied.status, 409);
  assert.equal((await denied.json()).code, "PROVIDER_SETUP_NOT_ENABLED");
  delete process.env.LH_BROKER_MODE;
  assert.equal(providerCapabilities().directProviderSetup, true);
  assert.equal(providerCapabilities().explanation, null);
 } finally { if (before === undefined) delete process.env.LH_BROKER_MODE; else process.env.LH_BROKER_MODE = before; }
});
