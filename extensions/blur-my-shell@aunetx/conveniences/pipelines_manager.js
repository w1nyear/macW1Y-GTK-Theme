import GLib from 'gi://GLib';

const Signals = imports.signals;

function new_id(prefix) {
    return `${prefix}_${GLib.uuid_string_random()}`;
}

function clone_effect(effect) {
    return {
        ...effect,
        params: Object.fromEntries(
            Object.entries(effect.params ?? {}).map(([key, value]) => [
                key,
                Array.isArray(value) ? [...value] : value,
            ])
        ),
    };
}





























export class PipelinesManager {
    constructor(settings) {
        this.settings = settings;
        this.pipelines = this.settings.PIPELINES;
        this.settings.PIPELINES_changed(_ => this.on_pipeline_update());
    }

    create_pipeline(name, effects = []) {
        const id = new_id('pipeline');
        effects.forEach(effect => effect.id = new_id('effect'));

        this.pipelines[id] = { name, effects };
        this.settings.PIPELINES = this.pipelines;
        this._emit('pipeline-created', id, this.pipelines[id]);
        this._emit('pipeline-list-changed');
        return id;
    }

    duplicate_pipeline(id) {
        if (!(id in this.pipelines)) {
            this._warn(`could not duplicate pipeline, id ${id} does not exist`);
            return;
        }
        const pipeline = this.pipelines[id];
        this.create_pipeline(
            `${pipeline.name} - duplicate`,
            pipeline.effects.map(clone_effect)
        );
    }

    delete_pipeline(id) {
        if (!(id in this.pipelines)) {
            this._warn(`could not delete pipeline, id ${id} does not exist`);
            return;
        }
        if (id == "pipeline_default") {
            this._warn(`could not delete pipeline "pipeline_default" as it is immutable`);
            return;
        }
        delete this.pipelines[id];
        this.settings.PIPELINES = this.pipelines;
        this._emit(id + '::pipeline-destroyed');
        this._emit('pipeline-list-changed');
    }

    update_pipeline_effects(id, effects, emit_update_signal = true) {
        if (!(id in this.pipelines)) {
            this._warn(`could not update pipeline effects, id ${id} does not exist`);
            return;
        }
        this.pipelines[id].effects = [...effects];
        this.settings.PIPELINES = this.pipelines;
        if (emit_update_signal)
            this._emit(id + '::pipeline-updated');
    }

    rename_pipeline(id, name) {
        if (!(id in this.pipelines)) {
            this._warn(`could not rename pipeline, id ${id} does not exist`);
            return;
        }
        this.pipelines[id].name = name;
        this.settings.PIPELINES = this.pipelines;
        this._emit(id + '::pipeline-renamed', name);
        this._emit('pipeline-names-changed');
    }

    on_pipeline_update() {
        const old_pipelines = this.pipelines;
        this.pipelines = this.settings.PIPELINES;
        const old_ids = Object.keys(old_pipelines);
        const new_ids = Object.keys(this.pipelines);
        const list_changed = old_ids.length !== new_ids.length
            || old_ids.some(id => !(id in this.pipelines));
        let names_changed = false;

        for (const pipeline_id of new_ids) {
            if (!(pipeline_id in old_pipelines))
                this._emit('pipeline-created', pipeline_id, this.pipelines[pipeline_id]);
        }

        for (const pipeline_id of old_ids) {

            if (!(pipeline_id in this.pipelines)) {
                this._emit(pipeline_id + '::pipeline-destroyed');
                continue;
            }

            const old_pipeline = old_pipelines[pipeline_id];
            const new_pipeline = this.pipelines[pipeline_id];

            if (old_pipeline.name !== new_pipeline.name) {
                this._emit(pipeline_id + '::pipeline-renamed', new_pipeline.name);
                names_changed = true;
            }



            if (
                old_pipeline.effects.length == new_pipeline.effects.length &&
                old_pipeline.effects.every((effect, i) => effect.id === new_pipeline.effects[i].id)
            ) {
                for (let i = 0; i < old_pipeline.effects.length; i++) {
                    const old_effect = old_pipeline.effects[i];
                    const new_effect = new_pipeline.effects[i];
                    const id = old_effect.id;
                    for (let key in old_effect.params) {

                        if (!(key in new_effect.params))
                            this._emit(
                                pipeline_id + '::effect-' + id + '-key-removed', key
                            );

                        else if (old_effect.params[key] != new_effect.params[key])
                            this._emit(
                                pipeline_id + '::effect-' + id + '-key-updated', key, new_effect.params[key]
                            );
                    }
                    for (let key in new_effect.params) {

                        if (!(key in old_effect.params))
                            this._emit(
                                pipeline_id + '::effect-' + id + '-key-added', key, new_effect.params[key]
                            );
                    }
                }
            }

            else
                this._emit(pipeline_id + '::pipeline-updated', new_pipeline);
        }

        if (list_changed)
            this._emit('pipeline-list-changed');
        if (names_changed)
            this._emit('pipeline-names-changed');
    }

    destroy() {
        this.settings.PIPELINES_disconnect();
    }

    _emit(signal, ...args) {
        this.emit(signal, ...args);
        this._log(`signal: '${signal}', arguments: ${args}`);
    }

    _log(str) {
        if (this.settings.DEBUG)
            console.log(`[Blur my Shell > pipelines]    ${str}`);
    }

    _warn(str) {
        console.warn(`[Blur my Shell > pipelines]    ${str}`);
    }
}

Signals.addSignalMethods(PipelinesManager.prototype);
