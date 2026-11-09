#!/usr/bin/env python3
"""Where did the native heap grow? Diffs the native heap dumps of one soak by allocation site.

The dumps come from `malloc-debug-soak.sh` (`am dumpheap -n` of an app started under malloc_debug with backtraces):
`<dir>/base.heap`, `<dir>/mid.heap` and `<dir>/final.heap`, each carrying its own MAPS section. Frames in the app's
libraries are symbolized with the unstripped copies in `<symbols-dir>` (`qa/out/app-<abi>.symbols`, written by
`native-qa build`), the other libraries of the APK by their dynamic symbols (React Native's, Hermes's: mostly addresses),
and system libraries when they were pulled into `<dir>/syslibs`.

    python3 qa/soak/heapdiff.py <dir> <apk> <symbols-dir> [--frames N] [--top N] [--depth N]

Prints the call sites by growth from the first dump to the last (bytes before and after, live allocations before and
after) and the largest live sites of the last dump; `--frames N` also prints every frame of the N fastest growing sites.
A site whose allocation count rises with the soak's cycles and falls back at no window is a leak; one that rises once and
stays is a cache.
"""
import argparse
import collections
import glob
import os
import re
import subprocess
import sys
import zipfile


def find_ndk_bin():
    roots = [os.environ.get("ANDROID_NDK_HOME"), os.environ.get("ANDROID_NDK_ROOT")]
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or os.path.expanduser("~/Android/sdk")
    roots += sorted(glob.glob(os.path.join(sdk, "ndk", "*")), reverse=True)
    for root in roots:
        if root:
            candidate = os.path.join(root, "toolchains", "llvm", "prebuilt", "linux-x86_64", "bin")
            if os.path.exists(os.path.join(candidate, "llvm-symbolizer")):
                return candidate
    sys.exit("no Android NDK with llvm-symbolizer found (set ANDROID_NDK_HOME)")


