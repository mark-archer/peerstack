import { isEmail } from "./common"
import 'should';

describe("common", () => {
  describe("isEmail", () => {
    it('should return true for valid email', () => {
      isEmail('test@test.com').should.be.true();
    })
  })
})