#include <fbjni/fbjni.h>

#include "SvelteEngineNative.h"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
  return facebook::jni::initialize(vm, [] { expo::svelteengine::SvelteEngineNative::registerNatives(); });
}
