import type { ReactElement } from "react";
import { ComingSoon } from "../../../src/ui/ComingSoon";
import { TEST_IDS } from "../../../src/ui/test-ids";

export default function Calendar(): ReactElement {
  return <ComingSoon title="Calendar" testID={TEST_IDS.screenCalendar} />;
}
