'use strict';

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { SettingsData } from './settings_data.js';

// safe logging helper: use global.log if available, otherwise fall back to log() or print()
const _safeLog = (msg) => {
    try {
        if (typeof global !== 'undefined' && global && typeof global.log === 'function') {
            global.log(msg);
        } else if (typeof log === 'function') {
            log(msg);
        } else {
            print(msg);
        }
    } catch (e) {
        // ignore
    }
};

const DEBUG = !!GLib.getenv('PIXEL_DISSOLVE_DEBUG');
// SAFE_MODE can be enabled via env PIXEL_DISSOLVE_SAFE=1 or by creating ~/.pixel_dissolve_safe
const SAFE_MODE = !!GLib.getenv('PIXEL_DISSOLVE_SAFE') || GLib.file_test(GLib.get_home_dir() + '/.pixel_dissolve_safe', GLib.FileTest.EXISTS);
// LEGACY_MODE restores the older immediate cleanup/notification behavior (use for testing)
const LEGACY_MODE = !!GLib.getenv('PIXEL_DISSOLVE_LEGACY');
// Minimum scale when minimized (0.0..1.0). Smaller = more shrink.
// defaults; will be overridden by settings at runtime
const SHRINK_MIN_DEFAULT = 0.85;
const DRIFT_PX_DEFAULT   = 40;
const MINIMIZE_EFFECT_NAME = 'smoke-ink-minimize-overlay';
const UNMINIMIZE_EFFECT_NAME = 'smoke-ink-unminimize-overlay';
const ACTOR_FLAG = Symbol.for('pixel-dissolve-ink:active');
const LAST_START_TS = Symbol.for('pixel-dissolve-ink:last-start');
const START_COOLDOWN_MS = 100; // block duplicate starts within this window

function _safeActorName(actor) {
    try {
        if (!actor) return '<null>';
        if (typeof actor.get_title === 'function') return actor.get_title();
        if (typeof actor.toString === 'function') return actor.toString();
        return '<actor>';
    } catch (e) { return '<actor-error>'; }
}

