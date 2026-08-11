// PathAscent lightweight, privacy-friendly pageview beacon.
// No cookies, no PII — just an anonymous random session id in localStorage
// so the work room can estimate unique visitors.
(function () {
  try {
    var KEY = "pa_sid";
    var sid = localStorage.getItem(KEY);
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(KEY, sid);
    }
    var body = JSON.stringify({
      type: "pageview",
      path: location.pathname,
      sessionId: sid
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true
      }).catch(function () {});
    }
  } catch (e) { /* never let analytics break the page */ }
})();
