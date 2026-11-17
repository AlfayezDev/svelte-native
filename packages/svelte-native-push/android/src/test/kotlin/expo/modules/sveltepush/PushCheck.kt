package expo.modules.sveltepush

import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import kotlin.system.exitProcess

/**
 * Plain-JVM check of what the Android side of push decides without Android: the mapping of a message to and from its three carriers, the rule that a tap is the launch
 * message until JavaScript has asked for it and an `opened` event after, the guard against delivering a tap twice, the events kept for a JavaScript that is not listening
 * yet, the background wait with its limit, the foreground wait for `show`, the foreground count, the permission and channel rules; and, in the sources, that the plain
 * files stay plain, and that the module, the manifest, the config and the config plugin say what `src/push/client.ts` expects of them.
 * Usage: PushCheck <main sources dir> <AndroidManifest.xml> <expo-module.config.json> <src/capabilities.ts> <src/push/client.ts>   (src/test/push.sh)
 */
private var checks = 0
private var failures = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    failures++
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
  }
}

private fun truth(name: String, ok: Boolean, detail: () -> String = { "" }) {
  checks++
  if (!ok) {
    failures++
    System.err.println("FAIL $name ${detail()}")
  }
}

/** The events JavaScript would hear. */
private class Recorder(private val onSend: (String, Map<String, Any?>) -> Unit = { _, _ -> }) : EventSink {
  val sent = CopyOnWriteArrayList<Pair<String, Map<String, Any?>>>()

  override fun send(name: String, payload: Map<String, Any?>) {
    sent.add(name to payload)
    onSend(name, payload)
  }

  fun names(): List<String> = sent.map { it.first }
}

private class MemoryStore(var saved: List<String> = emptyList()) : TapStore {
  var loads = 0
  var saves = 0

  override fun load(): List<String> {
    loads++
    return saved
  }

  override fun save(ids: List<String>) {
    saves++
    saved = ids
  }
}

private fun elapsedMs(block: () -> Unit): Long {
  val start = System.nanoTime()
  block()
  return (System.nanoTime() - start) / 1_000_000
}

