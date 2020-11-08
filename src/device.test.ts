import { isid } from "./common";
import { newDevice } from "./device"

test('newDevice', () => {
  const device = newDevice();
  expect(typeof device.id).toBe('string')
  expect(isid(device.id)).toEqual(true);
})