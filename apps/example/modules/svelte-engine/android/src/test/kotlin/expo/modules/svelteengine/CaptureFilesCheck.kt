package expo.modules.svelteengine

import java.io.File
import java.nio.file.Files
import kotlin.system.exitProcess

/**
 * Plain-JVM check of the files `Capture` makes for the `tmpfile` result (`CaptureFiles`): the engine deletes its own when its
 * module is destroyed. Usage: `src/test/run.sh`.
 */
private var failures = 0
private var checks = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    failures++
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
  }
}

fun main() {
  // The files the engine made are deleted when its module is destroyed; one the app already released is skipped without an error.
  val directory = Files.createTempDirectory("capture-check").toFile()
  try {
    val files = CaptureFiles()
    val first = files.create("ReactNative-snapshot-image", ".png", directory)
    val named = files.create("avatar", ".jpg", directory)
    val released = files.create("ReactNative-snapshot-image", ".png", directory)
    val foreign = File.createTempFile("not-ours", ".png", directory)
    released.delete()
    expect("deleteAll counts what it deleted", files.deleteAll(), 2)
    expect("a default-named file is gone", first.exists(), false)
    expect("a file with the caller's name is gone", named.exists(), false)
    expect("a file the engine did not make stays", foreign.exists(), true)
    expect("a second deleteAll has nothing left", files.deleteAll(), 0)
  } finally {
    directory.deleteRecursively()
  }

  if (failures > 0) {
    System.err.println("$failures of $checks check(s) failed")
    exitProcess(1)
  }
  System.err.println("CaptureFilesCheck: $checks checks passed")
}
