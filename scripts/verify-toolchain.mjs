import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(projectRoot, relativePath), "utf8"));
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const nodeVersionFile = readFileSync(resolve(projectRoot, ".node-version"), "utf8").trim();
const failures = [];

const packageManagerMatch = /^npm@(\d+\.\d+\.\d+)$/.exec(packageJson.packageManager ?? "");
if (!packageManagerMatch) {
  failures.push('package.json packageManager must use the exact form "npm@x.y.z"');
}

const expectedNode = packageJson.engines?.node;
const expectedNpm = packageJson.engines?.npm;
const expectedPackageManagerNpm = packageManagerMatch?.[1];
const lockRoot = packageLock.packages?.[""];

if (!/^\d+\.\d+\.\d+$/.test(expectedNode ?? "")) {
  failures.push("package.json engines.node must be an exact semantic version");
}
if (!/^\d+\.\d+\.\d+$/.test(expectedNpm ?? "")) {
  failures.push("package.json engines.npm must be an exact semantic version");
}
if (nodeVersionFile !== expectedNode) {
  failures.push(`.node-version (${nodeVersionFile}) does not match engines.node (${expectedNode})`);
}
if (process.versions.node !== expectedNode) {
  failures.push(`running Node (${process.versions.node}) does not match required Node (${expectedNode})`);
}
if (expectedPackageManagerNpm !== expectedNpm) {
  failures.push(`packageManager npm (${expectedPackageManagerNpm}) does not match engines.npm (${expectedNpm})`);
}
if (lockRoot?.name !== packageJson.name || lockRoot?.version !== packageJson.version) {
  failures.push("package-lock.json root package identity does not match package.json");
}
if (lockRoot?.engines?.node !== expectedNode || lockRoot?.engines?.npm !== expectedNpm) {
  failures.push("package-lock.json root engines do not match package.json");
}
if (packageLock.lockfileVersion !== 3) {
  failures.push(`package-lock.json lockfileVersion must be 3, received ${packageLock.lockfileVersion}`);
}

const npmUserAgentMatch = /(?:^|\s)npm\/(\d+\.\d+\.\d+)(?:\s|$)/.exec(
  process.env.npm_config_user_agent ?? "",
);
if (!npmUserAgentMatch) {
  failures.push("npm version is unavailable; run this check through npm run verify:toolchain");
} else if (npmUserAgentMatch[1] !== expectedNpm) {
  failures.push(`running npm (${npmUserAgentMatch[1]}) does not match required npm (${expectedNpm})`);
}

if (failures.length > 0) {
  console.error("Toolchain verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Toolchain verified: Node ${expectedNode}, npm ${expectedNpm}, lockfile v${packageLock.lockfileVersion}`);
}