def parse_dump(path):
    records, maps, in_maps = [], [], False
    for line in open(path, errors="replace"):
        line = line.rstrip("\n")
        if line.startswith("MAPS"):
            in_maps = True
        elif line.startswith("END"):
            in_maps = False
        elif in_maps:
            m = re.match(r"([0-9a-f]+)-([0-9a-f]+) (\S+) ([0-9a-f]+) \S+ \S+\s*(.*)", line)
            if m:
                maps.append((int(m[1], 16), int(m[2], 16), int(m[4], 16), m[5]))
        else:
            m = re.match(r"z (\d+)\s+sz\s+(\d+)\s+num\s+(\d+)\s+bt\s*(.*)", line)
            if m:
                records.append((int(m[2]), int(m[3]), [int(x, 16) for x in m[4].split()]))
    return records, maps


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dir")
    parser.add_argument("apk")
    parser.add_argument("symbols")
    parser.add_argument("--frames", type=int, default=0)
    parser.add_argument("--top", type=int, default=40)
    parser.add_argument("--depth", type=int, default=4)
    args = parser.parse_args()
    ndk = find_ndk_bin()
    symbolizer, readelf = os.path.join(ndk, "llvm-symbolizer"), os.path.join(ndk, "llvm-readelf")

    # Libraries stored in the APK are mapped from it: the mapping's file offset counts from the start of the zip, so a
    # frame's offset in its library is the file offset minus where the entry's data starts (the local header's own
    # extra field holds the alignment padding, not the central directory's copy).
    apk_libs = {}
    extracted = os.path.join(args.dir, "apklibs")
    os.makedirs(extracted, exist_ok=True)
    with zipfile.ZipFile(args.apk) as archive, open(args.apk, "rb") as raw:
        for info in archive.infolist():
            if info.filename.startswith("lib/") and info.filename.endswith(".so") and "/x86_64/" in info.filename + "/":
                raw.seek(info.header_offset)
                header = raw.read(30)
                start = info.header_offset + 30 + int.from_bytes(header[26:28], "little") + int.from_bytes(header[28:30], "little")
                apk_libs[os.path.basename(info.filename)] = (start, info.file_size)
                target = os.path.join(extracted, os.path.basename(info.filename))
                if not os.path.exists(target):
                    with open(target, "wb") as out:
                        out.write(archive.read(info.filename))

    def library_file(module):
        for folder in (args.symbols, extracted, os.path.join(args.dir, "syslibs")):
            candidate = os.path.join(folder, module)
            if os.path.exists(candidate) and os.path.getsize(candidate) > 0:
                return candidate
        return None

    segment_cache = {}

    def to_vaddr(file, offset):
        if file not in segment_cache:
            text = subprocess.run([readelf, "-lW", file], capture_output=True, text=True).stdout
            segment_cache[file] = [
                (int(m[1], 16), int(m[2], 16), int(m[3], 16))
                for m in re.finditer(r"LOAD\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+0x[0-9a-f]+\s+0x([0-9a-f]+)", text)
            ]
        for file_offset, vaddr, size in segment_cache[file]:
            if file_offset <= offset < file_offset + size + 0x1000:
                return offset - file_offset + vaddr
        return offset

    dumps = {}
    for tag in ("base", "mid", "final"):
        path = os.path.join(args.dir, tag + ".heap")
        if os.path.exists(path) and os.path.getsize(path) > 0:
            dumps[tag] = parse_dump(path)
            records = dumps[tag][0]
            print(f"{tag}: {len(records)} records, {sum(size * count for size, count, _ in records)} bytes live")
    if len(dumps) < 2:
        sys.exit("need at least two of base.heap, mid.heap, final.heap")

    def locate(address, maps):
        for start, end, offset, path in maps:
            if start <= address < end:
                file_offset = address - start + offset
                name = os.path.basename(path)
                if name.endswith(".apk"):
                    for lib, (data, size) in apk_libs.items():
                        if data <= file_offset < data + size:
                            return lib, file_offset - data
                return name, file_offset
        return None, None

    located = {}
    wanted = collections.defaultdict(set)
    for tag, (records, maps) in dumps.items():
        for _, _, addresses in records:
            for address in addresses:
                if (tag, address) not in located:
                    located[(tag, address)] = locate(address, maps)
                    module, offset = located[(tag, address)]
                    if module:
                        wanted[module].add(offset)
    names = {}
    for module, offsets in wanted.items():
        file = library_file(module)
        ordered = sorted(offsets)
        if not file:
            for offset in ordered:
                names[(module, offset)] = f"{module}+0x{offset:x}"
            continue
        stdin = "".join(f"0x{to_vaddr(file, offset):x}\n" for offset in ordered)
        lines = subprocess.run(
            [symbolizer, "--obj=" + file, "--functions=short", "--demangle", "--no-inlines", "--output-style=GNU"],
            input=stdin, capture_output=True, text=True,
        ).stdout.split("\n")
        for index, offset in enumerate(ordered):
            function = lines[2 * index].strip() if 2 * index < len(lines) else "??"
            names[(module, offset)] = f"{module}!{function}" if function and function != "??" else f"{module}+0x{offset:x}"

    skip = re.compile(
        r"operator new|malloc|calloc|realloc|memalign|__libc|__allocate|allocator|make_shared|"
        r"basic_string|__hash_table|__function|deque|vector.*(__append|push_back|reserve|emplace_back|__vallocate)"
    )

    def frames(tag, addresses):
        out = []
        for address in addresses:
            module, offset = located[(tag, address)]
            out.append(names.get((module, offset), f"{module}+0x{offset:x}") if module else f"0x{address:x}")
        return out

    def site(tag, addresses):
        everything = frames(tag, addresses)
        kept = [f for f in everything if not (skip.search(f) or f.startswith(("libc.so", "libc++.so", "libc++_shared.so")))]
        return " <- ".join((kept or everything[:1] or ["(no frames)"])[: args.depth])

    live, count = {}, {}
    for tag, (records, _) in dumps.items():
        live[tag], count[tag] = collections.Counter(), collections.Counter()
        for size, number, addresses in records:
            key = site(tag, addresses)
            live[tag][key] += size * number
            count[tag][key] += number
    first = "base" if "base" in dumps else next(iter(dumps))
    last = "final" if "final" in dumps else list(dumps)[-1]
    rows = sorted(((live[last][k] - live[first][k], k) for k in set(live[first]) | set(live[last])), reverse=True)
    print(f"\ngrowth {first} -> {last} by call site (bytes before -> after, live allocations before -> after):")
    for delta, key in rows[: args.top]:
        print(f"{delta:>10}  {live[first][key]:>9} -> {live[last][key]:>9}  n {count[first][key]} -> {count[last][key]}  {key}")
    print(f"\nlargest live sites at {last}:")
    for key, size in live[last].most_common(15):
        print(f"{size:>10}  n {count[last][key]}  {key}")
    for delta, key in rows[: args.frames]:
        for _, number, addresses in dumps[last][0]:
            if site(last, addresses) == key:
                print(f"\nframes of the site growing {delta} bytes:")
                for frame in frames(last, addresses):
                    print("   ", frame)
                break


if __name__ == "__main__":
    main()
