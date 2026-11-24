const { execFileSync } = require("node:child_process");
const path = require("node:path");

// Fail packaging if electron-builder skipped notarization due to missing credentials.
exports.default = async function verifyMacosSigning(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  execFileSync("xcrun", ["stapler", "validate", appPath], { stdio: "inherit" });
};
