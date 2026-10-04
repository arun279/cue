import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const [buildNumber] = process.argv.slice(2);
const { APP_STORE_CONNECT_KEY, APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID } =
  process.env;
if (buildNumber === undefined || !APP_STORE_CONNECT_KEY || !APP_STORE_CONNECT_KEY_ID) {
  throw new Error(
    "usage: APP_STORE_CONNECT_KEY=<base64 .p8> APP_STORE_CONNECT_KEY_ID=<id> APP_STORE_CONNECT_ISSUER_ID=<id> testflight-friends.mjs <build-number>",
  );
}

const eas = JSON.parse(
  readFileSync(new URL("../packages/native/eas.json", import.meta.url), "utf8"),
);
const appId = eas.submit.production.ios.ascAppId;
const key = createPrivateKey(Buffer.from(APP_STORE_CONNECT_KEY, "base64"));
const PROCESSING_DEADLINE_MS = 60 * 60 * 1000;

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

const api = async (path, body) => {
  const response = await fetch(`https://api.appstoreconnect.apple.com/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify({ data: body }),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : (await response.json()).data;
};

const processedBuild = async (deadline) => {
  const [build] = await api(`builds?filter[app]=${appId}&filter[version]=${buildNumber}`);
  if (build?.attributes.processingState === "VALID") return build;
  if (build !== undefined && build.attributes.processingState !== "PROCESSING") {
    throw new Error(`build ${buildNumber} is ${build.attributes.processingState}`);
  }
  if (Date.now() > deadline) throw new Error(`build ${buildNumber} never finished processing`);
  await sleep(30_000);
  return processedBuild(deadline);
};

const build = await processedBuild(Date.now() + PROCESSING_DEADLINE_MS);
const groups = await api(`betaGroups?filter[app]=${appId}&filter[isInternalGroup]=false`);
if (groups.length !== 1) {
  throw new Error(
    `expected one external TestFlight group, found: ${groups.map((group) => group.attributes.name).join(", ") || "none"}`,
  );
}
const [group] = groups;
await api(`betaGroups/${group.id}/relationships/builds`, [{ type: "builds", id: build.id }]);
const detail = await api(`builds/${build.id}/buildBetaDetail`);
if (detail.attributes.externalBuildState === "READY_FOR_BETA_SUBMISSION") {
  await api("betaAppReviewSubmissions", {
    type: "betaAppReviewSubmissions",
    relationships: { build: { data: { type: "builds", id: build.id } } },
  });
}
process.stdout.write(
  `Build ${buildNumber} is in TestFlight group ${group.attributes.name}, ${detail.attributes.externalBuildState} before this run.\n`,
);
