#include "MountingDelegate.h"

#include <android/log.h>
#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/mounting/ShadowViewMutation.h>

#include <cmath>
#include <vector>

#include "FragmentWire.h"
#include "PropsEncoder.h"
#include "PropsEncoderNav.h"
#include "PropsEncoderViews.h"

using namespace facebook;
using namespace facebook::react;

namespace expo::svelteengine {

namespace {
constexpr const char *kTag = "SvelteEngine";

bool hasLayout(const ShadowView &v) {
  return !(v.layoutMetrics == EmptyLayoutMetrics);
}

// A foreign root as React Native's mounting sees it. The engine keeps the view in a frame of its own (EngineForeign), so
// React Native lays the view out at that frame's origin and in the size, in pixels, Kotlin gives the frame:
// round(x + w) - round(x), the same rounding `MountingManager.applyLayout` uses. Both sides then agree to the pixel.
ShadowView inEngineFrame(const ShadowView &view) {
  ShadowView framed = view;
  if (!hasLayout(view)) return framed;
  auto &metrics = framed.layoutMetrics;
  const float scale = static_cast<float>(metrics.pointScaleFactor);
  if (!(scale > 0.f)) return framed;
  const float x = static_cast<float>(metrics.frame.origin.x) * scale;
  const float y = static_cast<float>(metrics.frame.origin.y) * scale;
  const float w = static_cast<float>(metrics.frame.size.width) * scale;
  const float h = static_cast<float>(metrics.frame.size.height) * scale;
  const float widthPx = std::floor(x + w + 0.5f) - std::floor(x + 0.5f);
  const float heightPx = std::floor(y + h + 0.5f) - std::floor(y + 0.5f);
  metrics.frame.origin = Point{0, 0};
  metrics.frame.size = Size{widthPx / scale, heightPx / scale};
  return framed;
}

// A Text nested in a Text has no view of the engine's (its words are fragments of the paragraph's state), but a touch can land on it: the paragraph's view finds
// the fragment under the finger and the touch is dispatched to that node, as React Native's `ReactTextView.reactTagForTouch` does. So the node's event emitter is
// kept like a view's, from its Create to its Delete (FragmentWire.h names which nodes).
bool isNestedText(const ShadowView &view) {
  return fragmentwire::isNestedTextName(view.componentName);
}

bool sameForReactNative(const ShadowView &a, const ShadowView &b) {
  return a.props == b.props && a.state == b.state && a.eventEmitter == b.eventEmitter && a.layoutMetrics == b.layoutMetrics;
}
} // namespace

void MountingDelegate::registerForeignComponent(const std::string &name) {
  std::lock_guard<std::mutex> lock(foreignMutex_);
  foreignNames_.add(name);
}

bool MountingDelegate::isForeignTag(Tag tag) const {
  std::lock_guard<std::mutex> lock(foreignMutex_);
  return foreign_.contains(tag);
}

size_t MountingDelegate::foreignNodeCount() const {
  std::lock_guard<std::mutex> lock(foreignMutex_);
  return foreign_.size();
}

MountingDelegate::MountingDelegate(jni::global_ref<JMountingManager::javaobject> manager)
    : manager_(std::move(manager)) {}

void MountingDelegate::setEmitter(Tag tag, const EventEmitter::Shared &emitter) const {
  std::lock_guard<std::mutex> lock(emittersMutex_);
  if (emitter) {
    emitters_[tag] = emitter;
  }
}

void MountingDelegate::eraseEmitter(Tag tag) const {
  std::lock_guard<std::mutex> lock(emittersMutex_);
  emitters_.erase(tag);
  scrollStates_.erase(tag);
}

void MountingDelegate::setScrollState(Tag tag, const State::Shared &state) const {
  if (!state) return;
  std::lock_guard<std::mutex> lock(emittersMutex_);
  scrollStates_[tag] = state;
}

State::Shared MountingDelegate::scrollStateFor(Tag tag) const {
  std::lock_guard<std::mutex> lock(emittersMutex_);
  auto it = scrollStates_.find(tag);
  return it == scrollStates_.end() ? nullptr : it->second;
}

size_t MountingDelegate::emitterCount() const {
  std::lock_guard<std::mutex> lock(emittersMutex_);
  return emitters_.size();
}

size_t MountingDelegate::scrollStateCount() const {
  std::lock_guard<std::mutex> lock(emittersMutex_);
  return scrollStates_.size();
}

EventEmitter::Shared MountingDelegate::emitterFor(Tag tag) const {
  std::lock_guard<std::mutex> lock(emittersMutex_);
  auto it = emitters_.find(tag);
  return it == emitters_.end() ? nullptr : it->second;
}

std::optional<MountingTransaction> MountingDelegate::pullTransaction(
    SurfaceId surfaceId,
    MountingTransaction::Number number,
    const TransactionTelemetry &telemetry,
    ShadowViewMutationList mutations) const {
  {
    std::lock_guard<std::mutex> lock(emittersMutex_);
    if (loggedSurfaces_.emplace(surfaceId, true).second) {
      __android_log_print(
          ANDROID_LOG_INFO, kTag, "delegate order: %s first (surface %d, first transaction has %zu mutations)",
          reanimatedHookFirst_ ? "reanimated" : "ours", static_cast<int>(surfaceId), mutations.size());
    }
  }
  // What React Native's own mounting still receives: the foreign views' mutations, nothing of the engine's.
  ShadowViewMutationList forwarded;
  if (!mutations.empty()) {
    Batch batch;
    batch.ops.reserve(mutations.size() * 40);
    float scale = lastScale_;
    const std::vector<foreign::Owner> owners = classifyForeign(mutations);
    size_t foreignCreated = 0;
    size_t foreignDeleted = 0;

    for (size_t position = 0; position < mutations.size(); ++position) {
      const auto &mutation = mutations[position];
      const auto &oldView = mutation.oldChildShadowView;
      const auto &newView = mutation.newChildShadowView;
      const bool isVirtual = mutation.mutatedViewIsVirtual();
      const foreign::Owner owner = owners.empty() ? foreign::Owner::Engine : owners[position];
      if (owner == foreign::Owner::Descendant) {
        // Inside a foreign view: React Native creates, updates and removes it through the foreign view's own manager.
        forwarded.push_back(mutation);
        if (mutation.type == ShadowViewMutation::Create) ++foreignCreated;
        if (mutation.type == ShadowViewMutation::Delete) ++foreignDeleted;
        continue;
      }
      const bool isRoot = owner == foreign::Owner::Root;
      const auto kindOf = [isRoot](const ShadowView &view) { return isRoot ? kForeign : kindForView(view); };

      if (hasLayout(newView)) {
        scale = static_cast<float>(newView.layoutMetrics.pointScaleFactor);
      }

      switch (mutation.type) {
        case ShadowViewMutation::Create: {
          Kind kind = kindOf(newView);
          if (kind == kSkip) {
            if (isNestedText(newView)) setEmitter(newView.tag, newView.eventEmitter);
            break;
          }
          batch.putInt(kOpCreate);
          batch.putInt(newView.tag);
          batch.putInt(kind);
          encodeProps(batch, kind, newView, scale);
          if (isRoot) {
            // The view itself is React Native's: it creates it with the props, state and event emitter of the node. The engine keeps the emitter too:
            // a frame with `pointerEvents` box-only keeps its touches for JavaScript, which hears them on the frame's tag (`dispatchTouch`).
            setEmitter(newView.tag, newView.eventEmitter);
            forwarded.push_back(mutation);
            foreignAwaitingInsert_.insert(newView.tag);
            ++foreignCreated;
            break;
          }
          setEmitter(newView.tag, newView.eventEmitter);
          noteViewState(kind, newView);
          break;
        }
        case ShadowViewMutation::Delete: {
          // Reanimated's proxy holds back the Remove/Delete of an exiting view until its animation ends, so a
          // Delete can arrive long after the shadow tree dropped the node (as with React Native's own Java side).
          // Everything below is idempotent for unknown tags.
          if (kindOf(oldView) == kSkip) {
            if (isNestedText(oldView)) eraseEmitter(oldView.tag);
            break;
          }
          batch.putInt(kOpDelete);
          batch.putInt(oldView.tag);
          eraseEmitter(oldView.tag);
          forgetViewState(oldView.tag);
          if (isRoot) {
            forwarded.push_back(mutation);
            foreignAwaitingInsert_.erase(oldView.tag);
            ++foreignDeleted;
          }
          break;
        }
        case ShadowViewMutation::Insert: {
          Kind kind = kindOf(newView);
          if (kind == kSkip || isVirtual) break;
          batch.putInt(kOpInsert);
          batch.putInt(mutation.parentTag);
          batch.putInt(newView.tag);
          batch.putInt(mutation.index);

          // Like React Native's Android mounting: an inserted view gets its full props, state,
          // layout and event emitter (Create only carried the props at allocation time).
          batch.putInt(kOpUpdateProps);
          batch.putInt(newView.tag);
          batch.putInt(kind);
          encodeProps(batch, kind, newView, scale);
          if (newView.state && kindHasState(kind)) {
            batch.putInt(kOpUpdateState);
            batch.putInt(newView.tag);
            batch.putInt(kind);
            encodeState(batch, kind, newView, scale);
          }
          batch.putInt(kOpUpdateLayout);
          batch.putInt(newView.tag);
          encodeLayout(batch, newView);
          if (isRoot) {
            // The engine inserts its frame. React Native inserts the view too, into the surface's root view: a foreign
            // view's own manager expects its view attached to the window before the children are inserted into it (a map
            // starts its lifecycle on attach), and the root view is attached. The engine moves the view into its frame
            // once React Native's mount items have run (ForeignViews.didMountItems).
            // Only the first time: a later Insert of the same node is a move inside the engine's tree, and React Native's
            // insert would pull the view out of its frame.
            if (foreignAwaitingInsert_.erase(newView.tag) != 0) {
              forwarded.push_back(ShadowViewMutation::InsertMutation(surfaceId, inEngineFrame(newView), 0));
            }
            setEmitter(newView.tag, newView.eventEmitter);
            break;
          }
          setEmitter(newView.tag, newView.eventEmitter);
          noteViewState(kind, newView);
          if (kind == kScroll) setScrollState(newView.tag, newView.state);
          break;
        }
        case ShadowViewMutation::Remove: {
          if (kindOf(oldView) == kSkip || isVirtual) break;
          batch.putInt(kOpRemove);
          batch.putInt(mutation.parentTag);
          batch.putInt(oldView.tag);
          batch.putInt(mutation.index);
          break;
        }
        case ShadowViewMutation::Update: {
          if (newView.tag == surfaceId) break;  // the surface root itself (RootView); it has no engine view
          Kind kind = kindOf(newView);
          if (kind == kSkip) {
            if (isNestedText(newView) && oldView.eventEmitter != newView.eventEmitter) setEmitter(newView.tag, newView.eventEmitter);
            break;
          }
          if (isRoot) {
            const ShadowView before = inEngineFrame(oldView);
            const ShadowView after = inEngineFrame(newView);
            if (!sameForReactNative(before, after)) {
              forwarded.push_back(ShadowViewMutation::UpdateMutation(before, after, surfaceId));
            }
            if (oldView.eventEmitter != newView.eventEmitter) setEmitter(newView.tag, newView.eventEmitter);
          } else {
            if (oldView.eventEmitter != newView.eventEmitter) {
              setEmitter(newView.tag, newView.eventEmitter);
            }
            if (kind == kScroll && oldView.state != newView.state) setScrollState(newView.tag, newView.state);
            if (oldView.state != newView.state) noteViewState(kind, newView);
          }
          if (isVirtual) break;
          if (oldView.props != newView.props) {
            batch.putInt(kOpUpdateProps);
            batch.putInt(newView.tag);
            batch.putInt(kind);
            encodeProps(batch, kind, newView, scale);
          }
          if (oldView.state != newView.state && kindHasState(kind)) {
            batch.putInt(kOpUpdateState);
            batch.putInt(newView.tag);
            batch.putInt(kind);
            encodeState(batch, kind, newView, scale);
          }
          if (oldView.layoutMetrics != newView.layoutMetrics) {
            batch.putInt(kOpUpdateLayout);
            batch.putInt(newView.tag);
            encodeLayout(batch, newView);
          }
          break;
        }
        default:
          break;
      }
    }
    batch.putInt(kOpEnd);
    lastScale_ = scale;
    if (foreignCreated + foreignDeleted > 0) {
      __android_log_print(
          ANDROID_LOG_INFO, kTag, "foreign: surface=%d created=%zu deleted=%zu forwarded=%zu of %zu mutations", static_cast<int>(surfaceId),
          foreignCreated, foreignDeleted, forwarded.size(), mutations.size());
    }

    try {
      jni::ThreadScope threadScope;
      auto *env = jni::Environment::current();
      jni::JniLocalScope localScope(env, static_cast<int>(batch.objects.size() + batch.strings.size()) + 32);

      auto opsArray = jni::make_int_array(static_cast<jsize>(batch.ops.size()));
      opsArray->setRegion(0, static_cast<jsize>(batch.ops.size()), batch.ops.data());

      jclass stringClass = env->FindClass("java/lang/String");
      jclass objectClass = env->FindClass("java/lang/Object");

      jobjectArray stringsArray =
          env->NewObjectArray(static_cast<jsize>(batch.strings.size()), stringClass, nullptr);
      for (size_t i = 0; i < batch.strings.size(); ++i) {
        auto s = jni::make_jstring(batch.strings[i]);
        env->SetObjectArrayElement(stringsArray, static_cast<jsize>(i), s.get());
      }

      jobjectArray objectsArray =
          env->NewObjectArray(static_cast<jsize>(batch.objects.size()), objectClass, nullptr);
      for (size_t i = 0; i < batch.objects.size(); ++i) {
        env->SetObjectArrayElement(objectsArray, static_cast<jsize>(i), batch.objects[i].get());
      }

      static const auto onTransaction =
          JMountingManager::javaClassStatic()->getMethod<void(jint, jintArray, jobjectArray, jobjectArray)>(
              "onTransaction", "(I[I[Ljava/lang/String;[Ljava/lang/Object;)V");
      onTransaction(manager_.get(), surfaceId, opsArray.get(), stringsArray, objectsArray);
    } catch (const std::exception &e) {
      __android_log_print(ANDROID_LOG_ERROR, kTag, "onTransaction failed: %s", e.what());
    }
  }

  return MountingTransaction{surfaceId, number, std::move(forwarded), telemetry};
}

// Which layer owns each mutation. Empty (everything is the engine's) while no foreign component is registered or mounted,
// so a transaction of an app without foreign views costs one scan for foreign names.
std::vector<foreign::Owner> MountingDelegate::classifyForeign(const ShadowViewMutationList &mutations) const {
  std::lock_guard<std::mutex> lock(foreignMutex_);
  if (foreignNames_.empty() && foreign_.empty()) return {};
  bool anyNamedCreate = false;
  if (foreign_.empty()) {
    for (const auto &mutation : mutations) {
      if (mutation.type == ShadowViewMutation::Create && isForeignName(mutation.newChildShadowView.componentName)) {
        anyNamedCreate = true;
        break;
      }
    }
    if (!foreign::mayContainForeign(foreign_, anyNamedCreate)) return {};
  }
  std::vector<foreign::Item> items;
  items.reserve(mutations.size());
  for (const auto &mutation : mutations) {
    foreign::Item item{foreign::Type::Update, 0, -1, false};
    switch (mutation.type) {
      case ShadowViewMutation::Create:
        item.type = foreign::Type::Create;
        item.tag = mutation.newChildShadowView.tag;
        item.named = isForeignName(mutation.newChildShadowView.componentName);
        break;
      case ShadowViewMutation::Delete:
        item.type = foreign::Type::Delete;
        item.tag = mutation.oldChildShadowView.tag;
        break;
      case ShadowViewMutation::Insert:
        item.type = foreign::Type::Insert;
        item.tag = mutation.newChildShadowView.tag;
        item.parent = mutation.parentTag;
        item.named = isForeignName(mutation.newChildShadowView.componentName);
        break;
      case ShadowViewMutation::Remove:
        item.type = foreign::Type::Remove;
        item.tag = mutation.oldChildShadowView.tag;
        item.parent = mutation.parentTag;
        break;
      default:
        item.type = foreign::Type::Update;
        item.tag = mutation.newChildShadowView.tag;
        item.named = isForeignName(mutation.newChildShadowView.componentName);
        break;
    }
    items.push_back(item);
  }
  std::vector<foreign::Owner> owners(items.size());
  foreign_.classify(items.data(), items.size(), owners.data());
  return owners;
}

bool MountingDelegate::isForeignName(const char *componentName) const {
  return foreignNames_.contains(componentName);
}

} // namespace expo::svelteengine
