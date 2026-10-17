output.revokeRefused = http.post("http://127.0.0.1:8787/__fault", {
  body: JSON.stringify({ rules: [{ path: "^/oauth/revoke$", status: 500 }] }),
}).ok;
