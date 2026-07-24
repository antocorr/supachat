import { RpcAble, extend } from 'rpcable';

const ENDPOINT = '/rpc/user-session'; // adjust

class Session {
    joined({ user }) {
        // optional: hydrate auth/user state
    }
}

const session = new Session();

export const userSession = new RpcAble({
    transport: 'http',
    endpoint: ENDPOINT,
    target: session,
});

extend(userSession, {
    gamesReceived(games) {
        // optional: update shared store
    },
    'scenes.deleted': ({ sceneId }) => {
        // optional: notify current view
    },
});
