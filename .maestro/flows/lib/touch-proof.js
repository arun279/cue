const response = http.post("http://127.0.0.1:8787/__touch-proof", {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ trace: maestro.copiedText }),
});
const verdict = response.ok ? json(response.body) : { tapAgain: false, reason: "no answer" };
output.touchProof = JSON.stringify(verdict);
output.tapAgain = verdict.tapAgain === true;
