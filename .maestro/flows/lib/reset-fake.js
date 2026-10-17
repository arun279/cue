const response = http.post("http://127.0.0.1:8787/__reset?seed=default", { body: "" });
output.fakeReset = response.ok;
