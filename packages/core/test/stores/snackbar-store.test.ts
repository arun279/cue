import {
  dismissSnack,
  showFailure,
  showUndoable,
  snackText,
  useSnackbar,
} from "@cue/core/stores/snackbar-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const snack = () => useSnackbar.getState().snack;

beforeEach(() => {
  dismissSnack();
});

describe("what a snack says", () => {
  it("reads a two part sentence as one line, which is what an announcement takes", () => {
    expect(snackText({ subject: "Harbor Lights", predicate: " S3 E5 marked" })).toBe(
      "Harbor Lights S3 E5 marked",
    );
    expect(snackText("3 episodes marked")).toBe("3 episodes marked");
  });

  it("holds the two halves apart rather than the markup that joins them", () => {
    showUndoable({ subject: "Harbor Lights", predicate: " S3 E5 marked" }, () => {});

    // The emphasis is a fact about the sentence; which face carries it is the
    // drawing app's business, and a DOM element here crashes a native text tree.
    expect(snack()?.message).toEqual({
      subject: "Harbor Lights",
      predicate: " S3 E5 marked",
    });
  });
});

describe("what a snack offers", () => {
  it("gives a reversible action its Undo, and clears itself when it is taken", () => {
    const undo = vi.fn();
    showUndoable("Glasshouse stopped", undo);

    const action = snack()?.actions?.[0];
    expect(action?.label).toBe("Undo");
    action?.onPress();

    expect(undo).toHaveBeenCalledTimes(1);
    expect(snack()).toBeNull();
  });

  it("gives a failure a Dismiss that also clears what raised it", () => {
    const clear = vi.fn();
    showFailure("Couldn't undo Harbor Lights. Please try again.", clear);

    const action = snack()?.actions?.[0];
    expect(action?.label).toBe("Dismiss");
    // Without this the error stands in its owner and the snack comes straight
    // back on the next render.
    action?.onPress();

    expect(clear).toHaveBeenCalledTimes(1);
    expect(snack()).toBeNull();
  });

  it("keeps exactly one transient message, and keys each replacement", () => {
    showFailure("first", () => {});
    const first = snack()?.seq;
    showUndoable("second", () => {});

    expect(snack()?.message).toBe("second");
    expect(snack()?.seq).toBeGreaterThan(first ?? 0);
  });
});