private fun mapping() {
  var generated = 0
  val newId = { generated++; "generated-$generated" }

  val full = PushMapping.fromRemote("m1", "Order ready", "Pickup at gate 3", mapOf("url" to "/orders/42", "order" to "42", "tab" to "pickup"), newId)
  expect("a remote message: every member", full, PushMessage("m1", "Order ready", "Pickup at gate 3", "/orders/42", mapOf("order" to "42", "tab" to "pickup"), "fcm"))
  expect("a remote message: the url is not among the data", full.data.containsKey("url"), false)
  expect("a remote message with an id does not make one", generated, 0)

  val bare = PushMapping.fromRemote(null, null, null, emptyMap(), newId)
  expect("a remote message without an id gets one", bare.id, "generated-1")
  expect("a data message has no title, body or url", listOf(bare.title, bare.body, bare.url, bare.data), listOf(null, null, null, emptyMap<String, String>()))
  expect("a data message has no content to show", bare.hasContent, false)

  val blank = PushMapping.fromRemote("  ", "", " ", mapOf("url" to "", "k" to "v"), newId)
  expect("blank members are not members", listOf(blank.id, blank.title, blank.body, blank.url), listOf("generated-2", null, null, null))
  expect("a blank url is still not data", blank.data, mapOf("k" to "v"))
  expect("a message with only a body has content", PushMessage("x", body = "b").hasContent, true)

  // What JavaScript is given: members the sender did not give are left out, so JavaScript reads undefined.
  expect("toMap leaves out what is missing", bare.toMap(), mapOf("id" to "generated-1", "data" to emptyMap<String, String>(), "provider" to "fcm"))
  expect("toMap has every member that is there", full.toMap().keys.toList(), listOf("id", "title", "body", "url", "data", "provider"))
  expect("the token's shape", PushToken("t", "io.example.app").toMap(), mapOf("provider" to "fcm", "token" to "t", "app" to "io.example.app"))

  // Out and back through our own PendingIntent: nothing the sender names collides with it, whatever the data keys are.
  val tricky = PushMessage("m2", "T", "B", "myapp://orders/42", mapOf("from" to "me", "gcm.x" to "1", "google.c.a.e" to "2", "svelte.push.id" to "nope", "collapse_key" to "k"))
  val extras = PushMapping.toExtras(tricky)
  expect("our extras: the id", extras[PushMapping.EXTRA_ID], "m2")
  expect("our extras round trip", PushMapping.fromExtras(extras), tricky)
  expect("our extras round trip, a message with no title", PushMapping.fromExtras(PushMapping.toExtras(bare)), bare)
  truth("our extras are all under the prefix", extras.keys.all { it.startsWith(PushMapping.EXTRA_PREFIX) }) { extras.keys.toString() }
  expect("an unknown provider reads as fcm", PushMapping.fromExtras(mapOf(PushMapping.EXTRA_ID to "a", PushMapping.EXTRA_PROVIDER to "smoke"))?.provider, "fcm")
  expect("apns is a provider", PushMapping.fromExtras(mapOf(PushMapping.EXTRA_ID to "a", PushMapping.EXTRA_PROVIDER to "apns"))?.provider, "apns")

  // The launch intent of a notification the system showed: Firebase's keys are not the sender's data, and there is no title or body in it.
  val system: Map<String, Any?> = mapOf(
    "google.message_id" to "0:1700000000%abc",
    "google.sent_time" to 1700000000000L,
    "google.ttl" to 2419200,
    "google.original_priority" to "high",
    "google.delivered_priority" to "high",
    "google.c.a.e" to "1",
    "gcm.n.e" to "1",
    "from" to "123456789",
    "collapse_key" to "orders",
    "message_type" to "gcm",
    "url" to "/orders/42",
    "inbox" to "7",
    "order" to "42",
    "anim_not_finish" to true,
    "android.intent.extra.REFERRER" to "app",
    "nested" to mapOf("a" to "b"),
  )
  val tapped = PushMapping.fromExtras(system)
  expect("a system notification's tap: id, url, data", tapped, PushMessage("0:1700000000%abc", null, null, "/orders/42", mapOf("inbox" to "7", "order" to "42")))
  expect("a system notification's tap has no title or body to show", tapped?.hasContent, false)
  expect("our extras win over Firebase's", PushMapping.fromExtras(system + PushMapping.toExtras(tricky))?.id, "m2")
  expect("a blank id of ours falls to Firebase's", PushMapping.fromExtras(system + (PushMapping.EXTRA_ID to " "))?.id, "0:1700000000%abc")

  // Not a tap: an ordinary launch, a deep link, the extras another library puts in.
  expect("an ordinary launch is not a tap", PushMapping.fromExtras(emptyMap()), null)
  expect("a launch with the system's extras is not a tap", PushMapping.fromExtras(mapOf("android.intent.extra.REFERRER" to "x", "anim_not_finish" to true)), null)
  expect("a data key of the app is not a tap by itself", PushMapping.fromExtras(mapOf("url" to "/orders/42", "inbox" to "7")), null)
  expect("a blank Firebase id is not a tap", PushMapping.fromExtras(mapOf("google.message_id" to "")), null)
  expect("a Firebase id that is not a string is not a tap", PushMapping.fromExtras(mapOf("google.message_id" to 5)), null)

  expect("a presentation the hook gave", Presentation.from(mapOf("banner" to false, "sound" to true, "badge" to false)), Presentation(banner = false, sound = true, badge = false))
  expect("a presentation with members left out is shown", Presentation.from(mapOf("sound" to false)), Presentation(banner = true, sound = false, badge = true))
  expect("a presentation of the wrong type is shown", Presentation.from(mapOf("banner" to "no")), Presentation.DEFAULT)
  expect("no presentation is the default", Presentation.from(null), Presentation.DEFAULT)
}

