import { dismissSnack } from "@cue/core/stores/snackbar-store";
import { onlineManager } from "@tanstack/react-query";
import { act } from "react";

afterEach(async () => {
  await act(async () => {
    dismissSnack();
    onlineManager.setOnline(true);
  });
});
