import { newid } from "./common";
import { IConnection, testError, IRemoteChunk, newConnection, RPC, ping, IRemoteData, receiveMessage, IRemoteCall } from "./remote-calls";
import { newMe, signMessage, signObject } from "./user";
import { should } from 'should';

describe('connection', () => {
  const localDeviceId = newid();
  const remoteDeviceId = newid();
    
  const me = newMe();
  const remoteUser = newMe();

  let connLocal: IConnection;
  let connRemote: IConnection;

  const fakeFn = () => 1;

  beforeEach(() => {
    connLocal = newConnection(remoteDeviceId, null);
    connLocal.me = me;
    connLocal.remoteUser = remoteUser;
    
    connRemote = newConnection(localDeviceId, null);
    connRemote.me = remoteUser;
    connRemote.remoteUser = me;

    connLocal.send = async data => {
      await new Promise(resolve => setTimeout(resolve));
      receiveMessage(connRemote, JSON.parse(JSON.stringify(data)));
    }
    connRemote.send = async data => {
      await new Promise(resolve => setTimeout(resolve));
      receiveMessage(connLocal, JSON.parse(JSON.stringify(data)));
    }
  });
  
  describe('RPC with sync channels', () => {
    beforeEach(() => {
      connLocal.send = data => receiveMessage(connRemote, JSON.parse(JSON.stringify(data)));
      connRemote.send = data => receiveMessage(connLocal, JSON.parse(JSON.stringify(data)));
    });
    
    it('should work with ping', async () => {
      const results = await RPC(connLocal, ping)(1, "1");
      expect(results).toEqual(['pong', 1, "1"])
    });
  
    it('should return an error message when an error occurs on the remote device', async () => {
      await expect(() => RPC(connLocal, fakeFn)()).rejects.toMatch('fakeFn is not a remotely callable function');
    })
  });

  describe('RPC signature fails', () => {
    beforeEach(() => {
      connLocal.send = (data: IRemoteCall) => {
        data.fnName = 'tampered with';
        return receiveMessage(connRemote, JSON.parse(JSON.stringify(data))) 
      }
      connRemote.send = data => receiveMessage(connLocal, JSON.parse(JSON.stringify(data))) 
    });
  
    it('should return an error message', async () => {
      await expect(() => RPC(connLocal, fakeFn)()).rejects.toMatch('verification of remote message failed');
    })
  });

  describe('RPC with async channels', () => {
    it('should work with ping', async () => {
      const results = await RPC(connLocal, ping)(1, "1");
      expect(results).toEqual(['pong', 1, "1"])
    });
  
    it('should return an error message when an error occurs on the remote device', async () => {
      await expect(() => RPC(connLocal, fakeFn)()).rejects.toMatch('fakeFn is not a remotely callable function');
    })
  });

  describe('RPC fails locally', () => {
    let _connLocal: IConnection;
    beforeEach(() => {
      _connLocal = {...connLocal}
      _connLocal.me = null;
    })
    it('should return an error message', async () => {
      try {
        await RPC(_connLocal, fakeFn)();
        throw 'should not get here'
      } catch (err) {
        expect(String(err)).toMatch("Cannot read property 'secretKey' of null");
      }
    })
  })

  describe('RPC fails remotely', () => {
    it('should return an error message', async () => {
      try {
        await RPC(connLocal, testError)('BOOM');
        throw 'should not get here'
      } catch (err) {
        expect(String(err)).toMatch("BOOM");
      }
    })
  })

  describe('onPeerMessage', () => {
    beforeEach(() => {
      connLocal.send = data => receiveMessage(connRemote, JSON.stringify(data));
      connRemote.send = data => receiveMessage(connLocal, JSON.stringify(data));
    });
    
    it('should parse as string as JSON', async () => {
      const response = await RPC(connLocal, ping)(1, '1');
      expect(response).toMatchObject(['pong', 1, '1']);      
    })

    it('should accept data in chunks', async () => {
      const strChunkSize = 10;
      connLocal.send = async (data: IRemoteData) => {
        const strData = JSON.stringify(data);
        const totalChunks = Math.ceil(strData.length / strChunkSize);
        expect(totalChunks).toBeGreaterThan(10);
        const id = data.id;
        for (var i = 0; i < strData.length; i += strChunkSize) {
          const chunk = strData.substr(i, strChunkSize);
          const chunkPayload: IRemoteChunk = {
            type: 'chunk',
            id,
            iChunk: i / strChunkSize,
            totalChunks,
            chunk,
            signature: undefined
          }
          receiveMessage(connRemote, JSON.stringify(chunkPayload));   
        }
      }
      const response = await RPC(connLocal, ping)(1, '1');
      expect(response).toMatchObject(['pong', 1, '1']);      
    })

    // it('throw an error if an unknown type is sent', async () => {
    //   expect(() => onPeerMessage(connLocal, {} as any)).rejects.toMatch()
    // })
  })
});