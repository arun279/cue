output.writesDropped = http.post("http://127.0.0.1:8787/__fault?drop-write", { body: "" }).ok;
