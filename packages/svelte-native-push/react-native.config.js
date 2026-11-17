// Expo's autolinking links this package's native code (expo-module.config.json). React Native's autolinking would find the same `android/`
// and `ios/` at the package's root and link them a second time, as another Gradle project over the same directory (a build fails on the two
// projects' shared outputs) and another pod: it is told there is nothing here for it.
module.exports = { dependency: { platforms: { android: null, ios: null } } };
