global.before = (f) => beforeAll(f);
global.after = (f) => afterAll(f);
global.context = (desc, f) => describe(desc, f);