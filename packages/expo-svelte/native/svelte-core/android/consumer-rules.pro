# Push on Android names Firebase Messaging in two classes (SveltePushMessagingService, PushFirebase), but Firebase is in the app only when the config plugin added it
# (capabilities.push.android). An app without push has neither class's Firebase side, and never loads them (the service is not in its manifest; the module checks the
# `expo.modules.sveltepush.enabled` meta-data first): R8 is told not to stop on the references it cannot resolve.
-dontwarn com.google.firebase.messaging.**
-dontwarn com.google.android.gms.tasks.**

# Room creates its database class by reflection, through its constructor without arguments. react-native-maps brings WorkManager, whose Room (2.5.0) ships the rule
# `-keep class * extends androidx.room.RoomDatabase`, which keeps the class and, in the strict full mode of keep rules that Android Gradle plugin 9 turns on, not the
# constructor: the app then dies when WorkManager starts ("Failed to create an instance of class androidx.work.impl.WorkDatabase"). Later Room versions ship this rule themselves.
-keep class * extends androidx.room.RoomDatabase { <init>(); }

# EventBeat.kt finds the batch listeners of React Native's Fabric event dispatcher by the name of a private field. R8 renames it (`h0`), the lookup fails, and layout events
# then arrive a frame late (a warning in the log, no crash). The class keeps its name too, so the warning and a later look at the dispatcher read the real one.
-keepclassmembers class com.facebook.react.uimanager.events.FabricEventDispatcher { java.util.concurrent.CopyOnWriteArrayList postEventDispatchListeners; }
