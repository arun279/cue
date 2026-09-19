import type { ReactElement } from "react";
import { ComingSoon } from "../../../src/ui/ComingSoon";
import { TEST_IDS } from "../../../src/ui/test-ids";

export default function Search(): ReactElement {
  return <ComingSoon title="Search" testID={TEST_IDS.screenSearch} />;
}
