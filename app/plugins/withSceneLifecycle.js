// iOS 27 stops apps at launch unless they use the scene life cycle (UIScene), for anything built with
// Xcode 27 / the iOS 27 SDK. Expo SDK 57 ships the scene delegate (ExpoAppSceneDelegate) but its
// project template doesn't use it yet, so this switches it on when the iOS project is generated:
// the app delegate stops making its own window, a SceneDelegate starts React Native instead, and
// Info.plist names it. Remove once Expo's template does this itself.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

function patchAppDelegate(src) {
  if (src.includes('ExpoAppSceneDelegate')) return src;
  let out = src.replace(/class AppDelegate: ExpoAppDelegate \{/, 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
  // The scene delegate creates the window and starts React Native in it.
  out = out.replace(/\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/, '\n');
  if (out === src || !out.includes('ExpoReactNativeFactoryProvider') || out.includes('UIWindow(frame:')) {
    throw new Error('withSceneLifecycle: AppDelegate.swift is not the expected Expo template; update the plugin.');
  }
  return `${out}\n/// Starts the app in its window under the scene life cycle (see plugins/withSceneLifecycle.js).\nclass SceneDelegate: ExpoAppSceneDelegate {}\n`;
}

module.exports = function withSceneLifecycle(config) {
  config = withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift') throw new Error('withSceneLifecycle: expected a Swift AppDelegate.');
    c.modResults.contents = patchAppDelegate(c.modResults.contents);
    return c;
  });
  return withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate' },
        ],
      },
    };
    return c;
  });
};

module.exports.patchAppDelegate = patchAppDelegate;
