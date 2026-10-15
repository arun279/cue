import { Linking } from "react-native";

export let AUTO_DISMISS_UNDO = true;

function readUndoLink(url: string | null): void {
  if (url?.startsWith("cue://") && new URL(url).searchParams.get("keepUndo") === "1")
    AUTO_DISMISS_UNDO = false;
}

Linking.addEventListener("url", ({ url }) => readUndoLink(url));
void Linking.getInitialURL().then(readUndoLink);