private fun rules() {
  // The permission, from Expo's answer for POST_NOTIFICATIONS: granted is granted, denied with no more asking is denied, anything else is a question still open.
  expect("granted", PushRules.permission("granted", true, true), "granted")
  expect("granted with the app's notifications switched off", PushRules.permission("granted", true, false), "denied")
  expect("denied once, may be asked again", PushRules.permission("denied", true, true), "prompt")
  expect("denied once, may be asked again, notifications off", PushRules.permission("denied", true, false), "prompt")
  expect("denied for good", PushRules.permission("denied", false, true), "denied")
  expect("denied for good, notifications off", PushRules.permission("denied", false, false), "denied")
  expect("never asked", PushRules.permission("undetermined", true, false), "prompt")
  expect("never asked, and nothing asked again", PushRules.permission("undetermined", false, true), "prompt")
  expect("a state nobody knows is a question", PushRules.permission("whatever", false, false), "prompt")
  expect("before Android 13: on", PushRules.permissionWithoutRuntimeAsk(true), "granted")
  expect("before Android 13: switched off in the settings", PushRules.permissionWithoutRuntimeAsk(false), "denied")

  // The channel: the config plugin writes all three, and a number-looking value reads back as an Integer.
  expect("no meta-data: the defaults", PushRules.channel { null }, ChannelSpec("default", "Notifications", null))
  val written = mapOf<String, Any?>(PushRules.META_CHANNEL_ID to "updates", PushRules.META_CHANNEL_NAME to "Updates", PushRules.META_CHANNEL_DESCRIPTION to "News about your orders")
  expect("the channel from the config", PushRules.channel { written[it] }, ChannelSpec("updates", "Updates", "News about your orders"))
  val numbers = mapOf<String, Any?>(PushRules.META_CHANNEL_ID to 2024, PushRules.META_CHANNEL_NAME to 7)
  expect("an id and a name that look like numbers", PushRules.channel { numbers[it] }, ChannelSpec("2024", "7", null))
  val blanks = mapOf<String, Any?>(PushRules.META_CHANNEL_ID to " ", PushRules.META_CHANNEL_NAME to "", PushRules.META_CHANNEL_DESCRIPTION to "  ")
  expect("blank values are the defaults", PushRules.channel { blanks[it] }, ChannelSpec("default", "Notifications", null))

  // Which way a message goes.
  expect("a data message in the foreground", PushRules.route(foreground = true, hasNotification = false), PushRules.Route.FOREGROUND)
  expect("a notification message in the foreground", PushRules.route(foreground = true, hasNotification = true), PushRules.Route.FOREGROUND)
  expect("a data message away", PushRules.route(foreground = false, hasNotification = false), PushRules.Route.BACKGROUND)
  expect("a notification message that reached us away", PushRules.route(foreground = false, hasNotification = true), PushRules.Route.SHOW_NOW)
  val withContent = PushMessage("a", "t", "b")
  expect("shown", PushRules.shouldPost(withContent, Presentation.DEFAULT), true)
  expect("banner false shows nothing", PushRules.shouldPost(withContent, Presentation(banner = false)), false)
  expect("a message with nothing to show shows nothing", PushRules.shouldPost(PushMessage("a"), Presentation.DEFAULT), false)
}

private fun foregroundCount() {
  var now = 0L
  val tracker = ForegroundTracker({ now }, graceMs = 1_000)
  expect("a process nobody started a screen in", tracker.isForeground(), false)
  tracker.activityStarted()
  expect("one started Activity", tracker.isForeground(), true)
  tracker.activityStarted()
  tracker.activityStopped(false)
  expect("one of two stopped", tracker.isForeground(), true)
  tracker.activityStopped(false)
  expect("the user left", tracker.isForeground(), false)

  // A rotation stops the Activity before the new one starts: the app stays in the foreground for the gap, and only for it.
  tracker.activityStarted()
  now = 5_000
  tracker.activityStopped(true)
  expect("stopped to be made again", tracker.isForeground(), true)
  now = 5_999
  expect("still inside the gap", tracker.isForeground(), true)
  now = 6_000
  expect("the gap is over", tracker.isForeground(), false)
  tracker.activityStarted()
  expect("the new Activity started", tracker.isForeground(), true)
  tracker.activityStopped(false)
  expect("a stop that is the user leaving has no gap", tracker.isForeground(), false)

  // A stop that was never counted (an Activity that began before the count did) does not make the count negative.
  val late = ForegroundTracker({ now })
  late.activityStopped(false)
  late.activityStarted()
  expect("a stop that was never a start is not owed", late.isForeground(), true)
}

