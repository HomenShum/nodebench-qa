"""World-model substrate emitters.

Two variants:
  lite  — entities + schemas only. Use when the workflow is bounded and
          doesn't need live state / policy / outcome tracking.
  full  — entities + states + events + policies + actions + outcomes +
          evidence graph + interpretive boundary labels.

The interpretive boundary file is the product's honesty contract: every
emitted concept is labeled "act_on" (factual, verified, low-risk) or
"interpret_first" (judgment call, trend reading, correlation). That's
how attrition prevents the quiet-failure mode where plausible
interpretations masquerade as settled operational truth.

Prior art:
  - Jack Dorsey's Block "world model" blueprint — transactions as ground truth
  - Palantir ontology — explicit entity/relationship objects
  - Nate B Jones YouTube talk on quiet failures in world models (cited in
    docs/ATTRITION_PRODUCT_VISION_PITCH.md under the interpretive_boundary
    pattern in Radar)
"""

from daas.compile_down.world_model.emitter import (
    WORLD_MODEL_LANES,
    emit_world_model,
)

__all__ = ["WORLD_MODEL_LANES", "emit_world_model"]
