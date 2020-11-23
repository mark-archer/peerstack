import { hashObject, isEmail } from "./common"
import * as _ from 'lodash';
import 'should';

describe("common", () => {
  describe("isEmail", () => {
    it('should return true for valid email', () => {
      expect(isEmail('test@test.com')).toBeTruthy();
    })
  })

  describe("hashObject", () => {
    it('should produce hashes much less in size than the object', () => {
      const obj = { nums: _.range(100000) };
      const hash = hashObject(obj);
      hash.length.should.be.lessThan(100);      
    })
  })
})