private fun events() {
  val log = CopyOnWriteArrayList<String>()
  val events = PushEvents(capacity = 3) { log.add(it) }
  val a = mapOf<String, Any?>("n" to 1)
  val b = mapOf<String, Any?>("n" to 2)
  val c = mapOf<String, Any?>("n" to 3)

  // A message that starts the process: the events come before there is a module, and before JavaScript listens.
  events.emit("message", a)
  events.emit("message", b)
  events.emit("opened", c)
  expect("kept while there is no module", listOf(events.pending("message"), events.pending("opened")), listOf(2, 1))
  val first = Recorder()
  events.attach(first)
  expect("attaching delivers nothing: nobody listens yet", first.sent.size, 0)
  events.observe("message")
  expect("the first listener hears what came, in order", first.sent.toList(), listOf("message" to a, "message" to b))
  expect("what another name kept stays kept", events.pending("opened"), 1)
  events.emit("message", c)
  expect("then events go straight through", first.names(), listOf("message", "message", "message"))
  events.observe("opened")
  expect("a second name", first.sent.last(), "opened" to c)

  events.unobserve("message")
  events.emit("message", a)
  expect("a name whose last listener left keeps its events", listOf(events.pending("message"), first.sent.size), listOf(1, 4))
  events.observe("message")
  expect("and delivers them when one is added again", first.sent.last(), "message" to a)

  // A reload: a new module attaches, and the old one is destroyed after it; the old one's detach must not take the new sink away.
  val second = Recorder()
  events.attach(second)
  events.detach(first)
  events.emit("message", b)
  expect("the new runtime listens to nothing yet", listOf(second.sent.size, events.pending("message")), listOf(0, 1))
  events.observe("message")
  expect("and hears what came, after it listens", second.sent.toList(), listOf("message" to b))
  events.detach(second)
  events.emit("message", c)
  expect("after the last module is gone events are kept", events.pending("message"), 1)

  // Only the newest token matters.
  events.emit("token", mapOf("token" to "one"))
  events.emit("token", mapOf("token" to "two"))
  expect("a token replaces the token that waits", events.pending("token"), 1)
  val third = Recorder()
  events.attach(third)
  events.observe("token")
  expect("the newest is the one delivered", third.sent.toList(), listOf("token" to mapOf<String, Any?>("token" to "two")))

  // A process whose JavaScript never listens does not grow without end.
  val bounded = PushEvents(capacity = 3) { log.add(it) }
  for (n in 1..5) bounded.emit("message", mapOf("n" to n))
  expect("only the newest are kept", bounded.pending("message"), 3)
  val boundedSink = Recorder()
  bounded.attach(boundedSink)
  bounded.observe("message")
  expect("the oldest were the ones dropped", boundedSink.sent.map { it.second["n"] }, listOf(3, 4, 5))
  truth("and the drop is logged", log.any { it.contains("oldest was dropped") }) { log.toString() }

  // A sink that fails loses the event, and says so.
  val broken = PushEvents { log.add(it) }
  broken.attach { _, _ -> throw IllegalStateException("the runtime is being torn down") }
  broken.observe("message")
  broken.emit("message", a)
  truth("an event the runtime refused is logged", log.any { it.contains("could not be sent to JavaScript") && it.contains("torn down") }) { log.toString() }
  expect("and is not kept for later", broken.pending("message"), 0)
}

private fun taps() {
  val a = PushMessage("a", "A", "first", "/a")
  val b = PushMessage("b", "B", "second", "/b")
  val c = PushMessage("c", url = "/c")

  fun rig(store: MemoryStore = MemoryStore()): Triple<PushTaps, Recorder, PushEvents> {
    val events = PushEvents()
    val recorder = Recorder()
    events.attach(recorder)
    events.observe("opened")
    return Triple(PushTaps(events, TapLedger(store)), recorder, events)
  }

  // Until JavaScript asks, a tap is the launch message; the first ask is the last one that gets a launch message.
  val (taps, recorder, _) = rig()
  expect("a tap before JavaScript asked", taps.tapped(a), true)
  expect("is not an event", recorder.sent.size, 0)
  expect("it is the launch message", taps.takeLaunch(), a)
  expect("which is given once", taps.takeLaunch(), null)
  expect("a tap after JavaScript asked", taps.tapped(b), true)
  expect("is an opened event", recorder.sent.toList(), listOf("opened" to b.toMap()))
  expect("and a second asking changes nothing", taps.takeLaunch(), null)

  // The user's last tap is where they meant to go.
  val (latest, latestEvents, _) = rig()
  latest.tapped(a)
  latest.tapped(b)
  expect("the last tap before the ask is the launch message", latest.takeLaunch(), b)
  expect("the one it replaced is nowhere", latestEvents.sent.size, 0)

  // No tap at all launched the process: the ask is still the end of the launch window.
  val (none, noneEvents, _) = rig()
  expect("nothing launched the process", none.takeLaunch(), null)
  none.tapped(a)
  expect("a tap after that is an event", noneEvents.names(), listOf("opened"))

  // A tap while JavaScript does not listen to `opened` yet waits for it.
  val events = PushEvents()
  val late = Recorder()
  events.attach(late)
  val waiting = PushTaps(events, TapLedger(MemoryStore()))
  waiting.takeLaunch()
  waiting.tapped(c)
  expect("kept until a listener", listOf(late.sent.size, events.pending("opened")), listOf(0, 1))
  events.observe("opened")
  expect("then delivered", late.sent.toList(), listOf("opened" to c.toMap()))

  // The same tap twice: an Activity made again, an intent given again.
  val (twice, twiceEvents, _) = rig()
  expect("the first tap", twice.tapped(a), true)
  expect("the same intent read again before the ask", twice.tapped(a), false)
  expect("is still the launch message", twice.takeLaunch(), a)
  expect("the Activity is made again: the same tap", twice.tapped(a), false)
  expect("is nothing", twice.takeLaunch(), null)
  expect("and no event", twiceEvents.sent.size, 0)
  twice.tapped(b)
  twice.tapped(b)
  twice.tapped(a)
  expect("after the ask each tap is one event, however often it is read", twiceEvents.sent.toList(), listOf("opened" to b.toMap()))

  // The ledger outlives the process: an Activity the system restores after killing it holds the intent of its launch.
  val store = MemoryStore()
  val ledger = TapLedger(store)
  expect("first sight", ledger.firstTime("m1"), true)
  expect("again", ledger.firstTime("m1"), false)
  val afterRestart = TapLedger(store)
  expect("after a restart of the process", afterRestart.firstTime("m1"), false)
  expect("another message is new", afterRestart.firstTime("m2"), true)
  expect("and is remembered in the store", store.saved, listOf("m1", "m2"))
  val lazyStore = MemoryStore(listOf("old"))
  val lazy = TapLedger(lazyStore)
  expect("the store is not read until a tap needs it", lazyStore.loads, 0)
  expect("a message the store knows", lazy.firstTime("old"), false)
  expect("is read once", lazyStore.loads, 1)
  lazy.firstTime("x")
  lazy.firstTime("y")
  expect("and not again", lazyStore.loads, 1)
  val small = TapLedger(MemoryStore(), capacity = 3)
  for (id in listOf("1", "2", "3", "4")) small.firstTime(id)
  expect("a ledger keeps the last few: the oldest is forgotten", small.firstTime("1"), true)
  expect("the newest are kept", small.firstTime("4"), false)
}

