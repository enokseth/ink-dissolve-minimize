'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Gio from 'gi://Gio';
import { SettingsData } from './settings_data.js';

export default class Prefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const data = new SettingsData(settings);

    window.set_default_size(700, 380);
    const page = new Adw.PreferencesPage();

    // Top group: Simple mode + Presets
    const gTop = new Adw.PreferencesGroup({ title: 'Easy' });

    const simpleRow = new Adw.ActionRow({ title: 'Simple mode' });
    const simpleSwitch = new Gtk.Switch({ active: data.SIMPLE_MODE.get(), valign: Gtk.Align.CENTER });
    simpleSwitch.connect('state-set', (_, state) => {
      data.SIMPLE_MODE.set(state);
      toggleAdvanced(state);
    });
    simpleRow.add_suffix(simpleSwitch);
    gTop.add(simpleRow);

    const presetRow = new Adw.ActionRow({ title: 'Preset' });
    const presetStore = new Gtk.StringList();
    ['Subtle', 'Default', 'Bold'].forEach(it => presetStore.append(it));
    const presetDrop = new Gtk.DropDown({ model: presetStore });
    const presetMap = { 'subtle': 0, 'default': 1, 'bold': 2 };
    const invPresetMap = ['subtle', 'default', 'bold'];
    presetDrop.set_selected(presetMap[data.PRESET.get()] ?? 1);
    presetDrop.connect('notify::selected', () => {
      const name = invPresetMap[presetDrop.get_selected()] ?? 'default';
      data.PRESET.set(name);
      applyPreset(name, data, { durScale: null, scale: null, intens: null });
    });
    presetRow.add_suffix(presetDrop);
    gTop.add(presetRow);

    const styleRow = new Adw.ActionRow({ title: 'Style', subtitle: 'Choose a visual effect' });
    const styleStore = new Gtk.StringList();
    ['Ink', 'Pixelate', 'Ripple', 'Wobble', 'Genie'].forEach(it => styleStore.append(it));
    const styleDrop = new Gtk.DropDown({ model: styleStore });
    const styleMap = { 'ink': 0, 'pixelate': 1, 'ripple': 2, 'wobble': 3, 'genie': 4 };
    const invStyleMap = ['ink', 'pixelate', 'ripple', 'wobble', 'genie'];
    styleDrop.set_selected(styleMap[data.STYLE.get()] ?? 0);
    styleDrop.connect('notify::selected', () => {
      const name = invStyleMap[styleDrop.get_selected()] ?? 'ink';
      data.STYLE.set(name);
      // Hide Ink-only advanced controls when not using Ink, to simplify UX
      const isInk = name === 'ink';
      scaleRow.set_visible(isInk);
      intensRow.set_visible(isInk);
    });
    styleRow.add_suffix(styleDrop);
    gTop.add(styleRow);

    const easyDurRow = new Adw.ActionRow({ title: 'Duration (ms)', subtitle: 'Overall animation length' });
    const easyDurAdj = new Gtk.Adjustment({ lower: 200, upper: 2000, step_increment: 50, page_increment: 100 });
    const easyDurScale = new Gtk.Scale({ adjustment: easyDurAdj, digits: 0, hexpand: true, value_pos: Gtk.PositionType.RIGHT });
    easyDurScale.set_value(data.DURATION.get());
    easyDurScale.connect('value-changed', w => data.DURATION.set(Math.round(w.get_value())));
    easyDurRow.add_suffix(easyDurScale);
    gTop.add(easyDurRow);

    const easyShrinkRow = new Adw.ActionRow({ title: 'Shrink min', subtitle: '0.6–0.95 (smaller = more shrink)' });
    const easyShrinkAdj = new Gtk.Adjustment({ lower: 0.6, upper: 0.95, step_increment: 0.01, page_increment: 0.05 });
    const easyShrinkScale = new Gtk.Scale({ adjustment: easyShrinkAdj, digits: 2, hexpand: true, value_pos: Gtk.PositionType.RIGHT });
    easyShrinkScale.set_value(data.SHRINK_MIN.get());
    easyShrinkScale.connect('value-changed', w => data.SHRINK_MIN.set(Number(w.get_value().toFixed(2))));
    easyShrinkRow.add_suffix(easyShrinkScale);
    gTop.add(easyShrinkRow);

    const easyDriftRow = new Adw.ActionRow({ title: 'Vertical drift (px)', subtitle: '0–80' });
    const easyDriftAdj = new Gtk.Adjustment({ lower: 0, upper: 80, step_increment: 2, page_increment: 10 });
    const easyDriftScale = new Gtk.Scale({ adjustment: easyDriftAdj, digits: 0, hexpand: true, value_pos: Gtk.PositionType.RIGHT });
    easyDriftScale.set_value(data.DRIFT_PX.get());
    easyDriftScale.connect('value-changed', w => data.DRIFT_PX.set(Math.round(w.get_value())));
    easyDriftRow.add_suffix(easyDriftScale);
    gTop.add(easyDriftRow);

    page.add(gTop);

    // Group 1: timing / behavior (advanced)
    const g1 = new Adw.PreferencesGroup({ title: 'Animation (advanced)' });

    const revRow = new Adw.ActionRow({ title: 'Reverse on restore' });
    const revSwitch = new Gtk.Switch({ active: data.REVERSE_ON_RESTORE.get(), valign: Gtk.Align.CENTER });
    revSwitch.connect('state-set', (_, state) => data.REVERSE_ON_RESTORE.set(state));
    revRow.add_suffix(revSwitch);
    g1.add(revRow);

    page.add(g1);

    // Group 2: look (advanced)
    const g2 = new Adw.PreferencesGroup({ title: 'Look (advanced)' });

    const scaleRow = new Adw.ActionRow({ title: 'Noise scale' });
    const scaleAdj = new Gtk.Adjustment({ lower: 2.0, upper: 20.0, step_increment: 0.5, page_increment: 1.0 });
    const scale = new Gtk.Scale({ adjustment: scaleAdj, digits: 1, hexpand: true, value_pos: Gtk.PositionType.RIGHT });
    scale.set_value(data.NOISE_SCALE.get());
    scale.connect('value-changed', w => data.NOISE_SCALE.set(w.get_value()));
    scaleRow.add_suffix(scale);
    g2.add(scaleRow);

    const intensRow = new Adw.ActionRow({ title: 'Ink intensity' });
    const intensAdj = new Gtk.Adjustment({ lower: 0.3, upper: 2.0, step_increment: 0.1, page_increment: 0.2 });
    const intens = new Gtk.Scale({ adjustment: intensAdj, digits: 1, hexpand: true, value_pos: Gtk.PositionType.RIGHT });
    intens.set_value(data.INTENSITY.get());
    intens.connect('value-changed', w => data.INTENSITY.set(w.get_value()));
    intensRow.add_suffix(intens);
    g2.add(intensRow);

    const shaderRow = new Adw.ActionRow({ title: 'Use shader (when available)' });
    const shaderSwitch = new Gtk.Switch({ active: data.USE_SHADER.get(), valign: Gtk.Align.CENTER });
    shaderSwitch.connect('state-set', (_, state) => data.USE_SHADER.set(state));
    shaderRow.add_suffix(shaderSwitch);

    // Quick-disable button to aid testing: immediately turn shader off
    const disableShaderBtn = new Gtk.Button({ label: 'Disable shader now', valign: Gtk.Align.CENTER });
    disableShaderBtn.connect('clicked', () => {
      try {
        data.USE_SHADER.set(false);
        shaderSwitch.set_active(false);
      } catch (e) { }
    });
    shaderRow.add_suffix(disableShaderBtn);
    g2.add(shaderRow);

    const holdRow = new Adw.ActionRow({ title: 'Reveal timing (hold ratio)', subtitle: '0.5-0.9 (higher = overlay hides later)' });
    const holdAdj = new Gtk.Adjustment({ lower: 0.5, upper: 0.9, step_increment: 0.01, page_increment: 0.05 });
    const holdScale = new Gtk.Scale({ adjustment: holdAdj, digits: 2, hexpand: true, value_pos: Gtk.PositionType.RIGHT });
    holdScale.set_value(data.REVEAL_HOLD.get());
    holdScale.connect('value-changed', w => data.REVEAL_HOLD.set(Number(w.get_value().toFixed(2))));
    holdRow.add_suffix(holdScale);
    g2.add(holdRow);

    page.add(g2);
    // Initial visibility based on current style
    try {
      const cur = data.STYLE.get();
      const isInk = cur === 'ink';
      scaleRow.set_visible(isInk);
      intensRow.set_visible(isInk);
    } catch (_) {}

    // Reset button in header
    const resetBtn = new Gtk.Button({ icon_name: 'edit-clear' });
    resetBtn.connect('clicked', () => {
      // Reset to Default preset by default in Simple mode; otherwise reset advanced values
      if (data.SIMPLE_MODE.get()) {
        data.PRESET.set('default');
        presetDrop.set_selected(1);
        applyPreset('default', data, { scale, intens });
        easyShrinkScale.set_value(data.SHRINK_MIN.get());
        easyDriftScale.set_value(data.DRIFT_PX.get());
      } else {
        data.DURATION.set(600);
        data.NOISE_SCALE.set(6.0);
        data.INTENSITY.set(1.0);
        data.REVERSE_ON_RESTORE.set(true);
        data.REVEAL_HOLD.set(0.7);
        try { easyDurScale.set_value(600); } catch (_) { }
        scale.set_value(6.0);
        intens.set_value(1.0);
        revSwitch.set_active(true);
        holdScale.set_value(0.7);
        easyShrinkScale.set_value(0.85);
        easyDriftScale.set_value(40);
      }
    });

    const content = window.get_content();
    const header = findWidgetByType(content, Adw.HeaderBar);
    if (header) header.pack_start(resetBtn);

    // Preview button
    const previewBtn = new Gtk.Button({ icon_name: 'media-playback-start', tooltip_text: 'Preview effect' });
    previewBtn.connect('clicked', () => showPreview(window, data));
    if (header) header.pack_start(previewBtn);

    // Initial toggle of advanced groups
    function toggleAdvanced(simpleOn) {
      const showAdvanced = !simpleOn;
      g1.set_visible(showAdvanced);
      g2.set_visible(showAdvanced);
    }
    function applyPreset(name, data, widgets) {
      // simple, safe presets (minimal knobs)
      let cfg = { dur: 600, scale: 6.0, intens: 1.0, shrink: 0.85, drift: 40 };
      if (name === 'subtle') cfg = { dur: 500, scale: 5.5, intens: 0.9, shrink: 0.88, drift: 28 };
      else if (name === 'bold') cfg = { dur: 750, scale: 7.0, intens: 1.2, shrink: 0.82, drift: 56 };
      data.DURATION.set(cfg.dur);
      data.NOISE_SCALE.set(cfg.scale);
      data.INTENSITY.set(cfg.intens);
      // also set a reasonable hold per preset
      const hold = name === 'subtle' ? 0.75 : name === 'bold' ? 0.65 : 0.70;
      data.REVEAL_HOLD.set(hold);
      data.SHRINK_MIN.set(cfg.shrink);
      data.DRIFT_PX.set(cfg.drift);
      // Update UI if provided
      if (widgets && widgets.durScale) widgets.durScale.set_value(cfg.dur);
      if (widgets.scale) widgets.scale.set_value(cfg.scale);
      if (widgets.intens) widgets.intens.set_value(cfg.intens);
      try { easyDurScale.set_value(cfg.dur); } catch (_) { }
      try { holdScale.set_value(hold); } catch (_) { }
      try { easyShrinkScale.set_value(cfg.shrink); } catch (_) { }
      try { easyDriftScale.set_value(cfg.drift); } catch (_) { }
    }

    toggleAdvanced(data.SIMPLE_MODE.get());
    if (data.SIMPLE_MODE.get()) {
      applyPreset(data.PRESET.get(), data, { scale, intens });
    }

    window.add(page);
  }
}

