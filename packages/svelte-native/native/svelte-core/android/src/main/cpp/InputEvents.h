#pragma once

#include <memory>

#include "MountingDelegate.h"

namespace expo::svelteengine {

// Event entry points of the view kinds 5..9 (Kotlin object expo.modules.svelteengine.ViewEvents).
void setViewEventsDelegate(std::shared_ptr<MountingDelegate> delegate);
void registerViewEventNatives();

// The event emitter of a mounted view, or null; any thread.
facebook::react::EventEmitter::Shared emitterForTag(facebook::react::Tag tag);

} // namespace expo::svelteengine
