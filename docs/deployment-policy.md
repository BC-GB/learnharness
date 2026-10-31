# Deployment policy

The server supports operator-controlled restrictions for deployments that use a limited document library and do not need browser execution, subscription login, or raw PDF processing. Set these values in the server process environment; they are not user-editable API settings.

| Setting | Effect |
| --- | --- |
| `LH_SOURCE_ROOT=/path/to/library` | Confines model-facing source resolution to that directory, including real-path checks for symlinks and traversal. Without this setting, upstream home-directory behavior remains. |
| `LH_BROWSER_ENGINE=disabled` | Blocks browser/helper launches, interactive demo execution and browser fallback for SVG rendering. Native static SVG rendering remains available. |
| `LH_DISABLE_RESEARCH=1` | Blocks research dispatch, researcher startup, search and remote page/PDF fetching. |
| `LH_DISABLE_SUBSCRIPTION_AUTH=1` | Blocks subscription login, account selection, browser redirects, token leases and subscription transports. |
| `LH_IGNORE_ENV_KEYS=1` | Ignores inherited provider API keys; existing explicit application key storage remains separate. |
| `LH_DISABLE_PDF_PROCESSING=1` | Blocks PDF loading before PDF.js and its native canvas dependency load. Use prepared text and image documents instead. |
| `LH_DISABLE_PDF_RENDERING=1` | Blocks PDF rasterization. Processing restrictions also block rasterization. |
| `NEXT_TELEMETRY_DISABLED=1` | Disables Next.js telemetry. |

Restrictions are opt-in unless stated otherwise. This fork removes app-provided raw SVG/HTML export controls and rejects calls to the shared artifact download helper. Static image display and fullscreen viewing remain available. This does not prevent deliberate markup extraction through browser developer tools.

Raw provider-event recording requires exactly `LH_PROVIDER_EVENTS=1`. Leave it unset for normal operation. Values such as `0` and `false` do not enable recording. Enabling it can persist request/response content locally; treat those files as sensitive.

`LH_CALLBACK_PORT` and `LH_CALLBACK_BIND` configure the subscription callback listener for container ingress. Defaults remain an ephemeral port and `127.0.0.1`. Do not expose callback or application ports publicly without an independently authenticated gateway.

## Boundaries

These settings reduce exposed application features. They are not a security sandbox against arbitrary code already executing in the server process. Use independent runtime restrictions: non-root execution, a read-only root, no host folders or Docker socket, bounded resources, and external network controls.

An allowed provider hostname does not establish that a request contains only intended data. Normal model requests can include conversation history, retrieved document text, tool results and summaries; background model operations need the same privacy review as foreground chat. API credentials supplied to the application are readable by that application. Do not supply credentials for accounts you are unwilling to trust it with.

The source changes and tests do not certify absence of malware, decoder vulnerabilities, container escapes or unintended data collection. Network approval gateways and production isolation require separate integration and validation; this document does not claim to provide them.
