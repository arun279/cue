import { setStringAsync } from "expo-clipboard";
import type { ReactElement } from "react";
import { View } from "react-native";
import { incidentReport, PROBLEM_LABELS } from "@/core/data/trakt/diagnostics";
import { useAppVersion } from "@/core/ports/app-version";
import { useReadIncidents } from "@/core/stores/read-incidents-store";
import { showSnack } from "@/core/stores/snackbar-store";
import { useStartFailure } from "@/core/stores/start-failure-store";
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
  const startFailure = useStartFailure((state) => state.failure);
  const version = useAppVersion();
  const copy = async (): Promise<void> => {
    await setStringAsync(incidentReport(incidents, version, startFailure));
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
      {startFailure === null ? null : (
        <Note>
          {`Couldn't start · ${new Date(startFailure.at).toLocaleString(undefined, WHEN)} · ${startFailure.detail}`}
        </Note>
      )}
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
