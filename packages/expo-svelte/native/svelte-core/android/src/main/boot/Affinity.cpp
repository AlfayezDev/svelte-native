// CPU affinity of one thread, for `Affinity` (Kotlin: `BootBoost` and `MountBoost`). A library of its own with no dependency: it
// is loaded from Application.onCreate, before React Native's libraries are needed, and must cost nothing there.
#include <jni.h>
#include <sched.h>

extern "C" JNIEXPORT jlong JNICALL Java_expo_modules_svelteengine_Affinity_nativeAffinityOf(JNIEnv *, jclass, jint tid) {
  cpu_set_t set;
  CPU_ZERO(&set);
  if (sched_getaffinity(tid, sizeof(set), &set) != 0) return -1;
  jlong mask = 0;
  for (int cpu = 0; cpu < 63; cpu++) {
    if (CPU_ISSET(cpu, &set)) mask |= (jlong)1 << cpu;
  }
  return mask;
}

extern "C" JNIEXPORT jboolean JNICALL Java_expo_modules_svelteengine_Affinity_nativeSetAffinity(JNIEnv *, jclass, jint tid, jlong mask) {
  cpu_set_t set;
  CPU_ZERO(&set);
  for (int cpu = 0; cpu < 63; cpu++) {
    if ((mask >> cpu) & 1) CPU_SET(cpu, &set);
  }
  return sched_setaffinity(tid, sizeof(set), &set) == 0;
}
