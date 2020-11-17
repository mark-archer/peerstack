import { hashObject, isEmail } from "./common"
import * as _ from 'lodash';
import 'should';

describe("common", () => {
  describe("isEmail", () => {
    it('should return true for valid email', () => {
      isEmail('test@test.com').should.be.true();
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