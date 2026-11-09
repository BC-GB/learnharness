/** Deployment capabilities, not account status or a connectivity test. No secrets. */
export function providerCapabilities() {
 const brokered = process.env.LH_BROKER_MODE === "1";
 return { mode: brokered ? "isolated-broker" as const : "standard" as const,
  directProviderSetup: !brokered,
  supportedProtocol: brokered ? "openai-responses" : null,
  explanation: brokered ? "This installation routes models through its isolated OpenAI Responses broker. Direct API keys, custom endpoints and other provider connections are not enabled here. Adding a key would not make them work." : null,
  nextStep: brokered ? "A new provider needs a reviewed broker adapter and explicit endpoint, credential and billing authorization. Existing credentials and saved provider settings are unchanged." : null };
}
export function providerSetupDenied() {
 return Response.json({ code: "PROVIDER_SETUP_NOT_ENABLED", error: providerCapabilities().explanation }, { status: 409 });
}
