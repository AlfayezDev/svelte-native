#include "AnimatedBridge.h"

#include <android/log.h>
#include <android/trace.h>
#include <dlfcn.h>
#include <fbjni/fbjni.h>
#include <unistd.h>

#include <cstdint>
#include <mutex>

using namespace facebook;

namespace expo::svelteengine {

namespace {

constexpr const char *kTag = "SvelteEngine";
constexpr const char *kReanimatedLibrary = "libreanimated.so";
constexpr const char *kSinkSetter = "reanimatedSetSynchronousPropsSink";
constexpr const char *kBridgeClass = "expo/modules/svelteengine/AnimatedBridge";

// The sink contract of the patched Reanimated (NativeProxy.h, SynchronousPropsSink): returns the number of ints left in
// the rest buffers, or kUntouched when nothing was taken and Reanimated should use the batch as it is.
using Sink = size_t (*)(const int *, size_t, const double *, size_t, int *, double *, size_t *);
using SinkSetter = void (*)(Sink);
constexpr size_t kUntouched = static_cast<size_t>(-1);

struct TraceSection {
  explicit TraceSection(const char *name) : active_(ATrace_isEnabled()) {
    if (active_) ATrace_beginSection(name);
  }
  ~TraceSection() {
    if (active_) ATrace_endSection();
  }

 private:
  bool active_;
};

// All members are guarded by `mutex`: the sink runs on the UI thread, install and uninstall on whichever thread the
// module function runs.
struct Bridge {
  std::mutex mutex;
  bool installed = false;
  SinkSetter setter = nullptr;
  jni::global_ref<jintArray> buffer;
  jni::global_ref<jclass> bridgeClass;
  jni::JStaticMethod<jint(jint)> flush;
  animated::Staging staging;
};

// Never destroyed: a global reference released during process exit would call into a JVM that is already gone.
Bridge &bridge() {
  static Bridge *instance = new Bridge();
  return *instance;
}

bool onMainThread() {
  return gettid() == getpid();
}

size_t sink(
    const int *ints,
    size_t intCount,
    const double *doubles,
    size_t doubleCount,
    int *restInts,
    double *restDoubles,
    size_t *restDoubleCount) {
  Bridge &b = bridge();
  std::lock_guard<std::mutex> lock(b.mutex);
  // Writes to views belong to the UI thread; Reanimated runs there, but a call from anywhere else is not ours.
  if (!b.installed || !onMainThread()) return kUntouched;
  TraceSection trace("SvelteEngine.animated.sink");

  bool viewsTaken = false;
  const size_t rest = animated::split(
      ints, intCount, doubles, doubleCount, restInts, restDoubles, restDoubleCount, b.staging,
      [&](const int32_t *buffer, size_t count, std::vector<int32_t> &rejected) {
        const jint views = buffer[0];
        jint turnedBack = views;
        b.buffer->setRegion(0, static_cast<jsize>(count), buffer);
        try {
          turnedBack = b.flush(b.bridgeClass, static_cast<jint>(count));
        } catch (const std::exception &e) {
          // The Java side catches everything itself; this is a JNI failure. Everything goes back to Reanimated.
          __android_log_print(ANDROID_LOG_ERROR, kTag, "animated flush failed: %s", e.what());
          turnedBack = views;
          for (jint i = 0; i < views; ++i) rejected.push_back(i);
          return;
        }
        if (turnedBack > 0) {
          rejected.resize(static_cast<size_t>(turnedBack));
          b.buffer->getRegion(1, turnedBack, rejected.data());
        }
        if (turnedBack < views) viewsTaken = true;
      });
  // Nothing taken: the rest is the batch itself, so Reanimated can keep sending the buffers it already has.
  return viewsTaken ? rest : kUntouched;
}

// Looks Reanimated's setter up in the library once it is loaded (the Fabric host loads it lazily, after install).
bool registerSink(Bridge &b) {
  void *library = dlopen(kReanimatedLibrary, RTLD_NOW | RTLD_NOLOAD);
  if (library == nullptr) return false;
  void *symbol = dlsym(library, kSinkSetter);
  dlclose(library);
  if (symbol == nullptr) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "%s has no %s: the Reanimated patch is missing, animated writes use the map path", kReanimatedLibrary, kSinkSetter);
    return false;
  }
  b.setter = reinterpret_cast<SinkSetter>(symbol);
  b.setter(&sink);
  return true;
}

jboolean nativeInstall(jni::alias_ref<jclass> bridgeClass, jni::alias_ref<jintArray> buffer) {
  Bridge &b = bridge();
  std::lock_guard<std::mutex> lock(b.mutex);
  if (!buffer || buffer->size() < static_cast<jsize>(animated::kBufferInts)) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "animated bridge: buffer smaller than %zu ints", animated::kBufferInts);
    return JNI_FALSE;
  }
  b.buffer = jni::make_global(buffer);
  b.bridgeClass = jni::make_global(bridgeClass);
  b.flush = bridgeClass->getStaticMethod<jint(jint)>("flush");
  b.installed = true;
  return registerSink(b) ? JNI_TRUE : JNI_FALSE;
}

jboolean nativeAttach(jni::alias_ref<jclass>) {
  Bridge &b = bridge();
  std::lock_guard<std::mutex> lock(b.mutex);
  return b.installed && registerSink(b) ? JNI_TRUE : JNI_FALSE;
}

void nativeUninstall(jni::alias_ref<jclass>) {
  Bridge &b = bridge();
  std::lock_guard<std::mutex> lock(b.mutex);
  if (b.setter != nullptr) b.setter(nullptr);
  b.setter = nullptr;
  b.installed = false;
  b.buffer = nullptr;
  b.bridgeClass = nullptr;
}

}  // namespace

void registerAnimatedBridgeNatives() {
  jni::findClassStatic(kBridgeClass)
      ->registerNatives({
          makeNativeMethod("nativeInstall", nativeInstall),
          makeNativeMethod("nativeAttach", nativeAttach),
          makeNativeMethod("nativeUninstall", nativeUninstall),
      });
}

}  // namespace expo::svelteengine
