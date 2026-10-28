cmake_minimum_required(VERSION 3.16)
project(svelteengine)

set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

include("${REACT_NATIVE_DIR}/ReactAndroid/cmake-utils/folly-flags.cmake")
add_compile_options(${folly_FLAGS})

find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

file(GLOB SVELTE_ENGINE_SOURCES CONFIGURE_DEPENDS "${CMAKE_SOURCE_DIR}/src/main/cpp/*.cpp")

add_library(svelteengine SHARED ${SVELTE_ENGINE_SOURCES})

# The start-up thread boost (BootBoost.kt) needs one syscall and nothing else, so it does not load with the engine.
add_library(svelteboot SHARED "${CMAKE_SOURCE_DIR}/src/main/boot/BootBoost.cpp")
target_compile_options(svelteboot PRIVATE -O2 -Wall)

target_compile_options(svelteengine PRIVATE
  -std=c++20
  -O2
  -fexceptions
  -frtti
  -Wall
  -fstack-protector-all
  -DRN_FABRIC_ENABLED=1
  -DRN_SERIALIZABLE_STATE=1
  -DREACT_NATIVE_TARGET_VERSION=${REACT_NATIVE_TARGET_VERSION}
)

# The prefab headers ship the Android platform sub-trees under react/renderer/**/platform/android
# but not on the include path (React Native's own CMake adds them per target), so add them here.
set(RN_RENDERER "${REACT_NATIVE_DIR}/ReactCommon/react/renderer")
target_include_directories(svelteengine PRIVATE
  "${CMAKE_SOURCE_DIR}/src/main/cpp"
  "${REACT_NATIVE_DIR}/ReactCommon"
  "${RN_RENDERER}/graphics/platform/android"
  "${RN_RENDERER}/components/view/platform/android"
  "${RN_RENDERER}/components/text/platform/android"
  "${RN_RENDERER}/components/scrollview/platform/android"
  "${RN_RENDERER}/components/textinput/platform/android"
  "${RN_RENDERER}/textlayoutmanager/platform/android"
  "${RN_RENDERER}/imagemanager/platform/android"
  "${REACT_NATIVE_DIR}/ReactCommon/react/utils/platform/android"
)

target_link_libraries(svelteengine
  log
  android
  ReactAndroid::reactnative
  ReactAndroid::jsi
  fbjni::fbjni
)
