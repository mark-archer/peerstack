import { shuffle } from "lodash";
import { hashBlob } from "./common";
import { chunkSize, connections, IDeviceConnection } from "./connections";
import { getDB, hasPermission, IData, IFile } from "./db";
import { getCurrentConnection, remotelyCallableFunctions, RPC, verifyRemoteUser } from "./remote-calls";

remotelyCallableFunctions.getFile = getFile;

console.log('remote-files');

export async function getFileFromPeers(fileId: string, updateProgress?: (percent: number) => any): Promise<IFile> {
  // for (const connection of shuffle(connections.filter(c => c.remoteUserVerified))) {
  for (const connection of connections) {
    if (!connection.remoteUserVerified) {
      try {
        await verifyRemoteUser(connection);
      } catch (err) {
        console.error('error verifying conneciton')
      }
    }
    const file = await RPC(connection, getFile)(fileId).catch(err => console.error('Error getting file from peers', err));
    if (file) {
      return new Promise((resolve, reject) => {
        const dcReceive = connection.pc.createDataChannel(`file-${file.id}`);
        dcReceive.onopen = e => console.log('receive dc open');
        let receiveBuffer = [];
        let receivedSize = 0;
        // let pid;
        // const TRANSFER_TIMEOUT_MS = 3000;
        // function refreshWatchDog() {
        //   clearTimeout(pid);
        //   pid = setTimeout(() => {
        //     dcReceive.close();
        //     console.log('file transfer timed out', dcReceive.label)
        //     reject(new Error('file transfer timed out'));
        //   }, TRANSFER_TIMEOUT_MS);
        // }
        
        dcReceive.onmessage = e => {
          // refreshWatchDog();
          receiveBuffer.push(e.data);
          receivedSize += e.data.byteLength;

          if (updateProgress) updateProgress(receivedSize / file.size);

          if (receivedSize === file.size) {
            file.blob = new Blob(receiveBuffer);
            hashBlob(file.blob, updateProgress)
              .then(sha => {
                if (sha != file.id) return reject(new Error('File failed verification after transfer'))
                receiveBuffer = [];
                resolve(file);
                dcReceive.close();
              })
          }
        }
        dcReceive.onbufferedamountlow = e => console.log('buffered amount low');
        dcReceive.onclose = e => console.log('dc closed');
        dcReceive.onerror = e => {
          console.log('Error receiving file', e);
          reject(e);
        }
      });
    }
  }
}


// This is used to stream one file at a time per connection. It's better to get one file all the way through than many files a little bit through
const getFilePromises: { [connectionId: string]: Promise<void> } = {}

async function getFile(fileId: string) {
  const connection = getCurrentConnection() as IDeviceConnection;
  const db = await getDB();
  const file = await db.files.get(fileId);
  if (!file) return;

  // validate peer has permissions to file
  if (connection.me.id !== connection.remoteUser.id && !file.isPublic) {
    const remoteUserId = connection.remoteUser.id;
    if (!(file.shareUsers || []).includes(remoteUserId)) {
      const hasReadPermissions = (file.shareGroups || []).some(groupId => hasPermission(remoteUserId, groupId, 'read', db));
      if (!hasReadPermissions) {
        throw new Error(`Unauthorized access to file ${fileId}`);
      }
    }
  }

  let getFilePromise = getFilePromises[connection.id];
  if (!getFilePromise) {
    getFilePromise = Promise.resolve();
  }

  // getFilePromise = 
  getFilePromise.then(() => new Promise<void>((resolve) => {
    connection.waitForDataChannel(`file-${file.id}`).then(dcSend => {
      console.log('send dc open', dcSend);
      dcSend.onclose = e => {
        console.log('file transfer data channel closed', e);
        resolve();
      }
      dcSend.onerror = e => {
        console.error('error', e);
        resolve();
      }
      dcSend.onmessage = e => console.log('Error: message was received from a send only data channel', e);

      const fileReader = new FileReader();
      let offset = 0;
      fileReader.addEventListener('error', error => {
        console.error('Error reading file:', error);
        resolve();
      })
      fileReader.addEventListener('abort', event => {
        console.log('File reading aborted:', event)
        resolve()
      });
      fileReader.addEventListener('load', e => {
        const bytes = e.target.result as ArrayBuffer;
        dcSend.send(bytes);
        offset += bytes.byteLength;
        if (offset < file.size) {
          readSlice();
        } else {
          resolve();
        }
      });
      let backPressure = 0;
      const maxBufferedAmount = chunkSize * 100;
      const readSlice = () => {
        if (dcSend.readyState === 'closed' || 2 ** backPressure >= 1000) {
          resolve();
          return console.log('connection closed or not processing data, halting file transfer')
        }
        if (dcSend.bufferedAmount > maxBufferedAmount) {
          console.log(`waiting for buffer to get processed`, { backPressure, waitTimeMs: 2 ** backPressure }, dcSend.bufferedAmount);
          return setTimeout(() => {
            readSlice();
          }, 2 ** backPressure++);
        }
        backPressure = 0;
        const slice = file.blob.slice(offset, offset + chunkSize);
        fileReader.readAsArrayBuffer(slice);
      };

      // Event should be better than polling (with setTimeout) but couldn't get it to work
      // dcSend.onbufferedamountlow = e => {
      //   console.log('buffered amount low', e);
      //   if (offset < file.size) {
      //     readSlice(offset);
      //   }
      // }
      readSlice();
    })
  }))

  getFilePromises[connection.id] = getFilePromise;

  return file;
}