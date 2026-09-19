import type { ReactElement } from "react";
import { ComingSoon } from "../../../src/ui/ComingSoon";
import { TEST_IDS } from "../../../src/ui/test-ids";

export default function Library(): ReactElement {
  return <ComingSoon title="Library" testID={TEST_IDS.screenLibrary} />;
}
