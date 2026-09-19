output.writeHeld = http.post("http://127.0.0.1:8787/__fault?hold-write", { body: "" }).ok;
