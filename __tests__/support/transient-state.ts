import { onlineManager } from "@tanstack/react-query";
import { act } from "react";
import { dismissSnack } from "@/core/stores/snackbar-store";

afterEach(async () => {
  await act(async () => {
    dismissSnack();
    onlineManager.setOnline(true);
  });
});
