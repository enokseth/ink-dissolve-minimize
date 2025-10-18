'use strict';

export class SettingsData {
  constructor(settings) {
    this.DURATION = {
      key: 'duration-ms',
      get: function () { return settings.get_int(this.key); },
      set: function (v) { return settings.set_int(this.key, v); }
    };
    this.NOISE_SCALE = {
      key: 'noise-scale',
      get: function () { return settings.get_double(this.key); },
      set: function (v) { return settings.set_double(this.key, v); }
    };
    this.INTENSITY = {
      key: 'intensity',
      get: function () { return settings.get_double(this.key); },
      set: function (v) { return settings.set_double(this.key, v); }
    };
    this.REVERSE_ON_RESTORE = {
      key: 'reverse-on-restore',
      get: function () { return settings.get_boolean(this.key); },
      set: function (v) { return settings.set_boolean(this.key, v); }
    };
    this.USE_SHADER = {
      key: 'use-shader',
      get: function () { return settings.get_boolean(this.key); },
      set: function (v) { return settings.set_boolean(this.key, v); }
    };
    this.SIMPLE_MODE = {
      key: 'simple-mode',
      get: function () { return settings.get_boolean(this.key); },
      set: function (v) { return settings.set_boolean(this.key, v); }
    };
    this.PRESET = {
      key: 'preset',
      get: function () { return settings.get_string(this.key); },
      set: function (v) { return settings.set_string(this.key, v); }
    };
    this.REVEAL_HOLD = {
      key: 'reveal-hold',
      get: function () { return settings.get_double(this.key); },
      set: function (v) { return settings.set_double(this.key, v); }
    };
    this.SHRINK_MIN = {
      key: 'shrink-min',
      get: function () { return settings.get_double(this.key); },
      set: function (v) { return settings.set_double(this.key, v); }
    };
    this.DRIFT_PX = {
      key: 'drift-px',
      get: function () { return settings.get_int(this.key); },
      set: function (v) { return settings.set_int(this.key, v); }
    };
    this.STYLE = {
      key: 'style',
      get: function () { return settings.get_string(this.key); },
      set: function (v) { return settings.set_string(this.key, v); }
    };
  }
}