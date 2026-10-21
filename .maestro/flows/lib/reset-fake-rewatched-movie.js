const response = http.post("http://127.0.0.1:8787/__reset?seed=rewatched-movie", { body: "" });
output.fakeReset = response.ok;