private fun waits() {
  val waits = BackgroundWaits()
  val first = waits.open()
  val second = waits.open()
  truth("completion ids are not message ids and are not repeated", first != second && first.startsWith("background-")) { "$first $second" }

  // An answer that comes before the wait starts is not lost.
  expect("done before the wait", waits.done(first), true)
  expect("the wait is already over", elapsedMs { expect("and says the hook finished", waits.await(first, 5_000), true) } < 1_000, true)
  expect("an id is closed after its wait", waits.done(first), false)

  // The limit: a hook that never finishes releases the thread at the limit, and its late answer finds nobody.
  var finished = true
  val waited = elapsedMs { finished = waits.await(second, 150) }
  expect("a wait that runs out says so", finished, false)
  truth("and took about as long as it was given", waited in 140L..2_000L) { "$waited ms" }
  expect("a late answer has nobody to release", waits.done(second), false)
  expect("an id nobody opened", waits.done("background-999"), false)
  expect("waiting on an id nobody opened does not block", waits.await("background-999", 5_000), false)

  // From another thread, as JavaScript's `backgroundDone` is.
  val third = waits.open()
  thread { Thread.sleep(80); waits.done(third) }
  var released = false
  val took = elapsedMs { released = waits.await(third, 10_000) }
  expect("released by another thread", released, true)
  truth("long before the limit", took in 60L..3_000L) { "$took ms" }

  // The show gate.
  val gate = ShowGate()
  val quiet = Presentation(banner = true, sound = false, badge = false)
  val one = gate.hold("m1")
  expect("an answer while the message waits", gate.answer("m1", quiet), true)
  expect("is the presentation", gate.await(one, 1_000), quiet)
  expect("a second answer", gate.answer("m1", Presentation.DEFAULT), false)

  val slow = gate.hold("m2")
  var answered: Presentation? = Presentation.DEFAULT
  val waitedForShow = elapsedMs { answered = gate.await(slow, 120) }
  expect("no answer in time", answered, null)
  truth("after about the time it was given", waitedForShow in 110L..2_000L) { "$waitedForShow ms" }
  expect("an answer after the default was shown is refused", gate.answer("m2", quiet), false)
  expect("an answer for a message nobody holds", gate.answer("nobody", quiet), false)

  val older = gate.hold("m3")
  val newer = gate.hold("m3")
  expect("a message delivered twice: the newer hold takes the answer", gate.answer("m3", quiet), true)
  expect("which it gets", gate.await(newer, 1_000), quiet)
  expect("and the older one runs out", gate.await(older, 50), null)

  val remote = gate.hold("m4")
  thread { Thread.sleep(60); gate.answer("m4", Presentation(banner = false)) }
  expect("an answer from another thread", gate.await(remote, 10_000), Presentation(banner = false))
}

