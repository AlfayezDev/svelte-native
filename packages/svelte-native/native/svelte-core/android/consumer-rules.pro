# Push on Android names Firebase Messaging in two classes (SveltePushMessagingService, PushFirebase), but Firebase is in the app only when the config plugin added it
# (capabilities.push.android). An app without push has neither class's Firebase side, and never loads them (the service is not in its manifest; the module checks the
# `expo.modules.sveltepush.enabled` meta-data first): R8 is told not to stop on the references it cannot resolve.
-dontwarn com.google.firebase.messaging.**
-dontwarn com.google.android.gms.tasks.**
