import { incidentReport, PROBLEM_LABELS } from "@cue/core/data/trakt/diagnostics";
import { useAppVersion } from "@cue/core/ports/app-version";
import { useReadIncidents } from "@cue/core/stores/read-incidents-store";
import { showSnack } from "@cue/core/stores/snackbar-store";
import { setStringAsync } from "expo-clipboard";
import type { ReactElement } from "react";
import { View } from "react-native";
import { Button } from "../../ui/Button";
import { TEST_IDS } from "../../ui/test-ids";
import { Note, SettingRow } from "./Rows";

const WHEN: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

export function Diagnostics(): ReactElement {
  const incidents = useReadIncidents((state) => state.incidents);
  const version = useAppVersion();
  const copy = async (): Promise<void> => {
    await setStringAsync(incidentReport(incidents, version));
    showSnack({ message: "Report copied." });
  };
  return (
    <View testID={TEST_IDS.settingsDiagnostics}>
      <SettingRow
        title="Diagnostics"
        trailing={
          <Button
            label="Copy report"
            variant="link"
            testID={TEST_IDS.settingsDiagnosticsCopy}
            onPress={() => void copy()}
          />
        }
      />
      {incidents.length === 0 ? (
        <Note>No Trakt errors recorded.</Note>
      ) : (
        incidents.map((incident) => (
          <Note key={incident.endpoint}>
            {[
              PROBLEM_LABELS[incident.kind],
              incident.endpoint,
              new Date(incident.at).toLocaleString(undefined, WHEN),
              incident.detail,
            ]
              .filter((part) => part !== "")
              .join(" · ")}
          </Note>
        ))
      )}
    </View>
  );
}