export default class InkSmokeEffectExtension extends Extension {
    enable() {
        this.settingsData = new SettingsData(this.getSettings());

        if (SAFE_MODE) {
            if (DEBUG) _safeLog('pixel-dissolve-ink: SAFE_MODE enabled - extension will not monkey-patch WM or run effects');
            return;
        }
        // Désactive les anims Shell pour min/unmin
        Main.wm._original_shouldAnimateActor = Main.wm._shouldAnimateActor;
        Main.wm._shouldAnimateActor = function (actor, types) {
            const stack = new Error().stack || '';
            if (stack.indexOf('_minimizeWindow') !== -1 || stack.indexOf('_unminimizeWindow') !== -1) return false;
            return Main.wm._original_shouldAnimateActor(actor, types);
        };

        // Overlay-only: do not override or proxy WM completed_*; let WM handle accounting

        this._layer = null;

    this._minimizeId = global.window_manager.connect('minimize', (_wm, actor) => {
            try {
                if (Main.overview.visible) {
                    return;
                }
                // Always log event occurrence to aid diagnosis (not gated by DEBUG)
                try { _safeLog('pixel-dissolve-ink: minimize event ' + _safeActorName(actor)); } catch (e) { }
                if (DEBUG) _safeLog('pixel-dissolve-ink: minimize signal received for actor ' + _safeActorName(actor));
                // Cancel any running opposite-phase effect so we can switch smoothly
                try {
                    const eOpp = actor.get_effect && actor.get_effect(UNMINIMIZE_EFFECT_NAME);
                    if (eOpp) {
                        try { eOpp.cancelEarly?.(actor); } catch { try { actor.remove_effect(eOpp); } catch { try { eOpp.destroy?.(); } catch {} } }
                    }
                } catch {}
                // Clear any previous minimize overlay of the same name
                try {
                    const e = actor.get_effect && actor.get_effect(MINIMIZE_EFFECT_NAME);
                    if (e && e.get_actor && e.get_actor() === actor) {
                        try { e.cancelEarly?.(actor); } catch { try { actor.remove_effect(e); } catch (e2) { try { e.destroy?.(); } catch (_) {} } }
                    }
                } catch (_) {}
                try { actor[ACTOR_FLAG] = false; } catch {}
                // simple cooldown to avoid back-to-back duplicate starts
                try {
                    const now = Date.now();
                    if (actor[LAST_START_TS] && (now - actor[LAST_START_TS]) < START_COOLDOWN_MS)
                        return;
                    actor[LAST_START_TS] = now;
                } catch {}
                if (SAFE_MODE) {
                    if (DEBUG) _safeLog('pixel-dissolve-ink: SAFE_MODE - skipping minimize effect');
                } else {
                    try {
                        actor.add_effect_with_name(MINIMIZE_EFFECT_NAME,
                            new SmokeInkOverlayEffect({ settingsData: this.settingsData, reverse: false }));
                    } catch (e) {
                        if (DEBUG) _safeLog('pixel-dissolve-ink: add_effect_with_name failed in minimize handler: ' + e);
                    }
                }
            } catch (e) {
                if (DEBUG) _safeLog('pixel-dissolve-ink: minimize handler error: ' + e);
            }
        });

        // (map) handler is defined once later with additional filtering; avoid duplicate connects

        this._unminimizeId = global.window_manager.connect('unminimize', (_wm, actor) => {
            try {
                // Always log event occurrence to aid diagnosis (not gated by DEBUG)
                try { _safeLog('pixel-dissolve-ink: unminimize event ' + _safeActorName(actor)); } catch (e) { }
                if (DEBUG) _safeLog('pixel-dissolve-ink: unminimize signal received for actor ' + _safeActorName(actor));
                if (Main.overview.visible) {
                    return;
                }
                // Respect user setting for reverse-on-restore
                try {
                    const doReverse = this.settingsData?.REVERSE_ON_RESTORE?.get?.();
                    if (doReverse === false) return;
                } catch {}
                // Cancel any running opposite-phase effect so we can switch smoothly
                try {
                    const eOpp = actor.get_effect && actor.get_effect(MINIMIZE_EFFECT_NAME);
                    if (eOpp) {
                        try { eOpp.cancelEarly?.(actor); } catch { try { actor.remove_effect(eOpp); } catch { try { eOpp.destroy?.(); } catch {} } }
                    }
                } catch {}
                // Clear any previous unminimize overlay of the same name
                try {
                    const e = actor.get_effect && actor.get_effect(UNMINIMIZE_EFFECT_NAME);
                    if (e && e.get_actor && e.get_actor() === actor) {
                        try { e.cancelEarly?.(actor); } catch { try { actor.remove_effect(e); } catch (e2) { try { e.destroy?.(); } catch (_) {} } }
                    }
                } catch (_) {}
                try { actor[ACTOR_FLAG] = false; } catch {}
                if (SAFE_MODE) {
                    if (DEBUG) _safeLog('pixel-dissolve-ink: SAFE_MODE - skipping unminimize effect');
                } else {
                    try {
                        // Add overlay effect; let WM handle unminimize accounting
                        actor.add_effect_with_name(UNMINIMIZE_EFFECT_NAME,
                            new SmokeInkOverlayEffect({ settingsData: this.settingsData, reverse: true }));
                    } catch (e) {
                        if (DEBUG) _safeLog('pixel-dissolve-ink: add_effect_with_name failed in unminimize handler: ' + e);
                    }
                }
            } catch (e) {
                if (DEBUG) _safeLog('pixel-dissolve-ink: unminimize handler error: ' + e);
            }
        });

        // Single map handler (open/reopen): play reverse overlay with strong guards
        this._mapId = global.window_manager.connect('map', (_wm, actor) => {
            try {
                if (!actor || actor === null) return;
                // guard against disposed actors
                if (!actor.get_stage || !actor.get_stage()) return;
                if (Main.overview.visible) return;
                // Respect user setting for reverse-on-restore
                try {
                    const doReverse = this.settingsData?.REVERSE_ON_RESTORE?.get?.();
                    if (doReverse === false) return;
                } catch {}
                try {
                    const now = Date.now();
                    if (actor[LAST_START_TS] && (now - actor[LAST_START_TS]) < START_COOLDOWN_MS)
                        return;
                    actor[LAST_START_TS] = now;
                } catch {}
                const mw = actor.get_meta_window?.();
                if (!mw || mw.skip_taskbar || mw.is_skip_taskbar?.()) return;
                // ignore if already animating
                if (actor[ACTOR_FLAG]) return;

                // cancel opposite-phase; clear same-phase
                try {
                    const eOpp = actor.get_effect && actor.get_effect(MINIMIZE_EFFECT_NAME);
                    if (eOpp) {
                        try { eOpp.cancelEarly?.(actor); } catch { try { actor.remove_effect(eOpp); } catch { try { eOpp.destroy?.(); } catch {} } }
                    }
                } catch {}
                try {
                    const eSame = actor.get_effect && actor.get_effect(UNMINIMIZE_EFFECT_NAME);
                    if (eSame && eSame.get_actor && eSame.get_actor() === actor) {
                        try { eSame.cancelEarly?.(actor); } catch { try { actor.remove_effect(eSame); } catch { try { eSame.destroy?.(); } catch {} } }
                    }
                } catch {}
                try { actor[ACTOR_FLAG] = false; } catch {}
                // cooldown
                try {
                    const now = Date.now();
                    if (actor[LAST_START_TS] && (now - actor[LAST_START_TS]) < START_COOLDOWN_MS)
                        return;
                    actor[LAST_START_TS] = now;
                } catch {}
                if (!SAFE_MODE) {
                    try { actor.add_effect_with_name(UNMINIMIZE_EFFECT_NAME, new SmokeInkOverlayEffect({ settingsData: this.settingsData, reverse: true })); } catch {}
                }
            } catch (e) {
                if (DEBUG) _safeLog('pixel-dissolve-ink: map handler error: ' + e);
            }
        });
    }

