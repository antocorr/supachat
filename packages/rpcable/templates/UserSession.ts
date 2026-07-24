import { RpcAble, RpcAbleReceiver } from 'rpcable';

type ClientProxy = RpcAble & Record<string, (...args: any[]) => any>;

export default class UserSession {
    client: ClientProxy;
    readonly receiver: RpcAbleReceiver;
    readonly userId: string;
    readonly user: any;

    constructor(userData: any) {
        this.user = userData;
        this.userId = userData?.userId ?? userData?.id ?? '';
        this.client = new RpcAble({ transport: 'collector' }) as ClientProxy;
        this.receiver = new RpcAbleReceiver({ target: this });
    }

    setClient(client: ClientProxy) {
        this.client = client;
    }

    // async getItems() {
    //     const items = await db.find('items', {});
    //     this.client.itemsReceived(items);
    // }
}