function findWidgetByType(parent, type) {
  for (const child of [...parent]) {
    if (child instanceof type) return child;
    const m = findWidgetByType(child, type);
    if (m) return m;
  }
  return null;
}

function showPreview(parentWindow, data) {
  const preview = new Gtk.Window({ transient_for: parentWindow, modal: true, default_width: 300, default_height: 200, title: 'Effect preview' });
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin: 12 });
  const area = new Gtk.DrawingArea({ hexpand: true, vexpand: true });
  box.append(area);
  preview.set_child(box);

  let start = Date.now();
  const dur = (data && data.DURATION && typeof data.DURATION.get === 'function') ? data.DURATION.get() : 600;

  const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
    // loop
    const elapsed = (Date.now() - start) % dur;
    const t = elapsed / dur;
    area.queue_draw();
    return GLib.SOURCE_CONTINUE;
  });

  area.set_draw_func((widget, ctx, width, height) => {
    const elapsed = (Date.now() - start) % dur;
    const t = elapsed / dur;
    const eased = 0.5 * (1 - Math.cos(t * Math.PI * 2));
    // background
    ctx.setSourceRGBA(0.1, 0.1, 0.1, 1.0);
    ctx.rectangle(0, 0, width, height);
    ctx.fill();
    // circle
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(width, height) * 0.3 * (1 + eased * 0.35);
    ctx.setSourceRGBA(0, 0, 0, 0.6 + 0.4 * (1 - eased));
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  });

  preview.present();
}