    disable() {
        if (this._minimizeId) {
            try { global.window_manager.disconnect(this._minimizeId); } catch (e) { }
            this._minimizeId = 0;
        }
        if (this._unminimizeId) {
            try { global.window_manager.disconnect(this._unminimizeId); } catch (e) { }
            this._unminimizeId = 0;
        }
        if (this._mapId) {
            try { global.window_manager.disconnect(this._mapId); } catch (e) { }
            this._mapId = 0;
        }

        global.get_window_actors().forEach(a => this._destroyOverlay(a));

        if (Main.wm._original_shouldAnimateActor) {
            Main.wm._shouldAnimateActor = Main.wm._original_shouldAnimateActor;
            Main.wm._original_shouldAnimateActor = null;
        }
        if (Main.wm._shellwm._original_completed_minimize) {
            Main.wm._shellwm._original_completed_minimize = null;
        }
        if (Main.wm._shellwm._original_completed_unminimize) {
            Main.wm._shellwm._original_completed_unminimize = null;
        }

        if (this._layer && !this._layer.destroyed) {
            try { this._layer.destroy(); } catch (e) { }
        }
        this._layer = null;
        this.settingsData = null;
    }

    _ensureLayer() {
        if (!this._layer || this._layer.destroyed) {
            this._layer = new Clutter.Actor({ reactive: false });
            Main.uiGroup.add_child(this._layer);
        }
    }

    _destroyOverlay(actor) {
        if (!actor) return;
        try {
            if (!actor.get_stage || !actor.get_stage()) return;
            const e1 = actor.get_effect(MINIMIZE_EFFECT_NAME);
            if (e1 && e1.get_actor && e1.get_actor() === actor) {
                try { e1.cancelEarly?.(actor); } catch {}
                try { actor.remove_effect(e1); } catch {}
            }
        } catch (e) { }
        try {
            if (!actor.get_stage || !actor.get_stage()) return;
            const e2 = actor.get_effect(UNMINIMIZE_EFFECT_NAME);
            if (e2 && e2.get_actor && e2.get_actor() === actor) {
                try { e2.cancelEarly?.(actor); } catch {}
                try { actor.remove_effect(e2); } catch {}
            }
        } catch (e) { }
    }

    // no per-app exclusion (feature removed for simplicity)
}

// SmokeInkOverlayEffect implementation