private fun delivery() {
  val log = CopyOnWriteArrayList<String>()
  val posted = CopyOnWriteArrayList<Pair<PushMessage, Presentation>>()
  val message = PushMessage("m1", "Order ready", "Pickup at gate 3", "/orders/42", mapOf("order" to "42"))
  val dataOnly = PushMessage("m2", data = mapOf("inbox" to "7"))

  class Rig(foregroundWaitMs: Long = 200, backgroundWaitMs: Long = 400, sink: ((Rig, String, Map<String, Any?>) -> Unit)? = null) {
    val events = PushEvents { log.add(it) }
    val shows = ShowGate()
    val waits = BackgroundWaits()
    val recorder = Recorder { name, payload -> sink?.invoke(this, name, payload) }
    val delivery = PushDelivery(events, shows, waits, { m, p -> posted.add(m to p) }, { log.add(it) }, foregroundWaitMs, backgroundWaitMs)

    init {
      events.attach(recorder)
      for (name in listOf("token", "message", "opened", "background")) events.observe(name)
    }
  }

  // Foreground, and JavaScript answers at once: the message is shown as the hook said, once.
  posted.clear()
  val quick = Rig(sink = { rig, name, payload ->
    if (name == "message") rig.shows.answer(payload["id"] as String, Presentation(banner = true, sound = false, badge = false))
  })
  expect("the foreground route", quick.delivery.deliver(message, foreground = true, hasNotification = true), PushRules.Route.FOREGROUND)
  expect("JavaScript heard the message, whole", quick.recorder.sent.toList(), listOf("message" to message.toMap()))
  expect("shown as the hook said, once", posted.toList(), listOf(message to Presentation(banner = true, sound = false, badge = false)))

  // Foreground, and JavaScript answers a little later, from its own thread.
  posted.clear()
  val later = Rig(sink = { rig, name, payload ->
    if (name == "message") thread { Thread.sleep(60); rig.shows.answer(payload["id"] as String, Presentation(banner = false)) }
  })
  later.delivery.deliver(message, foreground = true, hasNotification = true)
  expect("an answer that comes inside the second", posted.toList(), listOf(message to Presentation(banner = false)))

  // Foreground, and nobody answers: the default, after the wait, and the answer that comes after that is refused.
  posted.clear()
  val silent = Rig()
  var route: PushRules.Route? = null
  val waited = elapsedMs { route = silent.delivery.deliver(message, foreground = true, hasNotification = true) }
  expect("the foreground route when nobody answers", route, PushRules.Route.FOREGROUND)
  truth("it waited for the answer", waited in 190L..3_000L) { "$waited ms" }
  expect("then it showed the message with all three true", posted.toList(), listOf(message to Presentation(true, true, true)))
  expect("a late show does not show it again", silent.shows.answer("m1", Presentation(banner = false)), false)
  expect("and nothing was posted twice", posted.size, 1)
  truth("the default is logged", log.any { it.contains("m1") && it.contains("shown by default") }) { log.toString() }

  // A data message in the foreground reaches JavaScript as `message`; the hook cannot show anything of it, which `post` decides.
  posted.clear()
  val data = Rig(sink = { rig, name, payload -> if (name == "message") rig.shows.answer(payload["id"] as String, Presentation.DEFAULT) })
  data.delivery.deliver(dataOnly, foreground = true, hasNotification = false)
  expect("a data message in the foreground is a message event", data.recorder.names(), listOf("message"))
  expect("with no title, body or url in it", data.recorder.sent.single().second, mapOf("id" to "m2", "data" to mapOf("inbox" to "7"), "provider" to "fcm"))

  // A notification message that reached us with the app away is shown, and no hook runs.
  posted.clear()
  val away = Rig()
  expect("a notification message away", away.delivery.deliver(message, foreground = false, hasNotification = true), PushRules.Route.SHOW_NOW)
  expect("is shown by default", posted.toList(), listOf(message to Presentation.DEFAULT))
  expect("and tells JavaScript nothing", away.recorder.sent.size, 0)

  // A data message away: the event goes out with a completion id, and the thread is held until JavaScript is done.
  posted.clear()
  val done = AtomicInteger()
  val held = Rig(backgroundWaitMs = 10_000, sink = { rig, name, payload ->
    if (name == "background") thread {
      Thread.sleep(80)
      done.incrementAndGet()
      rig.waits.done(payload["id"] as String)
    }
  })
  var backgroundRoute: PushRules.Route? = null
  val heldFor = elapsedMs { backgroundRoute = held.delivery.deliver(dataOnly, foreground = false, hasNotification = false) }
  expect("the background route", backgroundRoute, PushRules.Route.BACKGROUND)
  val event = held.recorder.sent.single()
  expect("one background event", event.first, "background")
  val completion = event.second["id"] as String
  truth("with a completion id of its own, not the message's", completion != dataOnly.id && completion.startsWith("background-")) { completion }
  expect("and the message", event.second["message"], dataOnly.toMap())
  truth("the thread was held until the hook was done, and no longer", heldFor in 70L..3_000L && done.get() == 1) { "$heldFor ms" }
  expect("a data message shows nothing", posted.size, 0)

  // A hook that never finishes: the thread is let go at the limit.
  val stuck = Rig(backgroundWaitMs = 250)
  val stuckFor = elapsedMs { stuck.delivery.deliver(dataOnly, foreground = false, hasNotification = false) }
  truth("held up to the limit", stuckFor in 240L..3_000L) { "$stuckFor ms" }
  truth("and the limit is logged", log.any { it.contains("m2") && it.contains("the process is let go") }) { log.toString() }
  expect("a late done finds nobody", stuck.waits.done(stuck.recorder.sent.single().second["id"] as String), false)

  // A message that starts the process: it arrives before JavaScript exists. The event waits for the first listener, the thread waits for the hook, and the hook's
  // answer releases it, all in the order a cold start gives them.
  val events = PushEvents { log.add(it) }
  val waits = BackgroundWaits()
  val cold = PushDelivery(events, ShowGate(), waits, { _, _ -> }, { log.add(it) }, backgroundWaitMs = 10_000)
  val coldDone = AtomicInteger()
  val worker = thread { cold.deliver(dataOnly, foreground = false, hasNotification = false); coldDone.incrementAndGet() }
  Thread.sleep(150)
  expect("the process started with the message, and nobody listens", listOf(events.pending("background"), coldDone.get()), listOf(1, 0))
  val runtime = Recorder { _, payload -> thread { Thread.sleep(40); waits.done(payload["id"] as String) } }
  events.attach(runtime)
  events.observe("background")
  worker.join(5_000)
  expect("JavaScript started, heard the message and finished", listOf(runtime.names(), coldDone.get(), worker.isAlive), listOf(listOf("background"), 1, false))
}

