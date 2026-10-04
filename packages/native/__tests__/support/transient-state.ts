import { dismissSnack } from "@cue/core/stores/snackbar-store";
import { act } from "react";

afterEach(async () => {
  await act(async () => dismissSnack());
});
