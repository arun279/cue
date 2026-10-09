const response = http.post("http://127.0.0.1:8787/__approve", { body: "" });
output.deviceApproved = response.ok;
