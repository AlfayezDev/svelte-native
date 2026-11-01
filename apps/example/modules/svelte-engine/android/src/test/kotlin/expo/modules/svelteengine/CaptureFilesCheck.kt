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

  // What a killed process left: files of the library's name older than the new process are swept; younger ones, other names and directories are not.
  val cache = Files.createTempDirectory("capture-sweep").toFile()
  try {
    val old = File(cache, "ReactNative-snapshot-image123.png").also { it.writeText("x"); it.setLastModified(1_000) }
    val oldJpg = File(cache, "ReactNative-snapshot-image9.jpg").also { it.writeText("x"); it.setLastModified(2_000) }
    val young = File(cache, "ReactNative-snapshot-image456.png").also { it.writeText("x"); it.setLastModified(9_000) }
    val other = File(cache, "avatar1.png").also { it.writeText("x"); it.setLastModified(1_000) }
    val folder = File(cache, "ReactNative-snapshot-images").also { it.mkdir(); it.setLastModified(1_000) }
    expect("sweep counts the old files of the library's name", CaptureFiles().sweep(cache, "ReactNative-snapshot-image", 5_000), 2)
    expect("an old png is gone", old.exists(), false)
    expect("an old jpg is gone", oldJpg.exists(), false)
    expect("a file written after the process started stays", young.exists(), true)
    expect("a file of another name stays", other.exists(), true)
    expect("a directory of the same prefix stays", folder.exists(), true)
    expect("a missing directory has nothing to sweep", CaptureFiles().sweep(File(cache, "none"), "x", Long.MAX_VALUE), 0)
  } finally {
    cache.deleteRecursively()
  }

  if (failures > 0) {
    System.err.println("$failures of $checks check(s) failed")
    exitProcess(1)
  }
  System.err.println("CaptureFilesCheck: $checks checks passed")
}