const SmokeInkOverlayEffect = GObject.registerClass(class SmokeInkOverlayEffect extends Clutter.Effect {
    _init(params = {}) {
        super._init();
        this.settingsData       = params.settingsData;
        this.reverse            = !!params.reverse;

        this._timeline          = null;
        this._clone             = null;
        this._shader            = null;
        this._layer             = null;

        this._actorSavedOpacity = null;   // on sauvegarde l’opacité de la vraie fenêtre
        this._appliedToActor    = false;
        this._debug             = DEBUG;
        this._useShader         = false;
        this._lastUniformUpdate = 0;
        this._usedActorEase     = false;

        // où on commence le cross-fade en reverse (0.0..1.0)
        this._holdRatio         = 0.70;
    }

    vfunc_set_actor(actor) {
        super.vfunc_set_actor(actor);
        if (!actor) return;
        // guard disposed
        try { if (!actor.get_stage || !actor.get_stage()) return; } catch { return; }

        try { actor[ACTOR_FLAG] = true; } catch {}
        if (this._debug) _safeLog(`vfunc_set_actor reverse=${this.reverse} actor=${_safeActorName(actor)}`);

        // if actor gets destroyed during the animation, stop safely
        try {
            this._destroyConn = actor.connect('destroy', () => {
                try { this.cancelEarly(actor); } catch {}
            });
        } catch {}

        // apply settings-driven reveal hold if available
        try {
            const rh = this.settingsData?.REVEAL_HOLD?.get?.();
            if (typeof rh === 'number' && isFinite(rh)) {
                // clamp 0..0.95 to keep some fade window
                this._holdRatio = Math.max(0, Math.min(0.95, rh));
            }
        } catch {}

        // position & taille (prefer transformed for HiDPI/scale)
        let ax=0, ay=0, aw=0, ah=0;
        try { [ax, ay] = actor.get_transformed_position?.() ?? actor.get_position?.() ?? [0,0]; } catch {}
        try {
            if (actor.get_transformed_size) [aw, ah] = actor.get_transformed_size();
            else if (actor.get_size) [aw, ah] = actor.get_size();
        } catch {}
        // sanitize numbers
        if (!Number.isFinite(ax)) ax = 0;
        if (!Number.isFinite(ay)) ay = 0;
        if (!Number.isFinite(aw) || aw <= 0) aw = actor.get_width?.() ?? 1;
        if (!Number.isFinite(ah) || ah <= 0) ah = actor.get_height?.() ?? 1;

        // parent pour l’overlay
        try {
            const parent = actor.get_parent?.();
            this._layer  = parent || global.window_group || Main.uiGroup;
        } catch {
            this._layer  = global.window_group || Main.uiGroup;
        }

        // clone GPU
        let cloneCreated = false;
        try {
            this._clone = new Clutter.Clone({ source: actor });
            this._clone.set_position(ax, ay);
            this._clone.set_size(aw, ah);
            this._clone.set_reactive(false);
            // pivot defaults to center; some styles override to bottom
            this._clone.set_pivot_point(0.5, 0.5);
            this._clone.set_translation(0, 0, 0);
            try { this._clone.set_anchor_point_from_gravity?.(Clutter.Gravity.CENTER); } catch {}
            try {
                if (this._layer && !this._clone.get_parent()) {
                    this._layer.add_child(this._clone);
                    // au-dessus de la fenêtre réelle
                    this._layer.set_child_above_sibling?.(this._clone, actor);
                }
            } catch {}
            try { this._clone.set_opacity(255); } catch {}
            try { this._clone.queue_relayout?.(); } catch {}
            cloneCreated = true;
        } catch (e) {
            if (this._debug) _safeLog('Clone creation failed: ' + e);
            this._clone = null;
        }

        // fallback snapshot si besoin (même logique d’empilage)
        if (!this._clone) {
            try {
                const tex = actor.get_texture?.();
                if (tex) {
                    const texActor = new Clutter.Actor({ reactive:false });
                    try { texActor.set_content(tex); } catch { try { texActor.set_texture?.(tex); } catch {} }
                    texActor.set_position(ax, ay);
                    texActor.set_size(aw, ah);
                    this._clone = texActor;
                    if (this._layer && !this._clone.get_parent()) {
                        this._layer.add_child(this._clone);
                        this._layer.set_child_above_sibling?.(this._clone, actor);
                    }
                    this._clone.set_opacity?.(255);
                    this._clone.queue_relayout?.();
                    cloneCreated = true;
                }
            } catch (e) { if (this._debug) _safeLog('snapshot fallback failed: ' + e); }
        }

        // shader (optionnel)
        this._useShader = (this.settingsData?.USE_SHADER?.get?.() ?? true);
        if (this._useShader && (!Clutter.ShaderEffect || !Clutter.ShaderType?.FRAGMENT_SHADER)) {
            this._useShader = false;
            this._shader = null;
        }
        const styleSetting = (this.settingsData?.STYLE?.get?.() ?? 'ink');
        // Adjust pivot for 'genie' style (collapse to bottom)
        try {
            if (styleSetting === 'genie' && this._clone) {
                this._clone.set_pivot_point(0.5, 1.0);
                try { this._clone.set_anchor_point_from_gravity?.(Clutter.Gravity.SOUTH); } catch {}
            }
        } catch {}

        if (this._useShader) {
            try {
                this._shader = new Clutter.ShaderEffect({ shader_type: Clutter.ShaderType.FRAGMENT_SHADER });
                const style = styleSetting;
                const src = style === 'pixelate' ? `
                                        uniform sampler2D tex;
                                        uniform float u_time;
                                        uniform float u_gate;
                                        uniform float u_aspect;
                                        void main() {
                                            vec2 uv = cogl_tex_coord_in[0].st;
                                            float k = mix(40.0, 2.0, clamp(u_time, 0.0, 1.0));
                                            // gate keeps original until late for reverse
                                            float g = clamp(u_gate, 0.0, 1.0);
                                            vec2 p = floor(uv * k) / k;
                                            vec4 col = texture2D(tex, mix(uv, p, g));
                                            cogl_color_out = col;
                                        }
                                ` : style === 'ripple' ? `
                                        uniform sampler2D tex;
                                        uniform float u_time;
                                        uniform float u_gate;
                                        uniform vec2  u_center;
                                        uniform float u_aspect;
                                        void main() {
                                            vec2 uv = cogl_tex_coord_in[0].st;
                                            vec2 cuv = uv - u_center;
                                            cuv.y /= u_aspect;
                                            float r = length(cuv);
                                            float wave = sin(30.0 * r - 10.0 * u_time) * 0.003;
                                            float g = clamp(u_gate, 0.0, 1.0);
                                            vec2 disp = normalize(cuv) * wave * g;
                                            vec4 col = texture2D(tex, uv + disp);
                                            cogl_color_out = col;
                                        }
                                ` : style === 'wobble' ? `
                                        uniform sampler2D tex;
                                        uniform float u_time;
                                        uniform float u_gate;
                                        uniform float u_aspect;
                                        void main() {
                                            vec2 uv = cogl_tex_coord_in[0].st;
                                            float g = clamp(u_gate, 0.0, 1.0);
                                            // small jelly-like wobble, fades in with gate
                                            float w = 0.008 * (1.0);
                                            vec2 off;
                                            off.x = sin(uv.y * 30.0 + u_time * 12.0) * w * g;
                                            off.y = cos(uv.x * 30.0 + u_time * 10.0) * w * g;
                                            vec4 col = texture2D(tex, uv + off);
                                            cogl_color_out = col;
                                        }
                                ` : style === 'genie' ? `
                                        uniform sampler2D tex;
                                        uniform float u_time;
                                        uniform float u_gate;
                                        void main() {
                                            vec2 uv = cogl_tex_coord_in[0].st;
                                            float g = clamp(u_gate, 0.0, 1.0);
                                            // vertical collapse towards bottom (y=1.0) with slight X pinch near bottom
                                            float y = uv.y * (1.0 - g) + g; // move scanlines towards bottom
                                            float pinch = mix(1.0, 0.7, pow(uv.y, 2.0) * g);
                                            float x = (uv.x - 0.5) * pinch + 0.5;
                                            vec4 col = texture2D(tex, vec2(x, y));
                                            cogl_color_out = col;
                                        }
                                ` : `
                    uniform sampler2D tex;
                    uniform float u_time;
                    uniform float u_intensity;
                    uniform float u_scale;
                    uniform float u_gate; // 0 = plein opaque, 1 = fully dissolved
                    uniform vec2  u_center;
                    uniform float u_aspect;
                    uniform float u_edgeSoft;

                    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
                    float noise(vec2 p){
                      vec2 i=floor(p), f=fract(p);
                      float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
                      vec2 u=f*f*(3.0-2.0*f);
                      return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
                    }

                    void main() {
                      vec2 uv  = cogl_tex_coord_in[0].st;
                      vec4 col = texture2D(tex, uv);
                      vec2 cuv = uv - u_center;
                      cuv.y   /= u_aspect;
                      float r  = length(cuv);

                      float t = u_time;
                      float s = u_scale;

                      float n = 0.0;
                      n += 0.6 * noise(uv * s + t * 0.8);
                      n += 0.3 * noise(uv * s * 2.3 - t * 1.1);
                      n += 0.1 * noise(uv * s * 4.7 + t * 1.7);

                      float grow = mix(0.0, 1.2, t);
                      float rim  = smoothstep(grow - u_edgeSoft, grow, r + n * 0.15);

                      vec3 ink        = vec3(0.0);
                      vec3 dissolved  = mix(col.rgb, ink, rim * u_intensity);
                      float dissolvedA = mix(col.a, 0.0, rim);

                      // gate = 0 => image intacte ; gate -> 1 => on montre la version dissoute
                      vec3 finalRgb = mix(col.rgb, dissolved, clamp(u_gate, 0.0, 1.0));
                      float finalA  = mix(col.a,  dissolvedA, clamp(u_gate, 0.0, 1.0));

                      cogl_color_out = vec4(finalRgb, finalA);
                    }
                `;
                this._shader.set_shader_source(src);
                if (cloneCreated && this._clone?.add_effect) this._clone.add_effect(this._shader);
                else { actor.add_effect(this._shader); this._appliedToActor = true; }
            } catch (e) {
                if (this._debug) _safeLog('shader setup failed: ' + e);
                this._useShader = false;
                this._shader = null;
            }
        }

        // Overlay-only: ne pas modifier l’opacité de la fenêtre réelle.

        // timeline
        const duration = (this.settingsData?.DURATION?.get?.() ?? 600);
        // Ensure we don't double-apply duration elsewhere; single timeline governs progress
        this._timeline = new Clutter.Timeline({ actor, duration });
        this._timeline.connect('new-frame',   () => this._onFrame(actor));
        this._timeline.connect('completed',   () => this._finish(actor));
        try { this._timeline.start(); } catch (e) { if (this._debug) _safeLog('timeline start failed: ' + e); }
    }

    _onFrame(actor) {
        if (!this._timeline) return;

    // guard disposed
    try { if (!actor || !actor.get_stage || !actor.get_stage()) { this.cancelEarly?.(actor); return; } } catch { return; }
    const progress = this._timeline.get_progress(); // 0..1
        if (this._usedActorEase) return;

        try {
            // cross-fade overlay <-> actor réel en reverse
            const HOLD = this._holdRatio; // ~0.7 par défaut
            let overlayAlpha = null; // 0..255 si on a un clone

            if (this.reverse && this._clone) {
                if (progress < HOLD) {
                    overlayAlpha = 255; // on masque totalement le vrai actor (opacity=0)
                } else {
                    const t = (progress - HOLD) / (1 - HOLD); // 0..1
                    const easeOut = 1 - (1 - t) * (1 - t);
                    overlayAlpha = Math.max(0, Math.min(255, Math.round(255 * (1 - easeOut))));
                }
            }

            if (this._shader && this._useShader) {
                const easedTime  = 0.5 * (1 - Math.cos(progress * Math.PI));
                const style      = (this.settingsData?.STYLE?.get?.() ?? 'ink');
                const intensity  = (this.settingsData?.INTENSITY?.get?.() ?? 1.0);
                const scaleNoise = (this.settingsData?.NOISE_SCALE?.get?.() ?? 6.0);
                const edgeSoft   = 0.18;

                let aspect = 1.0;
                try {
                    const target = this._clone || actor;
                    const [w, h] = target?.get_size ? target.get_size() : [0,0];
                    if (w > 0 && h > 0) aspect = w / h;
                } catch {}

                const now = Date.now();
                if (!this._lastUniformUpdate || now - this._lastUniformUpdate >= 16) {
                    this._lastUniformUpdate = now;
                    const shaderTime = this.reverse ? (1.0 - easedTime) : easedTime;
                    let gate = 1.0;
                    if (this.reverse) {
                        gate = (easedTime < HOLD) ? 0.0 : (easedTime - HOLD) / (1 - HOLD);
                    }
                    try { this._shader.set_uniform_value('u_time',   shaderTime); } catch {}
                    try { this._shader.set_uniform_value('u_gate',   gate);       } catch {}
                    try { this._shader.set_uniform_value('u_aspect', aspect);     } catch {}
                    if (style === 'ink') {
                        try { this._shader.set_uniform_value('u_intensity', intensity); } catch {}
                        try { this._shader.set_uniform_value('u_scale',     scaleNoise); } catch {}
                        try { this._shader.set_uniform_value('u_center',    [0.5, 0.80]); } catch {}
                        try { this._shader.set_uniform_value('u_edgeSoft',  edgeSoft); } catch {}
                    } else if (style === 'ripple') {
                        try { this._shader.set_uniform_value('u_center',    [0.5, 0.80]); } catch {}
                    } else if (style === 'wobble') {
                        // no extra uniforms
                    } else if (style === 'genie') {
                        // no extra uniforms
                    }
                }

                const target = this._clone;
                if (target) {
                    // if target not realized/allocated yet, skip this frame to avoid warnings
                    try { if (!target.get_stage || !target.get_stage()) return; } catch {}
                    if (this.reverse) {
                        // en reverse, pas de drift/scale — on colle à l’acteur
                        try {
                            const [tx, ty] = actor.get_transformed_position?.() ?? actor.get_position?.() ?? [0,0];
                            const [aw, ah] = actor.get_transformed_size?.() ?? actor.get_size?.() ?? [0,0];
                            if (Number.isFinite(tx) && Number.isFinite(ty)) target.set_position(tx, ty);
                            if (Number.isFinite(aw) && Number.isFinite(ah) && aw > 0 && ah > 0) target.set_size(aw, ah);
                        } catch {}
                        // style-specific reverse transforms
                        const style = (this.settingsData?.STYLE?.get?.() ?? 'ink');
                        if (style === 'genie') {
                            // unfold vertically from bottom as gate opens
                            const HOLD = this._holdRatio;
                            const tOpen = progress < HOLD ? 0.0 : (progress - HOLD) / (1 - HOLD);
                            const sy = Math.max(0.001, tOpen);
                            target.set_scale?.(1.0, sy);
                            try { target.set_translation(0, 0, 0); } catch {}
                        } else if (style === 'wobble') {
                            // small bounce-in
                            const phase = Math.min(1, Math.max(0, (progress - 0.1) / 0.3));
                            const amp = 0.03 * (1 - phase);
                            const sx = 1.0 + amp * Math.sin(progress * Math.PI * 6.0);
                            const sy = 1.0 - amp * Math.sin(progress * Math.PI * 6.0);
                            target.set_scale?.(sx, sy);
                        } else {
                            target.set_scale?.(1.0, 1.0);
                        }
                        target.set_translation?.(0, 0, 0);
                        if (overlayAlpha !== null) target.set_opacity?.(overlayAlpha);

                        // Ne pas modifier l’opacité de l’acteur réel
                    } else {
                        // minimize: shrink + drift
                        const easeOutQuad = t => 1 - (1 - t) * (1 - t);
                        const eased = easeOutQuad(progress);
                        const shrinkMin = this.settingsData?.SHRINK_MIN?.get?.() ?? SHRINK_MIN_DEFAULT;
                        const style = (this.settingsData?.STYLE?.get?.() ?? 'ink');
                        if (style === 'genie') {
                            // collapse vertically towards bottom
                            const sx = 1.0 - (1.0 - shrinkMin) * eased;
                            const sy = Math.max(0.001, 1.0 - eased);
                            target.set_scale?.(sx, sy);
                            const driftPx = this.settingsData?.DRIFT_PX?.get?.() ?? DRIFT_PX_DEFAULT;
                            const dy = driftPx * eased;
                            try { target.set_translation(0, dy, 0); } catch {}
                        } else if (style === 'wobble') {
                            const base = 1.0 - (1.0 - shrinkMin) * eased;
                            const amp = 0.04 * (1 - eased);
                            const sx = base + amp * Math.sin(progress * Math.PI * 8.0);
                            const sy = base - amp * Math.sin(progress * Math.PI * 8.0);
                            target.set_scale?.(sx, sy);
                            const driftPx = this.settingsData?.DRIFT_PX?.get?.() ?? DRIFT_PX_DEFAULT;
                            const dy = driftPx * eased;
                            try { target.set_translation(0, dy, 0); } catch {}
                        } else {
                            const scaleVal = 1.0 - (1.0 - shrinkMin) * eased;
                            target.set_scale?.(scaleVal, scaleVal);
                            const driftPx = this.settingsData?.DRIFT_PX?.get?.() ?? DRIFT_PX_DEFAULT;
                            const dy = driftPx * eased;
                            try { target.set_translation(0, dy, 0); } catch {}
                        }
                        // overlay disparaît progressivement (shader le fait déjà via u_gate=1)
                        target.set_opacity?.(Math.max(0, Math.min(255, Math.round((1 - progress) * 255))));
                    }
                }

            } else {
                // fallback sans shader : même cross-fade
                const target = this._clone;
                if (!target) return;
                try { if (!target.get_stage || !target.get_stage()) return; } catch {}

                if (this.reverse) {
                    // overlay: hold puis fade (clone seulement)
                    if (overlayAlpha !== null) target.set_opacity?.(overlayAlpha);
                    // pas de drift/scale en reverse
                    try {
                        const [tx, ty] = actor.get_transformed_position?.() ?? actor.get_position?.() ?? [0,0];
                        const [aw, ah] = actor.get_transformed_size?.() ?? actor.get_size?.() ?? [0,0];
                        if (Number.isFinite(tx) && Number.isFinite(ty)) target.set_position(tx, ty);
                        if (Number.isFinite(aw) && Number.isFinite(ah) && aw > 0 && ah > 0) target.set_size(aw, ah);
                    } catch {}
                    // style-specific reverse fallback
                    const style = (this.settingsData?.STYLE?.get?.() ?? 'ink');
                    if (style === 'genie') {
                        const HOLD = this._holdRatio;
                        const tOpen = progress < HOLD ? 0.0 : (progress - HOLD) / (1 - HOLD);
                        const sy = Math.max(0.001, tOpen);
                        target.set_scale?.(1.0, sy);
                        target.set_translation?.(0, 0, 0);
                        try { target.set_pivot_point?.(0.5, 1.0); } catch {}
                    } else if (style === 'wobble') {
                        const phase = Math.min(1, Math.max(0, (progress - 0.1) / 0.3));
                        const amp = 0.03 * (1 - phase);
                        const sx = 1.0 + amp * Math.sin(progress * Math.PI * 6.0);
                        const sy = 1.0 - amp * Math.sin(progress * Math.PI * 6.0);
                        target.set_scale?.(sx, sy);
                        target.set_translation?.(0, 0, 0);
                    } else {
                        target.set_scale?.(1.0, 1.0);
                        target.set_translation?.(0, 0, 0);
                    }

                } else {
                    // minimize: shrink + drift + fade overlay
                    const easeOutQuad = t => 1 - (1 - t) * (1 - t);
                    const eased = easeOutQuad(progress);
                    const shrinkMin = this.settingsData?.SHRINK_MIN?.get?.() ?? SHRINK_MIN_DEFAULT;
                    const style = (this.settingsData?.STYLE?.get?.() ?? 'ink');
                    if (style === 'genie') {
                        const sx = 1.0 - (1.0 - shrinkMin) * eased;
                        const sy = Math.max(0.001, 1.0 - eased);
                        target.set_scale?.(sx, sy);
                        try { target.set_pivot_point?.(0.5, 1.0); } catch {}
                        const driftPx = this.settingsData?.DRIFT_PX?.get?.() ?? DRIFT_PX_DEFAULT;
                        const dy = driftPx * eased;
                        try { target.set_translation(0, dy, 0); } catch {}
                    } else if (style === 'wobble') {
                        const base = 1.0 - (1.0 - shrinkMin) * eased;
                        const amp = 0.04 * (1 - eased);
                        const sx = base + amp * Math.sin(progress * Math.PI * 8.0);
                        const sy = base - amp * Math.sin(progress * Math.PI * 8.0);
                        target.set_scale?.(sx, sy);
                        const driftPx = this.settingsData?.DRIFT_PX?.get?.() ?? DRIFT_PX_DEFAULT;
                        const dy = driftPx * eased;
                        try { target.set_translation(0, dy, 0); } catch {}
                    } else {
                        const scaleVal = 1.0 - (1.0 - shrinkMin) * eased;
                        target.set_scale?.(scaleVal, scaleVal);
                        const driftPx = this.settingsData?.DRIFT_PX?.get?.() ?? DRIFT_PX_DEFAULT;
                        const dy = driftPx * eased;
                        try { target.set_translation(0, dy, 0); } catch {}
                    }
                    target.set_opacity?.(Math.max(0, Math.min(255, Math.round((1 - progress) * 255))));
                }
            }
        } catch (e) {
            if (this._debug) _safeLog('onFrame error: ' + e);
        }
    }

    _finish(actor) {
        if (this._debug) _safeLog(`_finish reverse=${this.reverse} actor=${_safeActorName(actor)}`);
        // guard disposed
        try { if (!actor || !actor.get_stage || !actor.get_stage()) { this.cancelEarly?.(actor); return; } } catch { return; }

        // stop timeline
        try { this._timeline?.stop?.(); } catch {}
        this._timeline = null;

        // Overlay-only: ne pas toucher l’opacité de l’acteur réel en fin d’animation

        // petit fade de fin sur le clone, puis cleanup
        const END_FADE_MS = 120;
        const doCleanup = () => {
            try { if (this._destroyConn && actor?.disconnect) actor.disconnect(this._destroyConn); } catch {}
            this._destroyConn = 0;
            // retirer shader si appliqué à l’acteur
            try {
                if (this._appliedToActor && this._shader) {
                    try { actor.remove_effect(this._shader); } catch {}
                    this._appliedToActor = false;
                }
            } catch {}

            // détruire le clone
            try {
                if (this._clone) {
                    try { this._clone.get_parent()?.remove_child(this._clone); } catch {}
                    try { this._clone.destroy(); } catch {}
                    this._clone = null;
                }
            } catch {}

            // aucune restauration d’opacité nécessaire en overlay-only

            // enlever l’effet
            try { actor.remove_effect(this); } catch {}
            try { actor[ACTOR_FLAG] = false; } catch {}
        };

        try {
            if (this._clone) {
                let usedAnim = false;
                try {
                    this._clone.animate?.(Clutter.AnimationMode.EASE_OUT_QUAD, END_FADE_MS, 'opacity', 0);
                    usedAnim = true;
                } catch {}
                if (!usedAnim) {
                    try { this._clone.ease?.({ opacity:0, duration:END_FADE_MS, mode:Clutter.AnimationMode.EASE_OUT_QUAD }); } catch {}
                }
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, END_FADE_MS + 30, () => { doCleanup(); return false; });
            } else {
                doCleanup();
            }
        } catch {
            doCleanup();
        }
    }

    // Allow handlers to cancel the effect early when switching phases
    cancelEarly(actor) {
        try {
            this._timeline?.stop?.();
        } catch {}
        try { if (this._destroyConn && actor?.disconnect) actor.disconnect(this._destroyConn); } catch {}
        this._destroyConn = 0;
        try {
            if (this._appliedToActor && this._shader) {
                try { actor.remove_effect(this._shader); } catch {}
                this._appliedToActor = false;
            }
        } catch {}
        try {
            if (this._clone) {
                try { this._clone.get_parent()?.remove_child(this._clone); } catch {}
                try { this._clone.destroy(); } catch {}
                this._clone = null;
            }
        } catch {}
        try { actor.remove_effect(this); } catch {}
        try { actor[ACTOR_FLAG] = false; } catch {}
    }
});
