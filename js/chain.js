/*
 * chain.js
 *
 * The stack of effects the picture is put through, in order.
 *
 * One layer is one full pass over the whole frame: it reads what the layer
 * below it produced and writes what the layer above it will read. So the order
 * is the whole point - Halftone over Edge Glow prints the edges as dots, Edge
 * Glow over Halftone finds the outline of the dots - and it is worth being
 * able to reorder a stack without rebuilding it.
 *
 * Each layer carries its own intensity rather than reading it off the effect,
 * because the same effect can appear twice in one stack with different
 * strengths. The effect object still remembers the last value it was given,
 * which is what a layer starts from when you pick it: dialling VHS back to 0.3
 * once and then reaching for it again gets you the 0.3 you settled on, in the
 * new layer, without tying the two layers together afterwards.
 *
 * Every layer always holds a real, compiled effect - "None" is a genuine
 * pass-through shader, not an empty slot - so nothing downstream has to
 * special-case a layer that isn't doing anything yet.
 */

// Each layer is a full-resolution pass with two textures of its own, so this
// is a real cost rather than a tidiness limit. Six is past the point where
// another pass still reads as a deliberate choice rather than a mess.
export const MAX_LAYERS = 6;

export class Layer {
  /** One pass: an effect and the strength it runs at here. */
  constructor(effect, amount = null) {
    this.effect = effect;
    this.amount = amount === null ? effect.amount : amount;
  }
}

export class EffectChain {
  /**
   * An ordered stack of layers, with one of them active.
   *
   * The active layer is the one the effect combo box and the intensity slider
   * are pointed at. There is always at least one layer, so there is always
   * something for them to point at.
   */
  constructor(library, names = []) {
    this.library = library;
    this.layers = [];
    this.active = 0;

    for (const name of names) {
      const effect = library.byName(name);
      if (effect && effect.ok) this.layers.push(new Layer(effect));
    }
    if (!this.layers.length) this.layers.push(new Layer(this.defaultEffect()));
  }

  // --- the effect a new layer starts on ---------------------------------

  /**
   * What an added layer holds until you pick something.
   *
   * The pass-through, so adding a layer changes nothing on screen - you add
   * the slot, then choose what goes in it, rather than having the picture jump
   * the moment you make room.
   */
  defaultEffect() {
    return this.library.byName("None") || this.library.firstWorking();
  }

  // --- the active layer -------------------------------------------------

  get length() { return this.layers.length; }
  get layer() { return this.layers[this.active]; }
  get effect() { return this.layer.effect; }
  get amount() { return this.layer.amount; }

  /** Point the effect box and the slider at another layer. */
  select(index) {
    if (index < 0 || index >= this.layers.length || index === this.active) return false;
    this.active = index;
    return true;
  }

  /** Put an effect in the active layer, at the strength it last ran at. */
  setEffect(effect) {
    if (!effect || !effect.ok || effect === this.layer.effect) return false;
    this.layer.effect = effect;
    this.layer.amount = effect.amount;
    return true;
  }

  /**
   * Set the active layer's strength, and let the effect remember it.
   *
   * The layer is what actually runs at this value; the effect keeps a copy so
   * that picking it again later - in this layer or another one - starts where
   * you left it rather than back at its default.
   */
  setAmount(value) {
    value = Math.max(0, Math.min(1, Number(value)));
    this.layer.amount = value;
    this.layer.effect.amount = value;
  }

  /** Back to the effect's own default. */
  resetAmount() {
    this.setAmount(this.layer.effect.defaultAmount);
  }

  /** Step the active layer through the flat catalogue order. */
  stepEffect(delta) {
    const all = this.library.effects.filter((e) => e.ok);
    if (!all.length) return false;
    const at = all.indexOf(this.layer.effect);
    const next = all[((at + delta) % all.length + all.length) % all.length];
    return this.setEffect(next);
  }

  // --- editing the stack ------------------------------------------------

  /**
   * Insert a pass-through layer above the active one and select it.
   *
   * Above rather than at the end: the active layer is what you were just
   * looking at, so that is where the next one belongs.
   */
  add() {
    if (this.layers.length >= MAX_LAYERS) return false;
    this.active += 1;
    this.layers.splice(this.active, 0, new Layer(this.defaultEffect()));
    return true;
  }

  /**
   * Drop a layer. The last one standing can't be removed - the picture has to
   * go through something, and that something is the pass-through.
   */
  remove(index = null) {
    if (this.layers.length <= 1) return false;
    index = index === null ? this.active : index;
    if (index < 0 || index >= this.layers.length) return false;
    this.layers.splice(index, 1);
    this.active = Math.min(this.active, this.layers.length - 1);
    return true;
  }

  /**
   * Move the active layer up or down the stack, keeping it selected.
   *
   * The layer object itself moves, which is what keeps its feedback history
   * with it - the renderer keys each layer's buffers off the object, so a
   * reordered Echo Trails carries its own trails along rather than inheriting
   * whatever was in that slot before.
   */
  move(delta) {
    const target = this.active + delta;
    if (target < 0 || target >= this.layers.length) return false;
    const held = this.layers[this.active];
    this.layers[this.active] = this.layers[target];
    this.layers[target] = held;
    this.active = target;
    return true;
  }

  // --- description ------------------------------------------------------

  names() { return this.layers.map((l) => l.effect.name); }

  /** The stack as one line, bottom layer first. */
  describe() { return this.names().join(" > "); }
}
