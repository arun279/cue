import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const USAGE =
  "usage: APP_STORE_CONNECT_KEY=<base64 .p8> APP_STORE_CONNECT_KEY_ID=<id> APP_STORE_CONNECT_ISSUER_ID=<id> testflight.mjs latest-build | friends <build-number> | NOTES=<text> notes <build-number>";
const [command, buildNumber] = process.argv.slice(2);
const { APP_STORE_CONNECT_KEY, APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID, NOTES } =
  process.env;
if (!APP_STORE_CONNECT_KEY || !APP_STORE_CONNECT_KEY_ID) throw new Error(USAGE);

const eas = JSON.parse(
  readFileSync(new URL("../packages/native/eas.json", import.meta.url), "utf8"),
);
const appId = eas.submit.production.ios.ascAppId;
const key = createPrivateKey(Buffer.from(APP_STORE_CONNECT_KEY, "base64"));
const DEADLINE_MS = 60 * 60 * 1000;
const POLL_MS = 30_000;
const LOCALE = "en-US";

// https://developer.apple.com/documentation/appstoreconnectapi/externalbetastate
const SETTLED = new Set([
  "WAITING_FOR_BETA_REVIEW",
  "IN_BETA_REVIEW",
  "BETA_APPROVED",
  "READY_FOR_BETA_TESTING",
  "IN_BETA_TESTING",
]);
const PENDING = new Set(["PROCESSING", "IN_EXPORT_COMPLIANCE_REVIEW"]);

// https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
const token = () => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "ES256", kid: APP_STORE_CONNECT_KEY_ID, typ: "JWT" });
  const claims = encode({
    iss: APP_STORE_CONNECT_ISSUER_ID,
    iat: now,
    exp: now + 600,
    aud: "appstoreconnect-v1",
  });
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${claims}.${signature.toString("base64url")}`;
};

const api = async (path, data, method = data === undefined ? "GET" : "POST") => {
  const response = await fetch(`https://api.appstoreconnect.apple.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify({ data }),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : (await response.json()).data;
};

const latestBuild = async () => {
  const builds = await api(
    `builds?filter[app]=${appId}&sort=-uploadedDate&limit=200&fields[builds]=version`,
  );
  return Math.max(0, ...builds.map((build) => Number(build.attributes.version)));
};

const until = async (deadline, describe, attempt) => {
  const result = await attempt();
  if (result !== undefined) return result;
  if (Date.now() > deadline) throw new Error(`build ${buildNumber} ${describe()}`);
  await sleep(POLL_MS);
  return until(deadline, describe, attempt);
};

const processedBuild = (deadline) => {
  let processing = "missing";
  return until(
    deadline,
    () => `never finished processing (${processing})`,
    async () => {
      const [found] = await api(`builds?filter[app]=${appId}&filter[version]=${buildNumber}`);
      processing = found?.attributes.processingState ?? "missing";
      if (processing === "VALID") return found;
      if (processing !== "PROCESSING" && processing !== "missing") {
        throw new Error(`build ${buildNumber} is ${processing}`);
      }
      return undefined;
    },
  );
};

// https://developer.apple.com/documentation/appstoreconnectapi/beta-build-localizations
const notes = async () => {
  const build = await processedBuild(Date.now() + DEADLINE_MS);
  const localizations = await api(`builds/${build.id}/betaBuildLocalizations`);
  const existing = localizations.find(({ attributes }) => attributes.locale === LOCALE);
  if (existing === undefined) {
    await api("betaBuildLocalizations", {
      type: "betaBuildLocalizations",
      attributes: { locale: LOCALE, whatsNew: NOTES },
      relationships: { build: { data: { type: "builds", id: build.id } } },
    });
  } else {
    await api(
      `betaBuildLocalizations/${existing.id}`,
      { type: "betaBuildLocalizations", id: existing.id, attributes: { whatsNew: NOTES } },
      "PATCH",
    );
  }
  process.stdout.write(`Build ${buildNumber} tells testers what changed.\n`);
};

const friends = async () => {
  const deadline = Date.now() + DEADLINE_MS;
  const build = await processedBuild(deadline);

  const groups = await api(`betaGroups?filter[app]=${appId}&filter[isInternalGroup]=false`);
  if (groups.length !== 1) {
    throw new Error(
      `expected one external TestFlight group, found: ${groups.map((group) => group.attributes.name).join(", ") || "none"}`,
    );
  }
  const [group] = groups;
  const inGroup = await api(
    `builds?filter[app]=${appId}&filter[version]=${buildNumber}&filter[betaGroups]=${group.id}`,
  );
  if (inGroup.length === 0) {
    await api(`betaGroups/${group.id}/relationships/builds`, [{ type: "builds", id: build.id }]);
  }

  let state = "unknown";
  await until(
    deadline,
    () => `is still ${state}`,
    async () => {
      state = (await api(`builds/${build.id}/buildBetaDetail`)).attributes.externalBuildState;
      if (SETTLED.has(state)) return state;
      if (state === "READY_FOR_BETA_SUBMISSION") {
        await api("betaAppReviewSubmissions", {
          type: "betaAppReviewSubmissions",
          relationships: { build: { data: { type: "builds", id: build.id } } },
        });
        return undefined;
      }
      if (PENDING.has(state)) return undefined;
      throw new Error(`build ${buildNumber} cannot go to testers: ${state}`);
    },
  );
  process.stdout.write(
    `Build ${buildNumber} is in TestFlight group ${group.attributes.name}: ${state}.\n`,
  );
};

if (command === "latest-build") {
  process.stdout.write(`${await latestBuild()}\n`);
} else if (command === "friends" && buildNumber !== undefined) {
  await friends();
} else if (command === "notes" && buildNumber !== undefined && NOTES) {
  await notes();
} else {
  throw new Error(USAGE);
}
