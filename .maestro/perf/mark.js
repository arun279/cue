// Asks scripts/perf-probe.mjs, on the host, to start or stop a segment or to take a reading.
const response = http.post(`http://127.0.0.1:8790/${EDGE}?segment=${encodeURIComponent(SEGMENT)}`, {
  body: "",
});
output.marked = response.ok;
