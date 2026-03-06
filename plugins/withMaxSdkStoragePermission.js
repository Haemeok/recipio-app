const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withMaxSdkStoragePermission(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const permissions = androidManifest.manifest["uses-permission"] || [];

    for (const permission of permissions) {
      const name = permission.$["android:name"];
      if (
        name === "android.permission.READ_EXTERNAL_STORAGE" ||
        name === "android.permission.WRITE_EXTERNAL_STORAGE"
      ) {
        permission.$["android:maxSdkVersion"] = "32";
      }
    }

    return config;
  });
};
