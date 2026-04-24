/* ── CubeMaster Palletize Helper ─────────────────────────────────────────
 *  Smart per-cargo orientation, auto-overhang, and rules construction for
 *  Step-1 pallet loading.  Used by buildPalletStepPayload() and buildPayload().
 *
 *  Design goals
 *  ────────────
 *  1. Classify each SKU into a category based on dimensional ratios so the
 *     solver gets a physically-meaningful orientation envelope rather than
 *     "try every possible rotation" for every item.
 *  2. Auto-compute overhang when a cargo footprint slightly exceeds the
 *     pallet's nominal edge, within the pallet's maxLength/maxWidth budget.
 *  3. Add fillDirection and ensure Optimization / level-4 are present in the
 *     Step-1 rules so the solver can explore denser floor layouts.
 *
 *  Policy for overriding user values
 *  ─────────────────────────────────
 *  Only the *factory-default* UI values are replaced by smart logic.
 *  If the user explicitly changed an orientation or checked the overhang
 *  checkbox, those choices always win.
 * ──────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var CM = window.CM = window.CM || {};

  /* ──────────────────────────────────────────────────────────────────────
   * 1. Cargo Classification
   *
   *  Sort dims descending: d0 ≥ d1 ≥ d2
   *
   *  'long'     d0 ≥ 800 mm  AND  d0/d1 ≥ 2.5
   *              Primary large-format long boxes (e.g. 1145×310×190).
   *              Standing on the short end is mechanically unstable.
   *              → restrict to Orientations14 (two horizontal-only layouts, standing upright).
   *
   *  'filler'   d2 ≤ 180 mm  OR  volume ≤ 0.015 m³  (and NOT 'long')
   *              Slender or small gap-filling items.
   *              → OrientationsAll for maximum corner-filling freedom.
   *
   *  'standard' everything else
   *              Medium boxes; 12-orientation envelope avoids truly odd
   *              tilted configurations while still improving floor coverage.
   *              → Orientations12
   * ────────────────────────────────────────────────────────────────────*/
  function classifyCargo(l, w, h) {
    var dims = [l, w, h].sort(function (a, b) { return b - a; });
    var d0 = dims[0], d1 = dims[1], d2 = dims[2];
    var vol = l * w * h / 1e9;                             // m³
    if (d0 >= 800 && d1 > 0 && (d0 / d1) >= 2.5) return 'long';
    if (d2 <= 180 || vol <= 0.015)                return 'filler';
    return 'standard';
  }

  /* ──────────────────────────────────────────────────────────────────────
   * 2. Orientation strategy per category
   * ────────────────────────────────────────────────────────────────────*/
  function orientationForCategory(cat) {
    if (cat === 'long')   return 'Orientations14';
    if (cat === 'filler') return 'OrientationsAll';
    return 'Orientations12';
  }

  /* ──────────────────────────────────────────────────────────────────────
   * 3. Automatic overhang calculation
   *
   *  Called when the user has NOT checked the overhang checkbox.
   *
   *  Algorithm
   *  ─────────
   *  a) Footprint candidates = two largest cargo dims (any face can be the
   *     floor depending on orientation).
   *  b) Per-side budget from pallet spec:
   *       budgetL = min(60, (maxLength - length) / 2)
   *       budgetW = min(60, (maxWidth  - width ) / 2)
   *  c) Request overhang when:
   *       (i)  cargo dim > pallet nominal + 10 mm  (cargo positively needs it)
   *       (ii) cargo dim ≥ 92% of pallet nominal   (proactive; ≤ 30 mm gives
   *            the solver extra edge-packing freedom without risking stability)
   * ────────────────────────────────────────────────────────────────────*/
  function autoOverhang(l, w, h, pltSpec) {
    if (!pltSpec) return { allowed: false, ovhL: 0, ovhW: 0 };

    var pltL = pltSpec.length    || 1200;
    var pltW = pltSpec.width     || 1000;
    var maxL = pltSpec.maxLength || (pltL + 80);
    var maxW = pltSpec.maxWidth  || (pltW + 60);

    // Per-side headroom from pallet spec, hard-capped at 60 mm
    var budgetL = Math.min(60, Math.max(0, Math.floor((maxL - pltL) / 2)));
    var budgetW = Math.min(60, Math.max(0, Math.floor((maxW - pltW) / 2)));

    // Cargo's two largest dims = possible footprint in any orientation
    var dims = [l, w, h].sort(function (a, b) { return b - a; });
    var fd0 = dims[0], fd1 = dims[1];

    var ovhL = 0, ovhW = 0;

    // L direction (compared against the larger pallet dimension)
    if (fd0 > pltL + 10 && budgetL > 0) {
      ovhL = Math.min(budgetL, Math.ceil((fd0 - pltL) / 2));
    } else if (fd0 >= pltL * 0.92 && budgetL > 0) {
      ovhL = Math.min(30, budgetL);
    }

    // W direction (compared against the smaller pallet dimension)
    if (fd1 > pltW + 10 && budgetW > 0) {
      ovhW = Math.min(budgetW, Math.ceil((fd1 - pltW) / 2));
    } else if (fd1 >= pltW * 0.92 && budgetW > 0) {
      ovhW = Math.min(30, budgetW);
    }

    return { allowed: ovhL > 0 || ovhW > 0, ovhL: ovhL, ovhW: ovhW };
  }

  /* ──────────────────────────────────────────────────────────────────────
   * 4. enrichCargo
   *
   *  Applies smart orientation and overhang to a half-built cargo object.
   *  Mutates and returns the same object.
   *
   *  @param {object} cargo       – cargo object being prepared for the API
   *  @param {object} pltSpec     – active pallet spec
   *                                { length, width, maxLength, maxWidth }
   *  @param {object} uiOverrides – raw UI values for this row:
   *    orientSel       : string  value from .orientSel <select>
   *    maxLayerVal     : string  value from maxLayersOnOrientation1 input
   *    overhangChecked : bool    whether the overhang checkbox is ticked
   *    ovhL            : string  overhangLength input value
   *    ovhW            : string  overhangWidth  input value
   *
   *  Policy: the helper only replaces the factory default ('OrientationsAll'
   *  for orientation, unchecked for overhang). Any explicit user choice wins.
   * ────────────────────────────────────────────────────────────────────*/
  function enrichCargo(cargo, pltSpec, uiOverrides) {
    uiOverrides = uiOverrides || {};
    var l = cargo.length || 0;
    var w = cargo.width  || 0;
    var h = cargo.height || 0;
    var cat = classifyCargo(l, w, h);

    /* ── Orientation ─────────────────────────────────────────────────── */
    var uiOrient = uiOverrides.orientSel || 'OrientationsAll';
    if (uiOrient === 'OrientationsAll') {
      // User left the factory default → apply category-aware strategy
      cargo.orientationsAllowed = orientationForCategory(cat);
    }
    // else: user explicitly picked a direction → leave it unchanged

    /* ── Overhang ────────────────────────────────────────────────────── */
    if (!uiOverrides.overhangChecked) {
      var oh = autoOverhang(l, w, h, pltSpec);
      if (oh.allowed) {
        cargo.overhangAllowed = true;
        cargo.overhangLength  = oh.ovhL;
        cargo.overhangWidth   = oh.ovhW;
      }
    } else {
      // User explicitly enabled overhang: honour their typed values
      cargo.overhangAllowed = true;
      cargo.overhangLength  = parseInt(uiOverrides.ovhL,  10) || 0;
      cargo.overhangWidth   = parseInt(uiOverrides.ovhW,  10) || 0;
    }

    return cargo;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * 5. buildPalletRules
   *
   *  Constructs an optimised rules block for Step-1 pallet calculations.
   *
   *  fillDirection 'LengthWidthHeight'
   *    Tells the solver to fill along the pallet's long axis first, then
   *    width, then height.  This typically produces tighter floor coverage
   *    for long-box SKUs and reduces dead height above short items.
   * ────────────────────────────────────────────────────────────────────*/
  function buildPalletRules(opts) {
    opts = opts || {};
    return {
      isWeightLimited:               true,
      isUnitloadFirst:               true,
      isSpreadIdenticalCargoAllowed: (opts.spreadIdentical !== undefined)
                                       ? !!opts.spreadIdentical : true,
      algorithmType:                 opts.algorithmType    || 'Optimization',
      optimizationLevel:             (opts.optimizationLevel != null)
                                       ? (opts.optimizationLevel | 0) : 4,
      fillDirection:                 'FrontToRear'
    };
  }

  /* ── Public API ─────────────────────────────────────────────────────── */
  CM.palletizeHelper = {
    classifyCargo:          classifyCargo,
    orientationForCategory: orientationForCategory,
    autoOverhang:           autoOverhang,
    enrichCargo:            enrichCargo,
    buildPalletRules:       buildPalletRules
  };

}());