/** The source files that must not mention Android, Expo or Firebase, so that this check can compile them and nothing else has to be there. */
private val PLAIN_FILES = listOf("PushMessage", "PushMapping", "PushEvents", "PushTaps", "PushWaits", "PushRules", "PushDelivery", "ForegroundTracker")

private fun sources(args: Array<String>) {
  val main = File(args[0])
  val manifest = File(args[1]).readText()
  val moduleConfig = File(args[2]).readText()
  val capabilities = File(args[3]).readText()
  val client = File(args[4]).readText()
  fun source(name: String) = File(main, "$name.kt").readText()

  for (name in PLAIN_FILES) {
    val imports = source(name).lines().filter { it.startsWith("import ") }
    truth("$name.kt is plain Kotlin", imports.none { Regex("^import (android|androidx|expo|com|org)\\.").containsMatchIn(it) }) { imports.toString() }
  }

  // What the module offers is what client.ts calls: the same names, the same events.
  val module = source("SveltePushModule")
  val clientEvents = Regex("\\n  (\\w+): ").findAll(client.substringAfter("export type NativePushEvents = {").substringBefore("\n};")).map { it.groupValues[1] }.toList()
  val clientCalls = Regex("\\n  (\\w+)\\(").findAll(client.substringAfter("export type NativePushModule = {").substringBefore("\n};")).map { it.groupValues[1] }.filter { it != "addListener" }.toList()
  expect("client.ts: the events it listens to", clientEvents.sorted(), listOf("background", "message", "opened", "token"))
  expect("client.ts: the calls it makes", clientCalls.sorted(), listOf("backgroundDone", "permission", "register", "requestPermission", "show", "takeLaunchMessage", "unregister"))
  val moduleEvents = Regex("EVENTS = arrayOf\\(([^)]*)\\)").find(module)?.groupValues?.get(1)?.let { list -> Regex("\"(\\w+)\"").findAll(list).map { it.groupValues[1] }.toList() }
  expect("the module declares those events", moduleEvents?.sorted(), clientEvents.sorted())
  val moduleCalls = Regex("(?:Async)?Function\\(\"(\\w+)\"\\)").findAll(module).map { it.groupValues[1] }.toList()
  expect("the module defines those calls", moduleCalls.sorted(), clientCalls.sorted())
  truth("the module is named SveltePush", module.contains("Name(\"SveltePush\")"))
  for (call in listOf("takeLaunchMessage", "backgroundDone")) truth("$call is synchronous", Regex("[^c]Function\\(\"$call\"\\)").containsMatchIn(module) && !Regex("AsyncFunction\\(\"$call\"\\)").containsMatchIn(module))
  for (call in clientCalls.filter { it != "takeLaunchMessage" && it != "backgroundDone" }) truth("$call is asynchronous", Regex("AsyncFunction\\(\"$call\"\\)").containsMatchIn(module))
  val foregroundTimeout = Regex("FOREGROUND_TIMEOUT_MS = (\\d+)").find(client)?.groupValues?.get(1)?.toLong()
  truth("the native foreground wait is longer than JavaScript's ($foregroundTimeout ms), so JavaScript's default arrives first", foregroundTimeout != null && PushDelivery.FOREGROUND_WAIT_MS > foregroundTimeout)
  expect("the foreground wait is one second", PushDelivery.FOREGROUND_WAIT_MS, 1_000L)
  expect("the background wait is 18 seconds", PushDelivery.BACKGROUND_WAIT_MS, 18_000L)

  // The config plugin writes the meta-data this reads, under the same names.
  fun pluginName(key: String) = Regex("\\n  $key: \"([^\"]+)\"").find(capabilities.substringAfter("export const pushMetaData = {"))?.groupValues?.get(1)
  expect("meta-data: icon", pluginName("icon"), PushRules.META_ICON)
  expect("meta-data: color", pluginName("color"), PushRules.META_COLOR)
  expect("meta-data: channel id", pluginName("channelId"), PushRules.META_CHANNEL_ID)
  expect("meta-data: channel name", pluginName("channelName"), PushRules.META_CHANNEL_NAME)
  expect("meta-data: channel description", pluginName("channelDescription"), PushRules.META_CHANNEL_DESCRIPTION)
  val defaults = Regex("defaultPushChannel = \\{ id: \"([^\"]+)\", name: \"([^\"]+)\" \\}").find(capabilities)?.groupValues
  expect("the channel the plugin writes by default", listOf(defaults?.get(1), defaults?.get(2)), listOf(PushRules.DEFAULT_CHANNEL_ID, PushRules.DEFAULT_CHANNEL_NAME))

  // What autolinking and the manifest need to find.
  truth("the manifest declares the service this file defines", manifest.contains("expo.modules.sveltepush.SveltePushMessagingService") && source("SveltePushMessagingService").contains("class SveltePushMessagingService : FirebaseMessagingService()"))
  truth("the manifest asks for POST_NOTIFICATIONS", manifest.contains("android.permission.POST_NOTIFICATIONS"))
  truth("the service takes Firebase's event", manifest.contains("com.google.firebase.MESSAGING_EVENT"))
  truth("expo-module.config.json lists the module", moduleConfig.contains("expo.modules.sveltepush.SveltePushModule"))
  val packageSource = source("SveltePushPackage")
  truth("autolinking finds the Package by its file name and this import", Regex("\\bimport\\s+expo\\.modules\\.core\\.interfaces\\.Package\\b").containsMatchIn(packageSource) && packageSource.contains("class SveltePushPackage : Package"))
  truth("the Package makes both listeners", packageSource.contains("createApplicationLifecycleListeners") && packageSource.contains("createReactActivityLifecycleListeners") && packageSource.contains("PushTapListener()"))
  val packages = main.listFiles { file -> file.name.endsWith("Package.kt") }!!.map { it.name }
  expect("it is the only Package, so autolinking lists one", packages, listOf("SveltePushPackage.kt"))
}

fun main(args: Array<String>) {
  if (args.size != 5) {
    System.err.println("usage: PushCheck <main sources dir> <AndroidManifest.xml> <expo-module.config.json> <src/capabilities.ts> <src/push/client.ts>")
    exitProcess(2)
  }
  mapping()
  rules()
  foregroundCount()
  events()
  taps()
  waits()
  delivery()
  sources(args)
  println("push host check: $checks checks, $failures failed")
  if (failures > 0) exitProcess(1)
}
