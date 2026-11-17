import GLib from 'gi://GLib';
import { pack_pipelines, unpack_pipelines } from './pipeline_settings.js';
const Signals = imports.signals;


export const Type = {
    B: 'Boolean',
    I: 'Integer',
    D: 'Double',
    S: 'String',
    C: 'Color',
    AS: 'StringArray',
    PIPELINES: 'Pipelines'
};












export const Settings = class Settings {
    constructor(keys, settings) {
        this.settings = settings;
        this.keys = keys;

        this.keys.forEach(bundle => {
            let component = this;
            let component_settings = settings;
            if (bundle.component !== "general") {
                let bundle_component = bundle.component.replaceAll('-', '_');
                this[bundle_component] = {
                    settings: this.settings.get_child(bundle.component)
                };
                component = this[bundle_component];
                component_settings = settings.get_child(bundle.component);
            }


            bundle.schemas.forEach(key => {
                let property_name = this.get_property_name(key.name);

                switch (key.type) {
                    case Type.B:
                        Object.defineProperty(component, property_name, {
                            get() {
                                return component_settings.get_boolean(key.name);
                            },
                            set(v) {
                                component_settings.set_boolean(key.name, v);
                            }
                        });
                        break;

                    case Type.I:
                        Object.defineProperty(component, property_name, {
                            get() {
                                return component_settings.get_int(key.name);
                            },
                            set(v) {
                                component_settings.set_int(key.name, v);
                            }
                        });
                        break;

                    case Type.D:
                        Object.defineProperty(component, property_name, {
                            get() {
                                return component_settings.get_double(key.name);
                            },
                            set(v) {
                                component_settings.set_double(key.name, v);
                            }
                        });
                        break;

                    case Type.S:
                        Object.defineProperty(component, property_name, {
                            get() {
                                return component_settings.get_string(key.name);
                            },
                            set(v) {
                                component_settings.set_string(key.name, v);
                            }
                        });
                        break;

                    case Type.C:
                        Object.defineProperty(component, property_name, {


                            get() {
                                let val = component_settings.get_value(key.name);
                                return val.deep_unpack();
                            },


                            set(v) {
                                let val = new GLib.Variant("(dddd)", v);
                                component_settings.set_value(key.name, val);
                            }
                        });
                        break;

                    case Type.AS:
                        Object.defineProperty(component, property_name, {
                            get() {
                                let val = component_settings.get_value(key.name);
                                return val.deep_unpack();
                            },
                            set(v) {
                                let val = new GLib.Variant("as", v);
                                component_settings.set_value(key.name, val);
                            }
                        });
                        break;

                    case Type.PIPELINES:
                        Object.defineProperty(component, property_name, {
                            get() {
                                try {
                                    return unpack_pipelines(component_settings.get_value(key.name));
                                } catch (error) {
                                    this._warn(`impossible to get pipelines, resetting: ${error.message}`);
                                    component_settings.reset(key.name);
                                    return unpack_pipelines(component_settings.get_value(key.name));
                                }
                            },
                            set(pipelines) {
                                try {
                                    component_settings.set_value(key.name, pack_pipelines(pipelines));
                                } catch (error) {
                                    this._warn(`impossible to set pipelines: ${error.message}`);
                                }
                            }
                        });
                        break;
                }


                component[property_name + '_reset'] = function () {
                    return component_settings.reset(key.name);
                };

                component[property_name + '_signal_ids'] = [];
                component[property_name + '_changed'] = function (cb) {
                    component[property_name + '_signal_ids'].push(
                        component_settings.connect('changed::' + key.name, cb)
                    );
                };

                component[property_name + '_disconnect'] = function () {
                    component[property_name + '_signal_ids'].forEach(
                        id => component_settings.disconnect(id)
                    );
                    component[property_name + '_signal_ids'] = [];
                };
            });
        });
    };


    reset() {
        this.keys.forEach(bundle => {
            let component = this;
            if (bundle.component !== "general") {
                let bundle_component = bundle.component.replaceAll('-', '_');
                component = this[bundle_component];
            }

            bundle.schemas.forEach(key => {
                let property_name = this.get_property_name(key.name);
                component[property_name + '_reset']();
            });
        });

        this.emit('reset', true);
    }



    get_property_name(name) {
        return name.replaceAll('-', '_').toUpperCase();
    }



    disconnect_all_settings() {
        this.keys.forEach(bundle => {
            let component = this;
            if (bundle.component !== "general") {
                let bundle_component = bundle.component.replaceAll('-', '_');
                component = this[bundle_component];
            }

            bundle.schemas.forEach(key => {
                let property_name = this.get_property_name(key.name);
                component[property_name + '_disconnect']();
            });
        });
    }

    _warn(str) {
        console.warn(`[Blur my Shell > settings]     ${str}`);
    }
};

Signals.addSignalMethods(Settings.prototype);
