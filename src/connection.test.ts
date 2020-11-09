import { newid } from "./common";
import { IConnection, txfn } from "./connection";
import { newMe } from "./user";
import { newConnection, makeRemoteCall, RPC, ping } from "./connection";

describe('connection', () => {
  test('ping remote', async () => {
    const localDeviceId = newid();
    const remoteDeviceId = newid();
    
    const me = newMe();
    const remoteUser = newMe();

    const connLocal: IConnection = newConnection(remoteDeviceId, null);
    connLocal.me = me;
    connLocal.remoteUser = remoteUser;
    
    const connRemote: IConnection = newConnection(localDeviceId, null);
    connRemote.me = remoteUser;
    connRemote.remoteUser = me;
    
    connLocal.send = data => connRemote.receive(JSON.parse(JSON.stringify(data)));
    connRemote.send = data => connLocal.receive(JSON.parse(JSON.stringify(data)));
    
    const results = await RPC(connLocal, ping)(1, "1");
    expect(results).toEqual(['pong', 1, "1"])
  });
});