rule audit_delayed_sensitive_activity {
 meta:
  identifies = "review.delayed_sensitive_activity"
  description = "Timer/date/environment condition alongside sensitive access and outbound capability; review the actual data flow."
 strings:
  $trigger1 = "setTimeout(" $trigger2 = "setInterval(" $trigger3 = "Date.now(" $trigger4 = "process.uptime("
  $source1 = "readFile" $source2 = "document.cookie" $source3 = "localStorage" $source4 = "process.env"
  $sink1 = "fetch(" $sink2 = ".request(" $sink3 = "sendBeacon(" $sink4 = "WebSocket("
 condition: any of ($trigger*) and any of ($source*) and any of ($sink*)
}
rule audit_browser_collection {
 meta:
  identifies = "review.browser_collection"
  description = "Browser data/input collection alongside outbound capability; may be legitimate app functionality."
 strings:
  $source1 = "document.cookie" $source2 = "localStorage" $source3 = "clipboard.read" $source4 = "getDisplayMedia" $source5 = "keydown"
  $sink1 = "sendBeacon" $sink2 = "fetch(" $sink3 = "WebSocket" $sink4 = "XMLHttpRequest"
 condition: any of ($source*) and any of ($sink*)
}
