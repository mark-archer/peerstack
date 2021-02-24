import { shuffle } from "lodash";
import { hashBlob } from "./common";
import { chunkSize, connections, IDeviceConnection } from "./connections";
import { getIndexedDB, hasPermission, IData, IFile } from "./db";
import { getCurrentConnection, remotelyCallableFunctions, RPC } from "./remote-calls";

remotelyCallableFunctions.getFile = getFile;

export async function getFileFromPeers(fileId: string, updateProgress?: (percent: number) => any): Promise<IFile> {
  for (const connection of shuffle(connections)) {
    const file = await RPC(connection, getFile)(fileId);
    if (file) {
      return new Promise((resolve, reject) => {
        const dcReceive = connection.pc.createDataChannel(`file-${file.id}`);
        dcReceive.onopen = e => console.log('receive dc open', e);
        let receiveBuffer = [];
        let receivedSize = 0;
        dcReceive.onmessage = e => {
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
        dcReceive.onbufferedamountlow = e => console.log('buffered amount low', e);
        dcReceive.onclose = e => console.log('closed', e);
        dcReceive.onerror = e => console.log('error', e);
      });
    }
  }
}

async function getFile(fileId: string) {
  const connection = getCurrentConnection() as IDeviceConnection;
  const db = await getIndexedDB()
  const file = await db.files.get(fileId)
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

  connection.waitForDataChannel(`file-${file.id}`).then(dcSend => {
    console.log('send dc open', dcSend);
    dcSend.onclose = e => console.log('file transfer data channel closed', e);
    dcSend.onerror = e => console.error('error', e);
    dcSend.onmessage = e => console.log('message was received from a send only data channel', e)

    const fileReader = new FileReader();
    let offset = 0;
    fileReader.addEventListener('error', error => console.error('Error reading file:', error));
    fileReader.addEventListener('abort', event => console.log('File reading aborted:', event));
    fileReader.addEventListener('load', e => {
      const bytes = e.target.result as ArrayBuffer;
      dcSend.send(bytes);
      offset += bytes.byteLength;
      if (offset < file.size) {
        readSlice(offset);
      }
    });
    let waitCounter = 0;
    const readSlice = o => {
      if (dcSend.readyState === 'closed' || waitCounter >= 10000) {
        return console.log('connection closed or not processing data, halting file transfer')
      }
      if (dcSend.bufferedAmount > chunkSize * 64) {
        waitCounter++;
        // console.log(`waiting for buffer to get processed`, { waitCounter, waitTimeMs }, dcSend.bufferedAmount);
        return setTimeout(() => {
          readSlice(o);
        }, 1);
      }
      waitCounter = 0;
      const slice = file.blob.slice(offset, o + chunkSize);
      fileReader.readAsArrayBuffer(slice);
    };

    // Event should be better than polling (with setTimeout) but couldn't get it to work
    // dcSend.onbufferedamountlow = e => {
    //   console.log('buffered amount low', e);
    //   if (offset < file.size) {
    //     readSlice(offset);
    //   }
    // }
    readSlice(0);
  })
  return file;
}