


const DESTROYED_ACTORS = new WeakSet();
const WATCHED_ACTORS = new WeakSet();


export function watchActorLifecycle(actor) {
    if (!actor || WATCHED_ACTORS.has(actor))
        return actor;

    WATCHED_ACTORS.add(actor);
    actor.connect('destroy', () => DESTROYED_ACTORS.add(actor));
    return actor;
}


export function isActorDestroyed(actor) {
    if (!actor || DESTROYED_ACTORS.has(actor))
        return true;

    const flag = actor.is_destroyed;
    return typeof flag === 'function' ? !!flag.call(actor) : Boolean(flag);
}
